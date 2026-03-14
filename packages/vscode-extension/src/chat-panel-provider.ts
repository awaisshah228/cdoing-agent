/**
 * chat-panel-provider.ts — The Bridge Between Webview and Agent
 *
 * This is the most important file in the extension. It connects:
 *   React Webview (browser) <--postMessage()--> Extension Host (Node.js) --> @cdoing/ai --> @cdoing/core
 *
 * The webview cannot access Node.js, the filesystem, or npm packages.
 * All it can do is send/receive JSON messages via postMessage().
 * This provider receives those messages, runs the AI agent, and sends results back.
 *
 * Flow:
 *   1. User types a message in the React UI
 *   2. Webview sends { type: "sendMessage", text: "..." } to this provider
 *   3. Provider passes it to AgentRunner.run() with callback functions
 *   4. AgentRunner streams tokens and tool results via callbacks
 *   5. Each callback sends a message back to the webview for live UI updates
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
  PermissionManager,
  PermissionMode,
} from "@cdoing/core";
import {
  AgentRunner,
  type AgentCallbacks,
  type ModelConfig,
  getApiKeyEnvVar,
  getDefaultModel,
} from "@cdoing/ai";
import { getWebviewContent } from "./webview-content";

/**
 * Implements VS Code's WebviewViewProvider interface.
 * VS Code calls resolveWebviewView() when the sidebar panel is first opened.
 */
export class ChatPanelProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;        // Reference to the webview panel
  private agent?: AgentRunner;               // The AI agent that processes messages
  private toolRegistry?: ToolRegistry;       // Registry of all available tools (read, write, search, etc.)
  private permissionManager?: PermissionManager; // Controls which tools need user approval
  private isProcessing = false;              // Guard to prevent concurrent agent runs

  constructor(private context: vscode.ExtensionContext) {}

  /**
   * Called by VS Code when the webview panel is first shown.
   * Sets up security, loads the React app, and starts listening for messages.
   */
  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _ctx: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this.view = webviewView;

    // Security: allow scripts but only from our extension's directory
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.context.extensionUri],
    };

    // Load the HTML shell that mounts the React app (see webview-content.ts)
    webviewView.webview.html = getWebviewContent(webviewView.webview, this.context.extensionUri);

    // Listen for messages coming FROM the React webview
    // The webview sends these via: vscode.postMessage({ type: "sendMessage", text: "..." })
    webviewView.webview.onDidReceiveMessage(async (message) => {
      switch (message.type) {
        case "sendMessage":
          // User sent a chat message — run the agent
          await this.handleUserMessage(message.text);
          break;
        case "command":
          // User typed a slash command like /clear, /model, /help
          await this.handleCommand(message.command, message.args);
          break;
        case "ready":
          // Webview finished loading — send it the current model/provider info
          this.sendCurrentConfig();
          break;
      }
    });

    // Create the agent with tools and model configuration
    this.initAgent();
  }

  /**
   * Reads all settings from VS Code's configuration (Settings UI or settings.json).
   * Returns the model config and permission mode.
   */
  private getConfig(): {
    modelConfig: Partial<ModelConfig>;
    permMode: PermissionMode;
    provider: string;
    model: string;
  } {
    const config = vscode.workspace.getConfiguration("cdoing");

    // Read each setting — these are defined in package.json → contributes.configuration
    let provider = config.get<string>("provider") || "anthropic";
    const model = config.get<string>("model") || "";
    const customBaseURL = config.get<string>("customBaseURL") || "";
    const customProviderName = config.get<string>("customProviderName") || "";
    const apiKey = config.get<string>("apiKey") || "";
    const temperature = config.get<number>("temperature") ?? 0;
    const maxTokens = config.get<number>("maxTokens") ?? 8096;
    const permModeStr = config.get<string>("permissionMode") || "ask";

    // If using a custom provider with a name (e.g. "ollama"), use that as the provider ID
    if (provider === "custom" && customProviderName) {
      provider = customProviderName;
    }

    // Build the model config object that @cdoing/ai expects
    const modelConfig: Partial<ModelConfig> = {
      provider,
      model: model || undefined,
      temperature,
      maxTokens,
      apiKey: apiKey || undefined,
      baseURL: customBaseURL || undefined,
    };

    // Map the permission mode string to the enum
    let permMode: PermissionMode;
    switch (permModeStr) {
      case "auto":
        permMode = PermissionMode.AUTO;       // Auto-approve everything
        break;
      case "auto-edit":
        permMode = PermissionMode.AUTO_EDIT;   // Auto file ops, ask for shell
        break;
      default:
        permMode = PermissionMode.ASK;         // Ask before every risky tool
    }

    return { modelConfig, permMode, provider, model };
  }

  /**
   * Creates the agent infrastructure:
   *   1. ToolRegistry — registers all 6 core tools with the workspace directory
   *   2. PermissionManager — controls which tools need user confirmation
   *   3. AgentRunner — the AI agent that orchestrates the LLM + tools loop
   *
   * This is called on startup and whenever settings change (via refreshConfig).
   */
  private initAgent() {
    const workingDir = this.getWorkingDir();
    const { modelConfig, permMode } = this.getConfig();

    // Register all tools — each tool gets the workspace directory so file paths are resolved correctly
    this.toolRegistry = new ToolRegistry();
    this.toolRegistry.register(new FileReadTool(workingDir));     // Read file contents
    this.toolRegistry.register(new FileWriteTool(workingDir));    // Create/overwrite files
    this.toolRegistry.register(new FileEditTool(workingDir));     // Find-and-replace editing
    this.toolRegistry.register(new GlobSearchTool(workingDir));   // Search files by name pattern
    this.toolRegistry.register(new GrepSearchTool(workingDir));   // Search file contents by regex
    this.toolRegistry.register(new ShellExecTool(workingDir));    // Run shell commands

    // Permission manager decides if a tool needs user approval before running
    this.permissionManager = new PermissionManager(permMode);

    // Create the agent — it holds the LLM model, tools, and conversation history
    this.agent = new AgentRunner(
      modelConfig,
      this.toolRegistry,
      this.permissionManager
    );
  }

  /** Returns the first workspace folder path, or cwd as fallback */
  private getWorkingDir(): string {
    const folders = vscode.workspace.workspaceFolders;
    return folders?.[0]?.uri.fsPath || process.cwd();
  }

  /** Rebuilds the agent with fresh settings and updates the webview's model badge */
  refreshConfig() {
    this.initAgent();
    this.sendCurrentConfig();
  }

  /** Clears the agent's conversation history (but keeps the tools and model) */
  clearHistory() {
    this.agent?.clearHistory();
  }

  /** Sends a JSON message TO the React webview */
  postMessage(message: any) {
    this.view?.webview.postMessage(message);
  }

  /** Tells the webview what model/provider is currently active (for the model badge) */
  private sendCurrentConfig() {
    const { provider, model } = this.getConfig();
    const displayModel = model || getDefaultModel(provider) || provider;
    this.postMessage({
      type: "configUpdated",
      provider,
      model: displayModel,
    });
  }

  /**
   * The core message handler — called when the user sends a chat message.
   *
   * Flow:
   *   1. Validate we're not already processing another message
   *   2. Check for slash commands (e.g. /clear, /help)
   *   3. Validate the API key is available
   *   4. Create callback functions that relay agent events to the webview
   *   5. Run the agent — it streams tokens and tool results via callbacks
   */
  private async handleUserMessage(text: string) {
    // Prevent concurrent runs — the agent is stateful (message history)
    if (this.isProcessing) {
      this.postMessage({ type: "error", text: "Already processing a message. Please wait." });
      return;
    }

    // Intercept slash commands before sending to the agent
    if (text.startsWith("/")) {
      const [cmd, ...args] = text.split(" ");
      await this.handleCommand(cmd, args);
      return;
    }

    this.isProcessing = true;
    this.postMessage({ type: "startResponse" }); // Tell webview to show "Thinking..." indicator

    // Make sure we have an API key before calling the LLM
    const { provider, modelConfig } = this.getConfig();
    if (!modelConfig.apiKey) {
      const envVar = getApiKeyEnvVar(provider);
      if (!process.env[envVar]) {
        this.postMessage({
          type: "error",
          text: `API key not configured. Set "${envVar}" environment variable or add it in Settings (Cmd+Shift+P > Cdoing: Open Settings).`,
        });
        this.isProcessing = false;
        return;
      }
    }

    // Ensure agent is initialized (it should be, but just in case)
    if (!this.agent) {
      this.initAgent();
    }

    // Create callbacks that the AgentRunner will call during execution.
    // Each callback sends a message to the React webview for real-time UI updates.
    //
    // This is how streaming works:
    //   AgentRunner calls onToken("Hello") → we post { type: "token", text: "Hello" } → React appends "Hello" to the message
    const callbacks: AgentCallbacks = {
      // Called for each streamed text token from the LLM
      onToken: (token) => {
        this.postMessage({ type: "token", text: token });
      },
      // Called when the LLM decides to invoke a tool (e.g. file_read, shell_exec)
      onToolCall: (name, input) => {
        this.postMessage({
          type: "toolCall",
          name,
          input: JSON.stringify(input).substring(0, 200), // Truncate for UI display
        });
      },
      // Called when a tool finishes executing and returns a result
      onToolResult: (name, result, isError) => {
        this.postMessage({
          type: "toolResult",
          name,
          result: result.substring(0, 500), // Truncate for UI display
          isError,
        });
      },
      // Called when the agent is completely done (no more tools or text)
      onComplete: () => {
        this.postMessage({ type: "endResponse" });
        this.isProcessing = false;
      },
      // Called if something goes wrong (API error, network issue, etc.)
      onError: (error) => {
        this.postMessage({ type: "error", text: error.message });
        this.isProcessing = false;
      },
    };

    try {
      // Run the agent — this starts the agentic loop:
      // send message → LLM responds → maybe calls tools → feed results back → repeat
      await this.agent!.run(text, callbacks);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.postMessage({ type: "error", text: msg });
      this.isProcessing = false;
    }
  }

  /**
   * Handles slash commands typed in the chat input (e.g. /clear, /model, /help).
   * Some commands are handled here, others delegate to VS Code commands.
   */
  private async handleCommand(cmd: string, _args?: string[]) {
    switch (cmd) {
      case "/clear":
        this.clearHistory();
        this.postMessage({ type: "clear" });
        break;

      case "/model":
        // Delegate to the VS Code command which shows the quick-pick UI
        vscode.commands.executeCommand("cdoing.selectModel");
        break;

      case "/settings":
        vscode.commands.executeCommand("cdoing.openSettings");
        break;

      case "/help":
        // Send a formatted help message to the chat
        this.postMessage({
          type: "systemMessage",
          text: `**Available Commands:**
- \`/clear\` — Clear chat history
- \`/model\` — Change model/provider
- \`/settings\` — Open extension settings
- \`/help\` — Show this help

**Keyboard Shortcuts:**
- \`Cmd+Shift+L\` — New chat
- \`Cmd+Shift+Enter\` — Send selection to chat

**Right-click menu** on selected code for Explain, Refactor, Fix.`,
        });
        break;

      default:
        this.postMessage({
          type: "systemMessage",
          text: `Unknown command: ${cmd}. Type /help for available commands.`,
        });
    }
  }
}
