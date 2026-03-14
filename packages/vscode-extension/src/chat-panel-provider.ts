/**
 * chat-panel-provider.ts — Bridge between Webview and Agent
 *
 * React Webview (browser) <--postMessage()--> Extension Host (Node.js) --> @cdoing/ai --> @cdoing/core
 */

import * as vscode from "vscode";
import {
  ToolRegistry,
  FileReadTool,
  FileWriteTool,
  FileEditTool,
  GlobSearchTool,
  GrepSearchTool,
  ShellExecTool,
  FileRunTool,
  WebFetchTool,
  WebSearchTool,
  PermissionManager,
  PermissionMode,
  HookManager,
  MemoryStore,
  loadProjectConfig,
} from "@cdoing/core";
import {
  AgentRunner,
  type AgentCallbacks,
  type ModelConfig,
  getApiKeyEnvVar,
  getDefaultModel,
} from "@cdoing/ai";
import { getWebviewContent } from "./webview-content";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

export class ChatPanelProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private agent?: AgentRunner;
  private toolRegistry?: ToolRegistry;
  private permissionManager?: PermissionManager;
  private hookManager?: HookManager;
  private memoryStore?: MemoryStore;
  private isProcessing = false;
  private messageQueue: string[] = [];

  constructor(private context: vscode.ExtensionContext) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _ctx: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.context.extensionUri],
    };

    webviewView.webview.html = getWebviewContent(webviewView.webview, this.context.extensionUri);

    webviewView.webview.onDidReceiveMessage(async (message) => {
      switch (message.type) {
        case "sendMessage":
          await this.handleUserMessage(message.text);
          break;
        case "command":
          await this.handleCommand(message.command, message.args);
          break;
        case "ready":
          this.sendCurrentConfig();
          break;
      }
    });

    try {
      this.initAgent();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[Cdoing] initAgent error:", msg);
      this.postMessage({ type: "error", text: `Init error: ${msg}` });
    }
  }

  private getConfig(): {
    modelConfig: Partial<ModelConfig>;
    permMode: PermissionMode;
    provider: string;
    model: string;
  } {
    const config = vscode.workspace.getConfiguration("cdoing");

    let provider = config.get<string>("provider") || "anthropic";
    const model = config.get<string>("model") || "";
    const customBaseURL = config.get<string>("customBaseURL") || "";
    const customProviderName = config.get<string>("customProviderName") || "";
    const apiKey = config.get<string>("apiKey") || "";
    const temperature = config.get<number>("temperature") ?? 0;
    const maxTokens = config.get<number>("maxTokens") ?? 8096;
    const permModeStr = config.get<string>("permissionMode") || "ask";

    if (provider === "custom" && customProviderName) {
      provider = customProviderName;
    }

    const modelConfig: Partial<ModelConfig> = {
      provider,
      model: model || undefined,
      temperature,
      maxTokens,
      apiKey: apiKey || undefined,
      baseURL: customBaseURL || undefined,
    };

    let permMode: PermissionMode;
    switch (permModeStr) {
      case "auto": permMode = PermissionMode.AUTO; break;
      case "auto-edit": permMode = PermissionMode.AUTO_EDIT; break;
      default: permMode = PermissionMode.ASK;
    }

    return { modelConfig, permMode, provider, model };
  }

  /** Create agent with all tools, hooks, memory, and project config */
  private initAgent() {
    const workingDir = this.getWorkingDir();
    const { modelConfig, permMode, provider } = this.getConfig();

    // Ensure API key is available in process.env (VS Code doesn't inherit shell env)
    if (!modelConfig.apiKey) {
      const envVar = getApiKeyEnvVar(provider);
      if (!process.env[envVar]) {
        const storedKey = this.loadApiKeyFromConfig(provider);
        if (storedKey) {
          process.env[envVar] = storedKey;
        }
      }
    }

    // Tool registry with all tools
    this.toolRegistry = new ToolRegistry();
    this.toolRegistry.register(new FileReadTool(workingDir));
    this.toolRegistry.register(new FileWriteTool(workingDir));
    this.toolRegistry.register(new FileEditTool(workingDir));
    this.toolRegistry.register(new GlobSearchTool(workingDir));
    this.toolRegistry.register(new GrepSearchTool(workingDir));
    this.toolRegistry.register(new ShellExecTool(workingDir));
    this.toolRegistry.register(new FileRunTool(workingDir));
    this.toolRegistry.register(new WebFetchTool());
    this.toolRegistry.register(new WebSearchTool());

    // Permission manager with VS Code prompt UI
    this.permissionManager = new PermissionManager(permMode, workingDir);
    this.permissionManager.setPromptFn(async (toolName, message, hasProject) => {
      const items = ["Allow Once", "Always Allow"];
      if (hasProject) items.push("Allow for Project");
      items.push("Deny");

      const choice = await vscode.window.showInformationMessage(
        `⚡ ${message}`,
        ...items
      );

      if (choice === "Always Allow") return "always";
      if (choice === "Allow for Project") return "project";
      if (choice === "Deny") return "deny";
      if (choice === "Allow Once") return "allow";
      return "deny"; // dismissed = deny
    });

    // Hooks and memory
    this.hookManager = new HookManager(workingDir);
    this.memoryStore = this.memoryStore || new MemoryStore();

    // Load project config
    const projectConfig = loadProjectConfig(workingDir);

    this.agent = new AgentRunner(
      modelConfig,
      this.toolRegistry,
      this.permissionManager,
      this.hookManager,
      {
        projectConfig: projectConfig || undefined,
        memory: this.memoryStore.formatForPrompt() || undefined,
      },
    );
  }

  private getWorkingDir(): string {
    const folders = vscode.workspace.workspaceFolders;
    return folders?.[0]?.uri.fsPath || process.cwd();
  }

  /** Load API key from ~/.cdoing/config.json */
  private loadApiKeyFromConfig(provider: string): string | null {
    try {
      const configPath = path.join(os.homedir(), ".cdoing", "config.json");
      if (fs.existsSync(configPath)) {
        const data = JSON.parse(fs.readFileSync(configPath, "utf-8"));
        const envVar = getApiKeyEnvVar(provider);
        const p = provider.toLowerCase();
        // Check all possible locations:
        // { apiKeys: { anthropic: "..." } }
        // { ANTHROPIC_API_KEY: "..." }
        // { apiKey: "..." }
        // { anthropic: { apiKey: "..." } }
        return data?.apiKeys?.[p]
          || data?.[envVar]
          || data?.apiKey
          || data?.[p]?.apiKey
          || null;
      }
    } catch {
      // ignore
    }
    return null;
  }

  refreshConfig() {
    this.initAgent();
    this.sendCurrentConfig();
  }

  clearHistory() {
    this.agent?.clearHistory();
  }

  postMessage(message: any) {
    this.view?.webview.postMessage(message);
  }

  private sendCurrentConfig() {
    const { provider, model } = this.getConfig();
    const displayModel = model || getDefaultModel(provider) || provider;
    this.postMessage({
      type: "configUpdated",
      provider,
      model: displayModel,
    });
  }

  /** Handle user messages — slash commands or agent messages */
  private async handleUserMessage(text: string) {
    // Slash commands always run immediately
    if (text.startsWith("/")) {
      const [cmd, ...args] = text.split(" ");
      await this.handleCommand(cmd, args);
      return;
    }

    // If already processing, queue the message
    if (this.isProcessing) {
      this.messageQueue.push(text);
      this.postMessage({
        type: "systemMessage",
        text: `📬 Message queued (${this.messageQueue.length} in queue)`,
        queueCount: this.messageQueue.length,
      } as any);
      return;
    }

    this.isProcessing = true;
    this.postMessage({ type: "startResponse" });

    // Try to load API key from ~/.cdoing/config.json if not in settings or env
    const { provider, modelConfig } = this.getConfig();
    if (!modelConfig.apiKey) {
      const envVar = getApiKeyEnvVar(provider);
      if (!process.env[envVar]) {
        // Check ~/.cdoing/config.json
        const storedKey = this.loadApiKeyFromConfig(provider);
        if (storedKey) {
          process.env[envVar] = storedKey;
        }
      }
    }

    if (!this.agent) {
      try {
        this.initAgent();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.postMessage({ type: "error", text: `Failed to initialize agent: ${msg}` });
        this.isProcessing = false;
        return;
      }
    }

    const callbacks: AgentCallbacks = {
      onToken: (token) => {
        this.postMessage({ type: "token", text: token });
      },
      onToolCall: (name, input) => {
        this.postMessage({
          type: "toolCall",
          name,
          input: JSON.stringify(input).substring(0, 200),
        });
      },
      onToolResult: (name, result, isError) => {
        this.postMessage({
          type: "toolResult",
          name,
          result: result.substring(0, 500),
          isError,
        });
      },
      onComplete: () => {
        this.postMessage({ type: "endResponse" });
        this.isProcessing = false;
        this.processQueue();
      },
      onError: (error) => {
        this.postMessage({ type: "error", text: error.message });
        this.isProcessing = false;
        this.processQueue();
      },
      onUsage: (usage) => {
        const parts: string[] = [];
        if (usage.inputTokens > 0 || usage.outputTokens > 0) {
          parts.push(`${usage.inputTokens.toLocaleString()}→${usage.outputTokens.toLocaleString()}`);
        }
        parts.push(`${usage.totalTokens.toLocaleString()} tokens`);
        if (usage.cost !== undefined) {
          parts.push(`$${usage.cost.toFixed(4)}`);
        }
        this.postMessage({
          type: "usageInfo",
          text: parts.join(" · "),
        });
      },
    };

    try {
      await this.agent!.run(text, callbacks);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.postMessage({ type: "error", text: msg });
      this.isProcessing = false;
      this.processQueue();
    }
  }

  /** Process the next message in the queue */
  private processQueue() {
    if (this.messageQueue.length === 0) return;
    const next = this.messageQueue.shift()!;
    // Small delay so the UI can update
    setTimeout(() => {
      this.handleUserMessage(next);
    }, 100);
  }

  // ── Conversation History ─────────────────────────────────

  private readonly convDir = path.join(os.homedir(), ".cdoing", "conversations");

  private listConversations(): Array<{ id: string; title: string; updatedAt: number; msgCount: number; provider: string; model: string }> {
    try {
      if (!fs.existsSync(this.convDir)) return [];
      const files = fs.readdirSync(this.convDir).filter((f) => f.endsWith(".json"));
      const results: Array<{ id: string; title: string; updatedAt: number; msgCount: number; provider: string; model: string }> = [];
      for (const file of files) {
        try {
          const data = JSON.parse(fs.readFileSync(path.join(this.convDir, file), "utf-8"));
          results.push({
            id: data.id,
            title: data.title || "Untitled",
            updatedAt: data.updatedAt || 0,
            msgCount: (data.messages || []).filter((m: any) => m.role === "user").length,
            provider: data.provider || "",
            model: data.model || "",
          });
        } catch {}
      }
      return results.sort((a, b) => b.updatedAt - a.updatedAt);
    } catch { return []; }
  }

  private loadConversation(id: string): any {
    try {
      const filePath = path.join(this.convDir, `${id}.json`);
      if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, "utf-8"));
    } catch {}
    return null;
  }

  private deleteConversation(id: string): boolean {
    try {
      const filePath = path.join(this.convDir, `${id}.json`);
      if (fs.existsSync(filePath)) { fs.unlinkSync(filePath); return true; }
    } catch {}
    return false;
  }

  // ── Slash Commands ─────────────────────────────────────

  /** Handle slash commands — all CLI commands supported */
  private async handleCommand(cmd: string, args?: string[]) {
    const arg = (args || []).join(" ").trim();

    switch (cmd) {
      // ── Conversation management ──
      case "/clear":
        this.clearHistory();
        this.postMessage({ type: "clear" });
        break;

      case "/new":
        this.clearHistory();
        this.postMessage({ type: "clear" });
        this.postMessage({ type: "systemMessage", text: "New conversation started." });
        break;

      case "/history": {
        const convs = this.listConversations();
        if (convs.length === 0) {
          this.postMessage({ type: "systemMessage", text: "No saved conversations." });
        } else {
          const lines = convs.slice(0, 20).map((c) => {
            const date = new Date(c.updatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
            return `- \`${c.id}\` — ${c.title} *(${date}, ${c.msgCount} msgs)*`;
          }).join("\n");
          this.postMessage({ type: "systemMessage", text: `**Conversations:**\n${lines}\n\nUse \`/resume <id>\` to continue, \`/delete <id>\` to remove.` });
        }
        break;
      }

      case "/resume": {
        if (!arg) {
          this.postMessage({ type: "systemMessage", text: "Usage: `/resume <id>` — use `/history` to see IDs." });
          break;
        }
        const conv = this.loadConversation(arg);
        if (!conv) {
          this.postMessage({ type: "systemMessage", text: `Conversation not found: ${arg}` });
          break;
        }
        this.clearHistory();
        this.postMessage({ type: "clear" });
        // Replay messages into agent history
        for (const msg of (conv.messages || [])) {
          if (msg.role === "user") this.agent?.addToHistory("user", msg.content);
          else if (msg.role === "assistant") this.agent?.addToHistory("assistant", msg.content);
        }
        this.postMessage({ type: "systemMessage", text: `Resumed: **${conv.title}** (${conv.messages?.length || 0} messages loaded)` });
        // Show recent messages in chat
        const recent = (conv.messages || []).slice(-6);
        for (const msg of recent) {
          if (msg.role === "user") {
            this.postMessage({ type: "insertMessage", message: "" }); // dummy
            this.postMessage({ type: "systemMessage", text: `**You:** ${msg.content.substring(0, 200)}` });
          } else if (msg.role === "assistant") {
            this.postMessage({ type: "systemMessage", text: `**Assistant:** ${msg.content.substring(0, 300)}` });
          }
        }
        break;
      }

      case "/delete": {
        if (!arg) {
          this.postMessage({ type: "systemMessage", text: "Usage: `/delete <id>` — use `/history` to see IDs." });
          break;
        }
        if (this.deleteConversation(arg)) {
          this.postMessage({ type: "systemMessage", text: `Deleted conversation: ${arg}` });
        } else {
          this.postMessage({ type: "systemMessage", text: `Conversation not found: ${arg}` });
        }
        break;
      }

      // ── Model / Provider ──
      case "/model": {
        if (arg) {
          const config = vscode.workspace.getConfiguration("cdoing");
          await config.update("model", arg, vscode.ConfigurationTarget.Global);
          this.refreshConfig();
          this.postMessage({ type: "systemMessage", text: `Model switched to: **${arg}**` });
        } else {
          vscode.commands.executeCommand("cdoing.selectModel");
        }
        break;
      }

      case "/provider": {
        if (!arg) {
          const { provider } = this.getConfig();
          this.postMessage({ type: "systemMessage", text: `Current provider: **${provider}**\nUsage: \`/provider <name>\` (anthropic, openai, google)` });
          break;
        }
        const config = vscode.workspace.getConfiguration("cdoing");
        await config.update("provider", arg.toLowerCase(), vscode.ConfigurationTarget.Global);
        await config.update("model", "", vscode.ConfigurationTarget.Global);
        this.refreshConfig();
        this.postMessage({ type: "systemMessage", text: `Provider switched to: **${arg}**` });
        break;
      }

      // ── Permission mode ──
      case "/mode": {
        if (!arg) {
          const mode = this.permissionManager?.getMode() || "ask";
          this.postMessage({ type: "systemMessage", text: `Current mode: **${mode}**\nUsage: \`/mode <mode>\` (ask, auto-edit, auto)` });
          break;
        }
        let newMode: PermissionMode;
        switch (arg.toLowerCase()) {
          case "auto": newMode = PermissionMode.AUTO; break;
          case "auto-edit": newMode = PermissionMode.AUTO_EDIT; break;
          default: newMode = PermissionMode.ASK;
        }
        this.permissionManager?.setMode(newMode);
        const config2 = vscode.workspace.getConfiguration("cdoing");
        await config2.update("permissionMode", arg.toLowerCase(), vscode.ConfigurationTarget.Global);
        this.postMessage({ type: "systemMessage", text: `Permission mode: **${arg}**` });
        break;
      }

      // ── Permissions ──
      case "/permissions": {
        if (arg === "clear") {
          this.permissionManager?.removeRule();
          this.postMessage({ type: "systemMessage", text: "All stored permissions cleared." });
          break;
        }
        if (arg === "clear-global") {
          this.permissionManager?.removeRule(undefined, "global");
          this.postMessage({ type: "systemMessage", text: "Global permissions cleared." });
          break;
        }
        if (arg === "clear-project") {
          this.permissionManager?.removeRule(undefined, "project");
          this.postMessage({ type: "systemMessage", text: "Project permissions cleared." });
          break;
        }
        if (arg && !arg.startsWith("clear")) {
          this.permissionManager?.removeRule(arg);
          this.postMessage({ type: "systemMessage", text: `Permissions cleared for: ${arg}` });
          break;
        }
        const { global: gRules, project: pRules } = this.permissionManager?.getStoredRules() || { global: [], project: [] };
        if (gRules.length === 0 && pRules.length === 0) {
          this.postMessage({ type: "systemMessage", text: "No stored permissions.\nWhen prompted, choose **Always Allow** or **Allow for Project** to save permissions." });
          break;
        }
        let permText = "";
        if (gRules.length > 0) {
          permText += "**Global permissions:**\n" + gRules.map((r) => `- ✓ ${r.tool.replace(/_/g, " ")}${r.inputMatch ? ` (${r.inputMatch})` : " (all)"}`).join("\n") + "\n\n";
        }
        if (pRules.length > 0) {
          permText += "**Project permissions:**\n" + pRules.map((r) => `- ✓ ${r.tool.replace(/_/g, " ")}${r.inputMatch ? ` (${r.inputMatch})` : " (all)"}`).join("\n") + "\n\n";
        }
        permText += "`/permissions clear` — remove all\n`/permissions <tool>` — remove specific";
        this.postMessage({ type: "systemMessage", text: permText });
        break;
      }

      // ── Config ──
      case "/config": {
        const { provider, model } = this.getConfig();
        const dir = this.getWorkingDir();
        const permMode = this.permissionManager?.getMode() || "ask";
        const usage = this.agent?.getContextManager().formatTotalUsage() || "no usage data";
        this.postMessage({
          type: "systemMessage",
          text: `**Current Configuration:**\n- Provider: ${provider}\n- Model: ${model || "(default)"}\n- Mode: ${permMode}\n- Directory: ${dir}\n- Usage: ${usage}`,
        });
        break;
      }

      // ── Token usage / cost ──
      case "/usage": {
        const usage = this.agent?.getContextManager().formatTotalUsage() || "No usage data yet.";
        this.postMessage({ type: "systemMessage", text: `**Token Usage:** ${usage}` });
        break;
      }

      case "/cost": {
        const cm = this.agent?.getContextManager();
        if (!cm) { this.postMessage({ type: "systemMessage", text: "No usage data yet." }); break; }
        const { tokens, cost, turns } = cm.getTotalUsage();
        this.postMessage({ type: "systemMessage", text: `**Session Cost Breakdown:**\n- Turns: ${turns}\n- Input tokens: ${tokens.inputTokens.toLocaleString()}\n- Output tokens: ${tokens.outputTokens.toLocaleString()}\n- Total tokens: ${tokens.totalTokens.toLocaleString()}\n- Estimated cost: $${(cost || 0).toFixed(4)}` });
        break;
      }

      // ── Context management ──
      case "/compact": {
        const cm = this.agent?.getContextManager();
        const history = this.agent?.getHistory();
        if (!cm || !history) { this.postMessage({ type: "systemMessage", text: "Nothing to compress." }); break; }
        const before = cm.estimateMessages(history);
        const compressed = cm.compressIfNeeded(history, "");
        const after = cm.estimateMessages(compressed);
        if (before === after) {
          this.postMessage({ type: "systemMessage", text: "Context is already compact." });
        } else {
          this.agent!.setHistory(compressed);
          this.postMessage({ type: "systemMessage", text: `Compressed: **${before.toLocaleString()}** → **${after.toLocaleString()}** tokens` });
        }
        break;
      }

      // ── Memory ──
      case "/memory": {
        if (arg === "clear") {
          this.memoryStore?.clear();
          this.postMessage({ type: "systemMessage", text: "All memories cleared." });
          break;
        }
        if (arg.startsWith("forget ")) {
          const key = arg.slice(7).trim();
          if (this.memoryStore?.forget(key)) {
            this.postMessage({ type: "systemMessage", text: `Forgot: ${key}` });
          } else {
            this.postMessage({ type: "systemMessage", text: `Memory not found: ${key}` });
          }
          break;
        }
        const memories = this.memoryStore?.getAll() || [];
        if (memories.length === 0) {
          this.postMessage({ type: "systemMessage", text: "No stored memories.\nThe agent can save memories during conversations." });
        } else {
          const lines = memories.map((m) => `- **${m.key}** *(${m.category})*: ${m.value}`).join("\n");
          this.postMessage({ type: "systemMessage", text: `**Stored Memories:**\n${lines}\n\n\`/memory clear\` — clear all\n\`/memory forget <key>\` — forget specific` });
        }
        break;
      }

      // ── Hooks ──
      case "/hooks": {
        const hooks = this.hookManager?.getHooks() || [];
        if (hooks.length === 0) {
          this.postMessage({ type: "systemMessage", text: "No hooks configured.\nAdd hooks in `~/.cdoing/hooks.json` or `.cdoing/hooks.json`" });
        } else {
          const lines = hooks.map((h) => `- \`${h.event}\` → \`${h.command}\``).join("\n");
          this.postMessage({ type: "systemMessage", text: `**Configured Hooks:**\n${lines}` });
        }
        break;
      }

      // ── Queue ──
      case "/queue": {
        if (arg === "clear") {
          this.messageQueue = [];
          this.postMessage({ type: "systemMessage", text: "Queue cleared." });
          break;
        }
        if (this.messageQueue.length === 0) {
          this.postMessage({ type: "systemMessage", text: "No messages in queue." });
        } else {
          const lines = this.messageQueue.map((m, i) => `${i + 1}. ${m.substring(0, 60)}${m.length > 60 ? "..." : ""}`).join("\n");
          this.postMessage({ type: "systemMessage", text: `**Message Queue (${this.messageQueue.length}):**\n${lines}\n\n\`/queue clear\` — clear queue` });
        }
        break;
      }

      // ── Settings ──
      case "/settings":
        vscode.commands.executeCommand("cdoing.openSettings");
        break;

      // ── Help ──
      case "/help":
        this.postMessage({
          type: "systemMessage",
          text: `**Commands:**

**Chat:**
- \`/new\` — Start new conversation
- \`/clear\` — Clear chat history
- \`/history\` — List saved conversations
- \`/resume <id>\` — Resume a conversation
- \`/delete <id>\` — Delete a conversation
- \`/queue\` — View message queue
- \`/compact\` — Compress context window

**Model:**
- \`/model [name]\` — View or change model
- \`/provider [name]\` — View or change provider
- \`/mode [mode]\` — Permission mode (ask, auto-edit, auto)

**Info:**
- \`/config\` — Show current configuration
- \`/usage\` — Show token usage
- \`/cost\` — Show cost breakdown
- \`/permissions\` — View/clear stored permissions
- \`/memory\` — View/manage persistent memory
- \`/hooks\` — View configured hooks
- \`/settings\` — Open VS Code settings

**Shortcuts:**
- \`Cmd+Shift+L\` — New chat
- \`Cmd+Shift+Enter\` — Send selection to chat

**Right-click** on selected code for Explain, Refactor, Fix.

**Tools:** file_read, file_write, file_edit, glob_search, grep_search, shell_exec, file_run, web_fetch, web_search`,
        });
        break;

      default:
        this.postMessage({
          type: "systemMessage",
          text: `Unknown command: ${cmd}. Type \`/help\` for commands.`,
        });
    }
  }
}
