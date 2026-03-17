/**
 * DialogHelp — help overlay showing all keybinds and routes.
 *
 * Close with Esc or q. Uses scrollbox for content overflow.
 */

import { TextAttributes } from "@opentui/core";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useTheme, type Theme } from "../context/theme";

// ── Help Entries ─────────────────────────────────────────────

interface HelpEntry {
  key: string;
  description: string;
}

const KEYBOARD_SHORTCUTS: HelpEntry[] = [
  { key: "1", description: "Dashboard" },
  { key: "2", description: "Skills" },
  { key: "3", description: "Config" },
  { key: "s", description: "Setup" },
  { key: "Ctrl+P", description: "Command palette" },
  { key: "Ctrl+B", description: "Toggle sidebar" },
  { key: "F1", description: "Show this help" },
  { key: "c", description: "Clear event log" },
  { key: "q", description: "Quit" },
  { key: "Escape", description: "Close dialog / go back" },
  { key: "Ctrl+C", description: "Force quit" },
];

const ROUTES: HelpEntry[] = [
  { key: "Dashboard", description: "Agent status, channels, sessions, event stream" },
  { key: "Skills", description: "Registered skills and their descriptions" },
  { key: "Config", description: "Current engine configuration" },
  { key: "Setup", description: "Initial setup and channel configuration" },
];

const keyColWidth = 16;

function Section(props: { title: string; entries: HelpEntry[]; theme: Theme }) {
  const t = props.theme;
  return (
    <box flexDirection="column" flexShrink={0}>
      <text fg={t.primary} attributes={TextAttributes.BOLD}>
        {`  ${props.title}`}
      </text>
      <text>{""}</text>
      {props.entries.map((entry) => (
        <box key={entry.key} flexDirection="row">
          <text fg={t.secondary}>{`    ${entry.key.padEnd(keyColWidth)}`}</text>
          <text fg={t.textMuted}>{entry.description}</text>
        </box>
      ))}
      <text>{""}</text>
    </box>
  );
}

// ── Component ───────────────────────────────────────────────

export function DialogHelp(props: { onClose: () => void }) {
  const { theme: t, customBg } = useTheme();
  const dims = useTerminalDimensions();
  const dialogWidth = Math.min(70, (dims.width || 80) - 4);
  const dialogHeight = Math.max(10, (dims.height || 24) - 6);

  useKeyboard((key: any) => {
    if (key.name === "escape" || key.name === "q") {
      props.onClose();
    }
  });

  return (
    <box
      borderStyle="double"
      borderColor={t.primary}
      backgroundColor={t.bg}
      paddingX={2}
      paddingY={1}
      flexDirection="column"
      position="absolute"
      top={Math.max(1, Math.floor((dims.height || 24) * 0.05))}
      left={Math.max(1, Math.floor(((dims.width || 80) - dialogWidth) / 2))}
      width={dialogWidth}
      height={dialogHeight}
    >
      {/* Title bar */}
      <box flexDirection="row" flexShrink={0}>
        <text fg={t.primary} attributes={TextAttributes.BOLD} flexGrow={1}>
          {"  Help"}
        </text>
        <text fg={t.textDim}>{"esc"}</text>
      </box>
      <text flexShrink={0}>{""}</text>

      {/* Scrollable content */}
      <scrollbox flexGrow={1}>
        <box flexShrink={0}>
          <Section title="Keyboard Shortcuts" entries={KEYBOARD_SHORTCUTS} theme={t} />
          <Section title="Routes" entries={ROUTES} theme={t} />
        </box>
      </scrollbox>
    </box>
  );
}
