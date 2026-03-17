/**
 * Gateway Server
 *
 * Express HTTP server with modular route handlers:
 *   - Health check (GET /health)
 *   - Sessions CRUD (GET/DELETE /api/sessions, GET /api/sessions/:id/history)
 *   - Channels (GET /api/channels)
 *   - Stats (GET /api/stats)
 *   - Config (GET/PUT /api/config)
 *   - SSE event stream (GET /api/events)
 *   - Webhooks (POST /webhook/:channelId)
 *   - Send message (POST /api/send)
 *   - Dashboard UI (GET /dashboard/) — optional, served from static build
 *
 * Routes are split into separate files under ./routes/ for scalability.
 */

import express, { type Request, type Response, type NextFunction } from "express";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";
import type { GatewayConfig, AppConfig, EngineEvent } from "../types";
import type { SessionManager } from "../session/session-manager";
import type { AgentBridge } from "../core/bridge";
import type { ChannelRegistry } from "../channels/registry";
import { Logger } from "../utils/logger";
import { healthRoutes } from "./routes/health";
import { sessionRoutes } from "./routes/sessions";
import { channelRoutes } from "./routes/channels";
import { statsRoutes } from "./routes/stats";
import { configRoutes } from "./routes/config";
import { eventRoutes } from "./routes/events";
import { webhookRoutes } from "./routes/webhooks";
import { dashboardRoutes } from "./routes/dashboard";
import { cronRoutes } from "./routes/cron";
import { skillRoutes } from "./routes/skills";
import type { CronService } from "../cron/service";
import type { SkillRegistry } from "../skills/registry";

export interface GatewayOptions {
  config: GatewayConfig;
  sessionManager: SessionManager;
  bridge: AgentBridge;
  channelRegistry: ChannelRegistry;
  appConfig?: AppConfig;
  onConfigUpdate?: (patch: Partial<AppConfig>) => void;
  /** Enable the web dashboard UI at /dashboard/ */
  enableDashboard?: boolean;
  /** Custom path to dashboard static files */
  dashboardDir?: string;
  /** Cron service for scheduled jobs */
  cronService?: CronService;
  /** Skill registry */
  skillRegistry?: SkillRegistry;
  logLevel?: string;
}

export class Gateway {
  private app: express.Application;
  private server: ReturnType<typeof import("http").createServer> | null = null;
  private config: GatewayConfig;
  private logger: Logger;
  private sseClients = new Set<Response>();
  private dashboardEnabled: boolean;

  constructor(private options: GatewayOptions) {
    this.config = options.config;
    this.logger = new Logger("Gateway", options.logLevel);
    this.dashboardEnabled = options.enableDashboard ?? false;

    this.app = express();
    this.setupMiddleware();
    this.mountRoutes();
    this.setupErrorHandler();
  }

  /** Push an event to all connected SSE clients. */
  broadcastEvent(event: EngineEvent): void {
    const data = JSON.stringify(event);
    for (const client of this.sseClients) {
      try {
        client.write(`data: ${data}\n\n`);
      } catch {
        this.sseClients.delete(client);
      }
    }
  }

  private setupMiddleware(): void {
    // Relax Helmet CSP when dashboard is enabled (needs inline scripts for Next.js)
    if (this.dashboardEnabled) {
      this.app.use(helmet({
        contentSecurityPolicy: {
          directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", "data:"],
            connectSrc: ["'self'"],
          },
        },
      }));
    } else {
      this.app.use(helmet());
    }
    this.app.use(cors({ origin: this.config.corsOrigin }));
    this.app.use(express.json({ limit: "1mb" }));

    this.app.use("/api/", rateLimit({
      windowMs: 60_000,
      max: 60,
      standardHeaders: true,
      legacyHeaders: false,
    }));

    if (this.config.authToken) {
      this.app.use("/api/", (req: Request, res: Response, next: NextFunction) => {
        const token = req.headers.authorization?.replace("Bearer ", "");
        if (token !== this.config.authToken) {
          res.status(401).json({ error: "Unauthorized" });
          return;
        }
        next();
      });
    }
  }

  private mountRoutes(): void {
    const { sessionManager, bridge, channelRegistry, appConfig, onConfigUpdate, cronService, skillRegistry, logLevel } = this.options;

    // API routes
    this.app.use(healthRoutes({ sessionManager, bridge, channelRegistry }));
    this.app.use(sessionRoutes({ sessionManager }));
    this.app.use(channelRoutes({ channelRegistry }));
    this.app.use(statsRoutes({ sessionManager, bridge, channelRegistry }));
    this.app.use(configRoutes({
      channelRegistry,
      getAppConfig: () => appConfig,
      onConfigUpdate,
    }));
    this.app.use(eventRoutes({
      addClient: (res) => this.sseClients.add(res),
      removeClient: (res) => this.sseClients.delete(res),
    }));
    this.app.use(webhookRoutes({ channelRegistry, bridge, logLevel }));

    // Cron & Skills
    this.app.use(cronRoutes({ getCronService: () => cronService }));
    this.app.use(skillRoutes({ getSkillRegistry: () => skillRegistry }));

    // Dashboard UI (static files, auth-protected)
    if (this.dashboardEnabled) {
      this.app.use(dashboardRoutes({
        staticDir: this.options.dashboardDir,
        authToken: this.config.authToken,
        logLevel,
      }));
    }
  }

  private setupErrorHandler(): void {
    this.app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
      this.logger.error(`Unhandled: ${err.message}`);
      res.status(500).json({ error: "Internal server error" });
    });
  }

  async start(): Promise<void> {
    const maxRetries = 5;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const port = this.config.port + attempt;
      try {
        await new Promise<void>((resolve, reject) => {
          this.server = this.app.listen(port, () => {
            if (attempt > 0) {
              this.logger.info(`Port ${this.config.port} in use — using ${port}`);
            }
            this.config.port = port; // Update to actual port
            this.logger.info(`Gateway on port ${port}`);
            if (this.dashboardEnabled) {
              this.logger.info(`Dashboard: http://localhost:${port}/dashboard/`);
            }
            resolve();
          });
          this.server!.once("error", (err: NodeJS.ErrnoException) => {
            if (err.code === "EADDRINUSE") {
              this.server = null;
              reject(err);
            } else {
              reject(err);
            }
          });
        });
        return; // Success
      } catch (err: any) {
        if (err?.code !== "EADDRINUSE" || attempt === maxRetries - 1) {
          throw new Error(`Failed to start server. Ports ${this.config.port}-${this.config.port + maxRetries - 1} all in use.`);
        }
      }
    }
  }

  async stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.server) return resolve();
      this.server.close((err) => err ? reject(err) : resolve());
    });
  }

  getApp(): express.Application { return this.app; }
}
