/**
 * extension.ts — VS Code Extension Entry Point
 *
 * Registers:
 *   1. Sidebar webview (left panel — quick access)
 *   2. Editor panel webview (right column — alongside code, like Claude Code)
 *   3. Commands, keybindings, context menu actions
 *   4. Inline diff preview for file edits
 *   5. Inline edit mode (Cmd+I) — AI-powered code changes in place
 *   6. Inline autocomplete — ghost text suggestions as you type
 *   7. Image paste/attach support
 *   8. Context providers (@open, @problems, @terminal, etc.)
 *
 * Learning note: VS Code extensions activate lazily — this function
 * only runs when the user first interacts with our extension (opens
 * the panel, runs a command, etc.). We register everything upfront
 * but nothing runs until triggered.
 */

import * as vscode from "vscode";
import { ChatPanelProvider } from "./chat-panel-provider";
import { getWebviewContent } from "./webview-content";
import { registerInlineEdit } from "./inline-edit";
import { registerInlineAutocomplete } from "./inline-autocomplete";
import { CodebaseIndexer } from "@cdoing/core";
import type { ModelConfig } from "@cdoing/ai";

/** Sidebar chat provider instance */
let chatProvider: ChatPanelProvider;

/** Editor panel chat provider (independent from sidebar) */
let editorChatProvider: ChatPanelProvider | undefined;

/** Editor panel instance (opened alongside code in the editor area) */
let editorPanel: vscode.WebviewPanel | undefined;

/** Pending file context to send once the webview is ready */
let pendingFileContext: any = null;

/** Status bar item showing model + agent state */
let statusBarItem: vscode.StatusBarItem;

/**
 * Get the current model configuration from VS Code settings.
 * Used by inline edit and autocomplete features.
 *
 * Learning note: We read from VS Code settings rather than maintaining
 * a separate config object. This means changes in settings are
 * immediately reflected without restart.
 */
function getModelConfig(): Partial<ModelConfig> {
  const config = vscode.workspace.getConfiguration("cdoing");
  return {
    provider: config.get<string>("provider") || "anthropic",
    model: config.get<string>("model") || undefined,
    apiKey: config.get<string>("apiKey") || undefined,
    baseURL: config.get<string>("customBaseURL") || undefined,
    temperature: config.get<number>("temperature") || 0,
    maxTokens: config.get<number>("maxTokens") || 8096,
  };
}

export function activate(context: vscode.ExtensionContext) {
  chatProvider = new ChatPanelProvider(context);

  // ── Status Bar Item (shows model + agent processing state) ──
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = "cdoing.selectModel";
  statusBarItem.tooltip = "Cdoing Agent — Click to change model";
  updateStatusBar();
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  // Listen for agent state changes from the chat provider
  chatProvider.onDidChangeState(() => updateStatusBar());

  // Register sidebar webview (left activity bar — always available)
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("cdoing.chatPanel", chatProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    })
  );

  context.subscriptions.push(
    // ── New Chat ──
    vscode.commands.registerCommand("cdoing.newChat", () => {
      chatProvider.createTab();
    }),

    // ── Clear History ──
    vscode.commands.registerCommand("cdoing.clearHistory", () => {
      chatProvider.clearHistory();
      chatProvider.postMessage({ type: "clear" });
    }),

    // ── Open as Editor Panel (alongside code — like Claude Code) ──
    vscode.commands.registerCommand("cdoing.openEditorPanel", () => {
      openEditorPanel(context);
    }),

    // ── Open Chat Panel (right side, no file context — just project path) ──
    vscode.commands.registerCommand("cdoing.openChatPanel", () => {
      const panelAlreadyOpen = !!editorPanel;
      openEditorPanel(context);
      // If panel was already open, create a new independent tab
      if (panelAlreadyOpen && editorChatProvider) {
        editorChatProvider.createTab();
        editorPanel!.title = "Cdoing Chat";
      }
    }),

    // ── Focus Sidebar (when activity bar icon is clicked) ──
    vscode.commands.registerCommand("cdoing.focusSidebar", () => {
      vscode.commands.executeCommand("cdoing.chatPanel.focus");
    }),

    // ── Select Model ──
    vscode.commands.registerCommand("cdoing.selectModel", async () => {
      const config = vscode.workspace.getConfiguration("cdoing");
      const providers = ["anthropic", "openai", "google", "custom"];

      const provider = await vscode.window.showQuickPick(providers, {
        placeHolder: "Select AI provider",
      });
      if (!provider) return;

      await config.update("provider", provider, vscode.ConfigurationTarget.Global);

      if (provider === "custom") {
        const baseURL = await vscode.window.showInputBox({
          prompt: "Enter base URL for custom provider",
          placeHolder: "http://localhost:11434/v1",
          value: config.get<string>("customBaseURL") || "",
        });
        if (baseURL) {
          await config.update("customBaseURL", baseURL, vscode.ConfigurationTarget.Global);
        }
      }

      const modelName = await vscode.window.showInputBox({
        prompt: "Enter model name (leave empty for default)",
        placeHolder: getDefaultModelPlaceholder(provider),
        value: config.get<string>("model") || "",
      });
      if (modelName !== undefined) {
        await config.update("model", modelName, vscode.ConfigurationTarget.Global);
      }

      chatProvider.refreshConfig();
    }),

    // ── Open Settings ──
    vscode.commands.registerCommand("cdoing.openSettings", () => {
      vscode.commands.executeCommand("workbench.action.openSettings", "cdoing");
    }),

    // ── Add selected code to chat as context (just attach, don't send) ──
    vscode.commands.registerCommand("cdoing.addToChat", () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      const selection = editor.selection;
      const text = editor.document.getText(selection);
      if (!text) return;

      const filePath = vscode.workspace.asRelativePath(editor.document.uri);
      const lang = editor.document.languageId;

      chatProvider.postMessage({
        type: "contextAttached",
        attachment: {
          type: "selection",
          path: filePath,
          language: lang,
          content: text,
          startLine: selection.start.line + 1,
          endLine: selection.end.line + 1,
        },
      });

      vscode.commands.executeCommand("cdoing.chatPanel.focus");
    }),

    // ── Editor Selection Commands ──
    vscode.commands.registerCommand("cdoing.sendSelection", () => {
      sendEditorSelection();
    }),

    vscode.commands.registerCommand("cdoing.explainSelection", () => {
      sendEditorSelection("Explain this code:\n\n");
    }),

    vscode.commands.registerCommand("cdoing.refactorSelection", () => {
      sendEditorSelection("Refactor this code to improve it:\n\n");
    }),

    vscode.commands.registerCommand("cdoing.fixSelection", () => {
      sendEditorSelection("Fix any issues in this code:\n\n");
    }),

// ── Fix Diagnostics (triggered from quick-fix lightbulb) ──
    vscode.commands.registerCommand("cdoing.fixDiagnostics", (filePath: string, lang: string, code: string, errors: string, line: number) => {
      const provider = editorPanel ? editorChatProvider : chatProvider;
      provider?.postMessage({
        type: "contextAttached",
        attachment: {
          type: "selection",
          path: filePath,
          language: lang,
          content: code,
          startLine: Math.max(1, line - 3),
          endLine: line + 3,
        },
      });

      const prompt = `Fix the following ${errors.includes("\n") ? "issues" : "issue"} in \`${filePath}\` around line ${line}:\n\n${errors}`;
      provider?.postMessage({ type: "insertMessage", message: prompt });

      if (editorPanel) {
        editorPanel.reveal(vscode.ViewColumn.Beside);
      } else {
        vscode.commands.executeCommand("cdoing.chatPanel.focus");
      }
    }),

    // ── Open File Button (editor title bar icon) ──
    // If no file is open (e.g., Welcome screen), just open the chat panel
    vscode.commands.registerCommand("cdoing.openFile", () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        openEditorPanel(context);
        return;
      }

      const filePath = vscode.workspace.asRelativePath(editor.document.uri);
      const lang = editor.document.languageId;
      const selection = editor.selection;
      const selectedText = editor.document.getText(selection);
      const fullContent = editor.document.getText();
      const fileName = filePath.split("/").pop() || filePath;

      const panelAlreadyOpen = !!editorPanel;
      openEditorPanel(context);

      const attachment = selectedText
        ? {
            type: "selection" as const,
            path: filePath,
            language: lang,
            content: selectedText,
            startLine: selection.start.line + 1,
            endLine: selection.end.line + 1,
          }
        : {
            type: "file" as const,
            path: filePath,
            language: lang,
            content: fullContent,
          };

      const contextMsg = { type: "contextAttached", attachment };

      if (panelAlreadyOpen) {
        // Create a new tab on the EDITOR panel provider (not sidebar)
        editorChatProvider!.createTab(fileName);
        editorPanel!.title = `Cdoing — ${fileName}`;
        setTimeout(() => editorChatProvider!.postMessage(contextMsg), 150);
      } else {
        editorPanel!.title = `Cdoing — ${fileName}`;
        pendingFileContext = contextMsg;
      }
    }),

    // ── Paste Image — attach image from clipboard to chat ──
    // Learning note: This intercepts the paste command and checks if
    // the clipboard contains an image. If so, we save it as a temp
    // file and attach it as context. Otherwise, we let VS Code handle
    // the paste normally.
    vscode.commands.registerCommand("cdoing.pasteImage", async () => {
      try {
        const clipboardContent = await vscode.env.clipboard.readText();
        // If clipboard has text, it's not an image paste
        if (clipboardContent) return;

        // For actual image pasting, the webview handles it via
        // the browser's paste event and FileReader API
        vscode.window.showInformationMessage(
          "Paste images directly in the Cdoing chat panel"
        );
      } catch {
        // Clipboard API may not support image reading
      }
    }),

    // ── Attach Image File — pick an image to send to chat ──
    vscode.commands.registerCommand("cdoing.attachImage", async () => {
      const result = await vscode.window.showOpenDialog({
        canSelectMany: false,
        filters: {
          Images: ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"],
        },
        title: "Select an image to attach",
      });

      if (result && result[0]) {
        const filePath = vscode.workspace.asRelativePath(result[0]);
        chatProvider.postMessage({
          type: "contextAttached",
          attachment: {
            type: "file",
            path: filePath,
            language: "image",
          },
        });
        vscode.commands.executeCommand("cdoing.chatPanel.focus");
      }
    }),

    // ── Move Panel Commands ──
    vscode.commands.registerCommand("cdoing.moveToSecondarySidebar", () => {
      vscode.commands.executeCommand("cdoing.chatPanel.focus");
      vscode.commands.executeCommand("workbench.action.moveActivityBarEntryToSecondarySidebar", "cdoing");
    }),

    vscode.commands.registerCommand("cdoing.moveToPrimarySidebar", () => {
      vscode.commands.executeCommand("cdoing.chatPanel.focus");
      vscode.commands.executeCommand("workbench.action.moveActivityBarEntryToPrimarySidebar", "cdoing");
    }),

    // ── Show Diff (for file edits) ──
    vscode.commands.registerCommand("cdoing.showDiff", async (filePath: string, originalContent: string, newContent: string) => {
      await showInlineDiff(filePath, originalContent, newContent);
    }),

    // ── Index Codebase (Cmd+Shift+I) ──
    vscode.commands.registerCommand("cdoing.indexCodebase", () => {
      runIndexCommand(false);
    }),

    vscode.commands.registerCommand("cdoing.indexCodebaseFull", () => {
      runIndexCommand(true);
    }),

    vscode.commands.registerCommand("cdoing.indexCodebaseStats", async () => {
      const workingDir = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!workingDir) {
        vscode.window.showWarningMessage("No workspace folder open.");
        return;
      }
      const indexer = new CodebaseIndexer(workingDir);
      const stats = indexer.getStats();
      const ago = stats.lastIndexed > 0 ? `${Math.round((Date.now() - stats.lastIndexed) / 60000)} min ago` : "never";
      indexer.close();
      vscode.window.showInformationMessage(
        `Index: ${stats.totalFiles} files, ${stats.totalChunks} chunks, ${stats.ftsEntries} FTS entries, ${(stats.indexSizeBytes / 1024).toFixed(1)} KB, last indexed ${ago}`
      );
    }),
  );

  // ── Register Inline Edit Mode (Cmd+I / Ctrl+I) ────────
  // Allows users to select code → Cmd+I → type instruction → see diff
  registerInlineEdit(context, getModelConfig);

  // ── Register Inline Autocomplete (Tab completion) ──────
  // Ghost text suggestions as user types, accepted with Tab
  registerInlineAutocomplete(context, getModelConfig);

  // Config change listener
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("cdoing")) {
        chatProvider.refreshConfig();
        updateStatusBar();
      }
    })
  );

  // ── Floating Selection Actions (like Copilot's "Ask for Edits") ──
  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider("*", new CdoingCodeActionProvider(), {
      providedCodeActionKinds: [vscode.CodeActionKind.RefactorRewrite],
    })
  );

  // ── Diagnostics Code Actions (Fix with AI on errors/warnings) ──
  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider("*", new CdoingDiagnosticsActionProvider(), {
      providedCodeActionKinds: [vscode.CodeActionKind.QuickFix],
    })
  );

  // ── Terminal Context Sharing (opencode-style @file#L10-20) ──
  context.subscriptions.push(
    vscode.commands.registerCommand("cdoing.addFileRefToChat", () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      const filePath = vscode.workspace.asRelativePath(editor.document.uri);
      const selection = editor.selection;
      let ref = `@${filePath}`;
      if (!selection.isEmpty) {
        const startLine = selection.start.line + 1;
        const endLine = selection.end.line + 1;
        ref += startLine === endLine ? `#L${startLine}` : `#L${startLine}-${endLine}`;
      }
      chatProvider.postMessage({
        type: "insertMessage",
        message: ref,
      });
      if (editorPanel) {
        editorPanel.reveal(vscode.ViewColumn.Beside);
      } else {
        vscode.commands.executeCommand("cdoing.chatPanel.focus");
      }
    }),

    // ── Focus Chat (Cmd+L) ──
    vscode.commands.registerCommand("cdoing.focusChat", () => {
      if (editorPanel) {
        editorPanel.reveal(vscode.ViewColumn.Beside);
      } else {
        vscode.commands.executeCommand("cdoing.chatPanel.focus");
      }
    }),
  );
}

/**
 * CodeAction provider — adds "Cdoing: Add to Chat", "Explain", "Fix",
 * "Refactor", and "Inline Edit" to the lightbulb / quick-fix menu.
 *
 * Learning note: CodeActionProviders register actions that appear in the
 * lightbulb menu when text is selected. This is the same mechanism that
 * ESLint uses for its "Quick Fix" suggestions.
 */
class CdoingCodeActionProvider implements vscode.CodeActionProvider {
  provideCodeActions(
    _document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
  ): vscode.CodeAction[] {
    if (range.isEmpty) return [];

    const actions: vscode.CodeAction[] = [];

    // Inline Edit (Cmd+I) — most prominent action
    const inlineEdit = new vscode.CodeAction(
      "Cdoing: Inline Edit (Cmd+I)",
      vscode.CodeActionKind.RefactorRewrite
    );
    inlineEdit.command = { command: "cdoing.inlineEdit", title: "Inline Edit" };
    inlineEdit.isPreferred = true; // Show as primary action
    actions.push(inlineEdit);

    const addToChat = new vscode.CodeAction(
      "Cdoing: Add to Chat",
      vscode.CodeActionKind.RefactorRewrite
    );
    addToChat.command = { command: "cdoing.addToChat", title: "Add to Chat" };
    actions.push(addToChat);

    const explain = new vscode.CodeAction(
      "Cdoing: Explain",
      vscode.CodeActionKind.RefactorRewrite
    );
    explain.command = { command: "cdoing.explainSelection", title: "Explain" };
    actions.push(explain);

    const fix = new vscode.CodeAction(
      "Cdoing: Fix",
      vscode.CodeActionKind.RefactorRewrite
    );
    fix.command = { command: "cdoing.fixSelection", title: "Fix" };
    actions.push(fix);

    const refactor = new vscode.CodeAction(
      "Cdoing: Refactor",
      vscode.CodeActionKind.RefactorRewrite
    );
    refactor.command = { command: "cdoing.refactorSelection", title: "Refactor" };
    actions.push(refactor);

    return actions;
  }
}

// ── Index Codebase ───────────────────────────────────────

/**
 * Run codebase indexing with a VS Code progress notification.
 */
function runIndexCommand(full: boolean) {
  const workingDir = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workingDir) {
    vscode.window.showWarningMessage("No workspace folder open.");
    return;
  }

  vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: full ? "Rebuilding codebase index..." : "Indexing codebase...",
      cancellable: false,
    },
    async (progress) => {
      const indexer = new CodebaseIndexer(workingDir);

      if (full) {
        indexer.clearIndex();
      }

      const result = await indexer.index((p) => {
        progress.report({ message: p.message });
      });

      indexer.close();

      vscode.window.showInformationMessage(
        `Indexed: +${result.added} new, ~${result.updated} updated, -${result.deleted} deleted (${result.totalChunks} chunks)`
      );
    },
  );
}

// ── Editor Panel (opens alongside code) ─────────────────

/**
 * Opens the chat as an editor panel in column 2 (right of code).
 * Each editor panel gets its own independent ChatPanelProvider instance.
 */
function openEditorPanel(context: vscode.ExtensionContext) {
  if (editorPanel) {
    editorPanel.reveal(vscode.ViewColumn.Beside);
    return;
  }

  // Create a dedicated chat provider for this editor panel (independent from sidebar)
  editorChatProvider = new ChatPanelProvider(context);

  editorPanel = vscode.window.createWebviewPanel(
    "cdoing.editorPanel",
    "Cdoing Chat",
    vscode.ViewColumn.Beside,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [context.extensionUri],
    }
  );

  editorPanel.iconPath = vscode.Uri.joinPath(context.extensionUri, "media", "icon.svg");
  editorPanel.webview.html = getWebviewContent(editorPanel.webview, context.extensionUri);

  // Resolve the webview for the editor chat provider
  editorChatProvider.resolveWebviewView(
    {
      webview: editorPanel.webview,
      visible: true,
      onDidChangeVisibility: new vscode.EventEmitter<boolean>().event,
      onDidDispose: editorPanel.onDidDispose,
      show: () => {},
    } as any,
    {} as any,
    {} as any
  );

  // Handle messages from the editor panel webview
  editorPanel.webview.onDidReceiveMessage(async (message) => {
    switch (message.type) {
      case "sendMessage":
        editorChatProvider!.postMessage({ type: "startResponse" });
        (editorChatProvider as any).handleUserMessage?.(message.text, message.context);
        break;
      case "command":
        if (message.command === "openFile" && message.args?.[0]) {
          (editorChatProvider as any).openFileInEditor?.(message.args[0]);
        } else {
          (editorChatProvider as any).handleCommand?.(message.command, message.args);
        }
        break;
      case "newTab":
        editorChatProvider!.createTab();
        break;
      case "switchTab":
        break;
      case "closeTab":
        break;
      case "pickFile":
        (editorChatProvider as any).pickFileForContext?.();
        break;
      case "pickFolder":
        (editorChatProvider as any).pickFolderForContext?.();
        break;
      case "searchFiles":
        (editorChatProvider as any).searchWorkspaceFiles?.(message.query);
        break;
      case "getActiveFile":
        (editorChatProvider as any).sendActiveFileAsContext?.();
        break;
      case "listHistory":
        (editorChatProvider as any).sendConversationList?.();
        break;
      case "resumeConversation":
        (editorChatProvider as any).resumeConversationById?.(message.id);
        break;
      case "deleteConversation":
        (editorChatProvider as any).deleteConversation?.(message.id);
        (editorChatProvider as any).sendConversationList?.();
        break;
      case "getConfig":
        (editorChatProvider as any).sendFullConfig?.();
        break;
      case "updateConfig":
        (editorChatProvider as any).updateConfigFromWebview?.(message.config);
        break;
      case "openVscodeSettings":
        vscode.commands.executeCommand("workbench.action.openSettings", "cdoing");
        break;
      case "ready":
        editorChatProvider!.postMessage({ type: "configUpdated", provider: "anthropic", model: "" });
        if (pendingFileContext) {
          setTimeout(() => {
            if (pendingFileContext) {
              editorChatProvider!.postMessage(pendingFileContext);
              pendingFileContext = null;
            }
          }, 100);
        }
        break;
    }
  });

  editorPanel.onDidDispose(() => {
    editorPanel = undefined;
    editorChatProvider = undefined;
  });
}

// ── Inline Diff Preview ─────────────────────────────────

/**
 * Show a diff view in VS Code's native diff editor.
 *
 * Learning note: We use a virtual document (cdoing-diff: URI scheme)
 * to show the "before" state. VS Code's built-in diff editor handles
 * all the highlighting, scrolling, and side-by-side comparison.
 */
async function showInlineDiff(filePath: string, originalContent: string, newContent: string) {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  const workDir = workspaceFolders?.[0]?.uri.fsPath || "";

  const originalUri = vscode.Uri.parse(`cdoing-diff:${filePath}?original`);
  const modifiedUri = vscode.Uri.file(
    filePath.startsWith("/") ? filePath : `${workDir}/${filePath}`
  );

  const provider = new (class implements vscode.TextDocumentContentProvider {
    provideTextDocumentContent(): string {
      return originalContent;
    }
  })();

  const disposable = vscode.workspace.registerTextDocumentContentProvider("cdoing-diff", provider);

  await vscode.commands.executeCommand(
    "vscode.diff",
    originalUri,
    modifiedUri,
    `${filePath} (Cdoing Edit)`,
    { preview: true }
  );

  setTimeout(() => disposable.dispose(), 60000);
}

// ── Status Bar ───────────────────────────────────────────

function updateStatusBar() {
  if (!statusBarItem) return;
  const config = vscode.workspace.getConfiguration("cdoing");
  const provider = config.get<string>("provider") || "anthropic";
  const model = config.get<string>("model") || getDefaultModelPlaceholder(provider);
  const shortModel = model.length > 20 ? model.substring(0, 18) + ".." : model;

  if (chatProvider?.isProcessing) {
    statusBarItem.text = `$(loading~spin) Cdoing: ${shortModel}`;
    statusBarItem.tooltip = "Cdoing Agent — Processing...";
    statusBarItem.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground");
  } else {
    statusBarItem.text = `$(comment-discussion) Cdoing: ${shortModel}`;
    statusBarItem.tooltip = "Cdoing Agent — Click to change model";
    statusBarItem.backgroundColor = undefined;
  }
}

// ── Diagnostics Code Actions ─────────────────────────────

/**
 * Provides "Fix with Cdoing" quick-fix actions on lines with diagnostics.
 * When a file has errors/warnings, this appears in the lightbulb menu.
 */
class CdoingDiagnosticsActionProvider implements vscode.CodeActionProvider {
  provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
  ): vscode.CodeAction[] {
    const diagnostics = vscode.languages.getDiagnostics(document.uri)
      .filter(d => d.range.intersection(range));

    if (diagnostics.length === 0) return [];

    const actions: vscode.CodeAction[] = [];

    // Single "Fix with Cdoing" action for all diagnostics on the range
    const errorMessages = diagnostics
      .map(d => `${d.severity === vscode.DiagnosticSeverity.Error ? "Error" : "Warning"}: ${d.message}`)
      .join("\n");

    const fix = new vscode.CodeAction(
      `Cdoing: Fix ${diagnostics.length > 1 ? `${diagnostics.length} issues` : "this issue"}`,
      vscode.CodeActionKind.QuickFix
    );

    // Get the code around the diagnostic range for context
    const startLine = Math.max(0, range.start.line - 3);
    const endLine = Math.min(document.lineCount - 1, range.end.line + 3);
    const contextRange = new vscode.Range(startLine, 0, endLine, document.lineAt(endLine).text.length);
    const codeContext = document.getText(contextRange);
    const filePath = vscode.workspace.asRelativePath(document.uri);
    const lang = document.languageId;

    fix.command = {
      command: "cdoing.fixDiagnostics",
      title: "Fix with Cdoing",
      arguments: [filePath, lang, codeContext, errorMessages, range.start.line + 1],
    };
    fix.diagnostics = diagnostics;
    actions.push(fix);

    return actions;
  }
}

// ── Helpers ──────────────────────────────────────────────

function getDefaultModelPlaceholder(provider: string): string {
  switch (provider) {
    case "anthropic": return "claude-sonnet-4-20250514";
    case "openai": return "gpt-4o";
    case "google": return "gemini-2.0-flash";
    default: return "model-name";
  }
}

function sendEditorSelection(prefix = "") {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage("No active editor");
    return;
  }

  const selection = editor.selection;
  const text = editor.document.getText(selection);
  if (!text) {
    vscode.window.showWarningMessage("No text selected");
    return;
  }

  const filePath = vscode.workspace.asRelativePath(editor.document.uri);
  const lang = editor.document.languageId;

  // Route to editor panel if open, otherwise sidebar
  const provider = editorPanel ? editorChatProvider : chatProvider;

  provider?.postMessage({
    type: "contextAttached",
    attachment: {
      type: "selection",
      path: filePath,
      language: lang,
      content: text,
      startLine: selection.start.line + 1,
      endLine: selection.end.line + 1,
    },
  });

  if (prefix) {
    provider?.postMessage({ type: "insertMessage", message: prefix.trim() });
  }

  if (editorPanel) {
    editorPanel.reveal(vscode.ViewColumn.Beside);
  } else {
    vscode.commands.executeCommand("cdoing.chatPanel.focus");
  }
}

export function deactivate() {
  editorPanel?.dispose();
}
