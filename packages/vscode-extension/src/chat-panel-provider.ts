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
  SandboxManager,
  SystemInfoTool,
  MultiEditTool,
  FileDeleteTool,
  ListDirTool,
  ViewDiffTool,
  ViewRepoMapTool,
  CodebaseSearchTool,
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
import {
  generateOAuthUrl,
  exchangeOAuthCode,
  resolveOAuthToken,
  getOAuthStatus,
  oauthLogout,
  loadOAuthTokens,
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

  private webviewReady = false;
  private pendingMessages: any[] = [];
  private pendingPermissionResolvers = new Map<string, (decision: "allow" | "always" | "project" | "deny") => void>();
  private permissionIdCounter = 0;
  private oauthCodeVerifier: string | null = null;

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
          await this.handleUserMessage(message.text, message.context);
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
          const { url, codeVerifier } = generateOAuthUrl();
          this.oauthCodeVerifier = codeVerifier;
          vscode.env.openExternal(vscode.Uri.parse(url));
          this.postMessage({ type: "oauthStarted", url } as any);
          // Prompt user to paste the code
          const code = await vscode.window.showInputBox({
            title: "Claude OAuth Login",
            prompt: "Paste the authorization code from the browser",
            placeHolder: "Authorization code...",
            ignoreFocusOut: true,
          });
          if (code && this.oauthCodeVerifier) {
            try {
              await exchangeOAuthCode(code, this.oauthCodeVerifier);
              this.oauthCodeVerifier = null;
              this.postMessage({ type: "oauthResult", success: true } as any);
              this.postMessage({ type: "oauthStatus", ...getOAuthStatus() } as any);
              // Reinitialize with OAuth token
              this.refreshConfig();
            } catch (err) {
              const errMsg = err instanceof Error ? err.message : String(err);
              this.postMessage({ type: "oauthResult", success: false, error: errMsg } as any);
            }
          } else {
            this.oauthCodeVerifier = null;
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
      console.log("[cdoing] getConfig — authMethod:", authMethod, "apiKey:", !!apiKey, "oauthStatus:", status);
      if (status.status === "active") {
        const tokens = loadOAuthTokens();
        console.log("[cdoing] getConfig — loaded OAuth token:", !!tokens?.access_token);
        if (tokens) modelConfig.oauthToken = tokens.access_token;
      }
    } else {
      console.log("[cdoing] getConfig — skipped OAuth check. provider:", provider, "authMethod:", authMethod, "apiKey:", !!apiKey);
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

    console.log("[cdoing] initSharedServices — provider:", provider, "hasOAuth:", !!modelConfig.oauthToken, "hasApiKey:", !!modelConfig.apiKey, "envKey:", !!process.env[getApiKeyEnvVar(provider)]);

    // If OAuth token is available, clear any previously-set env API key
    // so the agent doesn't accidentally use the API key instead of OAuth
    if (modelConfig.oauthToken) {
      const envVar = getApiKeyEnvVar(provider);
      if (process.env[envVar]) {
        console.log("[cdoing] OAuth active — clearing env var", envVar);
        delete process.env[envVar];
      }
    }

    // Ensure API key is available (skip if using OAuth)
    if (!modelConfig.oauthToken && !modelConfig.apiKey) {
      const envVar = getApiKeyEnvVar(provider);
      if (!process.env[envVar]) {
        const storedKey = this.loadApiKeyFromConfig(provider);
        if (storedKey) {
          console.log("[cdoing] No OAuth — loaded stored API key for", provider);
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
      return new Promise<"allow" | "always" | "project" | "deny">((resolve) => {
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

    // Tool registry (with sandbox + permission manager)
    this.toolRegistry = new ToolRegistry();
    this.toolRegistry.register(new FileReadTool(workingDir, sm));
    this.toolRegistry.register(new FileWriteTool(workingDir, sm));
    this.toolRegistry.register(new FileEditTool(workingDir, sm));
    this.toolRegistry.register(new MultiEditTool(workingDir, sm));
    this.toolRegistry.register(new FileDeleteTool(workingDir, sm));
    this.toolRegistry.register(new GlobSearchTool(workingDir));
    this.toolRegistry.register(new GrepSearchTool(workingDir));
    this.toolRegistry.register(new ListDirTool(workingDir, sm));
    this.toolRegistry.register(new ViewDiffTool(workingDir));
    this.toolRegistry.register(new ViewRepoMapTool(workingDir));
    this.toolRegistry.register(new CodebaseSearchTool(workingDir));
    this.toolRegistry.register(new ShellExecTool(workingDir, sm, this.permissionManager));
    this.toolRegistry.register(new FileRunTool(workingDir, sm));
    this.toolRegistry.register(new WebFetchTool(sm));
    this.toolRegistry.register(new WebSearchTool());

    // System info tool — gives the LLM live access to its permission/sandbox state
    this.toolRegistry.register(new SystemInfoTool(this.permissionManager, this.toolRegistry, sm));

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
    const { provider, model } = this.getConfig();
    const displayModel = model || getDefaultModel(provider) || provider;
    this.postMessage({ type: "configUpdated", provider, model: displayModel });
  }

  /** Send full config to the webview for the settings panel */
  private sendFullConfig() {
    const vsConfig = vscode.workspace.getConfiguration("cdoing");
    this.postMessage({
      type: "configData" as any,
      config: {
        provider: vsConfig.get<string>("provider") || "anthropic",
        model: vsConfig.get<string>("model") || "",
        customProviderName: vsConfig.get<string>("customProviderName") || "",
        customBaseURL: vsConfig.get<string>("customBaseURL") || "",
        apiKey: vsConfig.get<string>("apiKey") || "",
        authMethod: vsConfig.get<string>("authMethod") || "apiKey",
        temperature: vsConfig.get<number>("temperature") ?? 0,
        maxTokens: vsConfig.get<number>("maxTokens") ?? 8096,
        permissionMode: vsConfig.get<string>("permissionMode") || "ask",
      },
    });
    // Also send OAuth status
    this.postMessage({ type: "oauthStatus", ...getOAuthStatus() } as any);
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
  private async handleUserMessage(text: string, context?: Array<{ type: string; path: string; language?: string; content?: string; startLine?: number; endLine?: number }>) {
    if (text.startsWith("/")) {
      const [cmd, ...args] = text.split(" ");
      await this.handleCommand(cmd, args);
      return;
    }

    // Build full message with context attachments
    let fullMessage = text;
    if (context && context.length > 0) {
      const contextParts: string[] = [];
      for (const att of context) {
        if (att.type === "selection" && att.content) {
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
          // List folder structure
          const listing = this.listFolderStructure(att.path);
          contextParts.push(`Folder: \`${att.path}\`\n\`\`\`\n${listing}\n\`\`\``);
        }
      }
      if (contextParts.length > 0) {
        fullMessage = `${contextParts.join("\n\n")}\n\n${text}`;
      }
    }

    const tab = this.getTab();
    if (!tab) {
      this.createTab();
      setTimeout(() => this.handleUserMessage(fullMessage), 50);
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
        if (this.activeTabId === tabId) {
          this.postMessage({ type: "token", text: token });
        }
      },
      onToolCall: (name, input) => {
        if (this.activeTabId === tabId) {
          // Finalize any streamed text so it stays visible above the tool calls
          // (this is the LLM's thinking, e.g., "Let me search for the file...")
          this.postMessage({ type: "finalizeStreaming" });
          // Send full input JSON (up to 2KB) so the webview can render per-tool detail
          const inputStr = JSON.stringify(input);
          const description = (input as any).description as string | undefined;
          this.postMessage({
            type: "toolCall",
            name,
            input: inputStr.length > 2000 ? inputStr.substring(0, 2000) : inputStr,
            description,
          });
        }
      },
      onToolResult: (name, result, isError) => {
        if (this.activeTabId === tabId) {
          // Send more output (up to 3KB) so the webview can render trimmed IN/OUT
          this.postMessage({
            type: "toolResult",
            name,
            result: result.length > 3000 ? result.substring(0, 3000) + `\n… (${result.length - 3000} more chars)` : result,
            isError,
          });
        }
      },
      onComplete: () => {
        const t = this.tabs.get(tabId);
        if (t) {
          // Show accumulated usage once at the end
          if (this.activeTabId === tabId && totalTokens > 0) {
            const parts: string[] = [];
            if (totalInputTokens > 0 || totalOutputTokens > 0) {
              parts.push(`${totalInputTokens.toLocaleString()}→${totalOutputTokens.toLocaleString()}`);
            }
            parts.push(`${totalTokens.toLocaleString()} tokens`);
            if (totalCost > 0) parts.push(`$${totalCost.toFixed(4)}`);
            this.postMessage({ type: "usageInfo", text: parts.join(" · ") });
          }

          t.isProcessing = false;
          if (this.activeTabId === tabId) this.postMessage({ type: "endResponse" });
          // Auto-save conversation after each completed turn
          this.saveConversation(tabId);
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
        // Accumulate usage across turns instead of showing each one
        totalInputTokens += usage.inputTokens;
        totalOutputTokens += usage.outputTokens;
        totalTokens += usage.totalTokens;
        if (usage.cost !== undefined) totalCost += usage.cost;
      },
    };

    try {
      console.log("[cdoing] runTab — starting agent.run, oauthToken:", !!modelConfig.oauthToken, "apiKey:", !!modelConfig.apiKey);
      await tab.agent.run(text, callbacks);
      console.log("[cdoing] runTab — agent.run completed");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[cdoing] runTab — agent.run error:", msg);
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
