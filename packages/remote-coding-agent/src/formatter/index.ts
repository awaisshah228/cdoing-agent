/**
 * Message Formatter
 *
 * Channel-agnostic formatting for agent responses. Each function returns
 * plain text that works across all channels. Channels can apply their
 * own formatting (MarkdownV2 for Telegram, embeds for Discord, etc.)
 * on top of this base format.
 */

import type { AgentReply, ToolCallSummary, UsageSummary } from "../types";

/** Format a full agent reply for display. */
export function formatReply(reply: AgentReply): string {
  const parts: string[] = [];

  if (reply.text) parts.push(reply.text);

  if (reply.toolCalls && reply.toolCalls.length > 0) {
    parts.push("");
    parts.push(formatToolSummary(reply.toolCalls));
  }

  if (reply.usage) {
    parts.push("");
    parts.push(formatUsage(reply.usage));
  }

  if (reply.durationMs) {
    parts.push(`(completed in ${(reply.durationMs / 1000).toFixed(1)}s)`);
  }

  return parts.join("\n");
}

export function formatToolSummary(tools: ToolCallSummary[]): string {
  if (tools.length === 0) return "";
  const lines = tools.map((tc) => {
    const icon = tc.isError ? "X" : ">";
    return `  ${icon} ${tc.name}: ${formatToolInput(tc)}`;
  });
  return `Tools used (${tools.length}):\n${lines.join("\n")}`;
}

function formatToolInput(tc: ToolCallSummary): string {
  const i = tc.input;
  if (i.file_path) return String(i.file_path);
  if (i.command) return String(i.command).substring(0, 80);
  if (i.pattern) return `"${String(i.pattern).substring(0, 60)}"`;
  if (i.url) return String(i.url).substring(0, 80);
  return tc.output.substring(0, 60);
}

export function formatUsage(usage: UsageSummary): string {
  const parts = [`Tokens: ${usage.inputTokens.toLocaleString()} in / ${usage.outputTokens.toLocaleString()} out`];
  if (usage.costUsd !== undefined) parts.push(`Cost: $${usage.costUsd.toFixed(4)}`);
  return parts.join(" | ");
}

export function formatError(error: Error): string {
  return `Error: ${error.message}\n\nPlease try again or use /clear to reset.`;
}

export function formatHelp(): string {
  return [
    "Remote Coding Agent - Commands:",
    "",
    "/start     — Start the bot",
    "/help      — Show this help message",
    "/clear     — Clear conversation history",
    "/status    — Show session status",
    "/dir <path> — Change working directory",
    "/model <name> — Switch AI model",
    "/provider <name> — Switch AI provider",
    "/whoami    — Show your user info",
    "",
    "Just send any message to start coding!",
    "The agent can read/edit files, run commands, search code, and more.",
  ].join("\n");
}

export function formatStatus(info: {
  sessionId: string;
  channel: string;
  workingDir: string;
  historyLength: number;
  provider: string;
  model: string;
}): string {
  return [
    "Session Status:",
    `  Session: ${info.sessionId}`,
    `  Channel: ${info.channel}`,
    `  Working dir: ${info.workingDir}`,
    `  History: ${info.historyLength} messages`,
    `  Provider: ${info.provider}`,
    `  Model: ${info.model}`,
  ].join("\n");
}
