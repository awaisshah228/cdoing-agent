/**
 * Sidebar — collapsible right panel with sections.
 * Uses single text per line to avoid layout concatenation issues.
 */

import { TextAttributes } from "@opentui/core";
import { useTheme } from "../context/theme";

const W = 34; // content width (inside the border)

export interface SidebarProps {
  provider: string;
  model: string;
  workingDir: string;
  tokens?: { input: number; output: number };
  contextPercent?: number;
  activeTool?: string;
  status: string;
  sessionTitle?: string;
  themeId?: string;
  modifiedFiles?: Array<{ path: string; additions: number; deletions: number }>;
}

function trunc(str: string, max: number): string {
  return str.length > max ? str.slice(0, max - 1) + "…" : str;
}

function bar(pct: number, len: number): string {
  const filled = Math.round((pct / 100) * len);
  return "█".repeat(filled) + "░".repeat(len - filled);
}

export function Sidebar(props: SidebarProps) {
  const { theme } = useTheme();
  const t = theme;

  const home = process.env.HOME || "";
  const dir = home && props.workingDir.startsWith(home)
    ? "~" + props.workingDir.slice(home.length) : props.workingDir;

  const pct = props.contextPercent ? Math.round(props.contextPercent) : 0;
  const pctColor = pct > 75 ? t.error : pct > 50 ? t.warning : t.success;
  const inTok = props.tokens ? props.tokens.input.toLocaleString() : "0";
  const outTok = props.tokens ? props.tokens.output.toLocaleString() : "0";
  const statusColor = props.status === "Error" ? t.error
    : props.status === "Processing..." ? t.warning : t.success;

  // Each line is a single string rendered in one <text> to avoid concatenation issues
  const lines: Array<{ text: string; fg: any; bold?: boolean }> = [];

  const sep = () => lines.push({ text: "│", fg: t.border });
  const header = (title: string) => {
    lines.push({ text: `│ ${title}`, fg: t.primary, bold: true });
  };
  const row = (label: string, value: string, fg?: any) => {
    const padded = label ? `│   ${label.padEnd(10)} ${trunc(value, W - 14)}` : `│   ${trunc(value, W - 4)}`;
    lines.push({ text: padded, fg: fg || t.text });
  };
  const shortcut = (key: string, label: string) => {
    lines.push({ text: `│   ${key.padEnd(10)} ${label}`, fg: t.textDim });
  };

  // ── Session ──
  header("Session");
  row("", props.sessionTitle || "New Session");
  row("Dir", trunc(dir, W - 14));
  row("Provider", props.provider);
  row("Model", props.model);
  if (props.themeId) row("Theme", props.themeId);
  sep();

  // ── Context ──
  header("Context");
  row("Input", `${inTok} tokens`);
  row("Output", `${outTok} tokens`);
  lines.push({ text: `│   ${bar(pct, 16)} ${pct}%`, fg: pctColor });
  sep();

  // ── Activity ──
  header("Activity");
  lines.push({ text: `│   Status     ${props.status}`, fg: statusColor });
  if (props.activeTool) {
    lines.push({ text: `│   Tool       ${trunc(props.activeTool, W - 14)}`, fg: t.toolRunning });
  }
  sep();

  // ── Modified Files ──
  if (props.modifiedFiles && props.modifiedFiles.length > 0) {
    header(`Files (${props.modifiedFiles.length})`);
    for (const f of props.modifiedFiles.slice(0, 6)) {
      const name = f.path.split("/").pop() || f.path;
      const diff = (f.additions > 0 ? ` +${f.additions}` : "") + (f.deletions > 0 ? ` -${f.deletions}` : "");
      lines.push({ text: `│   ${trunc(name, W - 12)}${diff}`, fg: t.text });
    }
    if (props.modifiedFiles.length > 6) {
      lines.push({ text: `│   … ${props.modifiedFiles.length - 6} more`, fg: t.textDim });
    }
    sep();
  }

  // ── Shortcuts ──
  header("Shortcuts");
  shortcut("Ctrl+B", "Sidebar");
  shortcut("Ctrl+N", "New session");
  shortcut("Ctrl+P", "Model");
  shortcut("Ctrl+T", "Theme");
  shortcut("Ctrl+S", "Sessions");
  shortcut("Ctrl+X", "Commands");
  shortcut("F1", "Help");

  return (
    <box width={W + 2} flexDirection="column">
      <box flexDirection="column" flexGrow={1}>
        {lines.map((line, i) => (
          <text
            key={i}
            fg={line.fg}
            attributes={line.bold ? TextAttributes.BOLD : undefined}
          >
            {line.text}
          </text>
        ))}
        {/* Fill remaining space with border */}
        <box flexGrow={1}>
          <text fg={t.border}>{"│"}</text>
        </box>
      </box>
    </box>
  );
}
