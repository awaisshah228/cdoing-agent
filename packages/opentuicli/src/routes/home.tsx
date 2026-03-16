/**
 * Home Route — landing screen with figlet logo, project info, and shortcuts
 */

import { TextAttributes } from "@opentui/core";
import { useTerminalDimensions } from "@opentui/react";
import { useTheme } from "../context/theme";

// Figlet-style ASCII art logo (ANSI Shadow style)
const LOGO_LINES = [
  " ██████╗██████╗  ██████╗ ██╗███╗   ██╗ ██████╗ ",
  "██╔════╝██╔══██╗██╔═══██╗██║████╗  ██║██╔════╝ ",
  "██║     ██║  ██║██║   ██║██║██╔██╗ ██║██║  ███╗",
  "██║     ██║  ██║██║   ██║██║██║╚██╗██║██║   ██║",
  "╚██████╗██████╔╝╚██████╔╝██║██║ ╚████║╚██████╔╝",
  " ╚═════╝╚═════╝  ╚═════╝ ╚═╝╚═╝  ╚═══╝ ╚═════╝ ",
];

const LOGO_WIDTH = 48; // visual width of the logo

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

  const shortDir = () => {
    const home = process.env.HOME || "";
    const d = props.workingDir;
    return home && d.startsWith(home) ? "~" + d.slice(home.length) : d;
  };

  const subtitle = "Multi-provider AI coding assistant";
  const version = "v0.1.0";

  return (
    <box flexDirection="column" flexGrow={1} justifyContent="center" alignItems="center">
      {/* Figlet Logo */}
      {LOGO_LINES.map((line, i) => (
        <text key={`logo-${i}`} fg={t.primary} attributes={TextAttributes.BOLD}>
          {centerPad(line, w, LOGO_WIDTH)}
        </text>
      ))}

      {/* Subtitle */}
      <text fg={t.textDim}>
        {centerPad(subtitle, w)}
      </text>
      <text fg={t.textMuted}>
        {centerPad(version, w)}
      </text>

      {/* Spacer */}
      <text>{""}</text>

      {/* Info section */}
      <text fg={t.textDim}>{centerPad(`Provider   ${props.provider}`, w)}</text>
      <text fg={t.textDim}>{centerPad(`Model      ${props.model}`, w)}</text>
      <text fg={t.textDim}>{centerPad(`Directory  ${shortDir()}`, w)}</text>

      {/* Spacer */}
      <text>{""}</text>

      {/* Shortcuts */}
      <text fg={t.primary} attributes={TextAttributes.BOLD}>
        {centerPad("Shortcuts", w)}
      </text>
      <text fg={t.textMuted}>{centerPad("Enter        Start session", w)}</text>
      <text fg={t.textMuted}>{centerPad("Ctrl+N       New session", w)}</text>
      <text fg={t.textMuted}>{centerPad("Ctrl+P       Switch model", w)}</text>
      <text fg={t.textMuted}>{centerPad("Ctrl+S       Browse sessions", w)}</text>
      <text fg={t.textMuted}>{centerPad("Ctrl+C       Quit", w)}</text>

      {/* Spacer */}
      <text>{""}</text>

      {/* Footer */}
      <text fg={t.textDim}>
        {centerPad("Powered by @opentui/react + @cdoing/ai", w)}
      </text>
    </box>
  );
}
