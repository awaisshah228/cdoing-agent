/**
 * Sidebar — right panel (36 cols) showing agents, channels, sessions, uptime, keybinds.
 *
 * Uses single text per line to avoid layout concatenation issues.
 */

import { TextAttributes, type RGBA } from "@opentui/core";
import { useTheme } from "../context/theme";
import type { EngineState } from "../hooks/use-engine-state";

const W = 34;

export interface SidebarProps {
  state: EngineState;
}

function trunc(str: string, max: number): string {
  return str.length > max ? str.slice(0, max - 1) + "\u2026" : str;
}

function shortModel(model: string): string {
  return model.replace("claude-", "").replace("gpt-", "").substring(0, 14);
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h${m}m`;
}

export function Sidebar(props: SidebarProps) {
  const { theme: t } = useTheme();
  const { state } = props;

  const lines: Array<{ text: string; fg: RGBA; bold?: boolean }> = [];

  const sep = () => lines.push({ text: "\u2502", fg: t.border });
  const header = (title: string) => {
    lines.push({ text: `\u2502 ${title}`, fg: t.primary, bold: true });
  };
  const row = (label: string, value: string, fg?: RGBA) => {
    const padded = label
      ? `\u2502   ${label.padEnd(10)} ${trunc(value, W - 14)}`
      : `\u2502   ${trunc(value, W - 4)}`;
    lines.push({ text: padded, fg: fg || t.text });
  };
  const shortcut = (key: string, label: string) => {
    lines.push({ text: `\u2502   ${key.padEnd(10)} ${label}`, fg: t.textDim });
  };

  // Agents
  header("Agents");
  row(
    "Assistant",
    `${state.stats.assistantProvider}/${shortModel(state.stats.assistantModel)}`,
    t.info,
  );
  row("", `${state.agentStats.assistant} active`, t.textMuted);
  row(
    "Coding",
    `${state.stats.codingProvider}/${shortModel(state.stats.codingModel)}`,
    t.secondary,
  );
  row("", `${state.agentStats.coding} active`, t.textMuted);
  sep();

  // Channels
  header("Channels");
  if (state.channels.length === 0) {
    row("", "(no channels)", t.textDim);
  } else {
    for (const ch of state.channels) {
      const icon = ch.connected ? "\u2713" : "\u2717";
      const color = ch.connected ? t.success : t.error;
      row("", `${icon} ${ch.name}`, color);
    }
  }
  sep();

  // Sessions
  header(`Sessions (${state.stats.activeSessions})`);
  row("Total", `${state.stats.totalSessions}`);
  row("Active", `${state.stats.activeSessions}`);
  row("Agents", `${state.stats.activeAgents}`);
  sep();

  // Uptime
  header("Uptime");
  row("", formatUptime(state.stats.uptime), t.success);
  sep();

  // Shortcuts
  header("Shortcuts");
  shortcut("1", "Dashboard");
  shortcut("2", "Skills");
  shortcut("3", "Config");
  shortcut("s", "Setup");
  shortcut("Ctrl+P", "Commands");
  shortcut("Ctrl+B", "Sidebar");
  shortcut("F1", "Help");
  shortcut("q", "Quit");

  return (
    <box width={W + 2} flexDirection="column" backgroundColor={t.bgSubtle}>
      <box flexDirection="column" flexGrow={1}>
        {lines.map((line, i) => (
          <box key={i} height={1}>
            <text
              fg={line.fg}
              attributes={line.bold ? TextAttributes.BOLD : undefined}
            >
              {line.text}
            </text>
          </box>
        ))}
        {/* Fill remaining space */}
        <box flexGrow={1}>
          <text fg={t.border}>{"\u2502"}</text>
        </box>
        {/* Footer */}
        <box height={1} paddingX={1}>
          <text fg={t.success}>{"\u25CF "}</text>
          <text fg={t.text} attributes={TextAttributes.BOLD}>{"Remote Agent"}</text>
        </box>
      </box>
    </box>
  );
}
