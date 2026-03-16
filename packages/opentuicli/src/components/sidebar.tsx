/**
 * Sidebar — collapsible right panel showing session info, context usage,
 * activity status, and keyboard shortcuts. Toggled with Ctrl+B.
 */

import { TextAttributes } from "@opentui/core";
import { useTheme } from "../context/theme";

const SIDEBAR_WIDTH = 30;

export interface SidebarProps {
  provider: string;
  model: string;
  workingDir: string;
  tokens?: { input: number; output: number };
  contextPercent?: number;
  activeTool?: string;
  status: string;
  sessionTitle?: string;
}

function truncate(str: string, max: number): string {
  return str.length > max ? str.slice(0, max - 1) + "\u2026" : str;
}

function contextBar(percent: number, barWidth: number): string {
  const filled = Math.round((percent / 100) * barWidth);
  const empty = barWidth - filled;
  return "[" + "\u2588".repeat(filled) + "\u2591".repeat(empty) + "]";
}

export function Sidebar(props: SidebarProps) {
  const { theme } = useTheme();
  const t = theme;

  const home = process.env.HOME || "";
  const shortDir =
    home && props.workingDir.startsWith(home)
      ? "~" + props.workingDir.slice(home.length)
      : props.workingDir;

  const pct = props.contextPercent ? Math.round(props.contextPercent) : 0;
  const pctColor = pct > 75 ? t.error : pct > 50 ? t.warning : t.success;

  const inputTokens = props.tokens ? props.tokens.input.toLocaleString() : "0";
  const outputTokens = props.tokens
    ? props.tokens.output.toLocaleString()
    : "0";

  const statusColor =
    props.status === "Error"
      ? t.error
      : props.status === "Processing..."
        ? t.warning
        : t.success;

  const bar = "\u2502";

  return (
    <box width={SIDEBAR_WIDTH} flexDirection="column">
      {/* Left border line runs the full height */}
      <box flexDirection="column" flexGrow={1}>
        {/* ── Session Info ──────────────────── */}
        <box height={1}>
          <text fg={t.border}>{bar} </text>
          <text fg={t.primary} attributes={TextAttributes.BOLD}>
            {"Session"}
          </text>
        </box>
        <box height={1}>
          <text fg={t.border}>{bar} </text>
          <text fg={t.textMuted}>{"  "}</text>
          <text fg={t.text}>
            {truncate(props.sessionTitle || "New Session", SIDEBAR_WIDTH - 6)}
          </text>
        </box>
        <box height={1}>
          <text fg={t.border}>{bar} </text>
          <text fg={t.textMuted}>{"  Dir: "}</text>
          <text fg={t.text}>{truncate(shortDir, SIDEBAR_WIDTH - 9)}</text>
        </box>
        <box height={1}>
          <text fg={t.border}>{bar} </text>
          <text fg={t.textMuted}>{"  Provider: "}</text>
          <text fg={t.text}>{truncate(props.provider, SIDEBAR_WIDTH - 14)}</text>
        </box>
        <box height={1}>
          <text fg={t.border}>{bar} </text>
          <text fg={t.textMuted}>{"  Model: "}</text>
          <text fg={t.text}>{truncate(props.model, SIDEBAR_WIDTH - 11)}</text>
        </box>

        {/* Spacer */}
        <box height={1}>
          <text fg={t.border}>{bar}</text>
        </box>

        {/* ── Context ──────────────────────── */}
        <box height={1}>
          <text fg={t.border}>{bar} </text>
          <text fg={t.primary} attributes={TextAttributes.BOLD}>
            {"Context"}
          </text>
        </box>
        <box height={1}>
          <text fg={t.border}>{bar} </text>
          <text fg={t.textMuted}>{"  In:  "}</text>
          <text fg={t.text}>{inputTokens}</text>
        </box>
        <box height={1}>
          <text fg={t.border}>{bar} </text>
          <text fg={t.textMuted}>{"  Out: "}</text>
          <text fg={t.text}>{outputTokens}</text>
        </box>
        <box height={1}>
          <text fg={t.border}>{bar} </text>
          <text fg={t.textMuted}>{"  "}</text>
          <text fg={pctColor}>{contextBar(pct, 14)}</text>
          <text fg={pctColor}>{` ${pct}%`}</text>
        </box>

        {/* Spacer */}
        <box height={1}>
          <text fg={t.border}>{bar}</text>
        </box>

        {/* ── Activity ─────────────────────── */}
        <box height={1}>
          <text fg={t.border}>{bar} </text>
          <text fg={t.primary} attributes={TextAttributes.BOLD}>
            {"Activity"}
          </text>
        </box>
        <box height={1}>
          <text fg={t.border}>{bar} </text>
          <text fg={t.textMuted}>{"  Status: "}</text>
          <text fg={statusColor}>{props.status}</text>
        </box>
        {props.activeTool && (
          <box height={1}>
            <text fg={t.border}>{bar} </text>
            <text fg={t.textMuted}>{"  Tool: "}</text>
            <text fg={t.toolRunning}>
              {truncate(props.activeTool, SIDEBAR_WIDTH - 10)}
            </text>
          </box>
        )}

        {/* Spacer */}
        <box height={1}>
          <text fg={t.border}>{bar}</text>
        </box>

        {/* ── Shortcuts ────────────────────── */}
        <box height={1}>
          <text fg={t.border}>{bar} </text>
          <text fg={t.primary} attributes={TextAttributes.BOLD}>
            {"Shortcuts"}
          </text>
        </box>
        <box height={1}>
          <text fg={t.border}>{bar} </text>
          <text fg={t.textMuted}>{"  Ctrl+B  "}</text>
          <text fg={t.textDim}>{"Sidebar"}</text>
        </box>
        <box height={1}>
          <text fg={t.border}>{bar} </text>
          <text fg={t.textMuted}>{"  Ctrl+N  "}</text>
          <text fg={t.textDim}>{"New session"}</text>
        </box>
        <box height={1}>
          <text fg={t.border}>{bar} </text>
          <text fg={t.textMuted}>{"  Ctrl+P  "}</text>
          <text fg={t.textDim}>{"Model picker"}</text>
        </box>
        <box height={1}>
          <text fg={t.border}>{bar} </text>
          <text fg={t.textMuted}>{"  Ctrl+S  "}</text>
          <text fg={t.textDim}>{"Sessions"}</text>
        </box>
        <box height={1}>
          <text fg={t.border}>{bar} </text>
          <text fg={t.textMuted}>{"  Ctrl+C  "}</text>
          <text fg={t.textDim}>{"Quit"}</text>
        </box>

        {/* Fill remaining space with border */}
        <box flexGrow={1}>
          <text fg={t.border}>{bar}</text>
        </box>
      </box>
    </box>
  );
}
