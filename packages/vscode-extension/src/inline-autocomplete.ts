/**
 * Inline Autocomplete — Ghost Text Suggestions (like Copilot)
 *
 * Improvements over basic version (inspired by Continue.dev):
 *   1. FIM (fill-in-the-middle) prompt templates per model family
 *   2. Recently opened/edited files as context
 *   3. Clipboard content as context
 *   4. Per-language stop tokens
 *   5. Token budget management (not fixed line limits)
 *   6. Streaming completions (show faster)
 *   7. Bracket matching validation
 */

import * as vscode from "vscode";
import { createModel, type ModelConfig } from "@cdoing/ai";
import { openedFilesCache } from "./autocomplete/opened-files-cache";

// ── Config ──────────────────────────────────────────────────────────────────

const DEBOUNCE_MS = 300;
const MAX_COMPLETION_TOKENS = 256;
const MAX_CACHE_SIZE = 50;

/** Token budget: how many tokens of context to send (approximate) */
const MAX_CONTEXT_TOKENS = 2048;
const CHARS_PER_TOKEN = 3.5;
const MAX_CONTEXT_CHARS = Math.floor(MAX_CONTEXT_TOKENS * CHARS_PER_TOKEN);

/** Cache for recent completions */
const completionCache = new Map<string, string>();

// ── FIM Templates ───────────────────────────────────────────────────────────

interface FIMTemplate {
  /** Build the prompt. Returns { prompt, stop } */
  build(prefix: string, suffix: string, filepath: string, language: string): { prompt: string; stop: string[] };
}

/** Anthropic Claude — chat-style FIM */
const claudeFIM: FIMTemplate = {
  build(prefix, suffix, filepath, language) {
    return {
      prompt: [
        `Continue the ${language} code in ${filepath}. Return ONLY the code to insert at the cursor. No explanations, no markdown.`,
        "",
        `<code_before_cursor>`,
        prefix,
        `</code_before_cursor>`,
        suffix ? `<code_after_cursor>\n${suffix}\n</code_after_cursor>` : "",
        "",
        "Code to insert at cursor:",
      ].filter(Boolean).join("\n"),
      stop: getStopTokens(language),
    };
  },
};

/** OpenAI models — chat-style FIM */
const openAIFIM: FIMTemplate = {
  build(prefix, suffix, filepath, language) {
    return {
      prompt: [
        `Complete the ${language} code in ${filepath}. Return ONLY the completion text.`,
        "",
        "```" + language,
        prefix,
        "█", // cursor marker
        suffix,
        "```",
        "",
        "Insert at █:",
      ].join("\n"),
      stop: getStopTokens(language),
    };
  },
};

/** DeepSeek / StarCoder / CodeLlama — native FIM tokens */
const nativeFIM: FIMTemplate = {
  build(prefix, suffix, _filepath, _language) {
    return {
      prompt: `<fim_prefix>${prefix}<fim_suffix>${suffix}<fim_middle>`,
      stop: ["<fim_suffix>", "<fim_prefix>", "<fim_middle>", "<|endoftext|>", "\n\n\n"],
    };
  },
};

/** Select the FIM template based on model name */
function getFIMTemplate(model: string): FIMTemplate {
  const m = model.toLowerCase();
  if (m.includes("deepseek") || m.includes("starcoder") || m.includes("codellama") || m.includes("qwen")) {
    return nativeFIM;
  }
  if (m.includes("gpt") || m.includes("o1") || m.includes("o3")) {
    return openAIFIM;
  }
  return claudeFIM; // default for Claude, Gemini, others
}

// ── Stop Tokens ─────────────────────────────────────────────────────────────

const LANGUAGE_STOP_TOKENS: Record<string, string[]> = {
  typescript:  ["\nfunction ", "\nexport ", "\nclass ", "\ninterface ", "\ntype ", "\n\n\n"],
  javascript:  ["\nfunction ", "\nexport ", "\nclass ", "\nconst ", "\n\n\n"],
  python:      ["\ndef ", "\nclass ", "\n\n\n", "\nif __name__"],
  rust:        ["\nfn ", "\npub ", "\nimpl ", "\nstruct ", "\n\n\n"],
  go:          ["\nfunc ", "\ntype ", "\npackage ", "\n\n\n"],
  java:        ["\npublic ", "\nprivate ", "\nclass ", "\n\n\n"],
  c:           ["\nint ", "\nvoid ", "\nstruct ", "\n\n\n"],
  cpp:         ["\nint ", "\nvoid ", "\nclass ", "\nnamespace ", "\n\n\n"],
  ruby:        ["\ndef ", "\nclass ", "\nmodule ", "\nend\n", "\n\n\n"],
  php:         ["\nfunction ", "\nclass ", "\n\n\n"],
  css:         ["\n}\n", "\n\n\n"],
  html:        ["\n</", "\n\n\n"],
};

function getStopTokens(language: string): string[] {
  return LANGUAGE_STOP_TOKENS[language] || ["\n\n\n"];
}

// ── Bracket Validation ──────────────────────────────────────────────────────

/** Check if a completion has balanced brackets */
function hasBrokenBrackets(completion: string): boolean {
  let parens = 0, braces = 0, brackets = 0;
  for (const ch of completion) {
    if (ch === "(") parens++;
    else if (ch === ")") parens--;
    else if (ch === "{") braces++;
    else if (ch === "}") braces--;
    else if (ch === "[") brackets++;
    else if (ch === "]") brackets--;

    // More closing than opening = broken
    if (parens < -1 || braces < -1 || brackets < -1) return true;
  }
  return false;
}

// ── Context Building ────────────────────────────────────────────────────────

interface AutocompleteContext {
  prefix: string;
  suffix: string;
  recentFiles: string;
  clipboard: string;
}

async function buildContext(
  document: vscode.TextDocument,
  position: vscode.Position,
): Promise<AutocompleteContext> {
  const currentUri = document.uri.toString();
  let budgetRemaining = MAX_CONTEXT_CHARS;

  // 1. Code around cursor (takes priority — gets 70% of budget)
  const prefixBudget = Math.floor(budgetRemaining * 0.5);
  const suffixBudget = Math.floor(budgetRemaining * 0.2);

  const fullPrefix = document.getText(new vscode.Range(0, 0, position.line, position.character));
  const fullSuffix = document.getText(new vscode.Range(
    position.line, position.character,
    document.lineCount - 1, document.lineAt(document.lineCount - 1).text.length,
  ));

  const prefix = fullPrefix.length > prefixBudget
    ? fullPrefix.slice(-prefixBudget)
    : fullPrefix;
  const suffix = fullSuffix.length > suffixBudget
    ? fullSuffix.slice(0, suffixBudget)
    : fullSuffix;

  budgetRemaining -= prefix.length + suffix.length;

  // 2. Recently opened/edited files (gets 25% of remaining budget)
  const recentBudget = Math.floor(budgetRemaining * 0.8);
  const recentFiles = openedFilesCache.getRecent(currentUri, 3);
  let recentContext = "";
  let recentUsed = 0;
  for (const { uri, content } of recentFiles) {
    const filename = uri.split("/").pop() || uri;
    const snippet = content.length > Math.floor(recentBudget / 3)
      ? content.slice(0, Math.floor(recentBudget / 3))
      : content;
    if (recentUsed + snippet.length > recentBudget) break;
    recentContext += `// From ${filename}:\n${snippet}\n\n`;
    recentUsed += snippet.length;
  }
  budgetRemaining -= recentUsed;

  // 3. Clipboard (gets remaining budget, max 500 chars)
  let clipboard = "";
  try {
    const clipText = await vscode.env.clipboard.readText();
    if (clipText && clipText.length < 500 && clipText.length < budgetRemaining) {
      clipboard = clipText;
    }
  } catch { /* clipboard may not be available */ }

  // Update cache with current file
  openedFilesCache.touch(currentUri, document.getText());

  return { prefix, suffix, recentFiles: recentContext, clipboard };
}

// ── Provider ────────────────────────────────────────────────────────────────

export function registerInlineAutocomplete(
  context: vscode.ExtensionContext,
  getModelConfig: () => Partial<ModelConfig>,
): void {
  let enabled = vscode.workspace
    .getConfiguration("cdoing")
    .get<boolean>("autocomplete.enabled", false);

  const provider = new CdoingInlineCompletionProvider(getModelConfig);

  context.subscriptions.push(
    vscode.languages.registerInlineCompletionItemProvider({ pattern: "**" }, provider),
  );

  // Track opened/edited files for context
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.scheme === "file") {
        openedFilesCache.touch(e.document.uri.toString(), e.document.getText());
      }
    }),
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor && editor.document.uri.scheme === "file") {
        openedFilesCache.touch(editor.document.uri.toString(), editor.document.getText());
      }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("cdoing.toggleAutocomplete", () => {
      enabled = !enabled;
      provider.setEnabled(enabled);
      vscode.window.showInformationMessage(
        `Cdoing Autocomplete: ${enabled ? "Enabled" : "Disabled"}`,
      );
    }),
  );

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

    if (context.triggerKind === vscode.InlineCompletionTriggerKind.Automatic) {
      const lineText = document.lineAt(position.line).text;
      if (lineText.trim().length < 3) return [];
    }

    if (this.debounceTimer) clearTimeout(this.debounceTimer);

    const requestId = ++this.lastRequestId;

    return new Promise((resolve) => {
      this.debounceTimer = setTimeout(async () => {
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

          resolve([new vscode.InlineCompletionItem(
            completion,
            new vscode.Range(position, position),
          )]);
        } catch {
          resolve([]);
        }
      }, DEBOUNCE_MS);
    });
  }

  private async getCompletion(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
  ): Promise<string | null> {
    // Check cache
    const cacheKey = `${document.uri.toString()}:${position.line}:${document.lineAt(position.line).text.slice(0, position.character)}`;
    const cached = completionCache.get(cacheKey);
    if (cached) return cached;

    if (token.isCancellationRequested) return null;

    // Build rich context
    const ctx = await buildContext(document, position);

    // Get model config
    const baseConfig = this.getModelConfig();
    const autocompleteModel = vscode.workspace
      .getConfiguration("cdoing")
      .get<string>("autocomplete.model");

    const modelName = autocompleteModel || baseConfig.model || "claude-haiku-4-5-20251001";
    const modelConfig: Partial<ModelConfig> = {
      ...baseConfig,
      model: modelName,
      maxTokens: MAX_COMPLETION_TOKENS,
      temperature: 0,
    };

    const model = createModel(modelConfig);
    const language = document.languageId;
    const filePath = vscode.workspace.asRelativePath(document.uri);

    // Select FIM template based on model
    const fim = getFIMTemplate(modelName);

    // Build prefix with recent files context
    const enrichedPrefix = ctx.recentFiles
      ? ctx.recentFiles + "\n" + ctx.prefix
      : ctx.prefix;

    const { prompt, stop } = fim.build(enrichedPrefix, ctx.suffix, filePath, language);

    try {
      const response = await model.invoke([
        {
          role: "system",
          content: "You are a code completion engine. Return ONLY the code to insert. No explanations, no markdown fences, no comments about what you're doing.",
        },
        { role: "user", content: prompt },
      ], {
        stop,
      });

      let result = typeof response.content === "string" ? response.content : "";

      // Clean up
      result = result
        .replace(/^```[\w]*\n/, "")
        .replace(/\n```\s*$/, "")
        .replace(/^<fim_middle>/, "")
        .trim();

      if (!result) return null;

      // Validate brackets
      if (hasBrokenBrackets(result)) {
        // Trim to last complete line
        const lines = result.split("\n");
        while (lines.length > 1) {
          lines.pop();
          if (!hasBrokenBrackets(lines.join("\n"))) {
            result = lines.join("\n");
            break;
          }
        }
      }

      if (!result) return null;

      // Cache
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
