/**
 * StatusBar — bottom bar with model info, tokens, context %, keybinds
 */

import { TextAttributes } from "@opentui/core";
import { useTheme } from "../context/theme";

export interface StatusBarProps {
  provider: string;
  model: string;
  mode: string;
  workingDir: string;
  tokens?: { input: number; output: number };
  contextPercent?: number;
  activeTool?: string;
  isProcessing?: boolean;
}

export function StatusBar(props: StatusBarProps) {
  const { theme } = useTheme();
  const t = theme;

  const home = process.env.HOME || "";
  const shortDir = home && props.workingDir.startsWith(home)
    ? "~" + props.workingDir.slice(home.length)
    : props.workingDir;

  const tokenInfo = props.tokens
    ? ` ${props.tokens.input.toLocaleString()}→${props.tokens.output.toLocaleString()}`
    : "";

  const pct = props.contextPercent ? Math.round(props.contextPercent) : 0;
  const contextBar = pct > 0 ? ` ctx:${pct}%` : "";

  return (
    <box height={1} flexDirection="row" justifyContent="space-between" backgroundColor={t.bgSubtle}>
      <box flexDirection="row">
        <text fg={t.primary} attributes={TextAttributes.BOLD}>
          {` ${props.provider}`}
        </text>
        <text fg={t.textMuted}>{`/${props.model}`}</text>
        <text fg={t.textDim}>{" │ "}</text>
        <text fg={t.warning}>{props.mode}</text>
        {tokenInfo && (
          <>
            <text fg={t.textDim}>{" │"}</text>
            <text fg={t.textMuted}>{tokenInfo}</text>
          </>
        )}
        {contextBar && (
          <>
            <text fg={t.textDim}>{" │"}</text>
            <text fg={pct > 75 ? t.warning : t.textMuted}>{contextBar}</text>
          </>
        )}
        {props.activeTool && (
          <>
            <text fg={t.textDim}>{" │ "}</text>
            <text fg={t.toolRunning}>{`⏳ ${props.activeTool}`}</text>
          </>
        )}
        {props.isProcessing && !props.activeTool && (
          <>
            <text fg={t.textDim}>{" │ "}</text>
            <text fg={t.primary}>{"thinking..."}</text>
          </>
        )}
      </box>
      <box flexDirection="row">
        <text fg={t.textDim}>{shortDir}</text>
        <text fg={t.textDim}>{" │ "}</text>
        <text fg={t.textMuted}>{"^P:Commands  ^O:Model  ^C:Quit"}</text>
      </box>
    </box>
  );
}
