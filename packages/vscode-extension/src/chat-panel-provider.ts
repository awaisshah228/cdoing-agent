/**
 * chat-panel-provider.ts — Bridge between Webview and Agent
 *
 * Supports multiple chat tabs, each with its own AgentRunner and history.
 * React Webview (browser) <--postMessage()--> Extension Host (Node.js) --> @cdoing/ai --> @cdoing/core
 */

import * as vscode from "vscode";
import {
  ToolRegistry,
  PermissionManager,
  PermissionMode,
  HookManager,
  MemoryStore,
  SandboxManager,
  loadProjectConfig,
  registerToolCategories,
  getOAuthProviders,
  ShellExecTool,
} from "@cdoing/core";
import { ProcessManager, TodoStore, CodebaseIndexer } from "@cdoing/core";
import type { ToolCategory } from "@cdoing/core";
import {
  AgentRunner,
  type AgentCallbacks,
  type ModelConfig,
  type ImageAttachment,
  getApiKeyEnvVar,
  resolveModelInfo,
} from "@cdoing/ai";
import { getWebviewContent } from "./webview-content";
import {
  exchangeOAuthCode,
  resolveOAuthToken,
  getOAuthStatus,
  getOAuthProvider,
  oauthLogout,
  loadOAuthTokens,
  startLocalOAuthServer,
} from "./oauth";
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
  /** Buffered UI messages for when this tab is in the background */
  pendingUiMessages: any[];
  /** True when a plan is waiting for user approval */
  planPending: boolean;
  /** Summary of the current plan (from plan_exit) */
  planSummary: string;
}

export class ChatPanelProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private toolRegistry?: ToolRegistry;
  private permissionManager?: PermissionManager;
  private hookManager?: HookManager;
  private memoryStore?: MemoryStore;
  private todoStore?: import("@cdoing/core").TodoStore;

  // Multi-tab state
  private tabs = new Map<string, TabState>();
  private activeTabId: string | null = null;
  private nextTabNum = 1;

  // State change event (for status bar updates)
  private _onDidChangeState = new vscode.EventEmitter<void>();
  readonly onDidChangeState = this._onDidChangeState.event;

  /** Whether the active tab is currently processing */
  get isProcessing(): boolean {
    const tab = this.getTab();
    return tab?.isProcessing ?? false;
  }

  constructor(private context: vscode.ExtensionContext) {
    context.subscriptions.push(this._onDidChangeState);
  }

  // ── Helpers ─────────────────────────────────────────────

  private webviewReady = false;
  private pendingMessages: any[] = [];
  private pendingPermissionResolvers = new Map<string, (decision: "allow" | "always" | "project" | "deny" | "deny_always" | "deny_project") => void>();
  private permissionIdCounter = 0;
  private oauthCodeVerifier: string | null = null;

  private getTab(id?: string): TabState | undefined {
    return this.tabs.get(id || this.activeTabId || "");
  }

  private generateTabId(): string {
    return `tab-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  }

  /** Send a UI message for a specific tab: post immediately if active, otherwise buffer */
  private postTabMessage(tabId: string, message: any) {
    if (this.activeTabId === tabId) {
      this.postMessage(message);
    } else {
      const tab = this.tabs.get(tabId);
      if (tab) tab.pendingUiMessages.push(message);
    }
  }

  /** Replay buffered UI messages when switching to a tab */
  private replayPendingMessages(tabId: string) {
    const tab = this.tabs.get(tabId);
    if (!tab || tab.pendingUiMessages.length === 0) return;

    // Consolidate consecutive token messages into one for performance
    const consolidated: any[] = [];
    let tokenBuffer = "";
    for (const msg of tab.pendingUiMessages) {
      if (msg.type === "token") {
        tokenBuffer += msg.text;
      } else {
        if (tokenBuffer) {
          consolidated.push({ type: "token", text: tokenBuffer });
          tokenBuffer = "";
        }
        consolidated.push(msg);
      }
    }
    if (tokenBuffer) {
      consolidated.push({ type: "token", text: tokenBuffer });
    }

    tab.pendingUiMessages = [];
    for (const msg of consolidated) {
      this.postMessage(msg);
    }
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
          await this.handleUserMessage(message.text, message.context, message.tabId);
          break;
        case "command":
          if (message.command === "openFile" && message.args?.[0]) {
            this.openFileInEditor(message.args[0]);
          } else {
            await this.handleCommand(message.command, message.args);
          }
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
        case "pickFile":
          await this.pickFileForContext();
          break;
        case "pickFolder":
          await this.pickFolderForContext();
          break;
        case "searchFiles":
          await this.searchWorkspaceFiles(message.query);
          break;
        case "getActiveFile":
          this.sendActiveFileAsContext();
          break;
        case "getConfig":
          this.sendFullConfig();
          break;
        case "updateConfig":
          this.updateConfigFromWebview(message.config);
          break;
        case "openVscodeSettings":
          vscode.commands.executeCommand("workbench.action.openSettings", "cdoing");
          break;
        case "listHistory":
          this.sendConversationList();
          break;
        case "resumeConversation":
          this.resumeConversationById(message.id);
          break;
        case "deleteConversation":
          this.deleteConversation(message.id);
          this.sendConversationList(); // refresh the list
          break;
        case "cancelGeneration": {
          const tab = this.getTab();
          if (tab?.isProcessing) {
            tab.agent.cancel();
            // Kill all background processes on cancel
            const shellTool = this.toolRegistry?.get("shell_exec") as ShellExecTool | undefined;
            if (shellTool?.getProcessManager) {
              shellTool.getProcessManager().killAll();
            }
            // Immediately reset processing state so the UI unblocks.
            // The agent's onComplete/onError may also fire, but setting
            // isProcessing=false here is safe (idempotent) and prevents
            // the UI from getting stuck when cancel happens mid-tool-execution.
            tab.isProcessing = false;
            this._onDidChangeState.fire();
            this.postTabMessage(tab.id, { type: "endResponse" });
          }
          break;
        }
        case "interruptGeneration": {
          // Interrupt current streaming and immediately send a new message
          const tab = this.getTab(message.tabId);
          if (tab?.isProcessing) {
            // Interrupt with partial response context
            tab.agent.interrupt(message.partialResponse || "");
            tab.isProcessing = false;
            this._onDidChangeState.fire();
            this.postTabMessage(tab.id, { type: "endResponse" });
            // Send the new message after a brief delay, with interrupt context
            if (message.newMessage) {
              const interruptContext = message.partialResponse
                ? `[User interrupted your previous response and sent a new message. Your partial response was preserved in context. Continue from where you left off if relevant, or address the new request.]\n\n${message.newMessage}`
                : message.newMessage;
              setTimeout(() => {
                this.handleUserMessage(interruptContext, undefined, tab.id);
              }, 100);
            }
          }
          break;
        }
        case "permissionResponse": {
          const resolver = this.pendingPermissionResolvers.get(message.id);
          if (resolver) {
            this.pendingPermissionResolvers.delete(message.id);
            resolver(message.decision);
          }
          break;
        }
        case "startOAuth": {
          const provider = message.provider || "anthropic";
          try {
            const { url, codeVerifier, state, port, codePromise, close } = await startLocalOAuthServer(provider);
            const localRedirectUri = `http://localhost:${port}/callback`;
            const consoleCallbackUri = "https://console.anthropic.com/oauth/code/callback";
            this.oauthCodeVerifier = codeVerifier;
            this.postMessage({ type: "oauthStarted", url, port } as any);
            // Open browser — VS Code shows the "Open external website?" dialog
            vscode.env.openExternal(vscode.Uri.parse(url));

            // Generate console fallback URL
            let consoleUrlStr = "";
            if (provider === "anthropic") {
              const consoleUrl = new URL(url);
              consoleUrl.searchParams.set("redirect_uri", consoleCallbackUri);
              consoleUrlStr = consoleUrl.toString();
            }

            // Race: auto-capture vs manual paste — whichever completes first wins
            let code: string;
            let usedLocalRedirect = true;

            const manualCodePromise = new Promise<string | undefined>((resolve) => {
              // Show fallback notification + input box immediately
              if (consoleUrlStr) {
                vscode.window.showInformationMessage(
                  "If the browser didn't open, click below to login manually.",
                  "Open Login Link"
                ).then((choice) => {
                  if (choice === "Open Login Link") {
                    vscode.env.openExternal(vscode.Uri.parse(consoleUrlStr));
                  }
                });
              }
              vscode.window.showInputBox({
                title: "OAuth Authorization",
                prompt: "Waiting for auto-capture... or paste the code here manually",
                placeHolder: "Authorization code (or wait for auto-capture)...",
                ignoreFocusOut: true,
              }).then(resolve);
            });

            // Race: auto-capture from localhost OR manual paste from input box
            const result = await Promise.race([
              codePromise.then((c) => ({ source: "auto" as const, code: c })),
              manualCodePromise.then((c) => ({ source: "manual" as const, code: c })),
            ]);

            close();

            if (result.source === "auto") {
              code = result.code;
            } else {
              usedLocalRedirect = false;
              if (!result.code) { this.oauthCodeVerifier = null; break; }
              code = result.code;
            }

            try {
              await exchangeOAuthCode(
                code,
                this.oauthCodeVerifier!,
                provider,
                usedLocalRedirect ? localRedirectUri : consoleCallbackUri,
                usedLocalRedirect ? state : undefined,
              );
              this.oauthCodeVerifier = null;
              this.postMessage({ type: "oauthResult", success: true } as any);
              this.postMessage({ type: "oauthStatus", ...getOAuthStatus() } as any);
              this.refreshConfig();
            } catch (err) {
              const errMsg = err instanceof Error ? err.message : String(err);
              this.postMessage({ type: "oauthResult", success: false, error: errMsg } as any);
            }
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            this.postMessage({ type: "oauthResult", success: false, error: errMsg } as any);
          }
          break;
        }
        case "exchangeOAuth": {
          if (!this.oauthCodeVerifier) {
            this.postMessage({ type: "oauthResult", success: false, error: "No OAuth flow in progress" } as any);
            break;
          }
          try {
            await exchangeOAuthCode(message.code, this.oauthCodeVerifier);
            this.oauthCodeVerifier = null;
            this.postMessage({ type: "oauthResult", success: true } as any);
            this.postMessage({ type: "oauthStatus", ...getOAuthStatus() } as any);
            this.refreshConfig();
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            this.postMessage({ type: "oauthResult", success: false, error: errMsg } as any);
          }
          break;
        }
        case "oauthLogout":
          oauthLogout();
          // Invalidate all in-memory agents so they can't make further API calls
          for (const tab of this.tabs.values()) {
            tab.agent.invalidate();
          }
          this.postMessage({ type: "oauthStatus", ...getOAuthStatus() } as any);
          this.refreshConfig();
          break;
        case "getOAuthStatus":
          this.postMessage({ type: "oauthStatus", ...getOAuthStatus() } as any);
          break;
        case "ready":
          this.webviewReady = true;
          this.sendCurrentConfig();
          // Create first tab on ready
          if (this.tabs.size === 0) {
            this.createTab();
          } else {
            // Restore tab list
            this.sendAllTabs();
          }
          // Flush any messages queued before webview was ready
          // (e.g., contextAttached from clicking 💬 on a file)
          this.flushPendingMessages();
          // Auto-attach the active/visible file as context
          setTimeout(() => this.sendActiveFileAsContext(), 200);
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
      pendingUiMessages: [],
      planPending: false,
      planSummary: "",
    };

    this.tabs.set(id, tab);
    this.activeTabId = id;

    this.postMessage({ type: "tabCreated", tabId: id, title: tabTitle });
    this.postMessage({ type: "tabSwitched", tabId: id });
    this.postMessage({ type: "clear" });

    // Auto-attach active file to new tab
    setTimeout(() => this.sendActiveFileAsContext(), 100);

    return id;
  }

  /** Switch to an existing tab */
  private switchTab(tabId: string) {
    const tab = this.tabs.get(tabId);
    if (!tab) return;

    this.activeTabId = tabId;
    this.postMessage({ type: "tabSwitched", tabId, isProcessing: tab.isProcessing } as any);
    // Replay any buffered messages from background processing
    this.replayPendingMessages(tabId);
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
      const activeTab = this.tabs.get(this.activeTabId);
      this.postMessage({ type: "tabSwitched", tabId: this.activeTabId, isProcessing: activeTab?.isProcessing ?? false } as any);
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

    const authMethod = config.get<string>("authMethod") || "apiKey";

    const modelConfig: Partial<ModelConfig> = {
      provider,
      model: model || undefined,
      temperature,
      maxTokens,
      apiKey: apiKey || undefined,
      baseURL: customBaseURL || undefined,
    };

    // If Anthropic + OAuth auth method, OR no API key configured (auto-detect),
    // try to use cached OAuth tokens (same as CLI fallback behavior)
    if (provider === "anthropic" && (authMethod === "oauth" || !apiKey)) {
      const status = getOAuthStatus();
      if (status.status === "active") {
        const tokens = loadOAuthTokens();
        if (tokens) {
          modelConfig.oauthToken = tokens.access_token;
          // OAuth forces claude-haiku-4-5 — clear any user-set API key
          // so the agent doesn't accidentally use API key auth
          modelConfig.apiKey = undefined;
        }
      }
    }

    let permMode: PermissionMode;
    switch (permModeStr) {
      case "bypassPermissions": permMode = PermissionMode.BYPASS; break;
      case "auto":              permMode = PermissionMode.BYPASS; break;
      case "acceptEdits":       permMode = PermissionMode.ACCEPT_EDITS; break;
      case "auto-edit":         permMode = PermissionMode.ACCEPT_EDITS; break;
      case "plan":              permMode = PermissionMode.PLAN; break;
      case "dontAsk":           permMode = PermissionMode.DONT_ASK; break;
      default:                  permMode = PermissionMode.DEFAULT;
    }

    return { modelConfig, permMode, provider, model };
  }

  // ── Agent Initialization ───────────────────────────────

  /** Initialize shared services (tool registry, permissions, hooks, memory) */
  private initSharedServices() {
    const workingDir = this.getWorkingDir();
    const { modelConfig, permMode, provider } = this.getConfig();

    // If OAuth token is available, clear any previously-set env API key
    // so the agent doesn't accidentally use the API key instead of OAuth
    if (modelConfig.oauthToken) {
      const envVar = getApiKeyEnvVar(provider);
      if (process.env[envVar]) {
        delete process.env[envVar];
      }
    }

    // Ensure API key is available (skip if using OAuth)
    if (!modelConfig.oauthToken && !modelConfig.apiKey) {
      const envVar = getApiKeyEnvVar(provider);
      if (!process.env[envVar]) {
        const storedKey = this.loadApiKeyFromConfig(provider);
        if (storedKey) {
          process.env[envVar] = storedKey;
        }
      }
    }

    // Auto-refresh OAuth token in background if expired or not yet loaded
    // Works regardless of authMethod — if OAuth tokens exist, use them (CLI parity)
    if (modelConfig.oauthToken === undefined && provider === "anthropic" && !modelConfig.apiKey) {
      resolveOAuthToken().then((token) => {
        if (token) {
          // Token resolved/refreshed — rebuild agents
          this.refreshConfig();
        }
      }).catch(() => {});
    }

    // Sandbox manager
    const sandboxManager = new SandboxManager(workingDir, workingDir);
    sandboxManager.setDomainPromptFn(async (domain: string) => {
      const choice = await vscode.window.showInformationMessage(
        `Sandbox: allow network access to "${domain}"?`,
        "Allow", "Deny",
      );
      return choice === "Allow";
    });

    // Permission manager (created first so tools can reference it)
    const sm = sandboxManager;
    this.permissionManager = new PermissionManager(permMode, workingDir);
    this.permissionManager.setSandboxManager(sandboxManager);
    this.permissionManager.setPromptFn(async (toolName, message, hasProject) => {
      const id = `perm-${++this.permissionIdCounter}-${Date.now()}`;
      return new Promise<"allow" | "always" | "project" | "deny" | "deny_always" | "deny_project">((resolve) => {
        this.pendingPermissionResolvers.set(id, resolve);
        this.postMessage({
          type: "permissionRequest",
          id,
          toolName,
          message,
          hasProject,
        } as any);

        // If the webview panel is not visible, show a VS Code notification
        // so the user knows permission is needed
        if (!this.view?.visible) {
          vscode.window.showInformationMessage(
            `Cdoing is requesting permission to use ${toolName}`,
            "View"
          ).then((action) => {
            if (action === "View") {
              // Focus the Cdoing sidebar panel
              vscode.commands.executeCommand("cdoing.chatPanel.focus");
            }
          });
        }
      });
    });

    // Tool registry — use grouped registration (file, search, execution, web, editing, viewing, session, system)
    // Excludes "agents" category since VS Code extension doesn't support sub-agents
    this.toolRegistry = new ToolRegistry();
    const extensionCategories: ToolCategory[] = ["file", "search", "execution", "web", "editing", "viewing", "session", "system"];
    const processManager = new ProcessManager();
    const todoStore = new TodoStore();
    this.todoStore = todoStore;
    this.memoryStore = this.memoryStore || new MemoryStore(workingDir);
    // registerToolCategories is async but initSharedServices is sync — use void for fire-and-forget
    // The registry will be populated before the first agent run since createAgentRunner checks it
    // plan_exit callback: show inline approval prompt (like permission prompts)
    const planExitCallback = (summary: string) => {
      const tab = this.getTab();
      if (tab) {
        tab.planPending = true;
        tab.planSummary = summary;
      }
      // Send short summary for the approval prompt (not the full plan text)
      const shortSummary = summary.split("\n")[0].substring(0, 100);
      this.postMessage({ type: "planReady", summary: shortSummary } as any);
    };

    void registerToolCategories(this.toolRegistry, extensionCategories, {
      workingDir,
      sandboxManager: sm,
      permissionManager: this.permissionManager,
      processManager,
      todoStore,
      memoryStore: this.memoryStore,
      planExitCallback,
    });

    // Hooks and memory
    this.hookManager = new HookManager(workingDir);
    this.memoryStore = this.memoryStore || new MemoryStore();
  }

  /** Rebuild the current tab's agent (preserves conversation history) */
  private rebuildCurrentAgent(): void {
    const tab = this.getTab();
    if (!tab) return;
    const oldHistory = tab.agent.getHistory();
    tab.agent = this.createAgentRunner();
    if (oldHistory.length > 0) {
      tab.agent.setHistory(oldHistory);
    }
  }

  /** Create a new AgentRunner instance (one per tab) */
  private createAgentRunner(): AgentRunner {
    if (!this.toolRegistry || !this.permissionManager) {
      this.initSharedServices();
    }

    const { modelConfig } = this.getConfig();
    const workingDir = this.getWorkingDir();
    const projectConfig = loadProjectConfig(workingDir);

    // Detect git repo and workspace root for environment context
    const fs = require("fs");
    const path = require("path");
    const isGitRepo = fs.existsSync(path.join(workingDir, ".git"));
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

    return new AgentRunner(
      modelConfig,
      this.toolRegistry!,
      this.permissionManager!,
      this.hookManager || undefined,
      {
        workingDir,
        projectConfig: projectConfig || undefined,
        memory: this.memoryStore?.formatForPrompt() || undefined,
        isGitRepo,
        workspaceRoot: workspaceRoot !== workingDir ? workspaceRoot : undefined,
      },
    );
  }

  private getWorkingDir(): string {
    const folders = vscode.workspace.workspaceFolders;

    // Prefer the workspace folder that contains the active file (most specific)
    const activeFile = vscode.window.activeTextEditor?.document.uri;
    if (activeFile && folders) {
      const containing = vscode.workspace.getWorkspaceFolder(activeFile);
      if (containing) return containing.uri.fsPath;
    }

    // Fall back to the first workspace folder, then process.cwd()
    return folders?.[0]?.uri.fsPath || process.cwd();
  }

  /** Open a file in the editor (called when user clicks a file path in tool results) */
  private openFileInEditor(filePath: string) {
    const workingDir = this.getWorkingDir();
    const absPath = path.isAbsolute(filePath) ? filePath : path.join(workingDir, filePath);
    const uri = vscode.Uri.file(absPath);
    vscode.window.showTextDocument(uri, { preview: true }).then(
      () => {},
      () => vscode.window.showWarningMessage(`Could not open: ${filePath}`)
    );
  }

  /** Read file content for context attachment */
  private readFileContent(filePath: string): string | null {
    try {
      const workingDir = this.getWorkingDir();
      const absPath = path.isAbsolute(filePath) ? filePath : path.join(workingDir, filePath);
      if (fs.existsSync(absPath) && fs.statSync(absPath).isFile()) {
        return fs.readFileSync(absPath, "utf-8");
      }
    } catch { /* ignore */ }
    return null;
  }

  /**
   * Read folder contents — includes tree structure AND file contents.
   * Similar to @folder context provider: reads up to 20 files, 3k chars each.
   */
  private readFolderContents(folderPath: string): string {
    const workingDir = this.getWorkingDir();
    const absPath = path.isAbsolute(folderPath) ? folderPath : path.join(workingDir, folderPath);
    const maxFiles = 20;
    const maxFileChars = 3000;
    const maxTotalChars = 50000;
    const skipDirs = new Set(["node_modules", ".git", "dist", "build", "__pycache__", ".cache", "coverage"]);

    if (!fs.existsSync(absPath) || !fs.statSync(absPath).isDirectory()) {
      return `Folder: \`${folderPath}\` (not found)`;
    }

    const files: string[] = [];
    const walk = (dir: string) => {
      if (files.length >= maxFiles) return;
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        const fileEntries = entries.filter((e) => e.isFile());
        const dirEntries = entries.filter((e) => e.isDirectory() && !skipDirs.has(e.name) && !e.name.startsWith("."));
        for (const f of fileEntries) {
          if (files.length >= maxFiles) return;
          files.push(path.join(dir, f.name));
        }
        for (const d of dirEntries) {
          if (files.length >= maxFiles) return;
          walk(path.join(dir, d.name));
        }
      } catch { /* ignore unreadable dirs */ }
    };
    walk(absPath);

    if (files.length === 0) {
      return `Folder: \`${folderPath}\` (empty)`;
    }

    let totalChars = 0;
    const sections: string[] = [`Folder: \`${folderPath}\` (${files.length} files)`];

    for (const file of files) {
      if (totalChars >= maxTotalChars) {
        sections.push(`\n... [truncated, ${maxTotalChars} char limit reached]`);
        break;
      }
      const rel = path.relative(absPath, file);
      try {
        let content = fs.readFileSync(file, "utf-8");
        if (content.length > maxFileChars) {
          content = content.substring(0, maxFileChars) + "\n... [truncated]";
        }
        const ext = path.extname(file).substring(1) || "txt";
        sections.push(`\n### ${rel}\n\`\`\`${ext}\n${content}\n\`\`\``);
        totalChars += content.length;
      } catch {
        sections.push(`\n### ${rel}\n(unable to read)`);
      }
    }

    return sections.join("\n");
  }

  /** List folder structure (max 2 levels deep) */
  private listFolderStructure(folderPath: string, depth = 0, maxDepth = 2): string {
    const workingDir = this.getWorkingDir();
    const absPath = path.isAbsolute(folderPath) ? folderPath : path.join(workingDir, folderPath);
    try {
      if (!fs.existsSync(absPath) || !fs.statSync(absPath).isDirectory()) return "(not a directory)";
      const entries = fs.readdirSync(absPath, { withFileTypes: true })
        .filter((e) => !e.name.startsWith(".") && e.name !== "node_modules")
        .sort((a, b) => {
          if (a.isDirectory() && !b.isDirectory()) return -1;
          if (!a.isDirectory() && b.isDirectory()) return 1;
          return a.name.localeCompare(b.name);
        })
        .slice(0, 50);

      const lines: string[] = [];
      const indent = "  ".repeat(depth);
      for (const entry of entries) {
        if (entry.isDirectory()) {
          lines.push(`${indent}${entry.name}/`);
          if (depth < maxDepth) {
            lines.push(this.listFolderStructure(path.join(absPath, entry.name), depth + 1, maxDepth));
          }
        } else {
          lines.push(`${indent}${entry.name}`);
        }
      }
      return lines.join("\n");
    } catch { return "(could not read)"; }
  }

  /** Open file picker and send result as context attachment */
  private async pickFileForContext() {
    const uris = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: true,
      openLabel: "Attach as Context",
    });
    if (!uris || uris.length === 0) return;

    for (const uri of uris) {
      const filePath = vscode.workspace.asRelativePath(uri);
      const lang = this.getLanguageId(filePath);
      this.postMessage({
        type: "contextAttached",
        attachment: { type: "file", path: filePath, language: lang },
      });
    }
  }

  /** Open folder picker and send result as context attachment */
  private async pickFolderForContext() {
    const uris = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: "Attach Folder as Context",
    });
    if (!uris || uris.length === 0) return;

    const folderPath = vscode.workspace.asRelativePath(uris[0]);
    this.postMessage({
      type: "contextAttached",
      attachment: { type: "folder", path: folderPath },
    });
  }

  /** Send the currently active/visible file as a context attachment */
  private sendActiveFileAsContext() {
    // Try active editor first
    let editor = vscode.window.activeTextEditor;

    // If no active editor, try the first visible editor
    if (!editor && vscode.window.visibleTextEditors.length > 0) {
      editor = vscode.window.visibleTextEditors[0];
    }

    if (!editor) return;

    // Skip non-file schemes (output panels, settings, etc.)
    if (editor.document.uri.scheme !== "file") return;

    const filePath = vscode.workspace.asRelativePath(editor.document.uri);
    const lang = editor.document.languageId;
    const selection = editor.selection;
    const selectedText = editor.document.getText(selection);

    if (selectedText) {
      this.postMessage({
        type: "contextAttached",
        attachment: {
          type: "selection",
          path: filePath,
          language: lang,
          content: selectedText,
          startLine: selection.start.line + 1,
          endLine: selection.end.line + 1,
        },
      });
    } else {
      this.postMessage({
        type: "contextAttached",
        attachment: { type: "file", path: filePath, language: lang },
      });
    }
  }

  /** Search workspace files for @ autocomplete */
  private async searchWorkspaceFiles(query: string) {
    const workingDir = this.getWorkingDir();
    try {
      const results: Array<{ path: string; isDir: boolean; language: string }> = [];

      // Search for directories (top-level and one level deep)
      try {
        const topEntries = fs.readdirSync(workingDir, { withFileTypes: true });
        for (const entry of topEntries) {
          if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "dist" || entry.name === "build") continue;
          const relPath = entry.name;
          if (entry.isDirectory()) {
            if (!query || relPath.toLowerCase().includes(query.toLowerCase())) {
              results.push({ path: relPath, isDir: true, language: "" });
            }
            // Also search one level deeper for subdirectories
            try {
              const subEntries = fs.readdirSync(path.join(workingDir, entry.name), { withFileTypes: true });
              for (const sub of subEntries) {
                if (sub.name.startsWith(".") || sub.name === "node_modules") continue;
                const subPath = `${entry.name}/${sub.name}`;
                if (sub.isDirectory() && query && subPath.toLowerCase().includes(query.toLowerCase())) {
                  results.push({ path: subPath, isDir: true, language: "" });
                }
              }
            } catch { /* ignore unreadable dirs */ }
          }
        }
      } catch { /* ignore */ }

      // Search files using VS Code findFiles — escape special glob chars in query
      const safeQuery = query.replace(/[[\]{}()?!]/g, "\\$&");
      // Split query into chars for fuzzy-ish matching: "index.js" → "*i*n*d*e*x*.*j*s*"
      // But simpler: just use the whole query as a substring match
      const pattern = safeQuery ? `**/*${safeQuery}*` : "**/*";
      try {
        const uris = await vscode.workspace.findFiles(
          pattern,
          "{**/node_modules/**,**/dist/**,**/build/**,**/.git/**}",
          20
        );

        for (const uri of uris) {
          const relPath = vscode.workspace.asRelativePath(uri);
          const lang = this.getLanguageId(relPath);
          // Avoid duplicates
          if (!results.some((r) => r.path === relPath)) {
            results.push({ path: relPath, isDir: false, language: lang });
          }
        }
      } catch { /* findFiles can fail if no workspace is open */ }

      // If findFiles returned nothing, fallback to recursive fs search
      if (results.filter((r) => !r.isDir).length === 0 && query) {
        const lowerQuery = query.toLowerCase();
        const searchDir = (dir: string, depth: number) => {
          if (depth > 4 || results.length >= 20) return;
          try {
            const entries = fs.readdirSync(path.join(workingDir, dir), { withFileTypes: true });
            for (const entry of entries) {
              if (results.length >= 20) break;
              if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "dist") continue;
              const relPath = dir ? `${dir}/${entry.name}` : entry.name;
              if (entry.isDirectory()) {
                searchDir(relPath, depth + 1);
              } else if (entry.name.toLowerCase().includes(lowerQuery)) {
                results.push({ path: relPath, isDir: false, language: this.getLanguageId(relPath) });
              }
            }
          } catch { /* ignore */ }
        };
        searchDir("", 0);
      }

      // Sort: directories first, then by path length (shorter = more relevant)
      results.sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
        return a.path.length - b.path.length;
      });

      this.postMessage({ type: "fileSearchResults" as any, results: results.slice(0, 20) });
    } catch (err) {
      console.error("[Cdoing] searchWorkspaceFiles error:", err);
      this.postMessage({ type: "fileSearchResults" as any, results: [] });
    }
  }

  /** Get language ID from file extension */
  private getLanguageId(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    const map: Record<string, string> = {
      ".ts": "typescript", ".tsx": "typescript", ".js": "javascript", ".jsx": "javascript",
      ".py": "python", ".rb": "ruby", ".go": "go", ".rs": "rust", ".java": "java",
      ".css": "css", ".html": "html", ".json": "json", ".yaml": "yaml", ".yml": "yaml",
      ".md": "markdown", ".sh": "bash", ".sql": "sql", ".c": "c", ".cpp": "cpp",
    };
    return map[ext] || "";
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
    if (!this.webviewReady) {
      // Queue messages until webview sends "ready"
      this.pendingMessages.push(message);
      return;
    }
    this.view?.webview.postMessage(message);
  }

  /** Flush any messages that were queued before the webview was ready */
  private flushPendingMessages() {
    for (const msg of this.pendingMessages) {
      this.view?.webview.postMessage(msg);
    }
    this.pendingMessages = [];
  }

  private sendCurrentConfig() {
    const { modelConfig } = this.getConfig();
    // resolveModelInfo returns the exact model the LLM provider will actually use
    const resolved = resolveModelInfo(modelConfig);
    const displayModel = resolved.model || resolved.provider;
    this.postMessage({ type: "configUpdated", provider: resolved.provider, model: displayModel });
  }

  /** Send full config to the webview for the settings panel */
  private sendFullConfig() {
    const vsConfig = vscode.workspace.getConfiguration("cdoing");
    const provider = vsConfig.get<string>("provider") || "anthropic";

    // Check all API key sources: VS Code setting, config file, env var
    const vsApiKey = vsConfig.get<string>("apiKey") || "";
    const configApiKey = this.loadApiKeyFromConfig(provider) || "";
    // Auto-detect auth method
    let authMethod = vsConfig.get<string>("authMethod") || "";
    if (!authMethod) {
      const oauthInfo = getOAuthStatus(provider);
      if (oauthInfo.status === "active") {
        authMethod = "oauth";
      } else {
        authMethod = "apiKey";
      }
    }

    // Resolve actual model being used (respects OAuth overrides, defaults, etc.)
    const { modelConfig: resolvedMc } = this.getConfig();
    const resolved = resolveModelInfo(resolvedMc);

    this.postMessage({
      type: "configData" as any,
      config: {
        provider,
        model: resolved.model,
        customProviderName: vsConfig.get<string>("customProviderName") || "",
        customBaseURL: vsConfig.get<string>("customBaseURL") || "",
        apiKey: vsApiKey,
        authMethod,
        temperature: vsConfig.get<number>("temperature") ?? 0,
        maxTokens: vsConfig.get<number>("maxTokens") ?? 8096,
        permissionMode: vsConfig.get<string>("permissionMode") || "ask",
        // Extra info for settings panel to show correct status
        hasConfigFileApiKey: !!configApiKey,
        // OAuth-capable providers (from core, single source of truth)
        oauthProviders: getOAuthProviders().map(p => ({ id: p.id, name: p.name, defaultModel: p.defaultModel, models: p.models || [] })),
      },
    });
    // Also send OAuth status
    this.postMessage({ type: "oauthStatus", ...getOAuthStatus(provider) } as any);
  }

  /** Update config from the webview settings panel */
  private async updateConfigFromWebview(config: any) {
    const vsConfig = vscode.workspace.getConfiguration("cdoing");
    const target = vscode.ConfigurationTarget.Global;

    if (config.provider !== undefined) await vsConfig.update("provider", config.provider, target);
    if (config.model !== undefined) await vsConfig.update("model", config.model, target);
    if (config.customProviderName !== undefined) await vsConfig.update("customProviderName", config.customProviderName, target);
    if (config.customBaseURL !== undefined) await vsConfig.update("customBaseURL", config.customBaseURL, target);
    if (config.apiKey !== undefined) await vsConfig.update("apiKey", config.apiKey, target);
    if (config.authMethod !== undefined) await vsConfig.update("authMethod", config.authMethod, target);
    if (config.temperature !== undefined) await vsConfig.update("temperature", config.temperature, target);
    if (config.maxTokens !== undefined) await vsConfig.update("maxTokens", config.maxTokens, target);
    if (config.permissionMode !== undefined) await vsConfig.update("permissionMode", config.permissionMode, target);

    this.refreshConfig();
  }

  // ── Message Handling ───────────────────────────────────

  /** Handle user messages — slash commands or agent messages */
  private async handleUserMessage(text: string, context?: Array<{ type: string; path: string; language?: string; content?: string; startLine?: number; endLine?: number; base64?: string; mimeType?: string }>, requestTabId?: string) {
    if (text.startsWith("/")) {
      const [cmd, ...args] = text.split(" ");
      await this.handleCommand(cmd, args);
      return;
    }

    // Build full message with context attachments
    let fullMessage = text;
    const images: ImageAttachment[] = [];

    if (context && context.length > 0) {
      const contextParts: string[] = [];
      for (const att of context) {
        if (att.type === "image" && att.base64 && att.mimeType) {
          // Collect images for multimodal message
          images.push({ data: att.base64, mimeType: att.mimeType });
        } else if (att.type === "selection" && att.content) {
          contextParts.push(`\`\`\`${att.language || ""} (${att.path}${att.startLine ? `:${att.startLine}-${att.endLine}` : ""})\n${att.content}\n\`\`\``);
        } else if (att.type === "file") {
          // Use provided content or read from disk
          const content = att.content || this.readFileContent(att.path);
          if (content !== null) {
            const lines = content.split("\n").length;
            contextParts.push(`File: \`${att.path}\` (${lines} lines)\n\`\`\`${att.language || ""}\n${content.substring(0, 10000)}\n\`\`\``);
          } else {
            contextParts.push(`File: \`${att.path}\` (could not read)`);
          }
        } else if (att.type === "folder") {
          // Include folder structure + file contents (like @folder context provider)
          const folderContext = this.readFolderContents(att.path);
          contextParts.push(folderContext);
        }
      }
      if (contextParts.length > 0) {
        fullMessage = `${contextParts.join("\n\n")}\n\n${text}`;
      }
    }

    // Inject plan mode context when in plan mode
    // This ensures the LLM knows it's read-only even when the user just typed normally
    if (this.permissionManager?.getMode() === PermissionMode.PLAN) {
      fullMessage = `[PLAN MODE — Read-only] You are in plan mode. Do NOT write files, run commands, or modify anything. Only read, search, analyze, and create a plan using the todo tool. When your plan is ready, call plan_exit.\n\n${fullMessage}`;
    }

    const tab = this.getTab(requestTabId);
    if (!tab) {
      this.createTab();
      setTimeout(() => this.handleUserMessage(fullMessage, undefined, requestTabId), 50);
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
    this._onDidChangeState.fire();
    this.postTabMessage(tab.id, { type: "startResponse" });

    // Warn if sending images to a potentially non-vision model
    if (images.length > 0) {
      const { modelConfig: mc } = this.getConfig();
      const resolved = resolveModelInfo(mc);
      const m = resolved.model.toLowerCase();
      const visionModels = ["claude", "gpt-4o", "gpt-4-turbo", "gpt-4-vision", "gemini", "llava", "pixtral"];
      const isLikelyVision = resolved.provider === "anthropic" || resolved.provider === "openai" || resolved.provider === "google"
        || visionModels.some(v => m.includes(v));
      if (!isLikelyVision) {
        this.postTabMessage(tab.id, {
          type: "systemMessage",
          text: `⚠️ Image attached — model \`${resolved.model}\` may not support vision. If the model can't see the image, try a vision-capable model (Claude, GPT-4o, Gemini).`,
        });
      }
    }

    // Ensure API key or OAuth token is available
    const { provider, modelConfig } = this.getConfig();
    if (!modelConfig.oauthToken && !modelConfig.apiKey) {
      const envVar = getApiKeyEnvVar(provider);
      if (!process.env[envVar]) {
        const storedKey = this.loadApiKeyFromConfig(provider);
        if (storedKey) process.env[envVar] = storedKey;
      }
    }

    const tabId = tab.id; // capture for callbacks (tab might change)

    // Accumulate usage across all turns, show only once at the end
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalTokens = 0;
    let totalCost = 0;

    const callbacks: AgentCallbacks = {
      onToken: (token) => {
        this.postTabMessage(tabId, { type: "token", text: token });
      },
      onTextToolCallDetected: () => {
        // Local models (Ollama) may stream tool calls as text — clear the raw JSON from UI
        this.postTabMessage(tabId, { type: "clearStreamingText" });
      },
      onToolCallStreaming: (name) => {
        // Model is generating a tool call — show a "Generating..." indicator in the UI
        this.postTabMessage(tabId, { type: "finalizeStreaming" });
        this.postTabMessage(tabId, { type: "toolCallStreaming", name });
      },
      onToolCall: (name: string, input: Record<string, unknown>, toolCallId?: string) => {
        // Finalize any streamed text so it stays visible above the tool calls
        this.postTabMessage(tabId, { type: "finalizeStreaming" });
        // For file_write, send a lightweight summary instead of the full content
        // (the diff in the result already shows what was written)
        let inputForUi = input;
        if (name === "file_write" && typeof (input as any).content === "string") {
          const content = (input as any).content as string;
          inputForUi = { ...input, content: `(${content.split("\n").length} lines)` };
        }
        const inputStr = JSON.stringify(inputForUi);
        const description = (input as any).description as string | undefined;
        this.postTabMessage(tabId, {
          type: "toolCall",
          name,
          input: inputStr.length > 2000 ? inputStr.substring(0, 2000) : inputStr,
          description,
          toolCallId,
        });
      },
      onToolProgress: (name: string, chunk: string, toolCallId?: string) => {
        this.postTabMessage(tabId, { type: "toolProgress", name, chunk, toolCallId } as any);
      },
      onDiffChunk: (chunk) => {
        this.postTabMessage(tabId, {
          type: "diffChunk",
          diffType: chunk.type,
          content: chunk.content,
          lineNumber: chunk.lineNumber,
        } as any);
      },
      onToolResult: (name: string, result: string, isError: boolean, toolCallId?: string) => {
        let output = result.length > 3000 ? result.substring(0, 3000) + `\n… (${result.length - 3000} more chars)` : result;

        // For todo tool: append the full todo list state so the widget can render it
        if (name === "todo" && this.todoStore) {
          const allTodos = this.todoStore.getAll();
          if (allTodos.length > 0) {
            const lines: string[] = [output, "", "---TODO_STATE---"];
            for (const t of allTodos) {
              const indent = t.parentId ? "  " : "";
              const icon = t.status === "completed" ? "[x]" : t.status === "in_progress" ? "[~]" : t.status === "blocked" ? "[!]" : "[ ]";
              const subs = t.subtaskIds?.length > 0 ? ` (${t.subtaskIds.length} subtasks)` : "";
              lines.push(`${indent}${icon} #${t.id} ${t.subject}${subs}`);
            }
            const summary = allTodos.filter(t => t.status === "completed").length;
            lines.push(`\nSummary: ${summary}/${allTodos.length} completed`);
            output = lines.join("\n");
          }
        }

        this.postTabMessage(tabId, {
          type: "toolResult",
          name,
          result: output,
          isError,
          toolCallId,
        });
      },
      onComplete: () => {
        const t = this.tabs.get(tabId);
        if (t) {
          // Show accumulated usage once at the end
          if (totalTokens > 0) {
            const parts: string[] = [];
            if (totalInputTokens > 0 || totalOutputTokens > 0) {
              parts.push(`${totalInputTokens.toLocaleString()}→${totalOutputTokens.toLocaleString()}`);
            }
            parts.push(`${totalTokens.toLocaleString()} tokens`);
            if (totalCost > 0) parts.push(`$${totalCost.toFixed(4)}`);
            this.postTabMessage(tabId, { type: "usageInfo", text: parts.join(" · ") });
          }

          // Kill all background processes spawned during this agent run
          const shellTool = this.toolRegistry?.get("shell_exec") as ShellExecTool | undefined;
          if (shellTool?.getProcessManager) {
            const killed = shellTool.getProcessManager().killAll();
            if (killed > 0) {
              this.postTabMessage(tabId, {
                type: "addMessage",
                role: "system",
                content: `[auto-killed ${killed} background process${killed > 1 ? "es" : ""}]`,
              });
            }
          }

          t.isProcessing = false;
          this._onDidChangeState.fire();
          this.postTabMessage(tabId, { type: "endResponse" });
          // Auto-save conversation after each completed turn
          this.saveConversation(tabId);
          this.processTabQueue(tabId);
        }
      },
      onError: (error) => {
        const t = this.tabs.get(tabId);
        if (t) {
          t.isProcessing = false;
          this._onDidChangeState.fire();
          let errMsg = error.message;
          const lower = errMsg.toLowerCase();
          // Detect image-related errors
          if (images.length > 0) {
            if (lower.includes("400") || lower.includes("invalid") || lower.includes("image") ||
                lower.includes("multimodal") || lower.includes("vision") || lower.includes("content type") ||
                lower.includes("unsupported") || lower.includes("does not support")) {
              const resolved = resolveModelInfo(this.getConfig().modelConfig);
              errMsg = `This model (${resolved.model}) does not support image/vision input.\n\n${errMsg}\n\nSwitch to a vision-capable model: Claude Sonnet/Haiku, GPT-4o, or Gemini.`;
            }
          }
          // Categorize common errors with actionable hints
          if (lower.includes("401") || lower.includes("403") || lower.includes("authentication") || lower.includes("invalid_api_key")) {
            errMsg += "\n\nAuthentication failed — check your API key in the extension settings.";
          } else if (lower.includes("429") || lower.includes("rate") || lower.includes("quota") || lower.includes("credit balance")) {
            errMsg += "\n\nRate limit or quota exceeded — wait a moment and retry, or switch models.";
          } else if (lower.includes("econnrefused") || lower.includes("enotfound") || lower.includes("etimedout") || lower.includes("fetch failed")) {
            errMsg += "\n\nNetwork error — check your internet connection and try again.";
          } else if (lower.includes("empty response")) {
            errMsg += "\n\nThe model returned no output — try again or switch models.";
          }
          this.postTabMessage(tabId, { type: "error", text: errMsg });
          this.processTabQueue(tabId);
        }
      },
      onUsage: (usage) => {
        // Accumulate usage across turns instead of showing each one
        totalInputTokens += usage.inputTokens;
        totalOutputTokens += usage.outputTokens;
        totalTokens += usage.totalTokens;
        if (usage.cost !== undefined) totalCost += usage.cost;
      },
      onCompactStart: (contextPercent) => {
        try {
          this.postTabMessage(tabId, {
            type: "toolCall",
            name: "compact",
            input: "",
            description: `Compacting context (${contextPercent}% used)...`,
          });
        } catch {}
      },
      onCompactEnd: (savedTokens, newPercent) => {
        try {
          this.postTabMessage(tabId, {
            type: "toolResult",
            name: "compact",
            result: `Context compacted — saved ${savedTokens.toLocaleString()} tokens (now ${newPercent}%)`,
            isError: false,
          });
        } catch {}
      },
    };

    try {
      await tab.agent.run(fullMessage, callbacks, images.length > 0 ? images : undefined);
    } catch (err) {
      let msg = err instanceof Error ? err.message : String(err);
      // Detect image-related errors and provide a clear message
      if (images.length > 0) {
        const lower = msg.toLowerCase();
        if (lower.includes("400") || lower.includes("invalid") || lower.includes("image") ||
            lower.includes("multimodal") || lower.includes("vision") || lower.includes("content type") ||
            lower.includes("unsupported") || lower.includes("does not support")) {
          const { modelConfig } = this.getConfig();
          msg = `This model (${modelConfig.model || "unknown"}) does not support image/vision input.\n\n${msg}\n\nSwitch to a vision-capable model: Claude Sonnet/Haiku, GPT-4o, or Gemini.`;
        }
      }
      tab.isProcessing = false;
      this._onDidChangeState.fire();
      this.postTabMessage(tabId, { type: "error", text: msg });
      this.processTabQueue(tabId);
    }
  }

  /** Process the next queued message for a specific tab */
  private processTabQueue(tabId: string) {
    const tab = this.tabs.get(tabId);
    if (!tab || tab.messageQueue.length === 0) return;
    const next = tab.messageQueue.shift()!;
    // Process regardless of which tab is active — each tab runs independently
    setTimeout(() => {
      this.handleUserMessage(next, undefined, tabId);
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

  /** Send the conversation list to the webview */
  private sendConversationList() {
    const conversations = this.listConversations();
    this.postMessage({ type: "conversationList" as any, conversations });
  }

  /** Resume a conversation by ID — creates a new tab with the history restored */
  private resumeConversationById(id: string) {
    const conv = this.loadConversation(id);
    if (!conv) {
      this.postMessage({ type: "error", text: `Conversation not found: ${id}` });
      return;
    }
    const tabId = this.createTab(conv.title || "Resumed");
    const tab = this.tabs.get(tabId);
    if (tab) {
      for (const msg of (conv.messages || [])) {
        if (msg.role === "user") tab.agent.addToHistory("user", msg.content);
        else if (msg.role === "assistant") tab.agent.addToHistory("assistant", msg.content);
      }
      // Send the messages to the webview so the user can see the history
      const messages = (conv.messages || []).map((m: any) => ({ role: m.role, content: m.content }));
      this.postMessage({ type: "conversationMessages" as any, id, messages });
    }
  }

  /** Save a conversation to disk */
  private saveConversation(tabId: string) {
    const tab = this.tabs.get(tabId);
    if (!tab) return;

    const history = tab.agent.getHistory();
    if (!history || history.length === 0) return;

    // Convert LangChain messages to simple objects
    const messages: Array<{ role: string; content: string }> = [];
    for (const msg of history) {
      const type = msg._getType();
      if (type === "human") {
        messages.push({ role: "user", content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content) });
      } else if (type === "ai") {
        messages.push({ role: "assistant", content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content) });
      }
    }

    // Only save if there's at least one user message
    if (!messages.some((m) => m.role === "user")) return;

    // Use tab ID as conversation ID
    const convId = tab.id;
    const conv = {
      id: convId,
      title: tab.title,
      updatedAt: Date.now(),
      messages,
    };

    try {
      if (!fs.existsSync(this.convDir)) {
        fs.mkdirSync(this.convDir, { recursive: true });
      }
      fs.writeFileSync(path.join(this.convDir, `${convId}.json`), JSON.stringify(conv, null, 2));
    } catch { /* ignore save errors */ }
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
        const { provider, modelConfig } = this.getConfig();
        const isOAuth = !!modelConfig.oauthToken;
        const oauthConfig = isOAuth ? getOAuthProvider(provider) : null;
        const oauthModels = oauthConfig?.models || [];

        if (!arg) {
          // Show current model and available options
          const cur = modelConfig.model || oauthConfig?.defaultModel || "(default)";
          const lines = [`**Current model:** ${cur}`, `**Auth:** ${isOAuth ? "OAuth" : "API key"}`];
          if (isOAuth && oauthModels.length > 0) {
            lines.push("", "**Available models:**");
            for (const m of oauthModels) {
              const marker = m.id === cur ? " ← current" : "";
              lines.push(`- \`${m.id}\` — ${m.name}${m.hint ? ` (${m.hint})` : ""}${marker}`);
            }
            lines.push("", "Usage: `/model <name>` or `/model default`");
          } else {
            lines.push("", "Usage: `/model <name>` or `/model default`");
          }
          this.postMessage({ type: "systemMessage", text: lines.join("\n") });
          break;
        }

        if (arg === "default") {
          const vsConfig = vscode.workspace.getConfiguration("cdoing");
          await vsConfig.update("model", "", vscode.ConfigurationTarget.Global);
          this.refreshConfig();
          const def = oauthConfig?.defaultModel || "provider default";
          this.postMessage({ type: "systemMessage", text: `Model reset to default: **${def}**` });
          break;
        }

        // Validate against OAuth allowed list
        if (isOAuth && oauthModels.length > 0) {
          const allowed = oauthModels.map(m => m.id);
          if (!allowed.includes(arg)) {
            const available = oauthModels.map(m => `- \`${m.id}\` — ${m.name}`).join("\n");
            this.postMessage({
              type: "systemMessage",
              text: `**Error:** \`${arg}\` is not available with OAuth for ${provider}.\n\n**Available models:**\n${available}`,
            });
            break;
          }
        }

        const vsConfig = vscode.workspace.getConfiguration("cdoing");
        await vsConfig.update("model", arg, vscode.ConfigurationTarget.Global);
        this.refreshConfig();
        this.postMessage({ type: "systemMessage", text: `Model switched to: **${arg}**` });
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
        switch (arg) {
          case "bypassPermissions": newMode = PermissionMode.BYPASS; break;
          case "auto":              newMode = PermissionMode.BYPASS; break;
          case "acceptEdits":       newMode = PermissionMode.ACCEPT_EDITS; break;
          case "auto-edit":         newMode = PermissionMode.ACCEPT_EDITS; break;
          case "plan":              newMode = PermissionMode.PLAN; break;
          case "dontAsk":           newMode = PermissionMode.DONT_ASK; break;
          default:                  newMode = PermissionMode.DEFAULT;
        }
        this.permissionManager?.setMode(newMode);
        this.rebuildCurrentAgent();
        this.postMessage({ type: "modeChanged", mode: arg } as any);
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
        else { this.postMessage({ type: "systemMessage", text: `**Memories:**\n${memories.map((m) => `- **${m.key}** *(${m.type})*: ${m.content}`).join("\n")}` }); }
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

      case "/plan": {
        if (!tab) { this.postMessage({ type: "systemMessage", text: "No active tab." }); break; }
        if (arg === "off" || arg === "cancel") {
          tab.planPending = false;
          this.permissionManager?.setMode(PermissionMode.DEFAULT);
          this.rebuildCurrentAgent();
          this.postMessage({ type: "modeChanged", mode: "ask" } as any);
          this.postMessage({ type: "systemMessage", text: "Plan mode cancelled. Switched to **build mode**." });
          break;
        }
        if (arg === "show") {
          this.postMessage({ type: "systemMessage", text: tab.planSummary ? `**Plan:** ${tab.planSummary}` : "No active plan." });
          break;
        }
        if (arg === "approve" || arg === "yes") {
          if (!tab.planPending) {
            this.postMessage({ type: "systemMessage", text: "No plan to approve. Use `/plan <request>` to create one." });
            break;
          }
          tab.planPending = false;
          this.permissionManager?.setMode(PermissionMode.DEFAULT);
          this.rebuildCurrentAgent();
          this.postMessage({ type: "modeChanged", mode: "ask" } as any);
          this.postMessage({ type: "systemMessage", text: "Plan approved! Switched to **build mode**. Executing..." });
          const buildMsg = [
            "[MODE SWITCH: Plan → Build]",
            "Your operational mode has changed from plan to build.",
            "You now have full access to write files, run commands, and execute tools.",
            "",
            "## Approved Plan",
            tab.planSummary || "Execute the plan you created.",
            "",
            "## Instructions",
            "Execute the plan step by step. If a step fails, explain why and suggest alternatives.",
          ].join("\n");
          this.handleUserMessage(buildMsg);
          break;
        }
        if (arg === "reject" || arg === "no") {
          tab.planPending = false;
          this.permissionManager?.setMode(PermissionMode.DEFAULT);
          this.rebuildCurrentAgent();
          this.postMessage({ type: "modeChanged", mode: "ask" } as any);
          this.postMessage({ type: "systemMessage", text: "Plan rejected. Switched to **build mode**." });
          break;
        }
        if (!arg) {
          const isActive = this.permissionManager?.getMode() === PermissionMode.PLAN;
          if (isActive) {
            this.permissionManager?.setMode(PermissionMode.DEFAULT);
            tab.planPending = false;
            this.rebuildCurrentAgent();
            this.postMessage({ type: "modeChanged", mode: "ask" } as any);
            this.postMessage({ type: "systemMessage", text: "Plan mode **OFF**. Switched to build mode." });
          } else {
            this.permissionManager?.setMode(PermissionMode.PLAN);
            this.rebuildCurrentAgent();
            this.postMessage({ type: "modeChanged", mode: "plan" } as any);
            this.postMessage({ type: "systemMessage", text: "Plan mode **ON** (read-only). Send a message to start planning.\nUse `/plan approve` to execute, `/plan reject` to cancel." });
          }
          break;
        }
        // /plan <request> — enter plan mode and start planning
        this.permissionManager?.setMode(PermissionMode.PLAN);
        this.rebuildCurrentAgent();
        tab.planPending = true;
        this.postMessage({ type: "modeChanged", mode: "plan" } as any);
        this.postMessage({ type: "systemMessage", text: "Plan mode **ON** (read-only). Generating plan...\nUse `/plan approve` when ready, `/plan reject` to cancel." });
        const planMsg = [
          "[PLAN MODE — Read-only]",
          "Analyze this request and create a detailed step-by-step implementation plan.",
          "You are in read-only mode — you can read files, search code, and explore, but CANNOT write or execute.",
          "When your plan is complete, call plan_exit with a summary.",
          "",
          `Request: ${arg}`,
        ].join("\n");
        this.handleUserMessage(planMsg);
        break;
      }

      case "/index": {
        const workDir = this.getWorkingDir();

        if (arg === "stats") {
          const indexer = new CodebaseIndexer(workDir);
          const s = indexer.getStats();
          const ago = s.lastIndexed > 0 ? `${Math.round((Date.now() - s.lastIndexed) / 60000)} min ago` : "never";
          indexer.close();
          this.postMessage({ type: "systemMessage", text: `**Index Stats:**\n- Files: ${s.totalFiles}\n- Chunks: ${s.totalChunks}\n- FTS: ${s.ftsEntries}\n- Embeddings: ${s.embeddingEntries}\n- Size: ${(s.indexSizeBytes / 1024).toFixed(1)} KB\n- Last indexed: ${ago}` });
          break;
        }

        if (arg === "clear") {
          const indexer = new CodebaseIndexer(workDir);
          indexer.clearIndex();
          indexer.close();
          this.postMessage({ type: "systemMessage", text: "Index cleared." });
          break;
        }

        // Run indexing (full rebuild if arg === "full")
        vscode.commands.executeCommand(arg === "full" ? "cdoing.indexCodebaseFull" : "cdoing.indexCodebase");
        break;
      }

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

**Plan:**
- \`/plan <request>\` — Enter plan mode (read-only) and generate a plan
- \`/plan approve\` — Approve plan and switch to build mode
- \`/plan reject\` — Reject plan and return to build mode
- \`/plan show\` — Show current plan
- \`/plan off\` — Cancel plan mode

**Index:**
- \`/index\` — Index codebase (incremental)
- \`/index full\` — Rebuild index from scratch
- \`/index stats\` — Show index statistics
- \`/index clear\` — Clear the index

**Info:**
- \`/config\` — Configuration
- \`/usage\` — Token usage
- \`/cost\` — Cost breakdown
- \`/permissions\` — Stored permissions
- \`/memory\` — Persistent memory
- \`/hooks\` — Configured hooks
- \`/settings\` — VS Code settings

**Tabs:** Click \`+\` for new tab, \`×\` to close.
**Shortcuts:** \`Cmd+Shift+L\` new chat, \`Cmd+Shift+I\` index codebase, \`Cmd+Shift+Enter\` send selection.`,
        });
        break;

      default:
        this.postMessage({ type: "systemMessage", text: `Unknown: ${cmd}. Type \`/help\`.` });
    }
  }
}
