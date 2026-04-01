/**
 * Plan Exit Tool — signal that planning is complete.
 *
 * Does NOT auto-switch to build mode. Instead:
 *   1. LLM calls plan_exit when done planning
 *   2. The callback notifies the UI that the plan is ready for review
 *   3. User reviews the plan and types /plan approve
 *   4. Only then does the system switch to build mode
 *
 * This follows OpenCode's pattern where plan_exit shows a
 * "Would you like to switch to build agent?" dialog.
 */

import type { BaseTool, ToolDefinition, ToolResult } from "../types";

export type PlanExitCallback = (reason: string) => void;

export class PlanExitTool implements BaseTool {
  // ── Behavioral flags ──
  // Sequential: state transition, must complete before anything else
  definition: ToolDefinition = {
    name: "plan_exit",
    description:
      "Signal that your plan is complete and ready for user review. " +
      "This does NOT immediately switch to build mode — the user must approve the plan first. " +
      "Provide a summary of the plan you created.",
    inputSchema: {
      type: "object",
      properties: {
        summary: {
          type: "string",
          description: "Brief summary of the plan that's ready for review",
        },
      },
      required: ["summary"],
    },
    requiresPermission: false,
  };

  private onPlanExit: PlanExitCallback;

  constructor(onPlanExit: PlanExitCallback) {
    this.onPlanExit = onPlanExit;
  }

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const summary = String(input.summary || "Plan is ready for review");

    try {
      this.onPlanExit(summary);
      return {
        success: true,
        output: [
          `Plan complete: ${summary}`,
          "",
          "The plan is now waiting for user approval.",
          "The user can:",
          "  /plan approve  — approve and start building",
          "  /plan reject   — reject the plan",
          "  /plan show     — review the plan details",
          "",
          "Do NOT proceed with any changes until the user approves.",
        ].join("\n"),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, output: "", error: `Failed to signal plan completion: ${message}` };
    }
  }
}
