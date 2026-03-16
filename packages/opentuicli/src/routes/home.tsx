/**
 * Home Route — landing screen with logo, project info, and shortcuts
 *
 * Responsive: adapts layout based on terminal dimensions.
 *   - Small terminals (< 60 cols or < 20 rows): compact layout, no logo
 *   - Medium terminals: smaller logo, condensed info
 *   - Large terminals: full figlet logo, spacious layout
 */

import { TextAttributes } from "@opentui/core";
import { useTerminalDimensions } from "@opentui/react";
import { useTheme } from "../context/theme";

// Full figlet logo (ANSI Shadow)
const LOGO_FULL = [
  " ██████╗██████╗  ██████╗ ██╗███╗   ██╗ ██████╗ ",
  "██╔════╝██╔══██╗██╔═══██╗██║████╗  ██║██╔════╝ ",
  "██║     ██║  ██║██║   ██║██║██╔██╗ ██║██║  ███╗",
  "██║     ██║  ██║██║   ██║██║██║╚██╗██║██║   ██║",
  "╚██████╗██████╔╝╚██████╔╝██║██║ ╚████║╚██████╔╝",
  " ╚═════╝╚═════╝  ╚═════╝ ╚═╝╚═╝  ╚═══╝ ╚═════╝ ",
];
const LOGO_FULL_WIDTH = 48;

// Compact logo for smaller terminals
const LOGO_COMPACT = [
  "┌─┐┌┐ ┌─┐┬┌┐┌┌─┐",
  "│  │││ ││││││││ ┬",
  "└─┘└┘└─┘└─┘┘└┘└─┘",
];
const LOGO_COMPACT_WIDTH = 18;

function centerPad(text: string, width: number, textWidth?: number): string {
  const tw = textWidth ?? text.length;
  const pad = Math.max(0, Math.floor((width - tw) / 2));
  return " ".repeat(pad) + text;
}

export function Home(props: {
  provider: string;
  model: string;
  workingDir: string;
}) {
  const { theme } = useTheme();
  const t = theme;
  const dims = useTerminalDimensions();
  const w = dims.width || 80;
  const h = dims.height || 24;

  const shortDir = () => {
    const home = process.env.HOME || "";
    const d = props.workingDir;
    return home && d.startsWith(home) ? "~" + d.slice(home.length) : d;
  };

  const subtitle = "Multi-provider AI coding assistant";
  const version = "v0.1.1";

  // Determine layout size
  const isSmall = w < 60 || h < 20;
  const isMedium = !isSmall && (w < 80 || h < 30);

  // Pick logo
  const logo = isSmall ? null : isMedium ? LOGO_COMPACT : LOGO_FULL;
  const logoWidth = isSmall ? 0 : isMedium ? LOGO_COMPACT_WIDTH : LOGO_FULL_WIDTH;

  // Build info lines as right-aligned key-value pairs
  const infoLines = [
    ["Provider", props.provider],
    ["Model", props.model],
    ["Directory", shortDir()],
  ];
  const maxKeyLen = Math.max(...infoLines.map(([k]) => k.length));

  const shortcuts = [
    ["Enter", "Start session"],
    ["Ctrl+N", "New session"],
    ["Ctrl+P", "Switch model"],
    ["Ctrl+S", "Browse sessions"],
    ["Ctrl+C", "Quit"],
  ];
  const maxShortcutKey = Math.max(...shortcuts.map(([k]) => k.length));

  // Calculate vertical padding to roughly center content
  // Content height: logo + subtitle + version + spacer + info(3) + spacer + shortcuts header + shortcuts(5) + spacer + footer
  const contentHeight = (logo ? logo.length : 0) + 2 + 1 + 3 + 1 + 1 + shortcuts.length + 1 + 1;
  const topPad = Math.max(1, Math.floor((h - contentHeight - 4) / 3)); // bias toward upper third

  return (
    <box flexDirection="column" flexGrow={1}>
      {/* Top padding */}
      {Array.from({ length: topPad }, (_, i) => (
        <text key={`pad-${i}`}>{""}</text>
      ))}

      {/* Logo */}
      {logo && logo.map((line, i) => (
        <text key={`logo-${i}`} fg={t.primary} attributes={TextAttributes.BOLD}>
          {centerPad(line, w, logoWidth)}
        </text>
      ))}

      {/* Subtitle + version */}
      <text fg={t.textDim}>
        {centerPad(subtitle, w)}
      </text>
      <text fg={t.textMuted}>
        {centerPad(version, w)}
      </text>

      <text>{""}</text>

      {/* Info section — aligned key: value */}
      {infoLines.map(([key, val], i) => {
        const line = `${key.padStart(maxKeyLen)}  ${val}`;
        return (
          <text key={`info-${i}`} fg={t.textDim}>
            {centerPad(line, w)}
          </text>
        );
      })}

      <text>{""}</text>

      {/* Shortcuts */}
      <text fg={t.primary} attributes={TextAttributes.BOLD}>
        {centerPad("Shortcuts", w)}
      </text>
      {shortcuts.map(([key, desc], i) => {
        const line = `${key.padStart(maxShortcutKey)}   ${desc}`;
        return (
          <text key={`sc-${i}`} fg={t.textMuted}>
            {centerPad(line, w)}
          </text>
        );
      })}

      <text>{""}</text>

      {/* Footer */}
      <text fg={t.textDim}>
        {centerPad("Powered by @opentui/react + @cdoing/ai", w)}
      </text>
    </box>
  );
}
