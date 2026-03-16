/**
 * Configuration read/update routes.
 */
import { Router, type Request, type Response } from "express";
import type { ChannelRegistry } from "../../channels/registry";
import type { AppConfig } from "../../types";

export interface ConfigRouteOptions {
  channelRegistry: ChannelRegistry;
  getAppConfig: () => AppConfig | undefined;
  onConfigUpdate?: (patch: Partial<AppConfig>) => void;
}

export function configRoutes(opts: ConfigRouteOptions): Router {
  const router = Router();

  // Read config (with sensitive fields redacted)
  router.get("/api/config", (_req: Request, res: Response) => {
    const appConfig = opts.getAppConfig();
    if (appConfig) {
      const safe = {
        ...appConfig,
        agent: {
          ...appConfig.agent,
          apiKey: appConfig.agent.apiKey ? "••••••••" : undefined,
        },
        gateway: {
          ...appConfig.gateway,
          authToken: appConfig.gateway.authToken ? "••••••••" : undefined,
        },
        channels: Object.fromEntries(
          Object.entries(appConfig.channels).map(([id, cfg]) => [
            id,
            { ...cfg, botToken: (cfg as any).botToken ? "••••••••" : undefined },
          ]),
        ),
      };
      res.json(safe);
    } else {
      res.json({
        channels: opts.channelRegistry.getAvailableIds(),
        runningChannels: opts.channelRegistry.getRunningIds(),
      });
    }
  });

  // Update config
  router.put("/api/config", (req: Request, res: Response) => {
    if (!opts.onConfigUpdate) {
      res.status(501).json({ error: "Config updates not supported" });
      return;
    }
    try {
      const patch = req.body as Partial<AppConfig>;
      opts.onConfigUpdate(patch);
      res.json({ success: true, message: "Configuration updated" });
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      res.status(400).json({ error: error.message });
    }
  });

  return router;
}
