/**
 * SessionHeader — top-line session info bar.
 */

import { TextAttributes } from "@opentui/core";
import { useTheme } from "../context/theme";

export interface SessionHeaderProps {
  title: string;
  provider: string;
  model: string;
  tokens?: { input: number; output: number };
  contextPercent?: number;
  status: string;
}

export function SessionHeader(props: SessionHeaderProps) {
  const { theme } = useTheme();
  const t = theme;

  const inTok = props.tokens ? props.tokens.input.toLocaleString() : "0";
  const outTok = props.tokens ? props.tokens.output.toLocaleString() : "0";
  const pct = props.contextPercent ? Math.round(props.contextPercent) : 0;
  const pctColor = pct > 75 ? t.error : pct > 50 ? t.warning : t.success;
  const statusColor = props.status === "Error" ? t.error
    : props.status === "Processing..." ? t.warning : t.success;

  const left = ` ◆ ${props.title || "Session"} │ ${props.provider}/${props.model} │ ${inTok}→${outTok} tokens`;

  return (
    <box height={1} flexDirection="row">
      <text fg={t.primary} attributes={TextAttributes.BOLD}>{left}</text>
      <text fg={t.border}>{" │ "}</text>
      <text fg={pctColor}>{`${pct}%`}</text>
      <box flexGrow={1} />
      <text fg={statusColor}>{`${props.status} `}</text>
    </box>
  );
}
