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
import type { ModelConfig } from "@cdoing/ai";

/** Shared chat provider instance */
let chatProvider: ChatPanelProvider;

/** Editor panel instance (opened alongside code in the editor area) */
let editorPanel: vscode.WebviewPanel | undefined;

/** Pending file context to send once the webview is ready */
let pendingFileContext: any = null;

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
      openEditorPanel(context);
      // No file/folder context — agent already knows the project path from system prompt
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
        const fileName = filePath.split("/").pop() || filePath;
        chatProvider.createTab(fileName);
        setTimeout(() => chatProvider.postMessage(contextMsg), 150);
      } else {
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
      }
    })
  );

  // ── Floating Selection Actions (like Copilot's "Ask for Edits") ──
  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider("*", new CdoingCodeActionProvider(), {
      providedCodeActionKinds: [vscode.CodeActionKind.RefactorRewrite],
    })
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

// ── Editor Panel (opens alongside code) ─────────────────

/**
 * Opens the chat as an editor panel in column 2 (right of code).
 */
function openEditorPanel(context: vscode.ExtensionContext) {
  if (editorPanel) {
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

  // Bridge: editor panel ↔ chat provider
  editorPanel.webview.onDidReceiveMessage(async (message) => {
    switch (message.type) {
      case "sendMessage":
        chatProvider.postMessage({ type: "startResponse" });
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
      case "getConfig":
        (chatProvider as any).sendFullConfig?.();
        break;
      case "updateConfig":
        (chatProvider as any).updateConfigFromWebview?.(message.config);
        break;
      case "openVscodeSettings":
        vscode.commands.executeCommand("workbench.action.openSettings", "cdoing");
        break;
      case "ready":
        chatProvider.postMessage({ type: "configUpdated", provider: "anthropic", model: "" });
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
    chatProvider.postMessage = originalPostMessage;
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

  if (prefix) {
    chatProvider.postMessage({ type: "insertMessage", message: prefix.trim() });
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
