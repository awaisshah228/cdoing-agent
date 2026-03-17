/**
 * SessionFooter — bottom status line with directory and shortcut hints.
 */

import { useTheme } from "../context/theme";

export interface SessionFooterProps {
  workingDir: string;
  isProcessing: boolean;
}

export function SessionFooter(props: SessionFooterProps) {
  const { theme } = useTheme();
  const t = theme;

  const home = process.env.HOME || "";
  const shortDir = home && props.workingDir.startsWith(home)
    ? "~" + props.workingDir.slice(home.length)
    : props.workingDir;

  const shortcuts = "^P:Commands  ^O:Model  ^T:Theme  ^S:Sessions  ^B:Sidebar";

  return (
    <box height={1} flexDirection="row" backgroundColor={t.bgSubtle}>
      <text fg={t.textDim}>{` ${shortDir}`}</text>
      <box flexGrow={1} />
      <text fg={t.textMuted}>{`${shortcuts} `}</text>
    </box>
  );
}
