/**
 * Inline Autocomplete / Tab Completion — Ghost Text Suggestions
 *
 * Provides intelligent code completion suggestions as the user types.
 * Similar to GitHub Copilot — shows faded "ghost text" that can be
 * accepted with Tab or dismissed with Esc.
 *
 * How it works:
 *   1. User types code in the editor
 *   2. After a debounce period (300ms), we send context to the AI
 *   3. AI returns a completion suggestion
 *   4. We show it as ghost text (InlineCompletionItem)
 *   5. Tab accepts, Esc dismisses
 *
 * Key design decisions:
 *   - Uses a smaller/faster model by default (configurable)
 *   - Debounces to avoid hammering the API on every keystroke
 *   - Limits context to nearby code (not the entire file)
 *   - Caches recent completions to avoid duplicate requests
 *
 * Learning note: VS Code's InlineCompletionItemProvider API handles
 * all the ghost text rendering for us. We just need to return the
 * suggested text — VS Code shows it, handles Tab/Esc, and inserts it.
 */

import * as vscode from "vscode";
import { createModel, type ModelConfig } from "@cdoing/ai";

/** How long to wait after the user stops typing before requesting a completion */
const DEBOUNCE_MS = 300;

/** Max lines of context to send to the model (before + after cursor) */
const CONTEXT_LINES_BEFORE = 50;
const CONTEXT_LINES_AFTER = 10;

/** Max tokens for the completion response */
const MAX_COMPLETION_TOKENS = 256;

/** Cache for recent completions to avoid duplicate requests */
const completionCache = new Map<string, string>();
const MAX_CACHE_SIZE = 50;

/**
 * Register the inline autocomplete provider.
 *
 * @param context - VS Code extension context
 * @param getModelConfig - Function to get current model configuration
 */
export function registerInlineAutocomplete(
  context: vscode.ExtensionContext,
  getModelConfig: () => Partial<ModelConfig>,
): void {
  // Track whether autocomplete is enabled (can be toggled)
  let enabled = vscode.workspace
    .getConfiguration("cdoing")
    .get<boolean>("autocomplete.enabled", false);

  // The provider that generates completions
  const provider = new CdoingInlineCompletionProvider(getModelConfig);

  // Register with VS Code
  const disposable = vscode.languages.registerInlineCompletionItemProvider(
    { pattern: "**" }, // All file types
    provider,
  );
  context.subscriptions.push(disposable);

  // Toggle command
  context.subscriptions.push(
    vscode.commands.registerCommand("cdoing.toggleAutocomplete", () => {
      enabled = !enabled;
      provider.setEnabled(enabled);
      vscode.window.showInformationMessage(
        `Cdoing Autocomplete: ${enabled ? "Enabled" : "Disabled"}`,
      );
    }),
  );

  // Listen for config changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("cdoing.autocomplete")) {
        enabled = vscode.workspace
          .getConfiguration("cdoing")
          .get<boolean>("autocomplete.enabled", false);
        provider.setEnabled(enabled);
      }
    }),
  );
}

/**
 * Inline completion provider that generates AI-powered code suggestions.
 *
 * Learning note: VS Code calls provideInlineCompletionItems() whenever
 * the user types. We debounce these calls and return a Promise that
 * resolves to the completion suggestion (or an empty array).
 */
class CdoingInlineCompletionProvider implements vscode.InlineCompletionItemProvider {
  private enabled = false;
  private getModelConfig: () => Partial<ModelConfig>;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private lastRequestId = 0;

  constructor(getModelConfig: () => Partial<ModelConfig>) {
    this.getModelConfig = getModelConfig;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  async provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    context: vscode.InlineCompletionContext,
    token: vscode.CancellationToken,
  ): Promise<vscode.InlineCompletionItem[]> {
    if (!this.enabled) return [];

    // Only trigger on typing (not on explicit invocation for now)
    if (context.triggerKind === vscode.InlineCompletionTriggerKind.Automatic) {
      // Skip if the line is empty or just whitespace
      const lineText = document.lineAt(position.line).text;
      if (lineText.trim().length < 3) return [];
    }

    // Cancel any pending debounce
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    // Debounce: wait for user to stop typing
    const requestId = ++this.lastRequestId;

    return new Promise((resolve) => {
      this.debounceTimer = setTimeout(async () => {
        // Check if this request is still the latest
        if (requestId !== this.lastRequestId || token.isCancellationRequested) {
          resolve([]);
          return;
        }

        try {
          const completion = await this.getCompletion(document, position, token);
          if (!completion || token.isCancellationRequested) {
            resolve([]);
            return;
          }

          const item = new vscode.InlineCompletionItem(
            completion,
            new vscode.Range(position, position),
          );

          resolve([item]);
        } catch {
          resolve([]);
        }
      }, DEBOUNCE_MS);
    });
  }

  /**
   * Get a completion suggestion from the AI model.
   *
   * Learning note: We send a "fill-in-the-middle" style prompt
   * with code before and after the cursor. The model fills in
   * what should come next.
   */
  private async getCompletion(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
  ): Promise<string | null> {
    // Build context: lines before and after cursor
    const startLine = Math.max(0, position.line - CONTEXT_LINES_BEFORE);
    const endLine = Math.min(document.lineCount - 1, position.line + CONTEXT_LINES_AFTER);

    const beforeCursor = document.getText(
      new vscode.Range(startLine, 0, position.line, position.character),
    );
    const afterCursor = document.getText(
      new vscode.Range(position.line, position.character, endLine, document.lineAt(endLine).text.length),
    );

    // Check cache
    const cacheKey = `${document.uri.toString()}:${position.line}:${beforeCursor.slice(-100)}`;
    const cached = completionCache.get(cacheKey);
    if (cached) return cached;

    if (token.isCancellationRequested) return null;

    // Get model config — use autocomplete-specific model if configured
    const baseConfig = this.getModelConfig();
    const autocompleteModel = vscode.workspace
      .getConfiguration("cdoing")
      .get<string>("autocomplete.model");

    const modelConfig: Partial<ModelConfig> = {
      ...baseConfig,
      maxTokens: MAX_COMPLETION_TOKENS,
      temperature: 0,
    };
    if (autocompleteModel) {
      modelConfig.model = autocompleteModel;
    }

    const model = createModel(modelConfig);
    const language = document.languageId;
    const filePath = vscode.workspace.asRelativePath(document.uri);

    const prompt = [
      `Continue the ${language} code in ${filePath}. Return ONLY the completion text, nothing else.`,
      "",
      "Code before cursor:",
      "```",
      beforeCursor,
      "```",
      "",
      afterCursor ? `Code after cursor:\n\`\`\`\n${afterCursor}\n\`\`\`` : "",
      "",
      "Complete the code at the cursor position:",
    ].filter(Boolean).join("\n");

    try {
      const response = await model.invoke([
        { role: "system", content: "You are a code completion engine. Return ONLY the code that should be inserted at the cursor position. No explanations, no markdown fences." },
        { role: "user", content: prompt },
      ]);

      let result = typeof response.content === "string"
        ? response.content
        : "";

      // Clean up
      result = result
        .replace(/^```[\w]*\n/, "")
        .replace(/\n```\s*$/, "")
        .trim();

      if (!result) return null;

      // Cache the result
      if (completionCache.size >= MAX_CACHE_SIZE) {
        const firstKey = completionCache.keys().next().value;
        if (firstKey) completionCache.delete(firstKey);
      }
      completionCache.set(cacheKey, result);

      return result;
    } catch {
      return null;
    }
  }
}
