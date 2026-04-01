/**
 * Task Complete Tool — explicit signal that the agent is done.
 *
 * The LLM calls this when it has finished the user's task.
 * The agent-runner listens for this tool and:
 *   1. Kills all background processes (shell_exec background jobs)
 *   2. Terminates all running sub-agents
 *   3. Breaks the agentic loop
 *
 * This is more reliable than relying solely on "no tool calls" because
 * it gives the LLM an explicit way to signal completion with a summary.
 */

import type { BaseTool, ToolDefinition, ToolResult } from "../types";
import type { ProcessManager } from "../execution/process-manager";
import type { SubAgentManager } from "../agents/sub-agent-manager";

export type TaskCompleteCallback = (summary: string) => void;

export class TaskCompleteTool implements BaseTool {
  // ── Behavioral flags ──
  // Sequential: terminates all background work, must be the last thing to run
  definition: ToolDefinition = {
    name: "task_complete",
    description:
      "Signal that the current task is complete. Call this when you have finished all the work the user requested. " +
      "This will clean up any background processes and sub-agents. " +
      "Provide a brief summary of what was accomplished.",
    inputSchema: {
      type: "object",
      properties: {
        summary: {
          type: "string",
          description: "Brief summary of what was accomplished",
        },
      },
      required: ["summary"],
    },
    requiresPermission: false,
  };

  private processManager: ProcessManager | null;
  private subAgentManager: SubAgentManager | null;
  private onTaskComplete: TaskCompleteCallback | null;

  constructor(
    processManager?: ProcessManager | null,
    subAgentManager?: SubAgentManager | null,
    onTaskComplete?: TaskCompleteCallback,
  ) {
    this.processManager = processManager || null;
    this.subAgentManager = subAgentManager || null;
    this.onTaskComplete = onTaskComplete || null;
  }

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const summary = String(input.summary || "Task completed");

    const cleanupParts: string[] = [];

    // Kill all background processes
    if (this.processManager) {
      const killed = this.processManager.killAll();
      if (killed > 0) {
        cleanupParts.push(`Terminated ${killed} background process${killed > 1 ? "es" : ""}`);
      }
    }

    // Terminate all running sub-agents
    if (this.subAgentManager) {
      const terminated = this.subAgentManager.terminateAll();
      if (terminated > 0) {
        cleanupParts.push(`Terminated ${terminated} sub-agent${terminated > 1 ? "s" : ""}`);
      }
    }

    // Notify callback
    if (this.onTaskComplete) {
      this.onTaskComplete(summary);
    }

    const cleanupMsg = cleanupParts.length > 0
      ? ` Cleanup: ${cleanupParts.join(", ")}.`
      : "";

    return {
      success: true,
      output: `Task complete: ${summary}${cleanupMsg}`,
    };
  }
}
