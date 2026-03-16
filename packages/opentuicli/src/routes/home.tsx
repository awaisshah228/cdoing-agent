/**
 * Home Route — landing screen with logo, project info, shortcuts, and quick actions
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

// Compact logo for smaller terminals
const LOGO_COMPACT = [
  "┌─┐┌┐ ┌─┐┬┌┐┌┌─┐",
  "│  │││ ││││││││ ┬",
  "└─┘└┘└─┘└─┘┘└┘└─┘",
];

export function Home(props: {
  provider: string;
  model: string;
  workingDir: string;
  themeId: string;
  onAction?: (action: string) => void;
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

  // Build info lines
  const infoLines = [
    ["Provider", props.provider],
    ["Model", props.model],
    ["Theme", props.themeId],
    ["Directory", shortDir()],
  ];
  const maxKeyLen = Math.max(...infoLines.map(([k]) => k.length));

  // Quick actions
  const actions = [
    { key: "Enter", label: "Start session", id: "start" },
    { key: "Ctrl+P", label: "Switch model", id: "model" },
    { key: "Ctrl+T", label: "Change theme", id: "theme" },
    { key: "Ctrl+N", label: "New session", id: "new" },
    { key: "Ctrl+S", label: "Browse sessions", id: "sessions" },
    { key: "Ctrl+X", label: "Command palette", id: "commands" },
    { key: "/setup", label: "Setup wizard", id: "setup" },
    { key: "Ctrl+C", label: "Quit", id: "quit" },
  ];
  const maxActionKey = Math.max(...actions.map((a) => a.key.length));

  return (
    <box flexDirection="column" flexGrow={1} flexShrink={1} overflow="hidden" justifyContent="center" alignItems="center">
      <box flexDirection="column" alignItems="center" justifyContent="center" flexGrow={1}>
        {/* Logo */}
        {logo && logo.map((line, i) => (
          <text key={`logo-${i}`} fg={t.primary} attributes={TextAttributes.BOLD}>
            {line}
          </text>
        ))}

        {/* Subtitle + version */}
        <text fg={t.textDim}>
          {subtitle}
        </text>
        <text fg={t.textMuted}>
          {version}
        </text>

        <text>{""}</text>

        {/* Info section */}
        {infoLines.map(([key, val], i) => {
          const line = `${key.padStart(maxKeyLen)}  ${val}`;
          return (
            <text key={`info-${i}`} fg={t.textDim}>
              {line}
            </text>
          );
        })}

        <text>{""}</text>

        {/* Actions */}
        <text fg={t.primary} attributes={TextAttributes.BOLD}>
          {"Actions"}
        </text>
        {actions.map((action, i) => {
          const line = `${action.key.padStart(maxActionKey)}   ${action.label}`;
          return (
            <text key={`act-${i}`} fg={t.textMuted}>
              {line}
            </text>
          );
        })}

        <text>{""}</text>

        {/* Footer */}
        <text fg={t.textDim}>
          {"Powered by @opentui/react + @cdoing/ai"}
        </text>
      </box>
    </box>
  );
}
