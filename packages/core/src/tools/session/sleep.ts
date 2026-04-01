/**
 * Sleep Tool — strategic delays in agent workflows.
 *
 * Inspired by Claude Code's SleepTool. Used in proactive/background
 * workflows where the agent needs to wait before checking status.
 */

import type { BaseTool, ToolDefinition, ToolResult } from "../types";

export class SleepTool implements BaseTool {
  definition: ToolDefinition = {
    name: "sleep",
    description:
      "Pause execution for a specified duration. " +
      "Use for polling workflows where you need to wait before checking status " +
      "(e.g., waiting for a build, deployment, or test run to complete). " +
      "Max 300 seconds (5 minutes).",
    inputSchema: {
      type: "object",
      properties: {
        seconds: {
          type: "number",
          description: "Duration to sleep in seconds (max 300).",
        },
        reason: {
          type: "string",
          description: "Why the sleep is needed (shown to user).",
        },
      },
      required: ["seconds"],
    },
    requiresPermission: false,
  };

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const seconds = Math.min(Math.max(Number(input.seconds) || 1, 0.1), 300);
    const reason = input.reason ? String(input.reason) : "";

    await new Promise((resolve) => setTimeout(resolve, seconds * 1000));

    return {
      success: true,
      output: `Slept for ${seconds}s.${reason ? ` Reason: ${reason}` : ""}`,
    };
  }
}
