/**
 * Theme Context — RGBA-based color system for the TUI
 *
 * Detects the terminal's actual background color using:
 *   1. OSC 11 escape sequence (queries terminal directly)
 *   2. COLORFGBG environment variable (fallback)
 *   3. Defaults to dark theme
 *
 * Can also set the terminal background to match the chosen theme.
 */

import { RGBA, rgbToHex } from "@opentui/core";
import { createContext, useContext, useState, useEffect } from "react";
import type { ReactNode } from "react";

export interface Theme {
  text: RGBA;
  textMuted: RGBA;
  textDim: RGBA;
  primary: RGBA;
  secondary: RGBA;
  success: RGBA;
  error: RGBA;
  warning: RGBA;
  info: RGBA;
  border: RGBA;
  borderFocused: RGBA;
  bg: RGBA;
  bgSubtle: RGBA;
  // Roles
  userText: RGBA;
  assistantText: RGBA;
  systemText: RGBA;
  toolText: RGBA;
  // Tool status
  toolRunning: RGBA;
  toolDone: RGBA;
  toolError: RGBA;
  // Diff
  diffAdd: RGBA;
  diffRemove: RGBA;
  diffHunk: RGBA;
}

const DARK: Theme = {
  text: RGBA.fromHex("#e5e7eb"),
  textMuted: RGBA.fromHex("#9ca3af"),
  textDim: RGBA.fromHex("#6b7280"),
  primary: RGBA.fromHex("#06b6d4"),
  secondary: RGBA.fromHex("#8b5cf6"),
  success: RGBA.fromHex("#22c55e"),
  error: RGBA.fromHex("#ef4444"),
  warning: RGBA.fromHex("#eab308"),
  info: RGBA.fromHex("#3b82f6"),
  border: RGBA.fromHex("#374151"),
  borderFocused: RGBA.fromHex("#06b6d4"),
  bg: RGBA.fromHex("#111827"),
  bgSubtle: RGBA.fromHex("#1f2937"),
  userText: RGBA.fromHex("#22c55e"),
  assistantText: RGBA.fromHex("#e5e7eb"),
  systemText: RGBA.fromHex("#eab308"),
  toolText: RGBA.fromHex("#9ca3af"),
  toolRunning: RGBA.fromHex("#eab308"),
  toolDone: RGBA.fromHex("#22c55e"),
  toolError: RGBA.fromHex("#ef4444"),
  diffAdd: RGBA.fromHex("#22c55e"),
  diffRemove: RGBA.fromHex("#ef4444"),
  diffHunk: RGBA.fromHex("#3b82f6"),
};

const LIGHT: Theme = {
  text: RGBA.fromHex("#1f2937"),
  textMuted: RGBA.fromHex("#6b7280"),
  textDim: RGBA.fromHex("#9ca3af"),
  primary: RGBA.fromHex("#0891b2"),
  secondary: RGBA.fromHex("#7c3aed"),
  success: RGBA.fromHex("#16a34a"),
  error: RGBA.fromHex("#dc2626"),
  warning: RGBA.fromHex("#ca8a04"),
  info: RGBA.fromHex("#2563eb"),
  border: RGBA.fromHex("#d1d5db"),
  borderFocused: RGBA.fromHex("#0891b2"),
  bg: RGBA.fromHex("#ffffff"),
  bgSubtle: RGBA.fromHex("#f3f4f6"),
  userText: RGBA.fromHex("#16a34a"),
  assistantText: RGBA.fromHex("#1f2937"),
  systemText: RGBA.fromHex("#ca8a04"),
  toolText: RGBA.fromHex("#6b7280"),
  toolRunning: RGBA.fromHex("#ca8a04"),
  toolDone: RGBA.fromHex("#16a34a"),
  toolError: RGBA.fromHex("#dc2626"),
  diffAdd: RGBA.fromHex("#16a34a"),
  diffRemove: RGBA.fromHex("#dc2626"),
  diffHunk: RGBA.fromHex("#2563eb"),
};

/**
 * Calculate relative luminance from RGB values (0-255).
 * Uses the sRGB luminance formula from WCAG 2.0.
 */
function luminance(r: number, g: number, b: number): number {
  const [rs, gs, bs] = [r, g, b].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

/**
 * Detect terminal background color using OSC 11 escape sequence.
 * Returns { r, g, b } (0-255) or null if detection fails.
 *
 * OSC 11 works in most modern terminals: iTerm2, Terminal.app, Kitty,
 * Alacritty, WezTerm, foot, xterm, GNOME Terminal, etc.
 */
function queryTerminalBackground(): Promise<{ r: number; g: number; b: number } | null> {
  return new Promise((resolve) => {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      resolve(null);
      return;
    }

    const timeout = setTimeout(() => {
      cleanup();
      resolve(null);
    }, 500); // 500ms timeout — if terminal doesn't respond, give up

    let buf = "";

    const onData = (data: Buffer) => {
      buf += data.toString();
      // Response format: \x1b]11;rgb:RRRR/GGGG/BBBB\x07  (or \x1b\\ as terminator)
      // Some terminals use 4-digit hex per component, some use 2-digit
      const match = buf.match(
        /\x1b\]11;rgb:([0-9a-fA-F]{2,4})\/([0-9a-fA-F]{2,4})\/([0-9a-fA-F]{2,4})/
      );
      if (match) {
        cleanup();
        // Normalize to 0-255 range (4-digit values are 0-65535, 2-digit are 0-255)
        const parse = (hex: string) =>
          hex.length <= 2 ? parseInt(hex, 16) : Math.round((parseInt(hex, 16) / 65535) * 255);
        resolve({ r: parse(match[1]), g: parse(match[2]), b: parse(match[3]) });
      }
    };

    const cleanup = () => {
      clearTimeout(timeout);
      process.stdin.removeListener("data", onData);
      if (wasRaw === false) process.stdin.setRawMode(false);
    };

    const wasRaw = process.stdin.isRaw;
    try {
      process.stdin.setRawMode(true);
    } catch {
      resolve(null);
      return;
    }
    process.stdin.on("data", onData);

    // Send OSC 11 query: "what is your background color?"
    process.stdout.write("\x1b]11;?\x07");
  });
}

/**
 * Synchronous fallback: check COLORFGBG env var.
 * Format: "foreground;background" where values are ANSI color indices (0-15).
 * Background > 8 typically means a light terminal.
 */
function detectThemeFromEnv(): "dark" | "light" {
  const bg = process.env.COLORFGBG;
  if (bg) {
    const parts = bg.split(";");
    const bgVal = parseInt(parts[parts.length - 1] || "0", 10);
    if (bgVal > 8) return "light";
  }
  return "dark";
}

function detectTheme(): Theme {
  return detectThemeFromEnv() === "light" ? LIGHT : DARK;
}

/** Cached result of async terminal background detection */
let _detectedMode: "dark" | "light" | null = null;

/**
 * Async terminal background detection. Call once at startup before rendering.
 * Queries the terminal directly via OSC 11, falls back to COLORFGBG.
 */
export async function detectTerminalTheme(): Promise<"dark" | "light"> {
  if (_detectedMode) return _detectedMode;

  const rgb = await queryTerminalBackground();
  if (rgb) {
    const lum = luminance(rgb.r, rgb.g, rgb.b);
    // Luminance > 0.5 means the background is light
    _detectedMode = lum > 0.5 ? "light" : "dark";
  } else {
    _detectedMode = detectThemeFromEnv();
  }
  return _detectedMode;
}

/**
 * Set the terminal's background color using OSC 11.
 * Pass an RGBA hex color (e.g. from theme.bg).
 */
export function setTerminalBackground(color: RGBA): void {
  if (!process.stdout.isTTY) return;
  const hex = rgbToHex(color);
  // OSC 11 set: \x1b]11;#RRGGBB\x07
  process.stdout.write(`\x1b]11;${hex}\x07`);
}

/**
 * Restore the terminal's default background color.
 * Call this on exit to leave the terminal clean.
 */
export function restoreTerminalBackground(): void {
  if (!process.stdout.isTTY) return;
  // OSC 111 resets the background to the terminal's configured default
  process.stdout.write("\x1b]111;\x07");
}

const ThemeContext = createContext<{
  theme: Theme;
  mode: "dark" | "light" | "auto";
  setMode: (m: "dark" | "light" | "auto") => void;
  syncTerminalBg: boolean;
  setSyncTerminalBg: (sync: boolean) => void;
} | undefined>(undefined);

export function ThemeProvider(props: {
  mode?: string;
  syncTerminalBg?: boolean;
  detectedMode?: "dark" | "light";
  children: ReactNode;
}) {
  const resolveTheme = (m: string | undefined): Theme => {
    if (m === "light") return LIGHT;
    if (m === "auto") {
      // Use pre-detected mode if available, otherwise sync fallback
      if (props.detectedMode) return props.detectedMode === "light" ? LIGHT : DARK;
      return detectTheme();
    }
    return DARK;
  };

  const [theme, setTheme] = useState<Theme>(resolveTheme(props.mode));
  const [currentMode, setCurrentMode] = useState<"dark" | "light" | "auto">(
    (props.mode as "dark" | "light" | "auto") || "auto"
  );
  const [syncBg, setSyncBg] = useState(props.syncTerminalBg ?? false);

  const setMode = (m: "dark" | "light" | "auto") => {
    setCurrentMode(m);
    const newTheme = m === "light" ? LIGHT : m === "auto" ? detectTheme() : DARK;
    setTheme(newTheme);
    if (syncBg) {
      setTerminalBackground(newTheme.bg);
    }
  };

  const setSyncTerminalBg = (sync: boolean) => {
    setSyncBg(sync);
    if (sync) {
      setTerminalBackground(theme.bg);
    } else {
      restoreTerminalBackground();
    }
  };

  // Set terminal background on mount if sync is enabled
  useEffect(() => {
    if (syncBg) {
      setTerminalBackground(theme.bg);
    }
    return () => {
      // Restore on unmount
      if (syncBg) {
        restoreTerminalBackground();
      }
    };
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, mode: currentMode, setMode, syncTerminalBg: syncBg, setSyncTerminalBg }}>
      {props.children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
