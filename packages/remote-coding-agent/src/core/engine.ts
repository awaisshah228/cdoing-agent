/**
 * Engine — The main orchestrator for the Remote Coding Agent.
 *
 * Wires together:
 *   - Channel registry (Telegram, Discord, etc.)
 *   - Agent bridge (LLM + tools)
 *   - Session manager (conversation continuity)
 *   - Gateway (admin API + dashboard)
 *   - Cron service (scheduled jobs)
 *   - Skill registry (extensible capabilities)
 *   - Event bus (TUI, monitoring, SSE)
 *
 * The engine is channel-agnostic — it receives normalized messages
 * from any channel and routes them through the same agent pipeline.
 */

import { ChannelRegistry, createDefaultRegistry } from "../channels/registry";
import { AgentBridge } from "./bridge";
import { SessionManager } from "../session/session-manager";
import { Gateway } from "../gateway/server";
import { CronService } from "../cron/service";
import { SkillRegistry } from "../skills/registry";
import { builtinSkills } from "../skills/builtin";
import { CredentialManager } from "../auth/credentials";
import { UserRateLimiter } from "../middleware/rate-limiter";
import { Logger } from "../utils/logger";
import type {
  AppConfig,
  ChannelAdapter,
  IncomingMessage,
  EngineEvent,
  EngineEventListener,
  ChannelPlugin,
} from "../types";

export interface EngineOptions {
  /** Enable the web dashboard UI at /dashboard/ on the gateway. */
  enableDashboard?: boolean;
}

export class Engine {
  private channelRegistry: ChannelRegistry;
  private sessionManager: SessionManager;
  private bridge: AgentBridge;
  private gateway: Gateway;
  private cronService: CronService;
  private skillRegistry: SkillRegistry;
  private rateLimiter: UserRateLimiter;
  private logger: Logger;
  private config: AppConfig;
  private listeners: EngineEventListener[] = [];

  constructor(config: AppConfig, engineOpts: EngineOptions = {}) {
    this.config = config;
    this.logger = new Logger("Engine", config.logLevel);

    // Initialize subsystems
    this.channelRegistry = createDefaultRegistry(config.logLevel);
    this.sessionManager = new SessionManager(config.session, config.logLevel);
    this.rateLimiter = new UserRateLimiter(config.security.rateLimitPerMinute);

    // Sync-resolve API keys from credential store (OAuth resolved later in start())
    this.resolveCredentialsSync(config);

    // Cron service
    this.cronService = new CronService(config.logLevel, async (job) => {
      this.logger.info(`Cron job fired: ${job.name} (${job.id})`);
      // Agent turn payloads could be routed through the bridge in the future
    });

    // Skill registry — load built-in + workspace skills
    this.skillRegistry = new SkillRegistry(config.logLevel);
    for (const skill of builtinSkills) {
      this.skillRegistry.register(skill);
    }
    this.skillRegistry.loadFromWorkspace(config.workingDir);

    this.bridge = new AgentBridge({
      sessionManager: this.sessionManager,
      agentConfig: config.agent,
      securityConfig: config.security,
      appConfig: config,
      workingDir: config.workingDir,
      cronService: this.cronService,
      skillRegistry: this.skillRegistry,
      logLevel: config.logLevel,
    });

    this.gateway = new Gateway({
      config: config.gateway,
      sessionManager: this.sessionManager,
      bridge: this.bridge,
      channelRegistry: this.channelRegistry,
      appConfig: config,
      onConfigUpdate: (patch) => this.applyConfigPatch(patch),
      enableDashboard: engineOpts.enableDashboard,
      cronService: this.cronService,
      skillRegistry: this.skillRegistry,
      logLevel: config.logLevel,
    });

    // Forward bridge events to engine listeners + SSE clients
    this.bridge.onEvent((event) => {
      this.emit(event);
      this.gateway.broadcastEvent(event);
    });
  }

  // ── Channel Management ─────────────────────────────────────────────────

  /** Register an external channel plugin (for extending with new channels). */
  registerChannel(plugin: ChannelPlugin): void {
    this.channelRegistry.register(plugin);
    this.logger.info(`External channel registered: ${plugin.id}`);
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────

  /** Start all enabled channels, the gateway, cron, and session cleanup. */
  async start(): Promise<void> {
    this.emit({ type: "engine:start" });
    this.logger.info("Starting Remote Coding Agent engine...");

    // Resolve OAuth tokens + env vars (async — covers what sync missed)
    await this.resolveCredentialsAsync(this.config);

    // Load saved sessions from disk (continuity across restarts)
    this.sessionManager.loadFromDisk();

    // Start session cleanup
    this.sessionManager.startCleanup();

    // Start cron scheduler
    this.cronService.start();

    // Start gateway
    await this.gateway.start();
    this.logger.info(`Gateway running on port ${this.config.gateway.port}`);

    // Start each enabled channel
    for (const [channelId, channelConfig] of Object.entries(this.config.channels)) {
      if (!channelConfig.enabled) {
        this.logger.info(`Channel "${channelId}" is disabled — skipping`);
        continue;
      }

      try {
        const adapter = await this.channelRegistry.createAndStart(
          channelId,
          channelConfig,
          this.config.logLevel,
        );

        // Wire message handler (rate limit → bridge)
        this.wireChannel(channelId, adapter);

        // Start the channel
        await adapter.start();

        this.emit({ type: "channel:connected", channel: channelId });
        this.logger.info(`Channel "${channelId}" connected`);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        this.emit({ type: "channel:error", channel: channelId, error });
        this.logger.error(`Failed to start channel "${channelId}": ${error.message}`);
      }
    }

    this.logger.info("Engine is running!");
  }

  /** Stop everything gracefully — saves sessions to disk. */
  async stop(): Promise<void> {
    this.logger.info("Stopping engine...");
    this.bridge.cancelAll();
    this.cronService.stop();
    await this.channelRegistry.stopAll();
    await this.gateway.stop();
    this.sessionManager.stopCleanup();
    // Save sessions to disk for continuity across restarts
    this.sessionManager.saveToDisk();
    this.emit({ type: "engine:stop" });
    this.logger.info("Engine stopped.");
  }

  // ── Message Routing ────────────────────────────────────────────────────

  /** Wire a channel adapter's messages into the bridge with rate limiting. */
  private wireChannel(channelId: string, adapter: ChannelAdapter): void {
    adapter.onMessage(async (message: IncomingMessage) => {
      this.emit({
        type: "message:received",
        channel: channelId,
        chatId: message.chatId,
        userId: message.userId,
        text: message.text,
      });

      // Rate limit per user
      if (!this.rateLimiter.check(message.userId)) {
        await adapter.sendMessage(message.chatId, "You're sending messages too fast. Please slow down.", {
          replyToMessageId: message.messageId,
        });
        return;
      }

      // Route through bridge (which handles commands, agent, sessions)
      await this.bridge.handleMessage(message, adapter);
    });
  }

  // ── Event System ───────────────────────────────────────────────────────

  onEvent(listener: EngineEventListener): () => void {
    this.listeners.push(listener);
    return () => { this.listeners = this.listeners.filter((l) => l !== listener); };
  }

  private emit(event: EngineEvent): void {
    for (const l of this.listeners) {
      try { l(event); } catch { /* ignore */ }
    }
  }

  // ── Credential Resolution ──────────────────────────────────────────────

  /**
   * Sync resolve — checks credential store only (no OAuth).
   * Called in constructor so the config is populated early.
   */
  private resolveCredentialsSync(config: AppConfig): void {
    try {
      const creds = new CredentialManager();

      if (!config.agent.apiKey) {
        const stored = creds.getApiKey(config.agent.provider, "assistant");
        if (stored) {
          config.agent.apiKey = stored;
          this.logger.debug(`Resolved ${config.agent.provider} API key from credential store (assistant)`);
        }
      }

      if (config.agent.codingModel && !config.agent.codingApiKey) {
        const codingProvider = config.agent.codingProvider || config.agent.provider;
        const stored = creds.getApiKey(codingProvider, "coding");
        if (stored) {
          config.agent.codingApiKey = stored;
          this.logger.debug(`Resolved ${codingProvider} API key from credential store (coding)`);
        }
      }
    } catch (err) {
      this.logger.debug(`Credential resolution (sync) skipped: ${err}`);
    }
  }

  /**
   * Async resolve — checks credential store, OAuth tokens, AND env vars.
   * Called in start() to pick up OAuth tokens that sync resolution missed.
   */
  private async resolveCredentialsAsync(config: AppConfig): Promise<void> {
    try {
      const creds = new CredentialManager();

      if (!config.agent.apiKey) {
        this.logger.info(`Resolving API key for ${config.agent.provider} (assistant)...`);
        const resolved = await creds.resolveApiKey(config.agent.provider, "assistant");
        if (resolved) {
          config.agent.apiKey = resolved;
          this.logger.info(`Resolved ${config.agent.provider} API key (assistant): ${resolved.substring(0, 12)}...`);
        } else {
          this.logger.warn(`No API key found for ${config.agent.provider} (assistant) — check credentials or set ANTHROPIC_API_KEY`);
        }
      }

      if (config.agent.codingModel && !config.agent.codingApiKey) {
        const codingProvider = config.agent.codingProvider || config.agent.provider;
        this.logger.info(`Resolving API key for ${codingProvider} (coding)...`);
        const resolved = await creds.resolveApiKey(codingProvider, "coding");
        if (resolved) {
          config.agent.codingApiKey = resolved;
          this.logger.info(`Resolved ${codingProvider} API key (coding): ${resolved.substring(0, 12)}...`);
        } else {
          this.logger.warn(`No API key found for ${codingProvider} (coding) — will fall back to assistant key`);
        }
      }
    } catch (err) {
      this.logger.error(`Credential resolution failed: ${err}`);
    }
  }

  // ── Config Updates ─────────────────────────────────────────────────────

  private applyConfigPatch(patch: Partial<AppConfig>): void {
    if (patch.agent) {
      Object.assign(this.config.agent, patch.agent);
    }
    if (patch.session) {
      Object.assign(this.config.session, patch.session);
    }
    if (patch.security) {
      Object.assign(this.config.security, patch.security);
    }
    if (patch.workingDir) {
      this.config.workingDir = patch.workingDir;
    }
    if (patch.logLevel) {
      this.config.logLevel = patch.logLevel;
    }
    this.logger.info("Config updated via dashboard");
  }

  // ── Accessors ──────────────────────────────────────────────────────────

  getChannelRegistry(): ChannelRegistry { return this.channelRegistry; }
  getSessionManager(): SessionManager { return this.sessionManager; }
  getGateway(): Gateway { return this.gateway; }
  getBridge(): AgentBridge { return this.bridge; }
  getCronService(): CronService { return this.cronService; }
  getSkillRegistry(): SkillRegistry { return this.skillRegistry; }
  getConfig(): AppConfig { return this.config; }
}
