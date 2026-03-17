/**
 * SessionList — list of active sessions with message count and relative time.
 *
 * Shows up to 10 sessions with format: channel:userId -- N msgs -- Xm ago
 */

import { TextAttributes } from "@opentui/core";
import { useTheme } from "../context/theme";
import type { EngineState } from "../hooks/use-engine-state";

export interface SessionListProps {
  state: EngineState;
}

function timeSince(date: Date): string {
  const sec = Math.floor((Date.now() - date.getTime()) / 1000);
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  return `${Math.floor(sec / 3600)}h ago`;
}

const MAX_VISIBLE = 10;

export function SessionList(props: SessionListProps) {
  const { theme: t } = useTheme();
  const { sessions, stats } = props.state;

  const visible = sessions.slice(0, MAX_VISIBLE);

  return (
    <box flexDirection="column" flexShrink={0}>
      <text fg={t.primary} attributes={TextAttributes.BOLD}>
        {`\u25CF Sessions (${stats.activeSessions})`}
      </text>
      <box flexDirection="column" paddingLeft={2}>
        {visible.length === 0 ? (
          <text fg={t.textDim}>{"\u2514 (no sessions)"}</text>
        ) : (
          visible.map((s, i) => {
            const isLast = i === visible.length - 1 && sessions.length <= MAX_VISIBLE;
            const prefix = isLast ? "\u2514" : "\u251C";
            const chShort = s.channel.substring(0, 3);
            const userShort = s.userId.substring(0, 10);
            const ago = timeSince(s.lastActiveAt);
            return (
              <text key={s.id} fg={t.textMuted}>
                {`${prefix} ${chShort}:${userShort} \u2014 ${s.historyLength} msgs \u2014 ${ago}`}
              </text>
            );
          })
        )}
        {sessions.length > MAX_VISIBLE && (
          <text fg={t.textDim}>{`  +${sessions.length - MAX_VISIBLE} more`}</text>
        )}
      </box>
    </box>
  );
}
