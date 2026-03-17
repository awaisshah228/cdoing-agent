/**
 * StatusBar — footer bar with route info, channel status, and keybind hints.
 */

import { TextAttributes } from "@opentui/core";
import { useTheme } from "../context/theme";
import type { Route } from "../store/settings";

export interface StatusBarProps {
  route: Route;
  channelCount: number;
  allConnected: boolean;
}

const ROUTE_HINTS: Record<Route, string> = {
  dashboard: "1 Dashboard  2 Skills  3 Config  s Setup  q Quit",
  setup: "esc Back  1 Dashboard  q Quit",
  skills: "1 Dashboard  2 Skills  3 Config  q Quit",
  config: "1 Dashboard  2 Skills  3 Config  q Quit",
};

const ROUTE_LABELS: Record<Route, string> = {
  dashboard: "Dashboard",
  setup: "Setup",
  skills: "Skills",
  config: "Config",
};

export function StatusBar(props: StatusBarProps) {
  const { theme: t } = useTheme();

  const channelStatus = props.channelCount > 0
    ? `${props.channelCount} channel${props.channelCount !== 1 ? "s" : ""} ${props.allConnected ? "\u2713" : "\u2717"}`
    : "no channels";

  return (
    <box height={1} flexDirection="row" justifyContent="space-between" backgroundColor={t.bgSubtle}>
      <box flexDirection="row">
        <text fg={t.primary} attributes={TextAttributes.BOLD}>
          {` ${ROUTE_LABELS[props.route]}`}
        </text>
        <text fg={t.textDim}>{" \u2502 "}</text>
        <text fg={props.allConnected ? t.success : t.warning}>{channelStatus}</text>
      </box>
      <box flexDirection="row">
        <text fg={t.textMuted}>{ROUTE_HINTS[props.route] + " "}</text>
      </box>
    </box>
  );
}
