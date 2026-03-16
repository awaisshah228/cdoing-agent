/**
 * helpers.ts — Pure utility functions for the chat UI.
 *
 * "Pure" means these functions have NO React state or hooks — they only take
 * arguments and return values (or write to stdout).  Keeping them here makes
 * them easy to test in isolation and keeps the hook files focused on state.
 *
 * Contents:
 *  1. Context-window size look-up
 *  2. Terminal output for tool calls  (printToolCall / printToolResult / printFileDiff)
 *  3. Help text and conversation list formatters
 */

import chalk from "chalk";
import * as fs from "fs";
import { printConversationList } from "../../history";

// ─────────────────────────────────────────────────────────────────────────────
// 1. Context-window sizes
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Maximum input-token capacity for each AI provider / model family.
 *
 * Used to calculate what percentage of the context window is already filled
 * so the UI can warn the user and auto-compact when approaching the limit.
 */
export function getContextWindowMax(provider: string, model: string): number {
  if (provider === "google") return 1_000_000;            // Gemini 1M context
  if (provider === "anthropic") return 200_000;           // Claude 200k
  if (provider === "openai") {
    if (model.includes("o3") || model.includes("o1")) return 200_000;
    return 128_000;                                        // GPT-4o 128k
  }
  if (provider === "ollama") return 32_000;               // Local models vary
  return 100_000;                                          // Safe default
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Tool-call terminal output
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Emoji icon shown next to each tool name in the terminal scrollback.
 * Keeping this as a plain object (not a Map) makes it easy to extend.
 */
export const TOOL_ICONS: Record<string, string> = {
  file_read:       "📖",
  file_write:      "✏️ ",
  file_edit:       "🔧",
  multi_edit:      "🔧",

  ast_edit:        "🌳",
  notebook_edit:   "📓",
  glob_search:     "🔍",
  grep_search:     "🔎",
  codebase_search: "🔎",
  shell_exec:      "💻",
  file_run:        "▶",
  web_fetch:       "🌐",
  web_search:      "🔮",
  sub_agent:       "🤖",
  todo:            "📋",
  list_dir:        "📁",
  view_diff:       "📊",
  view_repo_map:   "🗺️",
  code_verify:     "✅",
  system_info:     "ℹ️",
};

/**
 * Extract a human-readable hint (file path, query, etc.) from the tool's
 * input object.  Shown in dim text next to the tool name while it runs.
 */
export function getToolHint(name: string, input: Record<string, unknown>): string {
  // Helper: get a string value from input, strip the cwd prefix for brevity
  const p = (k: string) => String(input[k] || "").replace(process.cwd() + "/", "");
  switch (name) {
    case "file_read":   return p("file_path") || p("path");
    case "file_write":  return p("file_path") || p("path");
    case "file_edit":   return p("file_path") || p("path");
    case "glob_search": return String(input.pattern || "");
    case "grep_search": return String(input.pattern || "");
    case "shell_exec":  return String(input.command || "").substring(0, 50);
    case "web_fetch":   return String(input.url    || "").substring(0, 60);
    case "web_search":  return String(input.query  || "").substring(0, 60);
    default:            return "";
  }
}

/**
 * Print a "▶ tool_name  hint" line to stdout the moment the agent invokes a
 * tool.  This stays in the terminal scrollback permanently (unlike Ink's
 * live render area which gets overwritten on each frame).
 */
export function printToolCall(name: string, input: Record<string, unknown>): void {
  const icon = TOOL_ICONS[name] || "⚡";
  const hint = getToolHint(name, input);
  process.stdout.write(
    chalk.yellow("  ▶ ") + chalk.yellow(`${icon} ${name}`) +
    (hint ? chalk.gray("  " + hint) : "") + "\n",
  );
}

/**
 * Print a "✓ tool_name" or "✗ tool_name" line once the tool finishes.
 * For file edits / writes, also prints a diff so the user can see what changed.
 */
export function printToolResult(
  name: string,
  isError: boolean,
  input: Record<string, unknown>,
): void {
  const icon = TOOL_ICONS[name] || "⚡";
  if (isError) {
    process.stdout.write(chalk.red(`  ✗ ${icon} ${name}`) + "\n");
  } else {
    process.stdout.write(chalk.green("  ✓ ") + chalk.cyan(`${icon} ${name}`) + "\n");
  }
  if (!isError && (name === "file_edit" || name === "file_write")) {
    printFileDiff(name, input);
  }
}

/**
 * Print a compact diff of what changed after a file_edit or file_write call.
 *
 * For file_edit:  compares old_string → new_string  (both come from the tool input).
 * For file_write: reads the file from disk before writing to get the old content.
 *
 * Uses the `diff` package for line-level and word-level hunks.
 */
export function printFileDiff(toolName: string, input: Record<string, unknown>): void {
  try {
    let oldContent = "";
    let newContent = "";
    let filePath   = "";

    if (toolName === "file_edit") {
      filePath   = String(input.file_path || input.path || "");
      oldContent = String(input.old_string || "");
      newContent = String(input.new_string || "");
    } else if (toolName === "file_write") {
      filePath   = String(input.file_path || input.path || "");
      newContent = String(input.content || "");
      try { oldContent = fs.readFileSync(filePath, "utf-8"); } catch { /* new file */ }
    }

    if (!oldContent && !newContent) return;

    const shortPath = filePath.replace(process.cwd() + "/", "");
    process.stdout.write(chalk.bold.white(`\n  📄 ${shortPath}\n`));

    if (!oldContent) {
      // Brand-new file — show the first 20 lines as additions
      const lines   = newContent.split("\n");
      const preview = lines.slice(0, 20);
      for (const line of preview) {
        process.stdout.write(chalk.green("  + ") + chalk.green(line) + "\n");
      }
      if (lines.length > 20) {
        process.stdout.write(chalk.gray(`  ... +${lines.length - 20} more lines\n`));
      }
    } else {
      // Existing file — compute a line diff and print added / removed hunks
      const { diffLines, diffWords } =
        require("diff") as typeof import("diff");
      const lineHunks = diffLines(oldContent, newContent);
      let shownLines  = 0;

      for (const hunk of lineHunks) {
        if (!hunk.added && !hunk.removed) continue;
        const lines = (hunk.value || "").split("\n")
          .filter((l, i, arr) => i < arr.length - 1 || l);

        for (const line of lines) {
          if (shownLines >= 40) {
            process.stdout.write(chalk.gray("  ... (diff truncated)\n"));
            return;
          }
          process.stdout.write(
            hunk.added
              ? chalk.green("  + ") + chalk.green(line) + "\n"
              : chalk.red("  - ")   + chalk.red(line)   + "\n",
          );
          shownLines++;
        }
      }

      // For edits: also show a word-level inline diff for the changed region
      if (toolName === "file_edit" && oldContent && newContent) {
        const wordDiff = diffWords(oldContent, newContent);
        const hasChanges = wordDiff.some((p) => p.added || p.removed);
        if (hasChanges) {
          process.stdout.write(chalk.gray("  ── word diff ──\n  "));
          for (const part of wordDiff) {
            if (part.added)   process.stdout.write(chalk.bgGreen.black(part.value));
            else if (part.removed) process.stdout.write(chalk.bgRed.white(part.value));
            else {
              // Context: show only up to 15 chars on each side to avoid walls of text
              const ctx = part.value.length > 30
                ? part.value.substring(0, 15) + chalk.gray("…") + part.value.slice(-15)
                : part.value;
              process.stdout.write(chalk.gray(ctx));
            }
          }
          process.stdout.write("\n");
        }
      }
    }
    process.stdout.write("\n");
  } catch {
    // If the diff fails for any reason, just skip it silently
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Help text and conversation list
// ─────────────────────────────────────────────────────────────────────────────

/** Full help string shown by /help.  Update this whenever you add a command. */
export function getHelpText(): string {
  return [
    "Available commands:",
    "  /help          — this message",
    "  /clear         — clear conversation",
    "  /new           — new conversation",
    "  /ls             — browse sessions (interactive TUI)",
    "  /history        — list saved conversations (text)",
    "  /resume <id>    — resume a conversation",
    "  /view <id>      — view messages in a conversation",
    "  /fork [id]      — fork current or given conversation",
    "  /delete <id>    — delete a conversation",
    "  /config         — view config",
    "  /model <name>   — switch model",
    "  /provider <n>   — switch provider",
    "  /mode <mode>    — change permission mode",
    "  /dir <path>     — change working directory",
    "  /usage          — token usage",
    "  /plan           — toggle plan mode",
    "  /effort <lvl>   — set effort level (low/medium/high/max)",
    "  /btw <q>        — ask without adding to history",
    "  /bg <prompt>    — run prompt as background job",
    "  /jobs [id]      — list / inspect background jobs",
    "  /rules          — show project rules",
    "  /mcp            — MCP server status",
    "  /context        — list context providers",
    "  /tasks          — show task list",
    "  /compact        — compact context",
    "  /exit           — quit",
    "",
    "Prefix with ! to run a shell command directly.",
    "Use @terminal, @tree, @url <u>, @codebase, @file <path> in messages.",
    "Ctrl+V to paste clipboard  ·  Shift+Tab to cycle mode  ·  Ctrl+L to clear",
  ].join("\n");
}

/**
 * Capture the output of printConversationList() as a string so it can be
 * displayed inside the TUI instead of being written directly to stdout.
 *
 * We temporarily replace console.log with a collector, then restore it.
 * This is a simple (if hacky) way to reuse the existing printer.
 */
export function getConversationListText(): string {
  const lines: string[] = [];
  const orig = console.log;
  console.log = (...args: unknown[]) => lines.push(args.join(" "));
  printConversationList();
  console.log = orig;
  return lines.join("\n") || "No saved conversations.";
}
