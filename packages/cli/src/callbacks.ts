/**
 * Agent Callbacks — formatted console output for interactive and one-shot modes.
 * Includes token usage display and basic markdown rendering.
 */

import chalk from "chalk";
import type { Ora } from "ora";
import type { AgentCallbacks } from "@cdoing/ai";
import type { TurnUsage } from "@cdoing/ai";

// Tool categories with icons and colors
const TOOL_STYLES: Record<string, { icon: string; color: (s: string) => string }> = {
  // File operations
  file_read: { icon: "📖", color: chalk.hex("#4FC3F7") },
  file_write: { icon: "✏️ ", color: chalk.hex("#81C784") },
  file_edit: { icon: "🔧", color: chalk.hex("#FFB74D") },
  // Search
  glob_search: { icon: "🔍", color: chalk.hex("#BA68C8") },
  grep_search: { icon: "🔎", color: chalk.hex("#9575CD") },
  // Execution
  shell_exec: { icon: "💻", color: chalk.hex("#4DD0E1") },
  file_run: { icon: "▶️ ", color: chalk.hex("#4DB6AC") },
  code_verify: { icon: "✅", color: chalk.hex("#AED581") },
  // Web
  web_fetch: { icon: "🌐", color: chalk.hex("#64B5F6") },
  web_search: { icon: "🔮", color: chalk.hex("#7986CB") },
  // Agent
  sub_agent: { icon: "🤖", color: chalk.hex("#F06292") },
  // Tasks
  todo: { icon: "📋", color: chalk.hex("#FF8A65") },
};

/** Get tool style or default */
function getToolStyle(name: string): { icon: string; color: (s: string) => string } {
  return TOOL_STYLES[name] || { icon: "⚡", color: chalk.hex("#FFC107") };
}

/** Basic terminal markdown rendering */
function renderMarkdown(text: string): string {
  let result = text;

  // Code blocks with language (```lang\n...\n```)
  result = result.replace(/```(\w+)?\n([\s\S]*?)```/g, (_match, lang, code) => {
    const langColor = chalk.hex("#82AAFF");
    const header = lang ? chalk.dim("  ┌─ ") + langColor(lang) + chalk.dim(" ─┐") + "\n" : "";
    const formatted = code
      .split("\n")
      .map((line: string) => chalk.hex("#C3E88D")(`  │ ${line}`))
      .join("\n");
    return `\n${header}${formatted}\n` + chalk.dim("  └────────┘\n");
  });

  // Inline code
  result = result.replace(/`([^`]+)`/g, (_m: string, code: string) =>
    chalk.bgHex("#2D2D2D").hex("#FFD54F")(` ${code} `)
  );

  // Bold
  result = result.replace(/\*\*([^*]+)\*\*/g, (_m: string, t: string) => chalk.bold.hex("#FFFFFF")(t));

  // Italic
  result = result.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, (_m: string, t: string) => chalk.italic.hex("#B0BEC5")(t));

  // Headers with gradient effect
  result = result.replace(/^### (.+)$/gm, (_m: string, t: string) =>
    chalk.hex("#4FC3F7")("   ▸ ") + chalk.bold.hex("#4FC3F7")(t)
  );
  result = result.replace(/^## (.+)$/gm, (_m: string, t: string) =>
    chalk.hex("#29B6F6")("  ▸▸ ") + chalk.bold.hex("#29B6F6")(t)
  );
  result = result.replace(/^# (.+)$/gm, (_m: string, t: string) =>
    chalk.hex("#03A9F4")(" ▸▸▸ ") + chalk.bold.hex("#03A9F4")(t)
  );

  // Bullet lists with colorful bullets
  result = result.replace(/^(\s*)[-*] (.+)$/gm, (_m: string, indent: string, t: string) =>
    `${indent}  ${chalk.hex("#FF7043")("●")} ${t}`
  );

  // Numbered lists
  result = result.replace(/^(\s*)(\d+)\. (.+)$/gm, (_m: string, indent: string, n: string, t: string) =>
    `${indent}  ${chalk.hex("#AB47BC")(n + ".")} ${t}`
  );

  // Horizontal rules
  result = result.replace(/^---+$/gm, chalk.hex("#546E7A")("  ═══════════════════════════════"));

  return result;
}

/** Format token usage for display with colors */
function formatUsage(usage: TurnUsage): string {
  const parts: string[] = [];
  if (usage.inputTokens > 0 || usage.outputTokens > 0) {
    parts.push(
      chalk.hex("#4FC3F7")(usage.inputTokens.toLocaleString()) +
      chalk.hex("#78909C")(" → ") +
      chalk.hex("#81C784")(usage.outputTokens.toLocaleString())
    );
  }
  parts.push(chalk.hex("#B0BEC5")(`${usage.totalTokens.toLocaleString()} tokens`));
  if (usage.cost !== undefined) {
    parts.push(chalk.hex("#FFD54F")(`$${usage.cost.toFixed(4)}`));
  }
  return parts.join(chalk.hex("#546E7A")(" · "));
}

/** Interactive mode: spinner + colors + markdown */
export function createInteractiveCallbacks(spinner: Ora): AgentCallbacks {
  let isFirstToken = true;
  let buffer = "";

  return {
    onToken: (token) => {
      if (isFirstToken) {
        spinner.stop();
        process.stdout.write(chalk.hex("#E0E0E0")("  "));
        isFirstToken = false;
      }
      // Buffer tokens and render markdown on newlines
      buffer += token;
      const lines = buffer.split("\n");
      // Write all complete lines with markdown rendering
      for (let i = 0; i < lines.length - 1; i++) {
        const rendered = renderMarkdown(lines[i]);
        process.stdout.write(rendered + "\n");
      }
      // Keep the last incomplete line in the buffer
      buffer = lines[lines.length - 1];
    },

    onTextToolCallDetected: () => {
      // Local model emitted tool call as text — clear the buffer (raw JSON)
      buffer = "";
      // Move cursor up and clear lines to remove already-printed JSON
      process.stdout.write("\x1b[1A\x1b[2K");
    },

    onToolCall: (name, input) => {
      // Flush buffer
      if (buffer) {
        process.stdout.write(renderMarkdown(buffer));
        buffer = "";
      }
      spinner.stop();

      const style = getToolStyle(name);

      // Special formatting for todo tool
      if (name === "todo") {
        const action = (input as Record<string, unknown>).action;
        const subject = (input as Record<string, unknown>).subject;
        const status = (input as Record<string, unknown>).status;
        const id = (input as Record<string, unknown>).id;

        if (action === "create" && subject) {
          console.log(chalk.hex("#FF8A65")(`\n  📋 Creating task: `) + chalk.bold.white(String(subject)));
        } else if (action === "update" && id && status) {
          const statusStyle = status === "completed"
            ? { icon: "✅", color: chalk.hex("#81C784") }
            : status === "in_progress"
            ? { icon: "🔄", color: chalk.hex("#FFB74D") }
            : { icon: "📌", color: chalk.hex("#90A4AE") };
          console.log(statusStyle.color(`\n  ${statusStyle.icon} Task #${id}: `) + chalk.bold.white(String(status)));
        } else if (action === "list") {
          console.log(chalk.hex("#FF8A65")(`\n  📋 Listing tasks`));
        } else {
          const preview = JSON.stringify(input).substring(0, 60);
          console.log(`\n  ${style.icon} ` + style.color(name) + chalk.hex("#78909C")(` ${preview}`));
        }
      } else {
        // Colorful tool call display
        const preview = formatToolPreview(name, input);
        console.log(`\n  ${style.icon} ` + style.color(name) + chalk.hex("#78909C")(` ${preview}`));
      }
    },

    onToolResult: (name, result, isError) => {
      const style = getToolStyle(name);

      if (isError) {
        console.log(chalk.hex("#EF5350")(`  ✗ `) + chalk.hex("#EF5350").dim(name) + chalk.hex("#EF5350")(" failed"));
      } else if (name === "todo") {
        console.log(chalk.hex("#81C784")(`  ✓ `) + chalk.hex("#A5D6A7")(result.split("\n")[0]));
      } else {
        const preview = result.substring(0, 100).replace(/\n/g, " ");
        console.log(chalk.hex("#81C784")(`  ✓ `) + style.color(name) + chalk.hex("#90A4AE")(` ${preview}`));
      }
      spinner.start(chalk.hex("#B0BEC5")("  🧠 Thinking..."));
      isFirstToken = true;
    },

    onComplete: () => {
      // Flush remaining buffer
      if (buffer) {
        process.stdout.write(renderMarkdown(buffer));
        buffer = "";
      }
      spinner.stop();
      console.log("\n");
    },

    onError: (error) => {
      if (buffer) {
        process.stdout.write(renderMarkdown(buffer));
        buffer = "";
      }
      spinner.stop();
      console.log(chalk.hex("#EF5350")(`\n  ❌ Error: `) + chalk.hex("#FFCDD2")(error.message) + "\n");
    },

    onUsage: (usage) => {
      // Show usage with nice formatting
      const formatted = formatUsage(usage);
      console.log(chalk.hex("#546E7A")(`  ╭─ `) + formatted + chalk.hex("#546E7A")(` ─╮`));
    },
    onCompactStart: (contextPercent) => {
      try {
        spinner.stop();
        console.log(chalk.hex("#FFA726")(`\n  ⟳ Compacting context (${contextPercent}% used)...`));
        spinner.start("Compacting...");
      } catch {}
    },
    onCompactEnd: (savedTokens, newPercent) => {
      try {
        spinner.stop();
        console.log(chalk.hex("#81C784")(`  ✓ Context compacted — saved ${savedTokens.toLocaleString()} tokens (now ${newPercent}%)\n`));
      } catch {}
    },
  };
}

/** Format tool input preview based on tool type */
function formatToolPreview(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case "file_read":
    case "file_write":
    case "file_edit":
      return String(input.path || input.file_path || "").split("/").pop() || "";
    case "shell_exec":
      const cmd = String(input.command || "").substring(0, 50);
      return cmd.length < String(input.command || "").length ? cmd + "..." : cmd;
    case "glob_search":
      return String(input.pattern || "");
    case "grep_search":
      return `"${String(input.pattern || "").substring(0, 30)}"`;
    case "web_fetch":
    case "web_search":
      return String(input.url || input.query || "").substring(0, 40);
    default:
      return JSON.stringify(input).substring(0, 60);
  }
}

/** One-shot mode: colorful minimal output */
export function createOneShotCallbacks(): AgentCallbacks & { hasError: boolean } {
  const state = { hasError: false };
  return {
    get hasError() { return state.hasError; },
    onToken: (token) => process.stdout.write(token),
    onToolCall: (name) => {
      const style = getToolStyle(name);
      console.log(`\n${style.icon} ` + style.color(name));
    },
    onToolResult: (name, _r, isErr) => {
      if (isErr) {
        console.log(chalk.hex("#EF5350")(`✗ ${name} failed`));
      } else {
        const style = getToolStyle(name);
        console.log(chalk.hex("#81C784")(`✓ `) + style.color(name));
      }
    },
    onComplete: () => console.log(),
    onError: (err) => {
      state.hasError = true;
      const msg = err.message;
      console.error("");
      // Categorize the error for clearer CLI output
      if (msg.includes("401") || msg.includes("403") || msg.includes("authentication") || msg.includes("invalid_api_key") || msg.includes("Authentication")) {
        console.error(chalk.hex("#EF5350")(`❌ Authentication Error`));
        console.error(chalk.hex("#FFCDD2")(`   ${msg}`));
        console.error(chalk.hex("#90A4AE")(`\n   Fix: Run "cdoing --login" or set your API key with --api-key`));
      } else if (msg.includes("429") || msg.includes("rate") || msg.includes("quota") || msg.includes("credit balance")) {
        console.error(chalk.hex("#EF5350")(`❌ Rate Limit / Quota Error`));
        console.error(chalk.hex("#FFCDD2")(`   ${msg}`));
        console.error(chalk.hex("#90A4AE")(`\n   Fix: Wait a moment and retry, or switch models with --model`));
      } else if (msg.includes("404") || msg.includes("not found") || msg.includes("not_found")) {
        console.error(chalk.hex("#EF5350")(`❌ Model Not Found`));
        console.error(chalk.hex("#FFCDD2")(`   ${msg}`));
        console.error(chalk.hex("#90A4AE")(`\n   Fix: Check the model name and try again with --model`));
      } else if (msg.includes("ECONNREFUSED") || msg.includes("ENOTFOUND") || msg.includes("ETIMEDOUT") || msg.includes("fetch failed") || msg.includes("network") || msg.includes("socket")) {
        console.error(chalk.hex("#EF5350")(`❌ Network Error`));
        console.error(chalk.hex("#FFCDD2")(`   ${msg}`));
        console.error(chalk.hex("#90A4AE")(`\n   Fix: Check your internet connection and try again`));
      } else if (msg.includes("400") || msg.includes("invalid")) {
        console.error(chalk.hex("#EF5350")(`❌ Invalid Request`));
        console.error(chalk.hex("#FFCDD2")(`   ${msg}`));
        console.error(chalk.hex("#90A4AE")(`\n   Fix: The model rejected the request — try a different model with --model`));
      } else if (msg.includes("Empty response")) {
        console.error(chalk.hex("#EF5350")(`❌ Empty Response`));
        console.error(chalk.hex("#FFCDD2")(`   The model returned no output.`));
        console.error(chalk.hex("#90A4AE")(`\n   Fix: Try again or switch to a different model with --model`));
      } else {
        console.error(chalk.hex("#EF5350")(`❌ Error: `) + chalk.hex("#FFCDD2")(msg));
      }
    },
    onUsage: (usage) => {
      console.error(chalk.hex("#546E7A")(`╭─ `) + formatUsage(usage) + chalk.hex("#546E7A")(` ─╮`));
    },
  };
}

/** Print mode: simple text output (for --print flag) */
export function createPrintCallbacks(): AgentCallbacks & { hasError: boolean } {
  const state = { hasError: false };
  return {
    get hasError() { return state.hasError; },
    onToken: (token) => process.stdout.write(token),
    onToolCall: () => {},
    onToolResult: () => {},
    onComplete: () => console.log(),
    onError: (e) => { state.hasError = true; console.error(e.message); },
  };
}

/** JSON mode: structured JSON output (for --output-format json) */
export function createJsonCallbacks(): AgentCallbacks & { hasError: boolean } {
  const result: { response: string; tools: Array<{ name: string; input: Record<string, unknown> }> } = {
    response: "",
    tools: [],
  };
  const state = { hasError: false };
  return {
    get hasError() { return state.hasError; },
    onToken: (token) => { result.response += token; },
    onToolCall: (name, input) => { result.tools.push({ name, input }); },
    onToolResult: () => {},
    onComplete: () => console.log(JSON.stringify(result, null, 2)),
    onError: (e) => { state.hasError = true; console.error(JSON.stringify({ error: e.message })); },
  };
}

/** Stream JSON mode: line-delimited JSON events (for --output-format stream-json) */
export function createStreamJsonCallbacks(): AgentCallbacks & { hasError: boolean } {
  const state = { hasError: false };
  return {
    get hasError() { return state.hasError; },
    onToken: (token) => console.log(JSON.stringify({ type: "token", data: token })),
    onToolCall: (name, input) => console.log(JSON.stringify({ type: "tool_call", name, input })),
    onToolResult: (name, result) => console.log(JSON.stringify({ type: "tool_result", name, result })),
    onComplete: () => console.log(JSON.stringify({ type: "complete" })),
    onError: (e) => { state.hasError = true; console.log(JSON.stringify({ type: "error", message: e.message })); },
  };
}
