/**
 * SessionList — interactive list of active sessions.
 *
 * Arrow keys to select, Enter to expand/collapse messages.
 * Shows up to 10 sessions with format: channel:userId -- N msgs -- Xm ago
 */

import { useState, useCallback } from "react";
import { TextAttributes } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { useTheme } from "../context/theme";
import { useEngine } from "../context/engine";
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

interface SessionMessage {
  role: string;
  content: string;
  timestamp: number;
}

const MAX_VISIBLE = 10;
const MAX_PREVIEW_MSGS = 8;

export function SessionList(props: SessionListProps) {
  const { theme: t } = useTheme();
  const engine = useEngine();
  const { sessions, stats } = props.state;

  const [selectedIdx, setSelectedIdx] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<SessionMessage[]>([]);

  const visible = sessions.slice(0, MAX_VISIBLE);

  const toggleExpand = useCallback((sessionId: string) => {
    if (expandedId === sessionId) {
      setExpandedId(null);
      setMessages([]);
      return;
    }
    // Fetch messages from session manager
    const sm = engine.getSessionManager();
    const session = sm.getById(sessionId);
    if (session) {
      setMessages(
        session.history.slice(-MAX_PREVIEW_MSGS).map((m: any) => ({
          role: m.role,
          content: m.content,
          timestamp: m.timestamp,
        }))
      );
    } else {
      setMessages([]);
    }
    setExpandedId(sessionId);
  }, [engine, expandedId]);

  useKeyboard((key: any) => {
    if (visible.length === 0) return;

    if (key.name === "up" || key.name === "k") {
      setSelectedIdx((i) => (i > 0 ? i - 1 : visible.length - 1));
      return;
    }
    if (key.name === "down" || key.name === "j") {
      setSelectedIdx((i) => (i < visible.length - 1 ? i + 1 : 0));
      return;
    }
    if (key.name === "return") {
      const s = visible[selectedIdx];
      if (s) toggleExpand(s.id);
      return;
    }
  }, {});

  // Clamp selected index
  const safeIdx = Math.min(selectedIdx, visible.length - 1);

  return (
    <box flexDirection="column" flexShrink={0}>
      <text fg={t.primary} attributes={TextAttributes.BOLD}>
        {`\u25CF Sessions (${stats.activeSessions})  \u2190\u2191\u2193 Enter`}
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
            const isSelected = i === safeIdx;
            const isExpanded = expandedId === s.id;

            return (
              <box key={s.id} flexDirection="column">
                <text
                  fg={isSelected ? t.primary : t.textMuted}
                  attributes={isSelected ? TextAttributes.BOLD : undefined}
                >
                  {`${isSelected ? "\u25B6" : prefix} ${chShort}:${userShort} \u2014 ${s.historyLength} msgs \u2014 ${ago}${isExpanded ? " \u25BC" : ""}`}
                </text>
                {isExpanded && (
                  <box flexDirection="column" paddingLeft={2}>
                    {messages.length === 0 ? (
                      <text fg={t.textDim}>{"  (no messages)"}</text>
                    ) : (
                      messages.map((m, mi) => {
                        const time = new Date(m.timestamp).toLocaleTimeString("en", { hour12: false, hour: "2-digit", minute: "2-digit" });
                        const roleLabel = m.role === "user" ? "USR" : m.role === "assistant" ? "AST" : m.role === "tool" ? "TL " : "SYS";
                        const roleFg = m.role === "user" ? t.info : m.role === "assistant" ? t.success : t.textDim;
                        const preview = m.content.length > 60 ? m.content.substring(0, 57) + "..." : m.content;
                        // Replace newlines for single-line display
                        const oneLine = preview.replace(/\n/g, " ");
                        return (
                          <text key={mi} fg={roleFg}>
                            {`  ${time} ${roleLabel} ${oneLine}`}
                          </text>
                        );
                      })
                    )}
                    {messages.length >= MAX_PREVIEW_MSGS && (
                      <text fg={t.textDim}>{`  ... use /inspect ${s.id} for full history`}</text>
                    )}
                  </box>
                )}
              </box>
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
