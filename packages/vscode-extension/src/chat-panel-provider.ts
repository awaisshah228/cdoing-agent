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

export class ChatPanelProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private agent?: AgentRunner;
  private toolRegistry?: ToolRegistry;
  private permissionManager?: PermissionManager;
  private hookManager?: HookManager;
  private memoryStore?: MemoryStore;
  private isProcessing = false;

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

    this.initAgent();
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
    const { modelConfig, permMode } = this.getConfig();

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

    // Permission manager with project dir
    this.permissionManager = new PermissionManager(permMode, workingDir);

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
    if (this.isProcessing) {
      this.postMessage({ type: "error", text: "Already processing. Please wait." });
      return;
    }

    if (text.startsWith("/")) {
      const [cmd, ...args] = text.split(" ");
      await this.handleCommand(cmd, args);
      return;
    }

    this.isProcessing = true;
    this.postMessage({ type: "startResponse" });

    // Validate API key
    const { provider, modelConfig } = this.getConfig();
    if (!modelConfig.apiKey) {
      const envVar = getApiKeyEnvVar(provider);
      if (!process.env[envVar]) {
        this.postMessage({
          type: "error",
          text: `API key not configured. Set "${envVar}" env var or add it in Settings.`,
        });
        this.isProcessing = false;
        return;
      }
    }

    if (!this.agent) this.initAgent();

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
      },
      onError: (error) => {
        this.postMessage({ type: "error", text: error.message });
        this.isProcessing = false;
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
    }
  }

  /** Handle slash commands */
  private async handleCommand(cmd: string, args?: string[]) {
    switch (cmd) {
      case "/clear":
        this.clearHistory();
        this.postMessage({ type: "clear" });
        break;

      case "/new":
        this.clearHistory();
        this.postMessage({ type: "clear" });
        this.postMessage({ type: "systemMessage", text: "New conversation started." });
        break;

      case "/model":
        vscode.commands.executeCommand("cdoing.selectModel");
        break;

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

      case "/usage": {
        const usage = this.agent?.getContextManager().formatTotalUsage() || "No usage data yet.";
        this.postMessage({ type: "systemMessage", text: `**Token Usage:** ${usage}` });
        break;
      }

      case "/memory": {
        const memories = this.memoryStore?.getAll() || [];
        if (memories.length === 0) {
          this.postMessage({ type: "systemMessage", text: "No stored memories." });
        } else {
          const lines = memories.map((m) => `- **${m.key}**: ${m.value}`).join("\n");
          this.postMessage({ type: "systemMessage", text: `**Stored Memories:**\n${lines}` });
        }
        break;
      }

      case "/settings":
        vscode.commands.executeCommand("cdoing.openSettings");
        break;

      case "/help":
        this.postMessage({
          type: "systemMessage",
          text: `**Commands:**
- \`/help\` — Show this help
- \`/new\` — Start new conversation
- \`/clear\` — Clear chat history
- \`/config\` — Show current configuration
- \`/usage\` — Show token usage and cost
- \`/memory\` — View stored memories
- \`/model\` — Change model/provider
- \`/settings\` — Open extension settings

**Shortcuts:**
- \`Cmd+Shift+L\` — New chat
- \`Cmd+Shift+Enter\` — Send selection to chat

**Right-click** on selected code for Explain, Refactor, Fix.

**Tools available:** file_read, file_write, file_edit, glob_search, grep_search, shell_exec, file_run, web_fetch, web_search`,
        });
        break;

      default:
        this.postMessage({
          type: "systemMessage",
          text: `Unknown command: ${cmd}. Type /help for commands.`,
        });
    }
  }
}
