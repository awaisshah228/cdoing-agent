/**
 * Health check route.
 */
import { Router, type Request, type Response } from "express";
import type { SessionManager } from "../../session/session-manager";
import type { AgentBridge } from "../../core/bridge";
import type { ChannelRegistry } from "../../channels/registry";

export interface HealthRouteOptions {
  sessionManager: SessionManager;
  bridge: AgentBridge;
  channelRegistry: ChannelRegistry;
}

export function healthRoutes(opts: HealthRouteOptions): Router {
  const router = Router();

  router.get("/health", (_req: Request, res: Response) => {
    res.json({
      status: "ok",
      uptime: process.uptime(),
      sessions: opts.sessionManager.size,
      activeAgents: opts.bridge.activeCount,
      channels: opts.channelRegistry.getRunningIds(),
      timestamp: new Date().toISOString(),
    });
  });

  return router;
}
