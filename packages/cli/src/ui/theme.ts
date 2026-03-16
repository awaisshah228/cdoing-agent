/**
 * Theme system — provides dark and light color palettes for the CLI.
 *
 * On light terminals, dark colors (gray, dimColor) become invisible.
 * This module centralizes all colors so every component can adapt.
 */

import { loadConfig, saveConfig } from "../config";

// ── Terminal background detection & sync ─────────────────────────────────────

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
 * Query the terminal's actual background color using the OSC 11 escape sequence.
 * Returns { r, g, b } (0-255) or null if detection fails/times out.
 *
 * Works in most modern terminals: iTerm2, Terminal.app, Kitty, Alacritty,
 * WezTerm, foot, xterm, GNOME Terminal, etc.
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
    }, 500);

    let buf = "";

    const onData = (data: Buffer) => {
      buf += data.toString();
      // Response: \x1b]11;rgb:RRRR/GGGG/BBBB\x07  (or \x1b\\ as terminator)
      const match = buf.match(
        /\x1b\]11;rgb:([0-9a-fA-F]{2,4})\/([0-9a-fA-F]{2,4})\/([0-9a-fA-F]{2,4})/
      );
      if (match) {
        cleanup();
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

/** Cached result of async terminal detection */
let _detectedMode: "dark" | "light" | null = null;

/**
 * Async terminal background detection using OSC 11.
 * Call once at startup before rendering. Falls back to env-var heuristics.
 */
export async function detectTerminalThemeAsync(): Promise<"dark" | "light"> {
  if (_detectedMode) return _detectedMode;

  const rgb = await queryTerminalBackground();
  if (rgb) {
    const lum = luminance(rgb.r, rgb.g, rgb.b);
    _detectedMode = lum > 0.5 ? "light" : "dark";
  } else {
    _detectedMode = detectTheme();
  }
  return _detectedMode;
}

/** Background colors for each theme (used for terminal bg sync) */
const themeBgHex: Record<string, string> = {
  dark: "#111827",
  light: "#ffffff",
};

/**
 * Set the terminal's background color using OSC 11.
 */
export function setTerminalBackground(themeName: "dark" | "light"): void {
  if (!process.stdout.isTTY) return;
  const hex = themeBgHex[themeName];
  process.stdout.write(`\x1b]11;${hex}\x07`);
}

/**
 * Restore the terminal's default background color.
 * Call on exit to leave the terminal clean.
 */
export function restoreTerminalBackground(): void {
  if (!process.stdout.isTTY) return;
  // OSC 111 resets the background to the terminal's configured default
  process.stdout.write("\x1b]111;\x07");
}

// ── Theme types ──────────────────────────────────────────────────────────────

export type ThemeName = "dark" | "light" | "auto";

export interface ThemeColors {
  // Primary text
  text: string;
  textBold: string;
  textDim: string;

  // Prompt / input
  prompt: string;        // ❯ and ● symbols
  cursor: string;        // ▊ cursor
  placeholder: string;   // ghost / placeholder text

  // Accent colors
  accent: string;        // primary accent (headers, highlights)
  accentSecondary: string; // secondary accent

  // Semantic colors
  success: string;
  warning: string;
  error: string;
  info: string;

  // UI chrome
  border: string;
  separator: string;
  selected: string;      // selected item text
  selectedBg: string;    // selected item background

  // Status bar
  provider: string;
  model: string;
  mode: string;

  // Markdown
  heading1: string;
  heading2: string;
  bullet: string;
  listNumber: string;
  codeBlock: string;
  horizontalRule: string;

  // Suggestions
  suggestionFile: string;
  suggestionProvider: string;
  suggestionTool: string;
  suggestionDefault: string;

  // Tool activity
  toolRunning: string;
  toolDone: string;
  toolError: string;
  toolPreview: string;

  // Spinner
  spinner: string;
  elapsed: string;

  // Session browser
  sessionTitle: string;
  sessionDate: string;
  sessionMeta: string;

  // Background jobs
  bgJobs: string;

  // Context bar colors
  contextLow: string;
  contextMed: string;
  contextHigh: string;

  // Whether to use dimColor prop (invisible on light terminals)
  useDim: boolean;
}

// ── Dark theme (default — optimized for dark terminal backgrounds) ──────────

const darkTheme: ThemeColors = {
  text: "white",
  textBold: "white",
  textDim: "gray",

  prompt: "green",
  cursor: "green",
  placeholder: "gray",

  accent: "cyan",
  accentSecondary: "blueBright",

  success: "green",
  warning: "yellow",
  error: "red",
  info: "yellow",

  border: "gray",
  separator: "gray",
  selected: "white",
  selectedBg: "cyan",

  provider: "cyan",
  model: "white",
  mode: "green",

  heading1: "blueBright",
  heading2: "cyan",
  bullet: "red",
  listNumber: "magenta",
  codeBlock: "gray",
  horizontalRule: "gray",

  suggestionFile: "magenta",
  suggestionProvider: "yellow",
  suggestionTool: "green",
  suggestionDefault: "cyan",

  toolRunning: "yellow",
  toolDone: "green",
  toolError: "red",
  toolPreview: "gray",

  spinner: "yellow",
  elapsed: "gray",

  sessionTitle: "white",
  sessionDate: "yellow",
  sessionMeta: "gray",

  bgJobs: "magenta",

  contextLow: "green",
  contextMed: "yellow",
  contextHigh: "red",

  useDim: true,
};

// ── Light theme (optimized for light / white terminal backgrounds) ──────────

const lightTheme: ThemeColors = {
  text: "black",
  textBold: "black",
  textDim: "blackBright",

  prompt: "green",
  cursor: "green",
  placeholder: "blackBright",

  accent: "blue",
  accentSecondary: "blue",

  success: "green",
  warning: "yellow",
  error: "red",
  info: "blue",

  border: "blackBright",
  separator: "blackBright",
  selected: "white",
  selectedBg: "blue",

  provider: "blue",
  model: "black",
  mode: "green",

  heading1: "blue",
  heading2: "blue",
  bullet: "red",
  listNumber: "magenta",
  codeBlock: "blackBright",
  horizontalRule: "blackBright",

  suggestionFile: "magenta",
  suggestionProvider: "blue",
  suggestionTool: "green",
  suggestionDefault: "blue",

  toolRunning: "yellow",
  toolDone: "green",
  toolError: "red",
  toolPreview: "blackBright",

  spinner: "blue",
  elapsed: "blackBright",

  sessionTitle: "black",
  sessionDate: "blue",
  sessionMeta: "blackBright",

  bgJobs: "magenta",

  contextLow: "green",
  contextMed: "yellow",
  contextHigh: "red",

  useDim: false, // dimColor is invisible on light backgrounds
};

// ── Theme registry ───────────────────────────────────────────────────────────

const themes: Record<string, ThemeColors> = {
  dark: darkTheme,
  light: lightTheme,
};

// ── Auto-detection ───────────────────────────────────────────────────────────

/**
 * Best-effort detect if the terminal has a light background.
 * Checks multiple signals:
 *  - COLORFGBG (set by iTerm2, rxvt, some others)
 *  - TERMINAL_EMULATOR / TERM_PROGRAM specific defaults
 *  - macOS defaults for Terminal.app
 * Falls back to dark if unknown.
 */
function detectTheme(): "dark" | "light" {
  // COLORFGBG is the most reliable signal (format: "fg;bg" or "fg;...;bg")
  const colorfgbg = process.env.COLORFGBG;
  if (colorfgbg) {
    const parts = colorfgbg.split(";");
    const bg = parseInt(parts[parts.length - 1], 10);
    // Background color index: 0-6 = dark, 7-15 = light (ANSI palette)
    if (!isNaN(bg) && bg >= 7) return "light";
    if (!isNaN(bg) && bg < 7) return "dark";
  }

  // VS Code terminal sets VSCODE_TERMINAL_DARK env or TERM_PROGRAM=vscode
  const termProgram = process.env.TERM_PROGRAM || "";
  if (termProgram === "vscode") {
    // VS Code sets this for its integrated terminal
    const colorTheme = process.env.VSCODE_CLI_QUALITY || "";
    // Best effort — assume user's VS Code theme matches
    return colorTheme === "stable" ? "dark" : "dark";
  }

  // macOS Terminal.app defaults to a light profile
  if (termProgram === "Apple_Terminal") {
    return "light";
  }

  // iTerm2 — check the profile name or ITERM_PROFILE
  if (termProgram === "iTerm.app") {
    const profile = (process.env.ITERM_PROFILE || "").toLowerCase();
    if (profile.includes("light") || profile.includes("solarized light")) return "light";
    return "dark";
  }

  // Windows Terminal
  if (process.env.WT_SESSION) {
    return "dark"; // Windows Terminal defaults to dark
  }

  return "dark";
}

// ── Current theme state ──────────────────────────────────────────────────────

let _currentThemeName: ThemeName = "auto";
let _currentTheme: ThemeColors = darkTheme;

/**
 * Initialize theme from stored config (sync). Call once at startup.
 */
export function initTheme(): void {
  const config = loadConfig();
  const stored = (config as any).theme as string | undefined;
  if (stored === "light" || stored === "dark") {
    _currentThemeName = stored;
    _currentTheme = themes[stored];
  } else {
    _currentThemeName = "auto";
    _currentTheme = themes[detectTheme()];
  }
}

/**
 * Initialize theme with async terminal background detection (OSC 11).
 * Use this instead of initTheme() for more accurate detection.
 * Optionally syncs the terminal background to match the theme.
 */
export async function initThemeAsync(options?: { syncTerminalBg?: boolean }): Promise<void> {
  const config = loadConfig();
  const stored = (config as any).theme as string | undefined;

  if (stored === "light" || stored === "dark") {
    _currentThemeName = stored;
    _currentTheme = themes[stored];
  } else {
    _currentThemeName = "auto";
    const detected = await detectTerminalThemeAsync();
    _currentTheme = themes[detected];
  }

  // Optionally set the terminal background to match
  if (options?.syncTerminalBg) {
    const resolved = _currentThemeName === "auto"
      ? (_currentTheme === lightTheme ? "light" : "dark")
      : _currentThemeName;
    if (resolved === "dark" || resolved === "light") {
      setTerminalBackground(resolved);
    }
  }
}

/**
 * Get the current theme colors.
 */
export function getTheme(): ThemeColors {
  return _currentTheme;
}

/**
 * Get the current theme name.
 */
export function getThemeName(): ThemeName {
  return _currentThemeName;
}

/** Whether terminal background sync is enabled */
let _syncTerminalBg = false;

export function setSyncTerminalBg(sync: boolean): void {
  _syncTerminalBg = sync;
  if (sync) {
    const resolved = _currentTheme === lightTheme ? "light" : "dark";
    setTerminalBackground(resolved);
  } else {
    restoreTerminalBackground();
  }
}

/**
 * Switch theme and persist to config.
 */
export function setTheme(name: ThemeName): string {
  _currentThemeName = name;
  if (name === "auto") {
    const detected = detectTheme();
    _currentTheme = themes[detected];
    // Remove theme from config so it auto-detects next time
    const config = loadConfig();
    delete (config as any).theme;
    saveConfig(config);
    if (_syncTerminalBg) setTerminalBackground(detected);
    return `Theme: auto (detected: ${detected})`;
  }
  _currentTheme = themes[name] || darkTheme;
  const config = loadConfig();
  (config as any).theme = name;
  saveConfig(config);
  if (_syncTerminalBg && (name === "dark" || name === "light")) {
    setTerminalBackground(name);
  }
  return `Theme: ${name}`;
}

/**
 * List available themes.
 */
export function getAvailableThemes(): string[] {
  return ["auto", "dark", "light"];
}
