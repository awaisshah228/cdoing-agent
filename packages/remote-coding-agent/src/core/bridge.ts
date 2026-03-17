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
import { SetupToolTool, type SetupToolState } from "../tools/setup-tool";
import { scanAllTools, type ToolReport } from "../tools/tool-checker";
import { buildRemoteSystemPrompt } from "./system-prompt";
import type { CronService } from "../cron/service";
import type { SkillRegistry } from "../skills/registry";
import { formatHelp, formatError } from "../formatter";
import { Logger } from "../utils/logger";


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

/** Tracks a running background task. */
interface RunningTask {
  id: string;
  query: string;
  startedAt: number;
  toolCalls: string[];
  status: "running" | "done" | "error";
  result?: string;
  error?: string;
  durationMs?: number;
  usage?: { inputTokens: number; outputTokens: number };
}

let taskCounter = 0;
function generateTaskId(): string {
  return `task-${++taskCounter}`;
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

  /** Cached tool report — scanned at startup, refreshed on install. */
  private toolReport: ToolReport;

  /** Active agent runners per session key + role. */
  private agents = new Map<string, AgentRunner>();

  /** Running tasks per user key — non-blocking background processing. */
  private runningTasks = new Map<string, RunningTask>();

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

    // Scan CLI tools at startup so prompts know what's available
    this.toolReport = scanAllTools();
    const installed = this.toolReport.tools.filter((t) => t.installed).length;
    this.logger.info(`Tool scan: ${installed}/${this.toolReport.tools.length} CLI tools available`);
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

    // Slash commands — always processed immediately, even during a running task
    if (text.startsWith("/")) {
      await this.handleCommand(message, adapter);
      return;
    }

    const userKey = `${channel}:${chatId}:${userId}`;

    // If a task is already running, queue info but don't block
    const existing = this.runningTasks.get(userKey);
    if (existing && existing.status === "running") {
      const elapsed = Math.round((Date.now() - existing.startedAt) / 1000);
      await adapter.sendMessage(chatId,
        `⏳ Task ${existing.id} is still running (${elapsed}s).\n` +
        `Tools used: ${existing.toolCalls.length > 0 ? existing.toolCalls.join(", ") : "none yet"}\n\n` +
        `Your new message has been queued. Use /status to check progress.`,
        { replyToMessageId: message.messageId },
      );
      return;
    }

    // Create a task and process in the background
    const task: RunningTask = {
      id: generateTaskId(),
      query: text.length > 100 ? text.substring(0, 100) + "..." : text,
      startedAt: Date.now(),
      toolCalls: [],
      status: "running",
    };
    this.runningTasks.set(userKey, task);

    // Acknowledge immediately with task ID
    await adapter.sendMessage(chatId, `🔄 Processing (${task.id})...`, {
      replyToMessageId: message.messageId,
    });

    this.emit({ type: "agent:start", channel, chatId, role: "assistant" });

    // Run in the background — don't await
    this.processInBackground(message, adapter, task, userKey).catch((err) => {
      const error = err instanceof Error ? err : new Error(String(err));
      this.logger.error(`Background task ${task.id} error: ${error.message}`);
    });
  }

  // ── Background Processing ─────────────────────────────────────────────

  private async processInBackground(
    message: IncomingMessage,
    adapter: ChannelAdapter,
    task: RunningTask,
    userKey: string,
  ): Promise<void> {
    const { channel, chatId, userId, text } = message;

    try {
      const session = this.sessionManager.getOrCreate(channel, chatId, userId, this.workingDir);
      const agent = this.getOrCreateAgent(session.id, session.workingDir, "assistant", channel, message.username);

      let totalIn = 0;
      let totalOut = 0;
      const toolCallSummaries: ToolCallSummary[] = [];

      const callbacks: AgentCallbacks = {
        onToken: (token) => this.emit({ type: "agent:token", channel, chatId, token }),
        onToolCall: (name, input) => {
          this.logger.debug(`Tool: ${name}`);
          task.toolCalls.push(name);
          this.emit({ type: "agent:tool_call", channel, chatId, name });
          if (name === "delegate_to_coder") {
            this.emit({ type: "agent:delegated", channel, chatId, task: (input as any).task || "" });
          }
        },
        onToolResult: (name, result, isError) => {
          toolCallSummaries.push({ name, input: {}, output: result.substring(0, 200), isError });
        },
        onComplete: () => {},
        onError: (err) => this.logger.error(`Agent error: ${err.message}`),
        onUsage: (usage) => { totalIn += usage.inputTokens; totalOut += usage.outputTokens; },
      };

      this.sessionManager.addMessage(session, "user", text);
      const responseText = await agent.run(text, callbacks);

      const durationMs = Date.now() - task.startedAt;
      const reply: AgentReply = {
        text: responseText || "(no response)",
        toolCalls: toolCallSummaries,
        usage: { inputTokens: totalIn, outputTokens: totalOut, totalTokens: totalIn + totalOut },
        durationMs,
      };

      // Update task status
      task.status = "done";
      task.result = reply.text;
      task.durationMs = durationMs;
      task.usage = { inputTokens: totalIn, outputTokens: totalOut };

      this.sessionManager.addMessage(session, "assistant", reply.text);
      this.emit({ type: "agent:complete", channel, chatId, reply, role: "assistant" });

      // Send the result
      await adapter.sendMessage(chatId, reply.text);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      task.status = "error";
      task.error = error.message;
      task.durationMs = Date.now() - task.startedAt;

      this.emit({ type: "agent:error", channel, chatId, error });
      await adapter.sendMessage(chatId, formatError(error));
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
        const statusKey = `${channel}:${chatId}:${userId}`;
        const task = this.runningTasks.get(statusKey);
        const session = this.sessionManager.get(channel, chatId, userId);

        const lines: string[] = [];

        // Task status
        if (task && task.status === "running") {
          const elapsed = Math.round((Date.now() - task.startedAt) / 1000);
          lines.push(`⏳ Task ${task.id} — running (${elapsed}s)`);
          lines.push(`Query: ${task.query}`);
          if (task.toolCalls.length > 0) {
            lines.push(`Tools: ${task.toolCalls.join(" → ")}`);
          }
        } else if (task && task.status === "done") {
          const duration = task.durationMs ? `${(task.durationMs / 1000).toFixed(1)}s` : "?";
          lines.push(`✅ Last task ${task.id} — done (${duration})`);
          if (task.usage) {
            lines.push(`Tokens: ${task.usage.inputTokens} in / ${task.usage.outputTokens} out`);
          }
          if (task.toolCalls.length > 0) {
            lines.push(`Tools: ${task.toolCalls.join(" → ")}`);
          }
        } else if (task && task.status === "error") {
          lines.push(`❌ Last task ${task.id} — error`);
          if (task.error) lines.push(`Error: ${task.error}`);
        } else {
          lines.push("No recent tasks.");
        }

        // Session info
        if (session) {
          lines.push("");
          lines.push(`Session: ${session.id}`);
          lines.push(`Working dir: ${session.workingDir}`);
          lines.push(`History: ${session.history.length} messages`);
          lines.push(`Assistant: ${this.agentConfig.provider}/${this.agentConfig.model}`);
          if (this.agentConfig.codingModel) {
            lines.push(`Coding: ${this.agentConfig.codingProvider || this.agentConfig.provider}/${this.agentConfig.codingModel}`);
          }
        }

        await adapter.sendMessage(chatId, lines.join("\n"));
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
  getOrCreateAgent(
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
    const resolvedKey = useCoding
      ? (this.agentConfig.codingApiKey || this.agentConfig.apiKey)
      : this.agentConfig.apiKey;
    const maxTokens = useCoding
      ? (this.agentConfig.codingMaxTokens || this.agentConfig.maxTokens)
      : this.agentConfig.maxTokens;

    // Detect OAuth tokens (sk-ant-oat01-...) and pass as oauthToken, not apiKey.
    // OAuth requires Bearer auth + special headers, not x-api-key.
    const isOAuth = resolvedKey?.startsWith("sk-ant-oat01-");
    const apiKey = isOAuth ? undefined : resolvedKey;
    const oauthToken = isOAuth ? resolvedKey : undefined;

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
      toolReport: this.toolReport,
    });

    agent = new AgentRunner(
      { provider, model, apiKey, oauthToken, maxTokens },
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

    // Setup tool — check, install, configure CLI tools on the PC
    const setupState: SetupToolState = {
      lastReport: this.toolReport,
      onToolInstalled: (toolId) => {
        this.logger.info(`Tool installed: ${toolId} — refreshing tool report`);
        this.toolReport = scanAllTools();
        // Clear cached agents so they pick up the new tool environment
        this.agents.clear();
      },
    };
    registry.register(new SetupToolTool(setupState));

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
