/**
 * useEngineState — polls the Engine for current state every N ms.
 *
 * Returns channels, sessions, agent stats, and uptime info
 * for use in dashboard components.
 */

import { useState, useEffect } from "react";
import { useEngine } from "../context/engine";

// ── Types ─────────────────────────────────────────────────

export interface EngineState {
  channels: Array<{ id: string; name: string; connected: boolean }>;
  sessions: Array<{
    id: string;
    channel: string;
    userId: string;
    historyLength: number;
    lastActiveAt: Date;
  }>;
  stats: {
    uptime: number;
    totalSessions: number;
    activeSessions: number;
    activeAgents: number;
    assistantModel: string;
    codingModel: string;
    assistantProvider: string;
    codingProvider: string;
  };
  agentStats: { assistant: number; coding: number };
}

/**
 * Poll engine state every `intervalMs` milliseconds (default 2s).
 */
export function useEngineState(intervalMs = 2000): EngineState {
  const engine = useEngine();
  const config = engine.getConfig();

  const [state, setState] = useState<EngineState>({
    channels: [],
    sessions: [],
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
  });

  useEffect(() => {
    const poll = () => {
      const reg = engine.getChannelRegistry();
      const sm = engine.getSessionManager();
      const bridge = engine.getBridge();
      const sessionStats = sm.getStats();
      const cfg = engine.getConfig();

      setState({
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
          lastActiveAt: s.lastActiveAt,
        })),
        stats: {
          uptime: process.uptime(),
          totalSessions: sessionStats.total,
          activeSessions: sessionStats.active,
          activeAgents: bridge.activeCount,
          assistantModel: cfg.agent.model,
          codingModel: cfg.agent.codingModel || cfg.agent.model,
          assistantProvider: cfg.agent.provider,
          codingProvider: cfg.agent.codingProvider || cfg.agent.provider,
        },
        agentStats: bridge.getAgentStats(),
      });
    };

    poll();
    const interval = setInterval(poll, intervalMs);
    return () => clearInterval(interval);
  }, [engine, intervalMs]);

  return state;
}
