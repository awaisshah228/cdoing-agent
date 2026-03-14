/**
 * Agent Callbacks — formatted console output for interactive and one-shot modes.
 * Includes token usage display and basic markdown rendering.
 */

import chalk from "chalk";
import type { Ora } from "ora";
import type { AgentCallbacks } from "@cdoing/ai";
import type { TurnUsage } from "@cdoing/ai";

/** Basic terminal markdown rendering */
function renderMarkdown(text: string): string {
  let result = text;

  // Code blocks with language (```lang\n...\n```)
  result = result.replace(/```(\w+)?\n([\s\S]*?)```/g, (_match, lang, code) => {
    const header = lang ? chalk.dim(`  ── ${lang} ──`) + "\n" : "";
    const formatted = code
      .split("\n")
      .map((line: string) => chalk.green(`  ${line}`))
      .join("\n");
    return `\n${header}${formatted}\n`;
  });

  // Inline code
  result = result.replace(/`([^`]+)`/g, (_m: string, code: string) => chalk.yellow(code));

  // Bold
  result = result.replace(/\*\*([^*]+)\*\*/g, (_m: string, t: string) => chalk.bold(t));

  // Italic
  result = result.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, (_m: string, t: string) => chalk.italic(t));

  // Headers
  result = result.replace(/^### (.+)$/gm, (_m: string, t: string) => chalk.bold.cyan(`   ${t}`));
  result = result.replace(/^## (.+)$/gm, (_m: string, t: string) => chalk.bold.cyan(`  ${t}`));
  result = result.replace(/^# (.+)$/gm, (_m: string, t: string) => chalk.bold.cyan(` ${t}`));

  // Bullet lists
  result = result.replace(/^(\s*)[-*] (.+)$/gm, (_m: string, indent: string, t: string) => `${indent}  ${chalk.dim("•")} ${t}`);

  // Numbered lists
  result = result.replace(/^(\s*)(\d+)\. (.+)$/gm, (_m: string, indent: string, n: string, t: string) => `${indent}  ${chalk.dim(`${n}.`)} ${t}`);

  // Horizontal rules
  result = result.replace(/^---+$/gm, chalk.dim("  ────────────────────────────"));

  return result;
}

/** Format token usage for display */
function formatUsage(usage: TurnUsage): string {
  const parts: string[] = [];
  if (usage.inputTokens > 0 || usage.outputTokens > 0) {
    parts.push(`${usage.inputTokens.toLocaleString()}→${usage.outputTokens.toLocaleString()}`);
  }
  parts.push(`${usage.totalTokens.toLocaleString()} tokens`);
  if (usage.cost !== undefined) {
    parts.push(`$${usage.cost.toFixed(4)}`);
  }
  return parts.join(" · ");
}

/** Interactive mode: spinner + colors + markdown */
export function createInteractiveCallbacks(spinner: Ora): AgentCallbacks {
  let isFirstToken = true;
  let buffer = "";

  return {
    onToken: (token) => {
      if (isFirstToken) {
        spinner.stop();
        process.stdout.write(chalk.cyan("  "));
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

    onToolCall: (name, input) => {
      // Flush buffer
      if (buffer) {
        process.stdout.write(renderMarkdown(buffer));
        buffer = "";
      }
      spinner.stop();
      const preview = JSON.stringify(input).substring(0, 80);
      console.log(chalk.yellow(`\n  ⚡ ${name}`) + chalk.dim(` ${preview}`));
    },

    onToolResult: (name, result, isError) => {
      if (isError) {
        console.log(chalk.red(`  ✗ ${name} failed`));
      } else {
        const preview = result.substring(0, 120).replace(/\n/g, " ");
        console.log(chalk.green(`  ✓ ${name}`) + chalk.dim(` ${preview}`));
      }
      spinner.start(chalk.dim("  Thinking..."));
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
      console.log(chalk.red(`\n  Error: ${error.message}\n`));
    },

    onUsage: (usage) => {
      // Show usage after spinner stops, before next prompt
      const formatted = formatUsage(usage);
      console.log(chalk.dim(`  [${formatted}]`));
    },
  };
}

/** One-shot mode: minimal output */
export function createOneShotCallbacks(): AgentCallbacks {
  return {
    onToken: (token) => process.stdout.write(token),
    onToolCall: (name) => console.log(chalk.yellow(`\n⚡ ${name}`)),
    onToolResult: (name, _r, isErr) => console.log(isErr ? chalk.red(`✗ ${name}`) : chalk.green(`✓ ${name}`)),
    onComplete: () => console.log(),
    onError: (err) => console.error(chalk.red(`Error: ${err.message}`)),
    onUsage: (usage) => {
      console.error(chalk.dim(`[${formatUsage(usage)}]`));
    },
  };
}

/** Print mode: simple text output (for --print flag) */
export function createPrintCallbacks(): AgentCallbacks {
  return {
    onToken: (token) => process.stdout.write(token),
    onToolCall: () => {},
    onToolResult: () => {},
    onComplete: () => console.log(),
    onError: (e) => console.error(e.message),
  };
}

/** JSON mode: structured JSON output (for --output-format json) */
export function createJsonCallbacks(): AgentCallbacks {
  const result: { response: string; tools: Array<{ name: string; input: Record<string, unknown> }> } = {
    response: "",
    tools: [],
  };
  return {
    onToken: (token) => { result.response += token; },
    onToolCall: (name, input) => { result.tools.push({ name, input }); },
    onToolResult: () => {},
    onComplete: () => console.log(JSON.stringify(result, null, 2)),
    onError: (e) => console.error(JSON.stringify({ error: e.message })),
  };
}

/** Stream JSON mode: line-delimited JSON events (for --output-format stream-json) */
export function createStreamJsonCallbacks(): AgentCallbacks {
  return {
    onToken: (token) => console.log(JSON.stringify({ type: "token", data: token })),
    onToolCall: (name, input) => console.log(JSON.stringify({ type: "tool_call", name, input })),
    onToolResult: (name, result) => console.log(JSON.stringify({ type: "tool_result", name, result })),
    onComplete: () => console.log(JSON.stringify({ type: "complete" })),
    onError: (e) => console.log(JSON.stringify({ type: "error", message: e.message })),
  };
}
