/**
 * extension.ts — VS Code Extension Entry Point
 *
 * Registers:
 *   1. Sidebar webview (left panel — quick access)
 *   2. Editor panel webview (right column — alongside code, like Claude Code)
 *   3. Commands, keybindings, context menu actions
 *   4. Inline diff preview for file edits
 *   5. Auto-save before agent reads/writes
 */

import * as vscode from "vscode";
import { ChatPanelProvider } from "./chat-panel-provider";
import { getWebviewContent } from "./webview-content";

/** Shared chat provider instance */
let chatProvider: ChatPanelProvider;

/** Editor panel instance (opened alongside code in the editor area) */
let editorPanel: vscode.WebviewPanel | undefined;

/** Pending file context to send once the webview is ready */
let pendingFileContext: any = null;

export function activate(context: vscode.ExtensionContext) {
  chatProvider = new ChatPanelProvider(context);

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
      // If editor panel exists, it shares the same provider
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

      // Focus the chat panel
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

    // ── Open File Button (editor title bar icon) ──
    // Opens chat alongside the current file, attaching file or selection as context.
    // If the panel is already open, creates a new tab for this file.
    vscode.commands.registerCommand("cdoing.openFile", () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;

      // Capture file info BEFORE opening the panel (editor may lose focus)
      const filePath = vscode.workspace.asRelativePath(editor.document.uri);
      const lang = editor.document.languageId;
      const selection = editor.selection;
      const selectedText = editor.document.getText(selection);
      const fullContent = editor.document.getText();

      const panelAlreadyOpen = !!editorPanel;

      // Open the editor panel alongside the file
      openEditorPanel(context);

      // Build the context attachment
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
        // Panel was already open — create a new tab, then attach context
        const fileName = filePath.split("/").pop() || filePath;
        chatProvider.createTab(fileName);
        setTimeout(() => chatProvider.postMessage(contextMsg), 150);
      } else {
        // Panel is newly created — queue context until webview is ready
        pendingFileContext = contextMsg;
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
  );

  // Config change listener
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("cdoing")) {
        chatProvider.refreshConfig();
      }
    })
  );

  // ── Floating Selection Actions (like Copilot's "Ask for Edits") ──
  // Shows a lightbulb/quick-fix menu when text is selected
  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider("*", new CdoingCodeActionProvider(), {
      providedCodeActionKinds: [vscode.CodeActionKind.RefactorRewrite],
    })
  );
}

/**
 * CodeAction provider — adds "Cdoing: Add to Chat", "Explain", "Fix", "Refactor"
 * to the lightbulb / quick-fix menu when text is selected.
 * This gives a floating toolbar similar to GitHub Copilot's "Ask for Edits".
 */
class CdoingCodeActionProvider implements vscode.CodeActionProvider {
  provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
  ): vscode.CodeAction[] {
    // Only show when text is selected
    if (range.isEmpty) return [];

    const actions: vscode.CodeAction[] = [];

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

// ── Editor Panel (opens alongside code) ─────────────────

/**
 * Opens the chat as an editor panel in column 2 (right of code).
 * This is the Claude Code approach — chat sits beside your code.
 */
function openEditorPanel(context: vscode.ExtensionContext) {
  if (editorPanel) {
    // Already open — just reveal it
    editorPanel.reveal(vscode.ViewColumn.Beside);
    return;
  }

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

  // Bridge: editor panel ↔ chat provider (share the same message handling)
  editorPanel.webview.onDidReceiveMessage(async (message) => {
    switch (message.type) {
      case "sendMessage":
        // Forward to chat provider, but also show in editor panel
        chatProvider.postMessage({ type: "startResponse" });
        // Route through the provider's handler (with context if present)
        (chatProvider as any).handleUserMessage?.(message.text, message.context);
        break;
      case "command":
        if (message.command === "openFile" && message.args?.[0]) {
          (chatProvider as any).openFileInEditor?.(message.args[0]);
        } else {
          (chatProvider as any).handleCommand?.(message.command, message.args);
        }
        break;
      case "newTab":
        chatProvider.createTab();
        break;
      case "switchTab":
        // Forward tab operations
        break;
      case "closeTab":
        break;
      case "pickFile":
        (chatProvider as any).pickFileForContext?.();
        break;
      case "pickFolder":
        (chatProvider as any).pickFolderForContext?.();
        break;
      case "searchFiles":
        (chatProvider as any).searchWorkspaceFiles?.(message.query);
        break;
      case "getActiveFile":
        (chatProvider as any).sendActiveFileAsContext?.();
        break;
      case "listHistory":
        (chatProvider as any).sendConversationList?.();
        break;
      case "resumeConversation":
        (chatProvider as any).resumeConversationById?.(message.id);
        break;
      case "deleteConversation":
        (chatProvider as any).deleteConversation?.(message.id);
        (chatProvider as any).sendConversationList?.();
        break;
      case "ready":
        chatProvider.postMessage({ type: "configUpdated", provider: "anthropic", model: "" });
        // Flush any pending file context from cdoing.openFile command
        if (pendingFileContext) {
          setTimeout(() => {
            if (pendingFileContext) {
              chatProvider.postMessage(pendingFileContext);
              pendingFileContext = null;
            }
          }, 100);
        }
        break;
    }
  });

  // Forward messages from provider to editor panel
  const originalPostMessage = chatProvider.postMessage.bind(chatProvider);
  chatProvider.postMessage = (msg: any) => {
    originalPostMessage(msg);
    editorPanel?.webview.postMessage(msg);
  };

  editorPanel.onDidDispose(() => {
    editorPanel = undefined;
    // Restore original postMessage
    chatProvider.postMessage = originalPostMessage;
  });
}

// ── Inline Diff Preview ─────────────────────────────────

/**
 * Show a diff view in VS Code's native diff editor.
 * Called when file_edit or file_write completes.
 */
async function showInlineDiff(filePath: string, originalContent: string, newContent: string) {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  const workDir = workspaceFolders?.[0]?.uri.fsPath || "";

  const originalUri = vscode.Uri.parse(`cdoing-diff:${filePath}?original`);
  const modifiedUri = vscode.Uri.file(
    filePath.startsWith("/") ? filePath : `${workDir}/${filePath}`
  );

  // Register a content provider for the original (before edit)
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

  // Clean up after a delay
  setTimeout(() => disposable.dispose(), 60000);
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

  // Attach the selection as context chip
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

  // If there's a prefix (e.g. "Explain this code:"), insert it in the input
  if (prefix) {
    chatProvider.postMessage({ type: "insertMessage", message: prefix.trim() });
  }

  // If editor panel is open, use it; otherwise focus sidebar
  if (editorPanel) {
    editorPanel.reveal(vscode.ViewColumn.Beside);
  } else {
    vscode.commands.executeCommand("cdoing.chatPanel.focus");
  }
}

export function deactivate() {
  editorPanel?.dispose();
}
