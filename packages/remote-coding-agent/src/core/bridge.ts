/**
 * Agent Bridge — Dual-agent orchestration layer.
 *
 * Architecture:
 *   Every message goes through the PERSONAL ASSISTANT first (fast/cheap model).
 *   The assistant decides whether to handle directly or delegate to the
 *   CODING AGENT (powerful model) via the delegate_to_coder tool.
 *
 *   Personal Assistant (Haiku/GPT-4o-mini)
 *   ├── Chat, Q&A → responds directly
 *   ├── Config/Cron/Skills → uses management tools
 *   └── Coding tasks → delegate_to_coder → Coding Agent (Opus/Sonnet)
 *
 *   This gives the best of both worlds:
 *   - Fast, cheap responses for casual interactions
 *   - Powerful, capable responses for coding tasks
 *   - The assistant IS the router (no fragile keyword matching)
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
  AgentRole,
  EngineEvent,
  EngineEventListener,
} from "../types";
import { SessionManager } from "../session/session-manager";
import { ConfigManagerTool, type ConfigManagerState } from "../tools/config-manager";
import { CronTool, type CronToolState } from "../tools/cron-tool";
import { SkillTool, type SkillToolState } from "../tools/skill-tool";
import { DelegateToCoder, type DelegateState } from "../tools/delegate-to-coder";
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

  /** Active agent runners per session key + role. */
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
    this.emit({ type: "agent:start", channel, chatId, role: "assistant" });

    try {
      await this.processWithAssistant(message, adapter);
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

  // ── Assistant Execution ────────────────────────────────────────────────
  // Every message goes through the personal assistant first.
  // The assistant has delegate_to_coder to hand off coding work.

  private async processWithAssistant(message: IncomingMessage, adapter: ChannelAdapter): Promise<void> {
    const { channel, chatId, userId, text } = message;
    const session = this.sessionManager.getOrCreate(channel, chatId, userId, this.workingDir);

    const assistantRegistry = this.createAssistantToolRegistry(session.workingDir, session.id);

    // Smart selection for assistant tools
    const selection = selectToolsForTurn(text, 1, assistantRegistry, "assistant");
    if (selection.filtered) {
      this.logger.debug(`Assistant tools: ${selection.count} [${selection.matchedCategories.join(", ")}]`);
    }

    const agent = this.getOrCreateAgent(session.id, session.workingDir, "assistant", channel, message.username);

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
        if (name === "delegate_to_coder") {
          this.emit({ type: "agent:delegated", channel, chatId, task: (input as any).task || "" });
        }
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
      this.emit({ type: "agent:complete", channel, chatId, reply, role: "assistant" });
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
        this.emit({ type: "agent:complete", channel, chatId, reply, role: "assistant" });

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

  // ── Coding Agent Execution ─────────────────────────────────────────────
  // Called by the delegate_to_coder tool. Runs the coding agent with
  // a powerful model and full tool access.

  async runCodingTask(task: string, sessionId: string): Promise<string> {
    const session = this.sessionManager.getById(sessionId);
    const workingDir = session?.workingDir || this.workingDir;

    this.logger.info(`Coding agent started: ${task.substring(0, 100)}`);
    this.emit({ type: "agent:start", channel: session?.channel || "internal", chatId: session?.chatId || "", role: "coding" });

    const agent = this.getOrCreateAgent(sessionId, workingDir, "coding");

    const toolCalls: string[] = [];
    let responseText = "";

    const callbacks: AgentCallbacks = {
      onToken: () => {},
      onToolCall: (name) => {
        toolCalls.push(name);
        this.emit({ type: "agent:tool_call", channel: session?.channel || "internal", chatId: session?.chatId || "", name });
      },
      onToolResult: () => {},
      onComplete: () => {},
      onError: (err) => this.logger.error(`Coding agent error: ${err.message}`),
      onUsage: () => {},
    };

    try {
      responseText = await agent.run(task, callbacks);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      responseText = `Coding agent error: ${error.message}`;
    }

    this.logger.info(`Coding agent done: ${toolCalls.length} tool calls`);
    this.emit({
      type: "agent:complete",
      channel: session?.channel || "internal",
      chatId: session?.chatId || "",
      reply: { text: responseText, toolCalls: toolCalls.map((n) => ({ name: n, input: {}, output: "", isError: false })) },
      role: "coding",
    });

    return responseText;
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
          "I'm your personal AI assistant. I handle chat, scheduling, and config directly. " +
          "For coding tasks, I delegate to a powerful coding agent.\n\n" +
          `Assistant: ${this.agentConfig.provider}/${this.agentConfig.model}\n` +
          `Coding: ${this.agentConfig.codingProvider || this.agentConfig.provider}/${this.agentConfig.codingModel || this.agentConfig.model}\n\n` +
          "Use /help to see all commands."
        );
        break;

      case "/help":
        await adapter.sendMessage(chatId, formatHelp());
        break;

      case "/clear":
        this.sessionManager.destroy(channel, chatId, userId);
        // Clear both assistant and coding agents
        const clearKey = `${channel}:${chatId}:${userId}`;
        this.agents.delete(`${clearKey}:assistant`);
        this.agents.delete(`${clearKey}:coding`);
        await adapter.sendMessage(chatId, "Conversation cleared. Starting fresh!");
        break;

      case "/status": {
        const session = this.sessionManager.get(channel, chatId, userId);
        if (!session) {
          await adapter.sendMessage(chatId, "No active session. Send a message to start.");
        } else {
          const codingInfo = this.agentConfig.codingModel
            ? `\nCoding: ${this.agentConfig.codingProvider || this.agentConfig.provider}/${this.agentConfig.codingModel}`
            : "";
          await adapter.sendMessage(chatId, formatStatus({
            sessionId: session.id,
            channel: session.channel,
            workingDir: session.workingDir,
            historyLength: session.history.length,
            provider: this.agentConfig.provider,
            model: this.agentConfig.model,
          }) + codingInfo);
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
            // Clear cached agents for this session
            const dirKey = `${channel}:${chatId}:${userId}`;
            this.agents.delete(`${dirKey}:assistant`);
            this.agents.delete(`${dirKey}:coding`);
            await adapter.sendMessage(chatId, `Working directory changed to: ${arg}`);
          }
        }
        break;
      }

      case "/model": {
        if (!arg) {
          const codingInfo = this.agentConfig.codingModel
            ? `\nCoding model: ${this.agentConfig.codingModel}`
            : "";
          await adapter.sendMessage(chatId,
            `Assistant model: ${this.agentConfig.model}${codingInfo}\n\n` +
            `Usage:\n/model <name> — change assistant model\n/model coding <name> — change coding model`
          );
        } else if (arg.startsWith("coding ")) {
          const codingModel = arg.substring(7).trim();
          this.agentConfig.codingModel = codingModel;
          this.agents.clear();
          await adapter.sendMessage(chatId, `Coding model switched to: ${codingModel}`);
        } else {
          this.agentConfig.model = arg;
          this.agents.clear();
          await adapter.sendMessage(chatId, `Assistant model switched to: ${arg}`);
        }
        break;
      }

      case "/provider": {
        if (!arg) {
          const codingInfo = this.agentConfig.codingProvider
            ? `\nCoding provider: ${this.agentConfig.codingProvider}`
            : "";
          await adapter.sendMessage(chatId, `Assistant provider: ${this.agentConfig.provider}${codingInfo}`);
        } else if (arg.startsWith("coding ")) {
          const codingProvider = arg.substring(7).trim();
          this.agentConfig.codingProvider = codingProvider;
          this.agents.clear();
          await adapter.sendMessage(chatId, `Coding provider switched to: ${codingProvider}`);
        } else {
          this.agentConfig.provider = arg;
          this.agents.clear();
          await adapter.sendMessage(chatId, `Assistant provider switched to: ${arg}`);
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
   * Get or create an AgentRunner for a session + role.
   *
   * Each role has its own:
   *   - Tool registry (assistant: management tools, coding: full tools)
   *   - System prompt (assistant: routing prompt, coding: coding prompt)
   *   - Model config (assistant: fast model, coding: powerful model)
   */
  private getOrCreateAgent(
    sessionId: string,
    workingDir: string,
    role: AgentRole,
    channel?: string,
    username?: string,
  ): AgentRunner {
    const cacheKey = `${sessionId}:${role}`;
    let agent = this.agents.get(cacheKey);
    if (agent) return agent;

    // Resolve model config based on role
    const useCoding = role === "coding";
    const provider = useCoding
      ? (this.agentConfig.codingProvider || this.agentConfig.provider)
      : this.agentConfig.provider;
    const model = useCoding
      ? (this.agentConfig.codingModel || this.agentConfig.model)
      : this.agentConfig.model;
    const apiKey = useCoding
      ? (this.agentConfig.codingApiKey || this.agentConfig.apiKey)
      : this.agentConfig.apiKey;
    const maxTokens = useCoding
      ? (this.agentConfig.codingMaxTokens || this.agentConfig.maxTokens)
      : this.agentConfig.maxTokens;

    // Create role-appropriate tool registry
    const toolRegistry = role === "assistant"
      ? this.createAssistantToolRegistry(workingDir, sessionId)
      : this.createCodingToolRegistry(workingDir);

    const permissionManager = new PermissionManager(
      this.agentConfig.permissionMode as any,
      workingDir,
    );

    const systemPrompt = buildRemoteSystemPrompt({
      workingDir,
      role,
      channel,
      username,
      provider,
      model,
      codingModel: useCoding ? undefined : (this.agentConfig.codingModel || undefined),
      customPrompt: this.agentConfig.systemPrompt,
      skillRegistry: this.skillRegistry,
    });

    agent = new AgentRunner(
      { provider, model, apiKey, maxTokens },
      toolRegistry,
      permissionManager,
      undefined,
      {
        maxTurns: role === "coding" ? this.agentConfig.maxTurns : Math.min(this.agentConfig.maxTurns, 5),
        workingDir,
        systemPrompt,
      },
    );

    this.agents.set(cacheKey, agent);
    return agent;
  }

  // ── Tool Registries (role-specific) ────────────────────────────────────

  /**
   * Assistant tools: read-only + management + delegation.
   * NO file write/edit/exec — those are for the coding agent.
   */
  private createAssistantToolRegistry(workingDir: string, sessionId: string): ToolRegistry {
    const sm = this.securityConfig.allowedDirs.length > 0
      ? new SandboxManager(workingDir, workingDir)
      : undefined;

    const registry = new ToolRegistry();

    // Read-only tools (assistant can look but not touch)
    registry.register(new FileReadTool(workingDir, sm));
    registry.register(new GlobSearchTool(workingDir));
    registry.register(new GrepSearchTool(workingDir));
    registry.register(new ListDirTool(workingDir, sm));

    // Delegation tool — the key mechanism
    const delegateState: DelegateState = {
      runCodingAgent: (task) => this.runCodingTask(task, sessionId),
      sessionId,
    };
    registry.register(new DelegateToCoder(delegateState));

    // Config manager — lets the assistant configure itself and the coding agent
    const configState: ConfigManagerState = {
      agentConfig: this.agentConfig,
      securityConfig: this.securityConfig,
      workingDir: this.workingDir,
      appConfig: this.appConfig,
      onConfigChanged: (key, value) => {
        this.logger.info(`Config changed via chat: ${key} = ${value}`);
        this.agents.clear();
      },
    };
    registry.register(new ConfigManagerTool(configState));

    // Cron manager
    if (this.cronService) {
      const cronState: CronToolState = { cronService: this.cronService };
      registry.register(new CronTool(cronState));
    }

    // Skill manager
    if (this.skillRegistry) {
      const skillState: SkillToolState = { skillRegistry: this.skillRegistry };
      registry.register(new SkillTool(skillState));
    }

    return registry;
  }

  /**
   * Coding tools: full file/shell/search access.
   * NO config/cron/skill/delegate — those are for the assistant.
   */
  private createCodingToolRegistry(workingDir: string): ToolRegistry {
    const sm = this.securityConfig.allowedDirs.length > 0
      ? new SandboxManager(workingDir, workingDir)
      : undefined;

    const registry = new ToolRegistry();

    // Full coding tools
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

  /** Get stats about active agents by role. */
  getAgentStats(): { assistant: number; coding: number } {
    let assistant = 0;
    let coding = 0;
    for (const key of this.agents.keys()) {
      if (key.endsWith(":assistant")) assistant++;
      else if (key.endsWith(":coding")) coding++;
    }
    return { assistant, coding };
  }
}
