/**
 * Agent Bridge — Channel-agnostic orchestration layer.
 *
 * Connects normalized messages from ANY channel to the AgentRunner.
 *
 *   1. Receives an IncomingMessage + the ChannelAdapter that sent it
 *   2. Resolves session (conversation continuity)
 *   3. Handles slash commands (/start, /help, /clear, /dir, /model, /status)
 *   4. Runs the agent with the 8-second timeout pattern:
 *      - Fast response: reply directly
 *      - Slow response: send "Working..." then follow up
 *   5. Sends response back via the channel adapter
 */

import { AgentRunner, type AgentCallbacks } from "@cdoing/ai";
import {
  ToolRegistry,
  PermissionManager,
  SandboxManager,
  FileReadTool,
  FileWriteTool,
  FileEditTool,
  MultiEditTool,
  GlobSearchTool,
  GrepSearchTool,
  ShellExecTool,
  FileRunTool,
  CodeVerifyTool,
  WebFetchTool,
  WebSearchTool,
  ListDirTool,
  ViewDiffTool,
  ViewRepoMapTool,
  CodebaseSearchTool,
} from "@cdoing/core";

import type {
  IncomingMessage,
  AgentReply,
  ChannelAdapter,
  ToolCallSummary,
  AgentConfig,
  SecurityConfig,
  AppConfig,
  EngineEvent,
  EngineEventListener,
} from "../types";
import { SessionManager } from "../session/session-manager";
import { ConfigManagerTool, type ConfigManagerState } from "../tools/config-manager";
import { CronTool, type CronToolState } from "../tools/cron-tool";
import { SkillTool, type SkillToolState } from "../tools/skill-tool";
import { selectToolsForTurn } from "../tools/smart-selector";
import { buildRemoteSystemPrompt } from "./system-prompt";
import type { CronService } from "../cron/service";
import type { SkillRegistry } from "../skills/registry";
import { formatHelp, formatStatus, formatError } from "../formatter";
import { Logger } from "../utils/logger";

const FAST_TIMEOUT_MS = 8_000;
const TYPING_INTERVAL_MS = 4_000;
const TIMED_OUT = Symbol("TIMED_OUT");

export interface AgentBridgeOptions {
  sessionManager: SessionManager;
  agentConfig: AgentConfig;
  securityConfig: SecurityConfig;
  appConfig: AppConfig;
  workingDir: string;
  /** Cron service for the cron_manager tool. */
  cronService?: CronService;
  /** Skill registry for the skill_manager tool. */
  skillRegistry?: SkillRegistry;
  logLevel?: string;
}

export class AgentBridge {
  private sessionManager: SessionManager;
  private agentConfig: AgentConfig;
  private securityConfig: SecurityConfig;
  private appConfig: AppConfig;
  private workingDir: string;
  private cronService?: CronService;
  private skillRegistry?: SkillRegistry;
  private logger: Logger;

  /** Active agent runners per session key. */
  private agents = new Map<string, AgentRunner>();

  /** Currently processing keys (prevent concurrent runs per user). */
  private processing = new Set<string>();

  private listeners: EngineEventListener[] = [];

  constructor(options: AgentBridgeOptions) {
    this.sessionManager = options.sessionManager;
    this.agentConfig = options.agentConfig;
    this.securityConfig = options.securityConfig;
    this.appConfig = options.appConfig;
    this.workingDir = options.workingDir;
    this.cronService = options.cronService;
    this.skillRegistry = options.skillRegistry;
    this.logger = new Logger("AgentBridge", options.logLevel);
  }

  // ── Events ─────────────────────────────────────────────────────────────

  onEvent(listener: EngineEventListener): () => void {
    this.listeners.push(listener);
    return () => { this.listeners = this.listeners.filter((l) => l !== listener); };
  }

  private emit(event: EngineEvent): void {
    for (const l of this.listeners) {
      try { l(event); } catch { /* ignore */ }
    }
  }

  // ── Message Handling ───────────────────────────────────────────────────

  async handleMessage(message: IncomingMessage, adapter: ChannelAdapter): Promise<void> {
    const { channel, chatId, userId, text } = message;

    // Security check
    if (!this.isAllowed(message)) {
      await adapter.sendMessage(chatId, "You are not authorized to use this bot.");
      return;
    }

    // Slash commands
    if (text.startsWith("/")) {
      await this.handleCommand(message, adapter);
      return;
    }

    // Prevent concurrent runs
    const key = `${channel}:${chatId}:${userId}`;
    if (this.processing.has(key)) {
      await adapter.sendMessage(chatId, "Still working on your previous request. Please wait...", {
        replyToMessageId: message.messageId,
      });
      return;
    }

    this.processing.add(key);
    this.emit({ type: "agent:start", channel, chatId });

    try {
      await this.processWithAgent(message, adapter);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.logger.error(`Agent error: ${error.message}`);
      this.emit({ type: "agent:error", channel, chatId, error });
      await adapter.sendMessage(chatId, formatError(error), {
        replyToMessageId: message.messageId,
      });
    } finally {
      this.processing.delete(key);
    }
  }

  // ── Agent Execution (timeout pattern) ──────────────────────────────────

  private async processWithAgent(message: IncomingMessage, adapter: ChannelAdapter): Promise<void> {
    const { channel, chatId, userId, text } = message;
    const session = this.sessionManager.getOrCreate(channel, chatId, userId, this.workingDir);

    // Smart tool selection: analyze what kind of task this is
    const fullRegistry = this.createToolRegistry(session.workingDir);
    const selection = selectToolsForTurn(text, 1, fullRegistry);
    if (selection.filtered) {
      this.logger.debug(`Smart selection: ${selection.count} tools [${selection.matchedCategories.join(", ")}]`);
    }

    // Detect if this is a coding task — if so, use the coding model (if configured)
    const isCodingTask = this.isCodingTask(text, selection.matchedCategories);
    const useModel = isCodingTask ? "coding" : "assistant";
    if (isCodingTask && this.agentConfig.codingModel) {
      this.logger.debug(`Using coding model: ${this.agentConfig.codingProvider || this.agentConfig.provider}/${this.agentConfig.codingModel}`);
    }

    const agent = this.getOrCreateAgent(session.id, session.workingDir, channel, message.username, useModel);

    const toolCalls: ToolCallSummary[] = [];
    let totalIn = 0;
    let totalOut = 0;
    const startTime = Date.now();

    // Typing indicator loop
    const typingLoop = setInterval(() => adapter.sendTyping(chatId).catch(() => {}), TYPING_INTERVAL_MS);
    await adapter.sendTyping(chatId);

    const callbacks: AgentCallbacks = {
      onToken: (token) => this.emit({ type: "agent:token", channel, chatId, token }),
      onToolCall: (name, input) => {
        this.logger.debug(`Tool: ${name}`);
        this.emit({ type: "agent:tool_call", channel, chatId, name });
      },
      onToolResult: (name, result, isError) => {
        toolCalls.push({ name, input: {}, output: result.substring(0, 200), isError });
      },
      onComplete: () => {},
      onError: (err) => this.logger.error(`Agent error: ${err.message}`),
      onUsage: (usage) => { totalIn += usage.inputTokens; totalOut += usage.outputTokens; },
    };

    this.sessionManager.addMessage(session, "user", text);

    // Race: agent vs timeout
    const agentPromise = agent.run(text, callbacks);
    const timeoutPromise = new Promise<typeof TIMED_OUT>((r) => setTimeout(() => r(TIMED_OUT), FAST_TIMEOUT_MS));
    const result = await Promise.race([agentPromise, timeoutPromise]);

    clearInterval(typingLoop);

    const buildReply = (responseText: string): AgentReply => ({
      text: responseText || "(no response)",
      toolCalls,
      usage: { inputTokens: totalIn, outputTokens: totalOut, totalTokens: totalIn + totalOut },
      durationMs: Date.now() - startTime,
    });

    if (result !== TIMED_OUT) {
      // Fast path
      const reply = buildReply(result as string);
      this.sessionManager.addMessage(session, "assistant", reply.text);
      this.emit({ type: "agent:complete", channel, chatId, reply });
      await adapter.sendMessage(chatId, reply.text, { replyToMessageId: message.messageId });
    } else {
      // Slow path — send "Working..." then follow up
      const workingMsgId = await adapter.sendMessage(chatId, "Working on your request...", {
        replyToMessageId: message.messageId,
      });

      const bgTyping = setInterval(() => adapter.sendTyping(chatId).catch(() => {}), TYPING_INTERVAL_MS);

      try {
        const responseText = await agentPromise;
        clearInterval(bgTyping);

        const reply = buildReply(responseText);
        this.sessionManager.addMessage(session, "assistant", reply.text);
        this.emit({ type: "agent:complete", channel, chatId, reply });

        // Try editing the "Working..." message, otherwise send new
        if (reply.text.length <= 4000) {
          try {
            await adapter.editMessage(chatId, workingMsgId, reply.text);
          } catch {
            await adapter.sendMessage(chatId, reply.text);
          }
        } else {
          try {
            await adapter.editMessage(chatId, workingMsgId, "Done! See below:");
          } catch { /* best effort */ }
          await adapter.sendMessage(chatId, reply.text);
        }
      } catch (err) {
        clearInterval(bgTyping);
        throw err;
      }
    }
  }

  // ── Slash Commands ─────────────────────────────────────────────────────

  private async handleCommand(message: IncomingMessage, adapter: ChannelAdapter): Promise<void> {
    const { channel, chatId, userId, text } = message;
    const [command, ...args] = text.split(/\s+/);
    const arg = args.join(" ").trim();

    switch (command) {
      case "/start":
        await adapter.sendMessage(chatId,
          "Welcome to Remote Coding Agent!\n\n" +
          "I'm your personal AI coding assistant. Send me any coding task " +
          "and I'll help — I can read/edit files, run commands, search code, and more.\n\n" +
          "Use /help to see all commands."
        );
        break;

      case "/help":
        await adapter.sendMessage(chatId, formatHelp());
        break;

      case "/clear":
        this.sessionManager.destroy(channel, chatId, userId);
        this.agents.delete(`${channel}:${chatId}:${userId}`);
        await adapter.sendMessage(chatId, "Conversation cleared. Starting fresh!");
        break;

      case "/status": {
        const session = this.sessionManager.get(channel, chatId, userId);
        if (!session) {
          await adapter.sendMessage(chatId, "No active session. Send a message to start.");
        } else {
          await adapter.sendMessage(chatId, formatStatus({
            sessionId: session.id,
            channel: session.channel,
            workingDir: session.workingDir,
            historyLength: session.history.length,
            provider: this.agentConfig.provider,
            model: this.agentConfig.model,
          }));
        }
        break;
      }

      case "/dir": {
        if (!arg) {
          const session = this.sessionManager.get(channel, chatId, userId);
          await adapter.sendMessage(chatId, `Current directory: ${session?.workingDir || this.workingDir}`);
        } else {
          const fs = await import("fs");
          if (!fs.existsSync(arg)) {
            await adapter.sendMessage(chatId, `Directory not found: ${arg}`);
          } else if (!this.isDirAllowed(arg)) {
            await adapter.sendMessage(chatId, `Directory not in allowed list: ${arg}`);
          } else {
            const session = this.sessionManager.getOrCreate(channel, chatId, userId, arg);
            session.workingDir = arg;
            this.agents.delete(`${channel}:${chatId}:${userId}`);
            await adapter.sendMessage(chatId, `Working directory changed to: ${arg}`);
          }
        }
        break;
      }

      case "/model": {
        if (!arg) {
          await adapter.sendMessage(chatId, `Current model: ${this.agentConfig.model}`);
        } else {
          this.agentConfig.model = arg;
          this.agents.delete(`${channel}:${chatId}:${userId}`);
          await adapter.sendMessage(chatId, `Model switched to: ${arg}`);
        }
        break;
      }

      case "/provider": {
        if (!arg) {
          await adapter.sendMessage(chatId, `Current provider: ${this.agentConfig.provider}`);
        } else {
          this.agentConfig.provider = arg;
          this.agents.delete(`${channel}:${chatId}:${userId}`);
          await adapter.sendMessage(chatId, `Provider switched to: ${arg}`);
        }
        break;
      }

      case "/whoami":
        await adapter.sendMessage(chatId,
          `User: ${message.username}\nUser ID: ${userId}\nChat ID: ${chatId}\nChannel: ${channel}`
        );
        break;

      default:
        await adapter.sendMessage(chatId, `Unknown command: ${command}\nUse /help for available commands.`);
    }
  }

  // ── Agent Factory ──────────────────────────────────────────────────────

  /**
   * Get or create an AgentRunner for a session.
   *
   * Supports two model modes:
   *   - "assistant": uses the main model (for chat, cron, skills, config)
   *   - "coding": uses the coding model if configured (for file edits, builds, etc.)
   *
   * Each mode gets its own cached agent per session so model switching
   * doesn't recreate agents on every message.
   */
  private getOrCreateAgent(
    sessionId: string,
    workingDir: string,
    channel?: string,
    username?: string,
    mode: "assistant" | "coding" = "assistant",
  ): AgentRunner {
    // Cache key includes mode so assistant and coding agents are separate
    const cacheKey = `${sessionId}:${mode}`;
    let agent = this.agents.get(cacheKey);
    if (agent) return agent;

    const toolRegistry = this.createToolRegistry(workingDir);
    const permissionManager = new PermissionManager(this.agentConfig.permissionMode as any, workingDir);

    // Resolve model config based on mode
    const useCoding = mode === "coding" && this.agentConfig.codingModel;
    const provider = useCoding ? (this.agentConfig.codingProvider || this.agentConfig.provider) : this.agentConfig.provider;
    const model = useCoding ? this.agentConfig.codingModel! : this.agentConfig.model;
    const apiKey = useCoding ? (this.agentConfig.codingApiKey || this.agentConfig.apiKey) : this.agentConfig.apiKey;
    const maxTokens = useCoding ? (this.agentConfig.codingMaxTokens || this.agentConfig.maxTokens) : this.agentConfig.maxTokens;

    // Build the remote agent system prompt
    const systemPrompt = buildRemoteSystemPrompt({
      workingDir,
      channel,
      username,
      provider,
      model,
      customPrompt: this.agentConfig.systemPrompt,
      skillRegistry: this.skillRegistry,
    });

    agent = new AgentRunner(
      { provider, model, apiKey, maxTokens },
      toolRegistry,
      permissionManager,
      undefined,
      {
        maxTurns: this.agentConfig.maxTurns,
        workingDir,
        systemPrompt,
      },
    );

    this.agents.set(cacheKey, agent);
    return agent;
  }

  /**
   * Detect whether a user message is a coding task (needs the coding model)
   * or a management/chat task (uses the assistant model).
   *
   * Coding tasks: file edits, search, run, build, test, git, debug, etc.
   * Non-coding: scheduling, skills, config, general chat, questions.
   */
  private isCodingTask(text: string, matchedCategories: string[]): boolean {
    // If no coding model configured, always use assistant model
    if (!this.agentConfig.codingModel) return false;

    // These categories indicate coding work
    const codingCategories = new Set(["edit", "search", "run", "diff", "repo"]);

    // Check if any matched category is a coding category
    for (const cat of matchedCategories) {
      if (codingCategories.has(cat)) return true;
    }

    // Keyword-based fallback for messages that didn't match categories
    return /\b(fix|bug|edit|refactor|implement|write code|debug|build|compile|test|deploy|create file|read file)\b/i.test(text);
  }

  private createToolRegistry(workingDir: string): ToolRegistry {
    const sm = this.securityConfig.allowedDirs.length > 0
      ? new SandboxManager(workingDir, workingDir)
      : undefined;

    const registry = new ToolRegistry();

    registry.register(new FileReadTool(workingDir, sm));
    registry.register(new FileWriteTool(workingDir, sm));
    registry.register(new FileEditTool(workingDir, sm));
    registry.register(new MultiEditTool(workingDir, sm));
    registry.register(new GlobSearchTool(workingDir));
    registry.register(new GrepSearchTool(workingDir));
    registry.register(new ListDirTool(workingDir, sm));
    registry.register(new ViewDiffTool(workingDir));
    registry.register(new ViewRepoMapTool(workingDir));
    registry.register(new CodebaseSearchTool(workingDir));
    registry.register(new ShellExecTool(workingDir, sm));
    registry.register(new FileRunTool(workingDir, sm));
    registry.register(new CodeVerifyTool(workingDir));
    registry.register(new WebFetchTool(sm));
    registry.register(new WebSearchTool());

    // ── Remote Agent Tools (personal assistant capabilities) ──

    // Config manager — lets the LLM change config via chat
    const configState: ConfigManagerState = {
      agentConfig: this.agentConfig,
      securityConfig: this.securityConfig,
      workingDir: this.workingDir,
      appConfig: this.appConfig,
      onConfigChanged: (key, value) => {
        this.logger.info(`Config changed via chat: ${key} = ${value}`);
        // Invalidate all cached agents so they pick up new config
        this.agents.clear();
      },
    };
    registry.register(new ConfigManagerTool(configState));

    // Cron manager — lets the LLM create/manage scheduled tasks
    if (this.cronService) {
      const cronState: CronToolState = { cronService: this.cronService };
      registry.register(new CronTool(cronState));
    }

    // Skill manager — lets the LLM invoke reusable skill recipes
    if (this.skillRegistry) {
      const skillState: SkillToolState = { skillRegistry: this.skillRegistry };
      registry.register(new SkillTool(skillState));
    }

    return registry;
  }

  // ── Security ───────────────────────────────────────────────────────────

  private isAllowed(message: IncomingMessage): boolean {
    const rules = this.securityConfig.channelRules[message.channel];
    if (!rules) return true;

    const allowed = rules.allowedUserIds as string[] | undefined;
    if (allowed && allowed.length > 0 && !allowed.includes(message.userId)) {
      return false;
    }
    return true;
  }

  private isDirAllowed(dir: string): boolean {
    if (this.securityConfig.allowedDirs.length === 0) return true;
    return this.securityConfig.allowedDirs.some((a) => dir.startsWith(a));
  }

  cancelAll(): void {
    for (const agent of this.agents.values()) agent.cancel();
  }

  get activeCount(): number {
    return this.agents.size;
  }
}
