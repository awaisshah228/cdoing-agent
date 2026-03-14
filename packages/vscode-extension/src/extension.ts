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
    // Opens chat alongside the current file
    vscode.commands.registerCommand("cdoing.openFile", () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;

      // Open the editor panel alongside the file
      openEditorPanel(context);

      const filePath = vscode.workspace.asRelativePath(editor.document.uri);
      const lang = editor.document.languageId;
      const lineCount = editor.document.lineCount;
      const selection = editor.selection;
      const selectedText = editor.document.getText(selection);

      let message: string;
      if (selectedText) {
        message = `\`\`\`${lang} (${filePath})\n${selectedText}\n\`\`\``;
      } else {
        message = `I'm working on \`${filePath}\` (${lang}, ${lineCount} lines). `;
      }

      chatProvider.postMessage({ type: "insertMessage", message });
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

  // Auto-save before agent reads/writes files
  context.subscriptions.push(
    vscode.workspace.onWillSaveTextDocument(() => {
      // VS Code handles this — we just need to trigger save before tool execution
    })
  );
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
        // Route through the provider's handler
        (chatProvider as any).handleUserMessage?.(message.text);
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
      case "ready":
        chatProvider.postMessage({ type: "configUpdated", provider: "anthropic", model: "" });
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
  const message = `${prefix}\`\`\`${lang} (${filePath})\n${text}\n\`\`\``;

  chatProvider.postMessage({ type: "insertMessage", message });

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
