/**
 * Plan Exit Tool — switch from plan mode to build mode.
 *
 * Used by the agent in plan mode to signal it's ready to start executing.
 * The agent-runner listens for this and switches modes.
 */

import type { BaseTool, ToolDefinition, ToolResult } from "../types";

export type PlanExitCallback = (reason: string) => void;

export class PlanExitTool implements BaseTool {
  definition: ToolDefinition = {
    name: "plan_exit",
    description:
      "Exit plan mode and switch to build mode. Use this when you have finished planning and are ready to start implementing. Requires user confirmation.",
    inputSchema: {
      type: "object",
      properties: {
        reason: {
          type: "string",
          description: "Brief explanation of why you're ready to switch from planning to building",
        },
      },
      required: ["reason"],
    },
    requiresPermission: true,
    permissionMessage: (input) => `Exit plan mode: ${input.reason}`,
  };

  private onPlanExit: PlanExitCallback;

  constructor(onPlanExit: PlanExitCallback) {
    this.onPlanExit = onPlanExit;
  }

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const reason = String(input.reason || "Ready to implement");

    try {
      this.onPlanExit(reason);
      return {
        success: true,
        output: `Switched from plan mode to build mode. Reason: ${reason}`,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, output: "", error: `Failed to exit plan mode: ${message}` };
    }
  }
}
