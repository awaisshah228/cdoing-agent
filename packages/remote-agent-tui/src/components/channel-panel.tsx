/**
 * ChannelPanel — channel status list with connection indicators.
 *
 * Shows each registered channel with a green checkmark or red cross
 * depending on connection status.
 */

import { TextAttributes } from "@opentui/core";
import { useTheme } from "../context/theme";
import type { EngineState } from "../hooks/use-engine-state";

export interface ChannelPanelProps {
  state: EngineState;
}

export function ChannelPanel(props: ChannelPanelProps) {
  const { theme: t } = useTheme();
  const { channels } = props.state;

  return (
    <box flexDirection="column" flexShrink={0}>
      <text fg={t.primary} attributes={TextAttributes.BOLD}>
        {"\u25CF Channels"}
      </text>
      <box flexDirection="column" paddingLeft={2}>
        {channels.length === 0 ? (
          <text fg={t.textDim}>{"\u2514 (no channels)"}</text>
        ) : (
          channels.map((ch, i) => {
            const isLast = i === channels.length - 1;
            const prefix = isLast ? "\u2514" : "\u251C";
            const icon = ch.connected ? "\u2713" : "\u2717";
            const color = ch.connected ? t.success : t.error;
            return (
              <text key={ch.id} fg={color}>
                {`${prefix} ${icon} ${ch.name}`}
              </text>
            );
          })
        )}
      </box>
    </box>
  );
}
