/**
 * EventLog — scrollable event stream from the engine.
 *
 * Subscribes to engine.onEvent(), maintains a buffer of the last 50 events,
 * and color-codes them by type.
 */

import { TextAttributes, type RGBA } from "@opentui/core";
import { useState, useEffect } from "react";
import { useEngine } from "../context/engine";
import { useTheme, type Theme } from "../context/theme";
import type { EngineEvent, AgentRole } from "@cdoing/remote-coding-agent/types";

// ── Types ─────────────────────────────────────────────────────

interface EventLogEntry {
  time: string;
  type: string;
  detail: string;
  color: RGBA;
  role?: AgentRole;
}

// ── Color Map ─────────────────────────────────────────────────

function getEventColor(eventType: string, role: AgentRole | undefined, t: Theme): RGBA {
  if (eventType.startsWith("agent:start") || eventType.includes(":start")) return t.info;
  if (eventType === "tool" || eventType === "agent:tool_call") return t.warning;
  if (eventType.includes("error") || eventType.includes("err")) return t.error;
  if (eventType === "delegated" || eventType === "agent:delegated") return t.secondary;
  if (eventType.startsWith("channel:up") || eventType.startsWith("session:new")) return t.success;
  if (eventType.startsWith("channel:down") || eventType.startsWith("session:exp")) return t.error;
  if (role === "coding") return t.secondary;
  if (role === "assistant") return t.info;
  return t.textMuted;
}

// ── Format Event ──────────────────────────────────────────────

function formatEvent(event: EngineEvent, t: Theme): EventLogEntry {
  const time = new Date().toLocaleTimeString("en", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const role = "role" in event ? (event as any).role : undefined;

  let type: string;
  let detail: string;

  switch (event.type) {
    case "channel:connected":
      type = "channel:up";
      detail = event.channel;
      break;
    case "channel:disconnected":
      type = "channel:down";
      detail = event.channel;
      break;
    case "channel:error":
      type = "channel:err";
      detail = `${event.channel} ${event.error.message.substring(0, 40)}`;
      break;
    case "message:received":
      type = "msg";
      detail = `${event.userId} "${event.text.substring(0, 50)}"`;
      break;
    case "agent:start":
      type = `${role || "agent"}:start`;
      detail = event.chatId.substring(0, 12);
      break;
    case "agent:tool_call":
      type = "tool";
      detail = event.name;
      break;
    case "agent:complete":
      type = `${role || "agent"}:done`;
      detail = `${event.reply.durationMs || 0}ms`;
      break;
    case "agent:error":
      type = "agent:err";
      detail = event.error.message.substring(0, 40);
      break;
    case "agent:delegated":
      type = "delegated";
      detail = `\u2192 coding: "${event.task?.substring(0, 40)}"`;
      break;
    case "session:created":
      type = "session:new";
      detail = (event as any).sessionId?.substring(0, 20) || "";
      break;
    case "session:expired":
      type = "session:exp";
      detail = (event as any).sessionId?.substring(0, 20) || "";
      break;
    default:
      type = event.type;
      detail = "";
  }

  return { time, type, detail, color: getEventColor(type, role, t), role };
}

// ── Component ─────────────────────────────────────────────────

const MAX_EVENTS = 50;

export function EventLog() {
  const engine = useEngine();
  const { theme: t } = useTheme();
  const [events, setEvents] = useState<EventLogEntry[]>([]);

  useEffect(() => {
    const unsubscribe = engine.onEvent((event: EngineEvent) => {
      const entry = formatEvent(event, t);
      setEvents((prev) => [entry, ...prev].slice(0, MAX_EVENTS));
    });
    return unsubscribe;
  }, [engine]);

  return (
    <box flexDirection="column" flexGrow={1}>
      <text fg={t.primary} attributes={TextAttributes.BOLD}>
        {`\u25CF Events (${events.length})`}
      </text>
      <box flexDirection="column" flexGrow={1}>
        {events.length === 0 ? (
          <text fg={t.textDim}>{"  waiting for events..."}</text>
        ) : (
          events.map((e, i) => (
            <box key={i} height={1}>
              <text fg={t.textDim}>{`[${e.time}] `}</text>
              <text fg={e.color}>{`${e.type} `}</text>
              <text fg={t.textMuted}>{e.detail}</text>
            </box>
          ))
        )}
      </box>
    </box>
  );
}
