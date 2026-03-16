/**
 * Stats and system info routes.
 */
import { Router, type Request, type Response } from "express";
import type { SessionManager } from "../../session/session-manager";
import type { AgentBridge } from "../../core/bridge";
import type { ChannelRegistry } from "../../channels/registry";

export interface StatsRouteOptions {
  sessionManager: SessionManager;
  bridge: AgentBridge;
  channelRegistry: ChannelRegistry;
}

export function statsRoutes(opts: StatsRouteOptions): Router {
  const router = Router();

  router.get("/api/stats", (_req: Request, res: Response) => {
    res.json({
      sessions: opts.sessionManager.getStats(),
      activeAgents: opts.bridge.activeCount,
      channels: {
        available: opts.channelRegistry.getAvailableIds(),
        running: opts.channelRegistry.getRunningIds(),
      },
      uptime: process.uptime(),
      memory: process.memoryUsage(),
    });
  });

  return router;
}
