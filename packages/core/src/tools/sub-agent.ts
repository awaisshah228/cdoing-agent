/**
 * Sub-Agent Tool — allows the agent to spawn child agents for parallel research.
 *
 * The sub-agent gets its own conversation context and the same tools,
 * but cannot spawn further sub-agents (prevents infinite recursion).
 *
 * Features:
 *  - Custom timeout (useful for long-running tasks like npm install)
 *  - Background mode (returns agent ID immediately, check status later)
 *  - Foreground mode (waits for completion, default)
 */

import type { BaseTool, ToolDefinition, ToolResult } from "./types";
import { SubAgentManager } from "./sub-agent-manager";

/**
 * Factory function signature for creating sub-agent runners.
 * Now accepts an AbortSignal so the parent can cancel child agents.
 */
export interface SubAgentRunnerFactory {
  (prompt: string, signal?: AbortSignal): Promise<string>;
}

export class SubAgentTool implements BaseTool {
  definition: ToolDefinition = {
    name: "sub_agent",
    description:
      "Spawn a sub-agent to handle a specific task. The sub-agent has access to the same file and search tools but runs in its own context. Use this for independent tasks like 'find all usages of X', 'read and summarize file Y', or long-running commands like 'npm install'. Supports custom timeout and background mode. The sub-agent cannot spawn further sub-agents.",
    inputSchema: {
      type: "object",
      properties: {
        task: {
          type: "string",
          description: "A clear, specific task for the sub-agent to perform",
        },
        timeout: {
          type: "number",
          description:
            "Custom timeout in milliseconds. Use for long-running tasks (e.g., 300000 for 5 minutes). Default: no timeout (runs until completion).",
        },
        background: {
          type: "boolean",
          description:
            "If true, returns immediately with an agent ID. Use sub_agent_status to check progress and sub_agent_terminate to stop it. Default: false (waits for completion).",
        },
      },
      required: ["task"],
    },
    requiresPermission: false,
  };

  private runnerFactory: SubAgentRunnerFactory;
  private manager: SubAgentManager;

  constructor(runnerFactory: SubAgentRunnerFactory, manager: SubAgentManager) {
    this.runnerFactory = runnerFactory;
    this.manager = manager;
  }

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const task = input.task as string;
    const timeout = input.timeout as number | undefined;
    const background = input.background as boolean | undefined;

    if (!task || task.trim().length === 0) {
      return { success: false, output: "", error: "Task cannot be empty" };
    }

    const runnerFn = (signal: AbortSignal) => this.runnerFactory(task, signal);

    if (background) {
      // Background mode: return immediately with agent ID
      const agentId = this.manager.spawn(task, runnerFn, timeout);
      return {
        success: true,
        output: JSON.stringify({
          agent_id: agentId,
          status: "running",
          message: `Sub-agent spawned in background. Use sub_agent_status with agent_id "${agentId}" to check progress, or sub_agent_terminate to stop it.`,
        }),
      };
    }

    // Foreground mode: wait for completion
    try {
      const entry = await this.manager.spawnAndWait(task, runnerFn, timeout);

      if (entry.status === "completed") {
        return {
          success: true,
          output: entry.output || "(sub-agent returned no output)",
        };
      }

      if (entry.status === "timed_out") {
        return {
          success: false,
          output: entry.output || "",
          error: `Sub-agent timed out after ${timeout}ms. Partial output (if any) is included. You can retry with a longer timeout or run in background mode.`,
        };
      }

      return {
        success: false,
        output: entry.output || "",
        error: `Sub-agent ${entry.status}: ${entry.error || "unknown error"}`,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, output: "", error: `Sub-agent failed: ${message}` };
    }
  }
}
