/**
 * Sub-Agent Tool — allows the agent to spawn child agents for parallel research.
 *
 * The sub-agent gets its own conversation context and the same tools,
 * but cannot spawn further sub-agents (prevents infinite recursion).
 */

import type { BaseTool, ToolDefinition, ToolResult } from "./types";

/**
 * Factory function to create a SubAgentTool.
 * Requires a runner factory because the tool needs to create AgentRunner instances,
 * which live in the @cdoing/ai package (avoiding circular dependency).
 */
export interface SubAgentRunnerFactory {
  (prompt: string): Promise<string>;
}

export class SubAgentTool implements BaseTool {
  definition: ToolDefinition = {
    name: "sub_agent",
    description:
      "Spawn a sub-agent to handle a specific task in parallel. The sub-agent has access to the same file and search tools but runs in its own context. Use this for independent research tasks like 'find all usages of X' or 'read and summarize file Y'. The sub-agent cannot spawn further sub-agents.",
    inputSchema: {
      type: "object",
      properties: {
        task: {
          type: "string",
          description: "A clear, specific task for the sub-agent to perform",
        },
      },
      required: ["task"],
    },
    requiresPermission: false,
  };

  private runnerFactory: SubAgentRunnerFactory;

  constructor(runnerFactory: SubAgentRunnerFactory) {
    this.runnerFactory = runnerFactory;
  }

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const task = input.task as string;

    if (!task || task.trim().length === 0) {
      return { success: false, output: "", error: "Task cannot be empty" };
    }

    try {
      const result = await this.runnerFactory(task);
      return {
        success: true,
        output: result || "(sub-agent returned no output)",
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, output: "", error: `Sub-agent failed: ${message}` };
    }
  }
}
