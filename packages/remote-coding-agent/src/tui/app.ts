/**
 * TUI Dashboard — Rich terminal UI for monitoring the remote agent.
 *
 * Layout:
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │  Remote Coding Agent                         ▲ uptime 42m   │
 *   ├──────────────────────────────────────────────────────────────┤
 *   │  ● Agents                    │  Events                      │
 *   │  ├ Assistant: haiku-4.5      │  12:01 message:received ...  │
 *   │  │  sessions: 3              │  12:01 agent:start ...       │
 *   │  ├ Coding: sonnet-4.6        │  12:01 agent:delegated ...   │
 *   │  │  sessions: 1              │  12:01 agent:tool_call ...   │
 *   │  │                           │  12:02 agent:complete ...    │
 *   │  ● Channels                  │                              │
 *   │  ├ ✓ Telegram                │                              │
 *   │  ├ ✗ Discord                 │                              │
 *   │  │                           │                              │
 *   │  ● Sessions (4)              │                              │
 *   │  ├ tg:user1 — 12 msgs       │                              │
 *   │  ├ tg:user2 — 3 msgs        │                              │
 *   ├──────────────────────────────────────────────────────────────┤
 *   │  q quit  r reload  c clear events                           │
 *   └──────────────────────────────────────────────────────────────┘
 *
 * Built with Ink (React for CLI).
 */

// eslint-disable-next-line @typescript-eslint/no-var-requires
const React = require("react");
const { useState, useEffect } = React;

import type { Engine } from "../core/engine";
import type { EngineEvent, AgentRole } from "../types";

// ── Types ────────────────────────────────────────────────────────────────

interface TuiState {
  channels: ChannelStatus[];
  sessions: SessionInfo[];
  events: EventLogEntry[];
  stats: StatsInfo;
  agentStats: { assistant: number; coding: number };
}

interface ChannelStatus {
  id: string;
  name: string;
  connected: boolean;
}

interface SessionInfo {
  id: string;
  channel: string;
  userId: string;
  historyLength: number;
  lastActive: string;
}

interface EventLogEntry {
  time: string;
  type: string;
  detail: string;
  role?: AgentRole;
  color: string;
}

interface StatsInfo {
  uptime: number;
  totalSessions: number;
  activeSessions: number;
  activeAgents: number;
  assistantModel: string;
  codingModel: string;
  assistantProvider: string;
  codingProvider: string;
}

// ── Colors ───────────────────────────────────────────────────────────────

const C = {
  primary: "cyan",
  success: "green",
  warning: "yellow",
  error: "red",
  muted: "gray",
  assistant: "blue",
  coding: "magenta",
  header: "cyanBright",
};

// ── Main Component ───────────────────────────────────────────────────────

export interface DashboardProps {
  engine: Engine;
}

export function Dashboard({ engine }: DashboardProps): any {
  const h = React.createElement;
  const config = engine.getConfig();

  const [state, setState] = (useState as any)({
    channels: [],
    sessions: [],
    events: [],
    stats: {
      uptime: 0,
      totalSessions: 0,
      activeSessions: 0,
      activeAgents: 0,
      assistantModel: config.agent.model,
      codingModel: config.agent.codingModel || config.agent.model,
      assistantProvider: config.agent.provider,
      codingProvider: config.agent.codingProvider || config.agent.provider,
    },
    agentStats: { assistant: 0, coding: 0 },
  } as TuiState);

  // Event listener
  (useEffect as any)(() => {
    const unsubscribe = engine.onEvent((event: EngineEvent) => {
      setState((prev: TuiState) => {
        const entry = formatEvent(event);
        return { ...prev, events: [entry, ...prev.events].slice(0, 100) };
      });
    });

    // Poll for state updates
    const interval = setInterval(() => {
      const reg = engine.getChannelRegistry();
      const sm = engine.getSessionManager();
      const bridge = engine.getBridge();
      const stats = sm.getStats();
      const cfg = engine.getConfig();

      setState((prev: TuiState) => ({
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
          lastActive: timeSince(s.lastActiveAt),
        })),
        stats: {
          uptime: process.uptime(),
          totalSessions: stats.total,
          activeSessions: stats.active,
          activeAgents: bridge.activeCount,
          assistantModel: cfg.agent.model,
          codingModel: cfg.agent.codingModel || cfg.agent.model,
          assistantProvider: cfg.agent.provider,
          codingProvider: cfg.agent.codingProvider || cfg.agent.provider,
        },
        agentStats: bridge.getAgentStats(),
      }));
    }, 2000);

    return () => { unsubscribe(); clearInterval(interval); };
  }, [engine]);

  // Keyboard handler
  (useEffect as any)(() => {
    const handler = (key: string, data: any) => {
      if (data?.name === "q" || data?.name === "escape") process.exit(0);
      if (data?.name === "c") {
        setState((prev: TuiState) => ({ ...prev, events: [] }));
      }
    };
    // Ink useInput equivalent via stdin
    process.stdin.on("keypress", handler);
    return () => { process.stdin.removeListener("keypress", handler); };
  }, []);

  const upStr = formatUptime(state.stats.uptime);

  return h("ink-box", { flexDirection: "column", width: "100%" },

    // ── Header ──────────────────────────────────────────────────────────
    h("ink-box", { borderStyle: "single", borderColor: C.primary, paddingX: 1, justifyContent: "space-between" },
      h("ink-text", { bold: true, color: C.header }, "Remote Coding Agent"),
      h("ink-text", { color: C.muted }, `uptime ${upStr}`),
    ),

    // ── Main Content (sidebar + events) ─────────────────────────────────
    h("ink-box", { flexDirection: "row", flexGrow: 1, minHeight: 16 },

      // Left panel — agents, channels, sessions
      h("ink-box", { flexDirection: "column", width: 38, paddingX: 1 },

        // Agents section
        h("ink-text", { bold: true, color: C.primary }, "● Agents"),
        h("ink-box", { flexDirection: "column", marginLeft: 2, marginBottom: 1 },
          h("ink-text", { color: C.assistant },
            `├ Assistant: ${state.stats.assistantProvider}/${shortModel(state.stats.assistantModel)}`
          ),
          h("ink-text", { color: C.muted },
            `│  ${state.agentStats.assistant} active`
          ),
          h("ink-text", { color: C.coding },
            `└ Coding: ${state.stats.codingProvider}/${shortModel(state.stats.codingModel)}`
          ),
          h("ink-text", { color: C.muted },
            `   ${state.agentStats.coding} active`
          ),
        ),

        // Channels section
        h("ink-text", { bold: true, color: C.primary }, "● Channels"),
        h("ink-box", { flexDirection: "column", marginLeft: 2, marginBottom: 1 },
          ...state.channels.map((ch: ChannelStatus, i: number) =>
            h("ink-text", { key: ch.id, color: ch.connected ? C.success : C.error },
              `${i === state.channels.length - 1 ? "└" : "├"} ${ch.connected ? "✓" : "✗"} ${ch.name}`
            )
          ),
          ...(state.channels.length === 0 ? [
            h("ink-text", { key: "none", color: C.muted }, "└ (no channels)")
          ] : []),
        ),

        // Sessions section
        h("ink-text", { bold: true, color: C.primary }, `● Sessions (${state.stats.activeSessions})`),
        h("ink-box", { flexDirection: "column", marginLeft: 2 },
          ...state.sessions.slice(0, 8).map((s: SessionInfo, i: number) => {
            const chShort = s.channel.substring(0, 2);
            const userShort = s.userId.substring(0, 10);
            const isLast = i === Math.min(state.sessions.length, 8) - 1;
            return h("ink-text", { key: s.id, color: C.muted },
              `${isLast ? "└" : "├"} ${chShort}:${userShort} — ${s.historyLength} msgs — ${s.lastActive}`
            );
          }),
          ...(state.sessions.length === 0 ? [
            h("ink-text", { key: "none", color: C.muted }, "└ (no sessions)")
          ] : []),
          ...(state.sessions.length > 8 ? [
            h("ink-text", { key: "more", color: C.muted }, `  +${state.sessions.length - 8} more`)
          ] : []),
        ),
      ),

      // Separator
      h("ink-box", { width: 1, flexDirection: "column" },
        h("ink-text", { color: C.muted }, "│".repeat(20))
      ),

      // Right panel — event log
      h("ink-box", { flexDirection: "column", flexGrow: 1, paddingX: 1 },
        h("ink-text", { bold: true, color: C.primary }, `● Events (${state.events.length})`),
        h("ink-box", { flexDirection: "column", marginTop: 0 },
          ...state.events.slice(0, 20).map((e: EventLogEntry, i: number) =>
            h("ink-text", { key: i, dimColor: i > 10, color: e.color || undefined },
              `${e.time} ${e.type} ${e.detail}`
            )
          ),
          ...(state.events.length === 0 ? [
            h("ink-text", { key: "none", color: C.muted }, "  waiting for events...")
          ] : []),
        ),
      ),
    ),

    // ── Footer ──────────────────────────────────────────────────────────
    h("ink-box", { borderStyle: "single", borderColor: C.muted, paddingX: 1, justifyContent: "space-between" },
      h("ink-text", { color: C.muted },
        `${state.stats.activeSessions} sessions · ${state.stats.activeAgents} agents`
      ),
      h("ink-text", { color: C.muted }, "q quit  c clear events"),
    ),
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────

function formatEvent(event: EngineEvent): EventLogEntry {
  const time = new Date().toLocaleTimeString("en", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const role = "role" in event ? (event as any).role : undefined;

  switch (event.type) {
    case "channel:connected":
      return { time, type: "channel:up", detail: event.channel, color: C.success, role };
    case "channel:disconnected":
      return { time, type: "channel:down", detail: event.channel, color: C.error, role };
    case "channel:error":
      return { time, type: "channel:err", detail: `${event.channel} ${event.error.message.substring(0, 40)}`, color: C.error, role };
    case "message:received":
      return { time, type: "msg", detail: `${event.userId} "${event.text.substring(0, 50)}"`, color: "", role };
    case "agent:start":
      return { time, type: `${role || "agent"}:start`, detail: event.chatId.substring(0, 12), color: role === "coding" ? C.coding : C.assistant, role };
    case "agent:tool_call":
      return { time, type: "tool", detail: event.name, color: C.warning, role };
    case "agent:complete":
      return { time, type: `${role || "agent"}:done`, detail: `${event.reply.durationMs || 0}ms`, color: role === "coding" ? C.coding : C.success, role };
    case "agent:error":
      return { time, type: "agent:err", detail: event.error.message.substring(0, 40), color: C.error, role };
    case "agent:delegated":
      return { time, type: "delegated", detail: `→ coding: "${(event as any).task?.substring(0, 40)}"`, color: C.coding, role };
    case "session:created":
      return { time, type: "session:new", detail: (event as any).sessionId?.substring(0, 20) || "", color: C.success, role };
    case "session:expired":
      return { time, type: "session:exp", detail: (event as any).sessionId?.substring(0, 20) || "", color: C.muted, role };
    default:
      return { time, type: event.type, detail: "", color: "", role };
  }
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h${m}m`;
}

function timeSince(date: Date): string {
  const sec = Math.floor((Date.now() - date.getTime()) / 1000);
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  return `${Math.floor(sec / 3600)}h ago`;
}

function shortModel(model: string): string {
  return model.replace("claude-", "").replace("gpt-", "").substring(0, 14);
}

/**
 * Render the TUI dashboard.
 */
export async function renderDashboard(engine: Engine): Promise<void> {
  const ink = await (Function('return import("ink")')() as Promise<any>);
  const element = React.createElement(Dashboard, { engine });
  const { waitUntilExit } = ink.render(element);
  await waitUntilExit();
}
