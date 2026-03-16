/**
 * TUI Dashboard — Terminal UI for monitoring and configuring the remote agent.
 *
 * Built with Ink (React for CLI). Shows:
 *   - Live channel status (connected/disconnected)
 *   - Active sessions with message counts
 *   - Real-time agent activity (tool calls, completions)
 *   - Event log stream
 *   - Interactive config (change model, provider, working dir)
 *
 * Usage:
 *   remote-coding-agent tui
 */

// eslint-disable-next-line @typescript-eslint/no-var-requires
const React = require("react");
const { useState, useEffect } = React;

import type { Engine } from "../core/engine";
import type { EngineEvent } from "../types";

// ── Types for TUI State ────────────────────────────────────────────────────

interface TuiState {
  channels: ChannelStatus[];
  sessions: SessionInfo[];
  events: EventLogEntry[];
  stats: StatsInfo;
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
}

interface StatsInfo {
  uptime: number;
  totalSessions: number;
  activeSessions: number;
  activeAgents: number;
}

// ── Main TUI Component ────────────────────────────────────────────────────

export interface DashboardProps {
  engine: Engine;
}

export function Dashboard({ engine }: DashboardProps): any {
  const [state, setState] = (useState as any)({
    channels: [],
    sessions: [],
    events: [],
    stats: { uptime: 0, totalSessions: 0, activeSessions: 0, activeAgents: 0 },
  } as TuiState);

  (useEffect as any)(() => {
    const unsubscribe = engine.onEvent((event: EngineEvent) => {
      setState((prev: TuiState) => {
        const entry: EventLogEntry = {
          time: new Date().toLocaleTimeString(),
          type: event.type,
          detail: formatEventDetail(event),
        };
        return { ...prev, events: [entry, ...prev.events].slice(0, 50) };
      });
    });

    const interval = setInterval(() => {
      const reg = engine.getChannelRegistry();
      const sm = engine.getSessionManager();
      const stats = sm.getStats();

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
          lastActive: s.lastActiveAt.toLocaleTimeString(),
        })),
        stats: {
          uptime: process.uptime(),
          totalSessions: stats.total,
          activeSessions: stats.active,
          activeAgents: engine.getBridge().activeCount,
        },
      }));
    }, 2000);

    return () => {
      unsubscribe();
      clearInterval(interval);
    };
  }, [engine]);

  const h = React.createElement;

  return h("ink-box", { flexDirection: "column" },
    // Header
    h("ink-box", { borderStyle: "round", paddingX: 1 },
      h("ink-text", { bold: true, color: "cyan" }, " Remote Coding Agent Dashboard ")
    ),

    // Stats bar
    h("ink-box", { marginY: 1, gap: 2 },
      h("ink-text", null, `Uptime: ${Math.floor(state.stats.uptime)}s`),
      h("ink-text", null, `Sessions: ${state.stats.activeSessions}/${state.stats.totalSessions}`),
      h("ink-text", null, `Agents: ${state.stats.activeAgents}`),
    ),

    // Channels
    h("ink-box", { flexDirection: "column", marginBottom: 1 },
      h("ink-text", { bold: true }, "Channels:"),
      ...state.channels.map((ch: ChannelStatus) =>
        h("ink-text", { key: ch.id },
          `  ${ch.connected ? "[OK]" : "[--]"} ${ch.name} (${ch.id})`
        )
      ),
    ),

    // Sessions
    h("ink-box", { flexDirection: "column", marginBottom: 1 },
      h("ink-text", { bold: true }, `Sessions (${state.sessions.length}):`),
      ...state.sessions.slice(0, 10).map((s: SessionInfo) =>
        h("ink-text", { key: s.id },
          `  ${s.channel}:${s.userId} — ${s.historyLength} msgs — ${s.lastActive}`
        )
      ),
    ),

    // Event log
    h("ink-box", { flexDirection: "column" },
      h("ink-text", { bold: true }, "Recent Events:"),
      ...state.events.slice(0, 15).map((e: EventLogEntry, i: number) =>
        h("ink-text", { key: i, dimColor: i > 5 },
          `  [${e.time}] ${e.type} ${e.detail}`
        )
      ),
    ),
  );
}

function formatEventDetail(event: EngineEvent): string {
  switch (event.type) {
    case "channel:connected": return event.channel;
    case "channel:disconnected": return event.channel;
    case "channel:error": return `${event.channel}: ${event.error.message}`;
    case "message:received": return `${event.channel}:${event.userId} "${event.text.substring(0, 40)}"`;
    case "agent:start": return `${event.channel}:${event.chatId}`;
    case "agent:tool_call": return `${event.channel}:${event.chatId} -> ${event.name}`;
    case "agent:complete": return `${event.channel}:${event.chatId} (${event.reply.durationMs || 0}ms)`;
    case "agent:error": return `${event.channel}:${event.chatId} ${event.error.message}`;
    default: return "";
  }
}

/**
 * Render the TUI dashboard.
 */
export async function renderDashboard(engine: Engine): Promise<void> {
  // Dynamic import to handle ESM ink module
  const ink = await (Function('return import("ink")')() as Promise<any>);
  const element = React.createElement(Dashboard, { engine });
  const { waitUntilExit } = ink.render(element);
  await waitUntilExit();
}
