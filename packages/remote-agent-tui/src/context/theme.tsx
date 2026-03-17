/**
 * Theme Context — Multi-theme system for the TUI
 *
 * Supports 15+ built-in themes inspired by popular editor themes.
 * Each theme has dark and light variants with full color palettes.
 *
 * Detection:
 *   1. OSC 11 escape sequence (queries terminal directly)
 *   2. COLORFGBG environment variable (fallback)
 *   3. Defaults to dark mode
 */

import { RGBA, rgbToHex, SyntaxStyle } from "@opentui/core";
import { createContext, useContext, useState, useEffect, useRef, useMemo } from "react";
import type { ReactNode } from "react";
import { useSettingsStore } from "../store/settings";

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

// ── Theme Definitions ─────────────────────────────────────

export interface ThemeDef {
  name: string;
  dark: Theme;
  light: Theme;
}

function t(hex: string): RGBA {
  return RGBA.fromHex(hex);
}

/** Helper to build a full theme from a minimal palette */
function buildTheme(p: {
  bg: string; bgSubtle: string; text: string; textMuted: string; textDim: string;
  primary: string; secondary: string; success: string; error: string;
  warning: string; info: string; border: string;
  diffAdd?: string; diffRemove?: string;
}): Theme {
  return {
    text: t(p.text), textMuted: t(p.textMuted), textDim: t(p.textDim),
    primary: t(p.primary), secondary: t(p.secondary),
    success: t(p.success), error: t(p.error), warning: t(p.warning), info: t(p.info),
    border: t(p.border), borderFocused: t(p.primary),
    bg: t(p.bg), bgSubtle: t(p.bgSubtle),
    userText: t(p.success), assistantText: t(p.text),
    systemText: t(p.warning), toolText: t(p.textMuted),
    toolRunning: t(p.warning), toolDone: t(p.success), toolError: t(p.error),
    diffAdd: t(p.diffAdd || p.success), diffRemove: t(p.diffRemove || p.error),
    diffHunk: t(p.info),
  };
}

// ── Built-in Themes ───────────────────────────────────────

export const THEMES: Record<string, ThemeDef> = {
  default: {
    name: "Default",
    dark: buildTheme({
      bg: "#000000", bgSubtle: "#111111", text: "#e5e7eb", textMuted: "#9ca3af", textDim: "#6b7280",
      primary: "#06b6d4", secondary: "#8b5cf6", success: "#22c55e", error: "#ef4444",
      warning: "#eab308", info: "#3b82f6", border: "#374151",
    }),
    light: buildTheme({
      bg: "#ffffff", bgSubtle: "#f3f4f6", text: "#1f2937", textMuted: "#6b7280", textDim: "#9ca3af",
      primary: "#0891b2", secondary: "#7c3aed", success: "#16a34a", error: "#dc2626",
      warning: "#ca8a04", info: "#2563eb", border: "#d1d5db",
    }),
  },
  catppuccin: {
    name: "Catppuccin",
    dark: buildTheme({
      bg: "#1e1e2e", bgSubtle: "#313244", text: "#cdd6f4", textMuted: "#a6adc8", textDim: "#6c7086",
      primary: "#89b4fa", secondary: "#cba6f7", success: "#a6e3a1", error: "#f38ba8",
      warning: "#f9e2af", info: "#74c7ec", border: "#45475a",
    }),
    light: buildTheme({
      bg: "#eff1f5", bgSubtle: "#e6e9ef", text: "#4c4f69", textMuted: "#6c6f85", textDim: "#9ca0b0",
      primary: "#1e66f5", secondary: "#8839ef", success: "#40a02b", error: "#d20f39",
      warning: "#df8e1d", info: "#04a5e5", border: "#ccd0da",
    }),
  },
  dracula: {
    name: "Dracula",
    dark: buildTheme({
      bg: "#282a36", bgSubtle: "#44475a", text: "#f8f8f2", textMuted: "#6272a4", textDim: "#44475a",
      primary: "#bd93f9", secondary: "#ff79c6", success: "#50fa7b", error: "#ff5555",
      warning: "#f1fa8c", info: "#8be9fd", border: "#44475a",
    }),
    light: buildTheme({
      bg: "#f8f8f2", bgSubtle: "#e6e6e6", text: "#282a36", textMuted: "#6272a4", textDim: "#999999",
      primary: "#7c3aed", secondary: "#d946ef", success: "#16a34a", error: "#dc2626",
      warning: "#ca8a04", info: "#0891b2", border: "#d1d5db",
    }),
  },
  nord: {
    name: "Nord",
    dark: buildTheme({
      bg: "#2e3440", bgSubtle: "#3b4252", text: "#eceff4", textMuted: "#d8dee9", textDim: "#4c566a",
      primary: "#88c0d0", secondary: "#b48ead", success: "#a3be8c", error: "#bf616a",
      warning: "#ebcb8b", info: "#81a1c1", border: "#434c5e",
    }),
    light: buildTheme({
      bg: "#eceff4", bgSubtle: "#e5e9f0", text: "#2e3440", textMuted: "#4c566a", textDim: "#7b88a1",
      primary: "#5e81ac", secondary: "#b48ead", success: "#a3be8c", error: "#bf616a",
      warning: "#ebcb8b", info: "#81a1c1", border: "#d8dee9",
    }),
  },
  tokyonight: {
    name: "Tokyo Night",
    dark: buildTheme({
      bg: "#1a1b26", bgSubtle: "#24283b", text: "#c0caf5", textMuted: "#a9b1d6", textDim: "#565f89",
      primary: "#7aa2f7", secondary: "#bb9af7", success: "#9ece6a", error: "#f7768e",
      warning: "#e0af68", info: "#7dcfff", border: "#3b4261",
    }),
    light: buildTheme({
      bg: "#d5d6db", bgSubtle: "#cbccd1", text: "#343b58", textMuted: "#565a6e", textDim: "#9699a3",
      primary: "#34548a", secondary: "#5a4a78", success: "#485e30", error: "#8c4351",
      warning: "#8f5e15", info: "#0f4b6e", border: "#b4b5b9",
    }),
  },
  gruvbox: {
    name: "Gruvbox",
    dark: buildTheme({
      bg: "#282828", bgSubtle: "#3c3836", text: "#ebdbb2", textMuted: "#a89984", textDim: "#665c54",
      primary: "#fabd2f", secondary: "#d3869b", success: "#b8bb26", error: "#fb4934",
      warning: "#fe8019", info: "#83a598", border: "#504945",
    }),
    light: buildTheme({
      bg: "#fbf1c7", bgSubtle: "#f2e5bc", text: "#3c3836", textMuted: "#7c6f64", textDim: "#a89984",
      primary: "#b57614", secondary: "#8f3f71", success: "#79740e", error: "#9d0006",
      warning: "#af3a03", info: "#427b58", border: "#d5c4a1",
    }),
  },
  rosepine: {
    name: "Rose Pine",
    dark: buildTheme({
      bg: "#191724", bgSubtle: "#1f1d2e", text: "#e0def4", textMuted: "#908caa", textDim: "#6e6a86",
      primary: "#c4a7e7", secondary: "#ebbcba", success: "#31748f", error: "#eb6f92",
      warning: "#f6c177", info: "#9ccfd8", border: "#26233a",
    }),
    light: buildTheme({
      bg: "#faf4ed", bgSubtle: "#f2e9e1", text: "#575279", textMuted: "#797593", textDim: "#9893a5",
      primary: "#907aa9", secondary: "#d7827e", success: "#286983", error: "#b4637a",
      warning: "#ea9d34", info: "#56949f", border: "#dfdad9",
    }),
  },
  monokai: {
    name: "Monokai",
    dark: buildTheme({
      bg: "#272822", bgSubtle: "#3e3d32", text: "#f8f8f2", textMuted: "#75715e", textDim: "#49483e",
      primary: "#66d9ef", secondary: "#ae81ff", success: "#a6e22e", error: "#f92672",
      warning: "#e6db74", info: "#66d9ef", border: "#49483e",
    }),
    light: buildTheme({
      bg: "#fafafa", bgSubtle: "#f0f0f0", text: "#272822", textMuted: "#75715e", textDim: "#b0b0b0",
      primary: "#0096d1", secondary: "#7c3aed", success: "#629e25", error: "#c4265e",
      warning: "#b5a21d", info: "#0096d1", border: "#d0d0d0",
    }),
  },
  solarized: {
    name: "Solarized",
    dark: buildTheme({
      bg: "#002b36", bgSubtle: "#073642", text: "#839496", textMuted: "#657b83", textDim: "#586e75",
      primary: "#268bd2", secondary: "#6c71c4", success: "#859900", error: "#dc322f",
      warning: "#b58900", info: "#2aa198", border: "#073642",
    }),
    light: buildTheme({
      bg: "#fdf6e3", bgSubtle: "#eee8d5", text: "#657b83", textMuted: "#839496", textDim: "#93a1a1",
      primary: "#268bd2", secondary: "#6c71c4", success: "#859900", error: "#dc322f",
      warning: "#b58900", info: "#2aa198", border: "#eee8d5",
    }),
  },
  amoled: {
    name: "AMOLED",
    dark: buildTheme({
      bg: "#000000", bgSubtle: "#0a0a0a", text: "#ffffff", textMuted: "#888888", textDim: "#555555",
      primary: "#00e5ff", secondary: "#e040fb", success: "#00e676", error: "#ff1744",
      warning: "#ffea00", info: "#40c4ff", border: "#222222",
    }),
    light: buildTheme({
      bg: "#ffffff", bgSubtle: "#f5f5f5", text: "#000000", textMuted: "#666666", textDim: "#aaaaaa",
      primary: "#0097a7", secondary: "#7b1fa2", success: "#2e7d32", error: "#c62828",
      warning: "#f9a825", info: "#0277bd", border: "#e0e0e0",
    }),
  },
  github: {
    name: "GitHub",
    dark: buildTheme({
      bg: "#0d1117", bgSubtle: "#161b22", text: "#e6edf3", textMuted: "#8b949e", textDim: "#484f58",
      primary: "#58a6ff", secondary: "#bc8cff", success: "#3fb950", error: "#f85149",
      warning: "#d29922", info: "#58a6ff", border: "#30363d",
    }),
    light: buildTheme({
      bg: "#ffffff", bgSubtle: "#f6f8fa", text: "#1f2328", textMuted: "#656d76", textDim: "#8c959f",
      primary: "#0969da", secondary: "#8250df", success: "#1a7f37", error: "#cf222e",
      warning: "#9a6700", info: "#0969da", border: "#d0d7de",
    }),
  },
  vercel: {
    name: "Vercel",
    dark: buildTheme({
      bg: "#000000", bgSubtle: "#111111", text: "#ededed", textMuted: "#888888", textDim: "#444444",
      primary: "#ffffff", secondary: "#888888", success: "#0070f3", error: "#ee0000",
      warning: "#f5a623", info: "#0070f3", border: "#333333",
    }),
    light: buildTheme({
      bg: "#ffffff", bgSubtle: "#fafafa", text: "#000000", textMuted: "#666666", textDim: "#999999",
      primary: "#000000", secondary: "#666666", success: "#0070f3", error: "#ee0000",
      warning: "#f5a623", info: "#0070f3", border: "#eaeaea",
    }),
  },
};

/** Get sorted list of theme IDs */
export function getThemeIds(): string[] {
  return Object.keys(THEMES).sort((a, b) => {
    if (a === "default") return -1;
    if (b === "default") return 1;
    return a.localeCompare(b);
  });
}

/** Get theme by ID and mode */
export function getThemeColors(themeId: string, mode: "dark" | "light"): Theme {
  const def = THEMES[themeId] || THEMES["default"];
  return mode === "light" ? def.light : def.dark;
}

// ── Terminal detection ────────────────────────────────────

function luminance(r: number, g: number, b: number): number {
  const [rs, gs, bs] = [r, g, b].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

function queryTerminalBackground(): Promise<{ r: number; g: number; b: number } | null> {
  return new Promise((resolve) => {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      resolve(null);
      return;
    }
    const timeout = setTimeout(() => { cleanup(); resolve(null); }, 500);
    let buf = "";
    const onData = (data: Buffer) => {
      buf += data.toString();
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
    try { process.stdin.setRawMode(true); } catch { resolve(null); return; }
    process.stdin.on("data", onData);
    process.stdout.write("\x1b]11;?\x07");
  });
}

function detectThemeFromEnv(): "dark" | "light" {
  const bg = process.env.COLORFGBG;
  if (bg) {
    const parts = bg.split(";");
    const bgVal = parseInt(parts[parts.length - 1] || "0", 10);
    if (bgVal > 8) return "light";
  }
  return "dark";
}

let _detectedMode: "dark" | "light" | null = null;

export async function detectTerminalTheme(): Promise<"dark" | "light"> {
  if (_detectedMode) return _detectedMode;
  const rgb = await queryTerminalBackground();
  if (rgb) {
    const lum = luminance(rgb.r, rgb.g, rgb.b);
    _detectedMode = lum > 0.5 ? "light" : "dark";
  } else {
    _detectedMode = detectThemeFromEnv();
  }
  return _detectedMode;
}

export function setTerminalBackground(color: RGBA): void {
  if (!process.stdout.isTTY) return;
  const hex = rgbToHex(color);
  process.stdout.write(`\x1b]11;${hex}\x07`);
}

export function restoreTerminalBackground(): void {
  if (!process.stdout.isTTY) return;
  process.stdout.write("\x1b]111;\x07");
}

// ── Syntax Style Generation ───────────────────────────────

function generateSyntaxStyle(theme: Theme): SyntaxStyle {
  return SyntaxStyle.fromStyles({
    // Default text
    "default": { fg: theme.text },
    // Markdown-specific scopes (used by <markdown> component)
    "markup.heading.1": { fg: theme.primary, bold: true },
    "markup.heading.2": { fg: theme.primary, bold: true },
    "markup.heading.3": { fg: theme.info, bold: true },
    "markup.heading.4": { fg: theme.info, bold: true },
    "markup.heading.5": { fg: theme.info },
    "markup.heading.6": { fg: theme.info },
    "markup.bold": { bold: true },
    "markup.italic": { italic: true },
    "markup.list": { fg: theme.warning },
    "markup.link": { fg: theme.info, underline: true },
    "markup.raw": { fg: theme.warning },
    "markup.quote": { fg: theme.textMuted, italic: true },
    // Code block syntax highlighting
    "keyword": { fg: theme.secondary, bold: true },
    "keyword.control": { fg: theme.secondary, bold: true },
    "keyword.operator": { fg: theme.secondary },
    "string": { fg: theme.success },
    "string.quoted": { fg: theme.success },
    "comment": { fg: theme.textDim, italic: true },
    "comment.line": { fg: theme.textDim, italic: true },
    "comment.block": { fg: theme.textDim, italic: true },
    "constant": { fg: theme.warning },
    "constant.numeric": { fg: theme.warning },
    "number": { fg: theme.warning },
    "variable": { fg: theme.text },
    "variable.parameter": { fg: theme.text },
    "function": { fg: theme.info },
    "entity.name.function": { fg: theme.info },
    "support.function": { fg: theme.info },
    "type": { fg: theme.primary },
    "entity.name.type": { fg: theme.primary },
    "support.type": { fg: theme.primary },
    "operator": { fg: theme.textMuted },
    "punctuation": { fg: theme.textMuted },
  });
}

// ── Theme Context ─────────────────────────────────────────

const ThemeContext = createContext<{
  theme: Theme;
  themeId: string;
  mode: "dark" | "light";
  syntaxStyle: SyntaxStyle;
  customBg: string | null;
  setThemeId: (id: string) => void;
  setMode: (m: "dark" | "light") => void;
  setCustomBg: (hex: string | null) => void;
  syncTerminalBg: boolean;
  setSyncTerminalBg: (sync: boolean) => void;
} | undefined>(undefined);

export function ThemeProvider(props: {
  mode?: string;
  themeId?: string;
  syncTerminalBg?: boolean;
  detectedMode?: "dark" | "light";
  children: ReactNode;
}) {
  const initialMode: "dark" | "light" =
    props.mode === "light" ? "light"
      : props.mode === "auto" ? (props.detectedMode || "dark")
        : "dark";

  const initialThemeId = props.themeId || "vercel";

  const [themeId, setThemeIdState] = useState(initialThemeId);
  const [currentMode, setCurrentMode] = useState<"dark" | "light">(initialMode);
  const [theme, setTheme] = useState<Theme>(getThemeColors(initialThemeId, initialMode));
  const [syncBg, setSyncBg] = useState(props.syncTerminalBg ?? false);
  const [customBg, setCustomBgState] = useState<string | null>(null);

  // Refs to avoid stale closures — always read current values
  const syncBgRef = useRef(syncBg);
  syncBgRef.current = syncBg;
  const customBgRef = useRef(customBg);
  customBgRef.current = customBg;
  const modeRef = useRef(currentMode);
  modeRef.current = currentMode;
  const themeIdRef = useRef(themeId);
  themeIdRef.current = themeId;

  /** Apply terminal background to match theme — always call after setTheme */
  const applyTerminalBg = (colors: Theme) => {
    if (!syncBgRef.current) return;
    if (customBgRef.current) {
      setTerminalBackground(RGBA.fromHex(customBgRef.current));
    } else {
      setTerminalBackground(colors.bg);
    }
  };

  const setThemeId = (id: string) => {
    setThemeIdState(id);
    themeIdRef.current = id;
    const colors = getThemeColors(id, modeRef.current);
    setTheme(colors);
    applyTerminalBg(colors);
    useSettingsStore.getState().setThemeId(id);
  };

  const setMode = (m: "dark" | "light") => {
    setCurrentMode(m);
    modeRef.current = m;
    const colors = getThemeColors(themeIdRef.current, m);
    setTheme(colors);
    applyTerminalBg(colors);
    useSettingsStore.getState().setMode(m);
  };

  const setCustomBg = (hex: string | null) => {
    setCustomBgState(hex);
    customBgRef.current = hex;
    if (!syncBgRef.current) return;
    if (hex) {
      setTerminalBackground(RGBA.fromHex(hex));
    } else {
      setTerminalBackground(getThemeColors(themeIdRef.current, modeRef.current).bg);
    }
  };

  const setSyncTerminalBg = (sync: boolean) => {
    setSyncBg(sync);
    syncBgRef.current = sync;
    if (sync) {
      const colors = getThemeColors(themeIdRef.current, modeRef.current);
      applyTerminalBg(colors);
    } else {
      restoreTerminalBackground();
    }
    useSettingsStore.getState().setSyncTerminalBg(sync);
  };

  // Sync terminal bg on mount — force it immediately
  useEffect(() => {
    if (syncBgRef.current) {
      const colors = getThemeColors(initialThemeId, initialMode);
      applyTerminalBg(colors);
    }
    return () => {
      if (syncBgRef.current) restoreTerminalBackground();
    };
  }, []);

  const syntaxStyle = useMemo(() => generateSyntaxStyle(theme), [theme]);

  return (
    <ThemeContext.Provider value={{ theme, themeId, mode: currentMode, syntaxStyle, customBg, setThemeId, setMode, setCustomBg, syncTerminalBg: syncBg, setSyncTerminalBg }}>
      {props.children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
