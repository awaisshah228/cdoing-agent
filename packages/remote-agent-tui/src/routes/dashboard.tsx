/**
 * Dashboard Route — main monitoring view.
 *
 * Two-column layout:
 *   Left:  AgentPanel, ChannelPanel, SessionList
 *   Right: EventLog (scrollable event stream)
 *
 * Uses useEngineState() hook that polls every 2 seconds.
 */

import { useEngineState } from "../hooks/use-engine-state";
import { useTheme } from "../context/theme";
import { AgentPanel } from "../components/agent-panel";
import { ChannelPanel } from "../components/channel-panel";
import { SessionList } from "../components/session-list";
import { EventLog } from "../components/event-log";

export function Dashboard() {
  const state = useEngineState(2000);
  const { theme: t } = useTheme();

  return (
    <box flexDirection="row" flexGrow={1}>
      {/* Left column — status panels */}
      <box flexDirection="column" width={38} paddingX={1}>
        <AgentPanel state={state} />
        <box height={1} />
        <ChannelPanel state={state} />
        <box height={1} />
        <SessionList state={state} />
      </box>

      {/* Separator */}
      <box width={1} flexShrink={0}>
        <text fg={t.border}>{"\u2502\n".repeat(30)}</text>
      </box>

      {/* Right column — event log */}
      <box flexDirection="column" flexGrow={1} paddingX={1}>
        <EventLog />
      </box>
    </box>
  );
}
