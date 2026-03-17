import { createContext, useContext, useState, useEffect, useRef } from "react";
import type { Engine } from "@cdoing/remote-coding-agent";
import type { EngineEvent, AgentRole } from "@cdoing/remote-coding-agent";

const EngineContext = createContext<Engine | null>(null);

export const EngineProvider = EngineContext.Provider;

export function useEngine(): Engine {
  const e = useContext(EngineContext);
  if (!e) throw new Error("useEngine must be inside EngineProvider");
  return e;
}

// ── Engine State ────────────────────────────────────────────────────────

export interface ChannelStatus {
  id: string;
  name: string;
  connected: boolean;
}

export interface SessionInfo {
  id: string;
  channel: string;
  userId: string;
  historyLength: number;
  lastActive: Date;
}

export interface EventEntry {
  time: string;
  type: string;
  detail: string;
  color: string;
  role?: AgentRole;
}

export interface EngineState {
  channels: ChannelStatus[];
  sessions: SessionInfo[];
  events: EventEntry[];
  uptime: number;
  activeSessions: number;
  totalSessions: number;
  activeAgents: number;
  agentStats: { assistant: number; coding: number };
  assistantModel: string;
  assistantProvider: string;
  codingModel: string;
  codingProvider: string;
}

/**
 * Hook that polls the engine for state every `intervalMs` and
 * subscribes to real-time events.
 */
export function useEngineState(intervalMs: number = 2000): EngineState {
  const engine = useEngine();
  const config = engine.getConfig();

  const [state, setState] = useState<EngineState>({
    channels: [],
    sessions: [],
    events: [],
    uptime: 0,
    activeSessions: 0,
    totalSessions: 0,
    activeAgents: 0,
    agentStats: { assistant: 0, coding: 0 },
    assistantModel: config.agent.model,
    assistantProvider: config.agent.provider,
    codingModel: config.agent.codingModel || config.agent.model,
    codingProvider: config.agent.codingProvider || config.agent.provider,
  });

  const eventsRef = useRef<EventEntry[]>([]);

  // Subscribe to events
  useEffect(() => {
    const unsubscribe = engine.onEvent((event: EngineEvent) => {
      const entry = formatEvent(event);
      eventsRef.current = [entry, ...eventsRef.current].slice(0, 100);
      setState((prev) => ({ ...prev, events: eventsRef.current }));
    });
    return unsubscribe;
  }, [engine]);

  // Poll state
  useEffect(() => {
    const poll = () => {
      const reg = engine.getChannelRegistry();
      const sm = engine.getSessionManager();
      const bridge = engine.getBridge();
      const stats = sm.getStats();
      const cfg = engine.getConfig();

      setState((prev) => ({
        ...prev,
        channels: reg.getAllPlugins().map((p: any) => ({
          id: p.id,
          name: p.name,
          connected: reg.isRunning(p.id),
        })),
        sessions: sm.getAll().map((s: any) => ({
          id: s.id,
          channel: s.channel,
          userId: s.userId,
          historyLength: s.history.length,
          lastActive: s.lastActiveAt,
        })),
        uptime: process.uptime(),
        activeSessions: stats.active,
        totalSessions: stats.total,
        activeAgents: bridge.activeCount,
        agentStats: bridge.getAgentStats(),
        assistantModel: cfg.agent.model,
        assistantProvider: cfg.agent.provider,
        codingModel: cfg.agent.codingModel || cfg.agent.model,
        codingProvider: cfg.agent.codingProvider || cfg.agent.provider,
      }));
    };

    poll();
    const interval = setInterval(poll, intervalMs);
    return () => clearInterval(interval);
  }, [engine, intervalMs]);

  return state;
}

// ── Event formatting ────────────────────────────────────────────────────

function formatEvent(event: EngineEvent): EventEntry {
  const time = new Date().toLocaleTimeString("en", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const role = "role" in event ? (event as any).role : undefined;

  switch (event.type) {
    case "channel:connected":
      return { time, type: "channel:up", detail: event.channel, color: "green", role };
    case "channel:disconnected":
      return { time, type: "channel:down", detail: event.channel, color: "red", role };
    case "channel:error":
      return { time, type: "channel:err", detail: `${event.channel} ${event.error.message.substring(0, 40)}`, color: "red", role };
    case "message:received":
      return { time, type: "msg", detail: `${event.userId} "${event.text.substring(0, 50)}"`, color: "", role };
    case "agent:start":
      return { time, type: `${role || "agent"}:start`, detail: event.chatId.substring(0, 12), color: role === "coding" ? "magenta" : "blue", role };
    case "agent:tool_call":
      return { time, type: "tool", detail: event.name, color: "yellow", role };
    case "agent:complete":
      return { time, type: `${role || "agent"}:done`, detail: `${event.reply.durationMs || 0}ms`, color: role === "coding" ? "magenta" : "green", role };
    case "agent:error":
      return { time, type: "agent:err", detail: event.error.message.substring(0, 40), color: "red", role };
    case "agent:delegated":
      return { time, type: "delegated", detail: `→ coding: "${(event as any).task?.substring(0, 40)}"`, color: "magenta", role };
    default:
      return { time, type: event.type, detail: "", color: "", role };
  }
}
