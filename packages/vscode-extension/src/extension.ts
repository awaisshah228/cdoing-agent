/**
 * extension.ts — VS Code Extension Entry Point
 *
 * This is the first file VS Code calls when the extension activates.
 * It registers:
 *   1. The chat panel webview (sidebar UI)
 *   2. All commands (new chat, select model, send selection, etc.)
 *   3. A config change listener to reload the agent when settings change
 *
 * Think of this as the "main()" of the extension.
 */

import * as vscode from "vscode";
import { ChatPanelProvider } from "./chat-panel-provider";

/** Single instance of the chat provider — shared across all commands */
let chatProvider: ChatPanelProvider;

/**
 * Called by VS Code when the extension is activated.
 * Sets up the sidebar webview, registers commands, and listens for config changes.
 */
export function activate(context: vscode.ExtensionContext) {
  chatProvider = new ChatPanelProvider(context);

  // Register the chat panel as a sidebar webview.
  // "cdoing.chatPanel" matches the view ID in package.json → contributes.views.
  // retainContextWhenHidden keeps the React app alive even when the panel is not visible,
  // so the user doesn't lose their chat history when switching tabs.
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("cdoing.chatPanel", chatProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    })
  );

  // --- Register all commands ---
  // Each command ID (e.g. "cdoing.newChat") is defined in package.json → contributes.commands.
  // VS Code wires the command palette and keybindings to these IDs.

  context.subscriptions.push(
    // Start a fresh chat — clears agent memory and tells the webview to reset
    vscode.commands.registerCommand("cdoing.newChat", () => {
      chatProvider.clearHistory();
      chatProvider.postMessage({ type: "clear" });
      vscode.window.showInformationMessage("Cdoing: New chat started");
    }),

    // Clear just the history (same as /clear in chat)
    vscode.commands.registerCommand("cdoing.clearHistory", () => {
      chatProvider.clearHistory();
      chatProvider.postMessage({ type: "clear" });
    }),

    // Show a quick-pick menu to switch provider and model.
    // This walks the user through: pick provider → enter base URL (if custom) → enter model name.
    // Then refreshes the agent with the new config.
    vscode.commands.registerCommand("cdoing.selectModel", async () => {
      const config = vscode.workspace.getConfiguration("cdoing");
      const providers = ["anthropic", "openai", "google", "custom"];

      // Step 1: Pick a provider
      const provider = await vscode.window.showQuickPick(providers, {
        placeHolder: "Select AI provider",
      });
      if (!provider) return; // User cancelled

      await config.update("provider", provider, vscode.ConfigurationTarget.Global);

      // Step 2: If custom, ask for the base URL (e.g. Ollama, Together, etc.)
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

      // Step 3: Ask for model name (optional — empty uses the provider's default)
      const modelName = await vscode.window.showInputBox({
        prompt: "Enter model name (leave empty for default)",
        placeHolder: getDefaultModelPlaceholder(provider),
        value: config.get<string>("model") || "",
      });
      if (modelName !== undefined) {
        await config.update("model", modelName, vscode.ConfigurationTarget.Global);
      }

      // Rebuild the agent with the new settings and update the webview's model badge
      chatProvider.refreshConfig();
      chatProvider.postMessage({
        type: "configUpdated",
        provider,
        model: modelName || getDefaultModelPlaceholder(provider),
      });
    }),

    // Open VS Code settings filtered to "cdoing" section
    vscode.commands.registerCommand("cdoing.openSettings", () => {
      vscode.commands.executeCommand(
        "workbench.action.openSettings",
        "cdoing"
      );
    }),

    // --- Editor selection commands ---
    // These grab the selected text from the active editor and send it to the chat panel.
    // Each one wraps the selection in a code block with the file path and language.

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
    })
  );

  // When the user changes any "cdoing.*" setting, rebuild the agent with the new config.
  // This means changes take effect immediately without restarting VS Code.
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("cdoing")) {
        chatProvider.refreshConfig();
      }
    })
  );
}

/** Returns the default model name for a provider — used as placeholder text */
function getDefaultModelPlaceholder(provider: string): string {
  switch (provider) {
    case "anthropic": return "claude-sonnet-4-20250514";
    case "openai": return "gpt-4o";
    case "google": return "gemini-2.0-flash";
    default: return "model-name";
  }
}

/**
 * Grabs the currently selected text from the editor, wraps it in a markdown
 * code block with the file path and language, and sends it to the chat panel.
 *
 * @param prefix - Optional instruction to prepend (e.g. "Explain this code:\n\n")
 */
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

  // Build a message like: "Explain this code:\n\n```typescript (src/app.ts)\n...\n```"
  const filePath = vscode.workspace.asRelativePath(editor.document.uri);
  const lang = editor.document.languageId;
  const message = `${prefix}\`\`\`${lang} (${filePath})\n${text}\n\`\`\``;

  // Send the message to the webview — it will appear in the input area
  chatProvider.postMessage({ type: "insertMessage", message });
  // Focus the chat panel so the user can see it
  vscode.commands.executeCommand("cdoing.chatPanel.focus");
}

/** Called by VS Code when the extension is deactivated (cleanup) */
export function deactivate() {}
