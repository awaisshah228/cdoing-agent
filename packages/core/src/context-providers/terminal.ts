/**
 * Terminal Context Provider — @terminal
 *
 * Injects recent terminal output into the conversation.
 * Useful when the user wants the AI to analyze command output,
 * debug errors, or understand build/test results.
 *
 * How it works:
 *   1. In VS Code: captures output from the integrated terminal
 *   2. In CLI: captures the last shell command output
 *   3. Formats it with a clear header for the LLM
 *
 * Learning note: Terminal output is inherently ephemeral — we only
 * capture what's available at resolve time. In VS Code, this comes
 * from the Terminal API; in CLI, from the last !command output.
 */

import type { ContextProvider, ContextResult, ContextResolveOptions } from "./types";

/** Default max characters for terminal output (prevents context window overflow) */
const DEFAULT_MAX_CHARS = 10000;

export class TerminalContextProvider implements ContextProvider {
  id = "terminal";
  trigger = "@terminal";
  description = "Include recent terminal output";
  requiresArg = false;

  async resolve(_arg?: string, options?: ContextResolveOptions): Promise<ContextResult> {
    const maxChars = options?.maxContentLength ?? DEFAULT_MAX_CHARS;
    let output = options?.terminalOutput || "";

    // If no terminal output is available, return a helpful message
    if (!output.trim()) {
      return {
        label: "Terminal Output",
        content: "[No recent terminal output available. Run a command first, then use @terminal.]",
        metadata: { source: "terminal", itemCount: 0 },
      };
    }

    // Truncate if too long — keep the tail (most recent output is most relevant)
    let truncated = false;
    if (output.length > maxChars) {
      output = output.slice(-maxChars);
      truncated = true;
    }

    return {
      label: "Terminal Output",
      content: `## Recent Terminal Output\n\n\`\`\`\n${output}\n\`\`\``,
      metadata: {
        source: "terminal",
        truncated,
      },
    };
  }
}
