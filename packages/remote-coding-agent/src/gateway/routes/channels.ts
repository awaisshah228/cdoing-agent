/**
 * Channel management routes.
 */
import { Router, type Request, type Response } from "express";
import type { ChannelRegistry } from "../../channels/registry";

export interface ChannelRouteOptions {
  channelRegistry: ChannelRegistry;
}

export function channelRoutes(opts: ChannelRouteOptions): Router {
  const router = Router();

  router.get("/api/channels", (_req: Request, res: Response) => {
    const available = opts.channelRegistry.getAllPlugins().map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      running: opts.channelRegistry.isRunning(p.id),
      configSchema: p.configSchema,
    }));
    res.json({ channels: available });
  });

  return router;
}
