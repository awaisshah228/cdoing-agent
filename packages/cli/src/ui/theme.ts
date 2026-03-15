/**
 * Theme system — provides dark and light color palettes for the CLI.
 *
 * On light terminals, dark colors (gray, dimColor) become invisible.
 * This module centralizes all colors so every component can adapt.
 */

import { loadConfig, saveConfig } from "../config";

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
 * Initialize theme from stored config. Call once at startup.
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
    return `Theme: auto (detected: ${detected})`;
  }
  _currentTheme = themes[name] || darkTheme;
  const config = loadConfig();
  (config as any).theme = name;
  saveConfig(config);
  return `Theme: ${name}`;
}

/**
 * List available themes.
 */
export function getAvailableThemes(): string[] {
  return ["auto", "dark", "light"];
}
