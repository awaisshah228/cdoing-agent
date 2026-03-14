/**
 * chat-panel-provider.ts — Bridge between Webview and Agent
 *
 * Supports multiple chat tabs, each with its own AgentRunner and history.
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

/** Per-tab conversation state */
interface TabState {
  id: string;
  title: string;
  agent: AgentRunner;
  isProcessing: boolean;
  messageQueue: string[];
}

export class ChatPanelProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private toolRegistry?: ToolRegistry;
  private permissionManager?: PermissionManager;
  private hookManager?: HookManager;
  private memoryStore?: MemoryStore;

  // Multi-tab state
  private tabs = new Map<string, TabState>();
  private activeTabId: string | null = null;
  private nextTabNum = 1;

  constructor(private context: vscode.ExtensionContext) {}

  // ── Helpers ─────────────────────────────────────────────

  private getTab(id?: string): TabState | undefined {
    return this.tabs.get(id || this.activeTabId || "");
  }

  private generateTabId(): string {
    return `tab-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  }

  // ── Webview Setup ──────────────────────────────────────

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
        case "newTab":
          this.createTab();
          break;
        case "switchTab":
          this.switchTab(message.tabId);
          break;
        case "closeTab":
          this.closeTab(message.tabId);
          break;
        case "ready":
          this.sendCurrentConfig();
          // Create first tab on ready
          if (this.tabs.size === 0) {
            this.createTab();
          } else {
            // Restore tab list
            this.sendAllTabs();
          }
          break;
      }
    });

    try {
      this.initSharedServices();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[Cdoing] init error:", msg);
      this.postMessage({ type: "error", text: `Init error: ${msg}` });
    }
  }

  // ── Tab Management ─────────────────────────────────────

  /** Create a new tab with its own AgentRunner */
  createTab(title?: string): string {
    const id = this.generateTabId();
    const tabTitle = title || `Chat ${this.nextTabNum++}`;
    const agent = this.createAgentRunner();

    const tab: TabState = {
      id,
      title: tabTitle,
      agent,
      isProcessing: false,
      messageQueue: [],
    };

    this.tabs.set(id, tab);
    this.activeTabId = id;

    this.postMessage({ type: "tabCreated", tabId: id, title: tabTitle });
    this.postMessage({ type: "tabSwitched", tabId: id });
    this.postMessage({ type: "clear" });

    return id;
  }

  /** Switch to an existing tab */
  private switchTab(tabId: string) {
    const tab = this.tabs.get(tabId);
    if (!tab) return;

    this.activeTabId = tabId;
    this.postMessage({ type: "tabSwitched", tabId });
    // Clear webview and let it restore from its own state
    this.postMessage({ type: "clear" });
    // Tell webview if this tab is currently processing
    if (tab.isProcessing) {
      this.postMessage({ type: "startResponse" });
    }
  }

  /** Close a tab */
  private closeTab(tabId: string) {
    this.tabs.delete(tabId);
    this.postMessage({ type: "tabClosed", tabId });

    // If we closed the active tab, switch to another
    if (this.activeTabId === tabId) {
      const remaining = Array.from(this.tabs.keys());
      if (remaining.length > 0) {
        this.switchTab(remaining[remaining.length - 1]);
      } else {
        // No tabs left — create a new one
        this.createTab();
      }
    }
  }

  /** Send all existing tabs to webview (on reconnect) */
  private sendAllTabs() {
    for (const tab of this.tabs.values()) {
      this.postMessage({ type: "tabCreated", tabId: tab.id, title: tab.title });
    }
    if (this.activeTabId) {
      this.postMessage({ type: "tabSwitched", tabId: this.activeTabId });
    }
  }

  /** Update a tab's title (e.g., from first user message) */
  private updateTabTitle(tabId: string, title: string) {
    const tab = this.tabs.get(tabId);
    if (tab) {
      tab.title = title;
      this.postMessage({ type: "tabTitleUpdated", tabId, title });
    }
  }

  // ── Config ─────────────────────────────────────────────

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

  // ── Agent Initialization ───────────────────────────────

  /** Initialize shared services (tool registry, permissions, hooks, memory) */
  private initSharedServices() {
    const workingDir = this.getWorkingDir();
    const { modelConfig, permMode, provider } = this.getConfig();

    // Ensure API key is available
    if (!modelConfig.apiKey) {
      const envVar = getApiKeyEnvVar(provider);
      if (!process.env[envVar]) {
        const storedKey = this.loadApiKeyFromConfig(provider);
        if (storedKey) {
          process.env[envVar] = storedKey;
        }
      }
    }

    // Tool registry
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

    // Permission manager with VS Code UI prompt
    this.permissionManager = new PermissionManager(permMode, workingDir);
    this.permissionManager.setPromptFn(async (_toolName, message, hasProject) => {
      const items = ["Allow Once", "Always Allow"];
      if (hasProject) items.push("Allow for Project");
      items.push("Deny");

      const choice = await vscode.window.showInformationMessage(`⚡ ${message}`, ...items);

      if (choice === "Always Allow") return "always";
      if (choice === "Allow for Project") return "project";
      if (choice === "Deny") return "deny";
      if (choice === "Allow Once") return "allow";
      return "deny";
    });

    // Hooks and memory
    this.hookManager = new HookManager(workingDir);
    this.memoryStore = this.memoryStore || new MemoryStore();
  }

  /** Create a new AgentRunner instance (one per tab) */
  private createAgentRunner(): AgentRunner {
    if (!this.toolRegistry || !this.permissionManager) {
      this.initSharedServices();
    }

    const { modelConfig } = this.getConfig();
    const workingDir = this.getWorkingDir();
    const projectConfig = loadProjectConfig(workingDir);

    return new AgentRunner(
      modelConfig,
      this.toolRegistry!,
      this.permissionManager!,
      this.hookManager || undefined,
      {
        projectConfig: projectConfig || undefined,
        memory: this.memoryStore?.formatForPrompt() || undefined,
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
        return data?.apiKeys?.[p] || data?.[envVar] || data?.apiKey || data?.[p]?.apiKey || null;
      }
    } catch { /* ignore */ }
    return null;
  }

  refreshConfig() {
    this.initSharedServices();
    // Rebuild agents for all tabs
    for (const tab of this.tabs.values()) {
      tab.agent = this.createAgentRunner();
    }
    this.sendCurrentConfig();
  }

  clearHistory() {
    const tab = this.getTab();
    tab?.agent.clearHistory();
  }

  postMessage(message: any) {
    this.view?.webview.postMessage(message);
  }

  private sendCurrentConfig() {
    const { provider, model } = this.getConfig();
    const displayModel = model || getDefaultModel(provider) || provider;
    this.postMessage({ type: "configUpdated", provider, model: displayModel });
  }

  // ── Message Handling ───────────────────────────────────

  /** Handle user messages — slash commands or agent messages */
  private async handleUserMessage(text: string) {
    if (text.startsWith("/")) {
      const [cmd, ...args] = text.split(" ");
      await this.handleCommand(cmd, args);
      return;
    }

    const tab = this.getTab();
    if (!tab) {
      this.createTab();
      // Retry after tab is created
      setTimeout(() => this.handleUserMessage(text), 50);
      return;
    }

    // Update tab title from first message
    if (tab.title.startsWith("Chat ")) {
      const title = text.length > 30 ? text.substring(0, 27) + "..." : text;
      this.updateTabTitle(tab.id, title);
    }

    // Queue if tab is busy
    if (tab.isProcessing) {
      tab.messageQueue.push(text);
      this.postMessage({
        type: "systemMessage",
        text: `📬 Message queued (${tab.messageQueue.length} in queue)`,
      });
      return;
    }

    tab.isProcessing = true;
    this.postMessage({ type: "startResponse" });

    // Ensure API key
    const { provider, modelConfig } = this.getConfig();
    if (!modelConfig.apiKey) {
      const envVar = getApiKeyEnvVar(provider);
      if (!process.env[envVar]) {
        const storedKey = this.loadApiKeyFromConfig(provider);
        if (storedKey) process.env[envVar] = storedKey;
      }
    }

    const tabId = tab.id; // capture for callbacks (tab might change)

    const callbacks: AgentCallbacks = {
      onToken: (token) => {
        if (this.activeTabId === tabId) this.postMessage({ type: "token", text: token });
      },
      onToolCall: (name, input) => {
        if (this.activeTabId === tabId) {
          this.postMessage({ type: "toolCall", name, input: JSON.stringify(input).substring(0, 200) });
        }
      },
      onToolResult: (name, result, isError) => {
        if (this.activeTabId === tabId) {
          this.postMessage({ type: "toolResult", name, result: result.substring(0, 500), isError });
        }
      },
      onComplete: () => {
        const t = this.tabs.get(tabId);
        if (t) {
          t.isProcessing = false;
          if (this.activeTabId === tabId) this.postMessage({ type: "endResponse" });
          this.processTabQueue(tabId);
        }
      },
      onError: (error) => {
        const t = this.tabs.get(tabId);
        if (t) {
          t.isProcessing = false;
          if (this.activeTabId === tabId) this.postMessage({ type: "error", text: error.message });
          this.processTabQueue(tabId);
        }
      },
      onUsage: (usage) => {
        if (this.activeTabId === tabId) {
          const parts: string[] = [];
          if (usage.inputTokens > 0 || usage.outputTokens > 0) {
            parts.push(`${usage.inputTokens.toLocaleString()}→${usage.outputTokens.toLocaleString()}`);
          }
          parts.push(`${usage.totalTokens.toLocaleString()} tokens`);
          if (usage.cost !== undefined) parts.push(`$${usage.cost.toFixed(4)}`);
          this.postMessage({ type: "usageInfo", text: parts.join(" · ") });
        }
      },
    };

    try {
      await tab.agent.run(text, callbacks);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      tab.isProcessing = false;
      if (this.activeTabId === tabId) this.postMessage({ type: "error", text: msg });
      this.processTabQueue(tabId);
    }
  }

  /** Process the next queued message for a specific tab */
  private processTabQueue(tabId: string) {
    const tab = this.tabs.get(tabId);
    if (!tab || tab.messageQueue.length === 0) return;
    const next = tab.messageQueue.shift()!;
    setTimeout(() => {
      // Only process if this tab is still active
      if (this.activeTabId === tabId) {
        this.handleUserMessage(next);
      }
    }, 100);
  }

  // ── Conversation History ───────────────────────────────

  private readonly convDir = path.join(os.homedir(), ".cdoing", "conversations");

  private listConversations(): Array<{ id: string; title: string; updatedAt: number; msgCount: number }> {
    try {
      if (!fs.existsSync(this.convDir)) return [];
      const files = fs.readdirSync(this.convDir).filter((f) => f.endsWith(".json"));
      const results: Array<{ id: string; title: string; updatedAt: number; msgCount: number }> = [];
      for (const file of files) {
        try {
          const data = JSON.parse(fs.readFileSync(path.join(this.convDir, file), "utf-8"));
          results.push({
            id: data.id,
            title: data.title || "Untitled",
            updatedAt: data.updatedAt || 0,
            msgCount: (data.messages || []).filter((m: any) => m.role === "user").length,
          });
        } catch { /* skip */ }
      }
      return results.sort((a, b) => b.updatedAt - a.updatedAt);
    } catch { return []; }
  }

  private loadConversation(id: string): any {
    try {
      const filePath = path.join(this.convDir, `${id}.json`);
      if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, "utf-8"));
    } catch { /* skip */ }
    return null;
  }

  private deleteConversation(id: string): boolean {
    try {
      const filePath = path.join(this.convDir, `${id}.json`);
      if (fs.existsSync(filePath)) { fs.unlinkSync(filePath); return true; }
    } catch { /* skip */ }
    return false;
  }

  // ── Slash Commands ─────────────────────────────────────

  private async handleCommand(cmd: string, args?: string[]) {
    const arg = (args || []).join(" ").trim();
    const tab = this.getTab();

    switch (cmd) {
      case "/clear":
        this.clearHistory();
        this.postMessage({ type: "clear" });
        break;

      case "/new":
        this.createTab();
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
          this.postMessage({ type: "systemMessage", text: `**Conversations:**\n${lines}\n\nUse \`/resume <id>\` to continue.` });
        }
        break;
      }

      case "/resume": {
        if (!arg) { this.postMessage({ type: "systemMessage", text: "Usage: `/resume <id>`" }); break; }
        const conv = this.loadConversation(arg);
        if (!conv) { this.postMessage({ type: "systemMessage", text: `Not found: ${arg}` }); break; }
        // Create new tab for resumed conversation
        const tabId = this.createTab(conv.title || "Resumed");
        const resumedTab = this.tabs.get(tabId);
        if (resumedTab) {
          for (const msg of (conv.messages || [])) {
            if (msg.role === "user") resumedTab.agent.addToHistory("user", msg.content);
            else if (msg.role === "assistant") resumedTab.agent.addToHistory("assistant", msg.content);
          }
        }
        this.postMessage({ type: "systemMessage", text: `Resumed: **${conv.title}** (${conv.messages?.length || 0} messages)` });
        break;
      }

      case "/delete": {
        if (!arg) { this.postMessage({ type: "systemMessage", text: "Usage: `/delete <id>`" }); break; }
        this.postMessage({ type: "systemMessage", text: this.deleteConversation(arg) ? `Deleted: ${arg}` : `Not found: ${arg}` });
        break;
      }

      case "/model": {
        if (arg) {
          const config = vscode.workspace.getConfiguration("cdoing");
          await config.update("model", arg, vscode.ConfigurationTarget.Global);
          this.refreshConfig();
          this.postMessage({ type: "systemMessage", text: `Model: **${arg}**` });
        } else {
          vscode.commands.executeCommand("cdoing.selectModel");
        }
        break;
      }

      case "/provider": {
        if (!arg) {
          const { provider } = this.getConfig();
          this.postMessage({ type: "systemMessage", text: `Provider: **${provider}**\nUsage: \`/provider <name>\`` });
          break;
        }
        const config = vscode.workspace.getConfiguration("cdoing");
        await config.update("provider", arg.toLowerCase(), vscode.ConfigurationTarget.Global);
        await config.update("model", "", vscode.ConfigurationTarget.Global);
        this.refreshConfig();
        this.postMessage({ type: "systemMessage", text: `Provider: **${arg}**` });
        break;
      }

      case "/mode": {
        if (!arg) {
          this.postMessage({ type: "systemMessage", text: `Mode: **${this.permissionManager?.getMode() || "ask"}**\nUsage: \`/mode <mode>\`` });
          break;
        }
        let newMode: PermissionMode;
        switch (arg.toLowerCase()) {
          case "auto": newMode = PermissionMode.AUTO; break;
          case "auto-edit": newMode = PermissionMode.AUTO_EDIT; break;
          default: newMode = PermissionMode.ASK;
        }
        this.permissionManager?.setMode(newMode);
        this.postMessage({ type: "systemMessage", text: `Mode: **${arg}**` });
        break;
      }

      case "/permissions": {
        if (arg === "clear") { this.permissionManager?.removeRule(); this.postMessage({ type: "systemMessage", text: "Permissions cleared." }); break; }
        if (arg === "clear-global") { this.permissionManager?.removeRule(undefined, "global"); this.postMessage({ type: "systemMessage", text: "Global permissions cleared." }); break; }
        if (arg === "clear-project") { this.permissionManager?.removeRule(undefined, "project"); this.postMessage({ type: "systemMessage", text: "Project permissions cleared." }); break; }
        if (arg && !arg.startsWith("clear")) { this.permissionManager?.removeRule(arg); this.postMessage({ type: "systemMessage", text: `Cleared: ${arg}` }); break; }
        const { global: gRules, project: pRules } = this.permissionManager?.getStoredRules() || { global: [], project: [] };
        if (gRules.length === 0 && pRules.length === 0) { this.postMessage({ type: "systemMessage", text: "No stored permissions." }); break; }
        let t = "";
        if (gRules.length > 0) t += "**Global:**\n" + gRules.map((r) => `- ✓ ${r.tool}${r.inputMatch ? ` (${r.inputMatch})` : ""}`).join("\n") + "\n";
        if (pRules.length > 0) t += "**Project:**\n" + pRules.map((r) => `- ✓ ${r.tool}${r.inputMatch ? ` (${r.inputMatch})` : ""}`).join("\n");
        this.postMessage({ type: "systemMessage", text: t });
        break;
      }

      case "/config": {
        const { provider, model } = this.getConfig();
        const dir = this.getWorkingDir();
        const mode = this.permissionManager?.getMode() || "ask";
        const usage = tab?.agent.getContextManager().formatTotalUsage() || "none";
        const tabCount = this.tabs.size;
        this.postMessage({ type: "systemMessage", text: `**Config:**\n- Provider: ${provider}\n- Model: ${model || "(default)"}\n- Mode: ${mode}\n- Dir: ${dir}\n- Tabs: ${tabCount}\n- Usage: ${usage}` });
        break;
      }

      case "/usage": {
        const usage = tab?.agent.getContextManager().formatTotalUsage() || "No data.";
        this.postMessage({ type: "systemMessage", text: `**Usage:** ${usage}` });
        break;
      }

      case "/cost": {
        const cm = tab?.agent.getContextManager();
        if (!cm) { this.postMessage({ type: "systemMessage", text: "No data." }); break; }
        const { tokens, cost, turns } = cm.getTotalUsage();
        this.postMessage({ type: "systemMessage", text: `**Cost:**\n- Turns: ${turns}\n- In: ${tokens.inputTokens.toLocaleString()}\n- Out: ${tokens.outputTokens.toLocaleString()}\n- Total: ${tokens.totalTokens.toLocaleString()}\n- Cost: $${(cost || 0).toFixed(4)}` });
        break;
      }

      case "/compact": {
        const cm = tab?.agent.getContextManager();
        const history = tab?.agent.getHistory();
        if (!cm || !history) { this.postMessage({ type: "systemMessage", text: "Nothing to compress." }); break; }
        const before = cm.estimateMessages(history);
        const compressed = cm.compressIfNeeded(history, "");
        const after = cm.estimateMessages(compressed);
        if (before === after) { this.postMessage({ type: "systemMessage", text: "Already compact." }); }
        else { tab!.agent.setHistory(compressed); this.postMessage({ type: "systemMessage", text: `Compressed: **${before.toLocaleString()}** → **${after.toLocaleString()}** tokens` }); }
        break;
      }

      case "/memory": {
        if (arg === "clear") { this.memoryStore?.clear(); this.postMessage({ type: "systemMessage", text: "Memories cleared." }); break; }
        if (arg.startsWith("forget ")) {
          const key = arg.slice(7).trim();
          this.postMessage({ type: "systemMessage", text: this.memoryStore?.forget(key) ? `Forgot: ${key}` : `Not found: ${key}` });
          break;
        }
        const memories = this.memoryStore?.getAll() || [];
        if (memories.length === 0) { this.postMessage({ type: "systemMessage", text: "No memories." }); }
        else { this.postMessage({ type: "systemMessage", text: `**Memories:**\n${memories.map((m) => `- **${m.key}** *(${m.category})*: ${m.value}`).join("\n")}` }); }
        break;
      }

      case "/hooks": {
        const hooks = this.hookManager?.getHooks() || [];
        if (hooks.length === 0) { this.postMessage({ type: "systemMessage", text: "No hooks configured." }); }
        else { this.postMessage({ type: "systemMessage", text: `**Hooks:**\n${hooks.map((h) => `- \`${h.event}\` → \`${h.command}\``).join("\n")}` }); }
        break;
      }

      case "/queue": {
        if (arg === "clear" && tab) { tab.messageQueue.length = 0; this.postMessage({ type: "systemMessage", text: "Queue cleared." }); break; }
        if (!tab || tab.messageQueue.length === 0) { this.postMessage({ type: "systemMessage", text: "Queue empty." }); }
        else { this.postMessage({ type: "systemMessage", text: `**Queue (${tab.messageQueue.length}):**\n${tab.messageQueue.map((m, i) => `${i + 1}. ${m.substring(0, 60)}`).join("\n")}` }); }
        break;
      }

      case "/settings":
        vscode.commands.executeCommand("cdoing.openSettings");
        break;

      case "/help":
        this.postMessage({
          type: "systemMessage",
          text: `**Commands:**

**Chat:**
- \`/new\` — New conversation tab
- \`/clear\` — Clear current tab
- \`/history\` — List saved conversations
- \`/resume <id>\` — Resume in new tab
- \`/delete <id>\` — Delete conversation
- \`/queue\` — View message queue
- \`/compact\` — Compress context

**Model:**
- \`/model [name]\` — View/change model
- \`/provider [name]\` — View/change provider
- \`/mode [mode]\` — Permission mode

**Info:**
- \`/config\` — Configuration
- \`/usage\` — Token usage
- \`/cost\` — Cost breakdown
- \`/permissions\` — Stored permissions
- \`/memory\` — Persistent memory
- \`/hooks\` — Configured hooks
- \`/settings\` — VS Code settings

**Tabs:** Click \`+\` for new tab, \`×\` to close.
**Shortcuts:** \`Cmd+Shift+L\` new chat, \`Cmd+Shift+Enter\` send selection.`,
        });
        break;

      default:
        this.postMessage({ type: "systemMessage", text: `Unknown: ${cmd}. Type \`/help\`.` });
    }
  }
}
