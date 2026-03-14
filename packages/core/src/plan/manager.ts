/**
 * Plan Manager — Creates, stores, and executes implementation plans.
 *
 * A plan is a structured breakdown of what the agent intends to do.
 * Each step has a description, status, and optional tool call info.
 *
 * Learning note: This follows the Command Pattern — each plan step
 * is a serializable command that can be reviewed before execution.
 */

/**
 * Status of the overall plan.
 */
export type PlanStatus = "drafting" | "pending_approval" | "approved" | "executing" | "completed" | "rejected";

/**
 * A single step in the plan.
 */
export interface PlanStep {
  /** Step number (1-based) */
  number: number;

  /** What this step will do (human-readable) */
  description: string;

  /** Which tool to use (e.g., "file_edit", "shell_exec") */
  tool?: string;

  /** Target file or resource */
  target?: string;

  /** Current status of this step */
  status: "pending" | "in_progress" | "completed" | "skipped";

  /** Optional details or notes */
  details?: string;
}

/**
 * A complete implementation plan.
 */
export interface Plan {
  /** Unique plan ID */
  id: string;

  /** One-line summary of what the plan achieves */
  summary: string;

  /** Ordered list of steps */
  steps: PlanStep[];

  /** Current plan status */
  status: PlanStatus;

  /** When the plan was created */
  createdAt: number;

  /** The original user request that generated this plan */
  originalRequest: string;
}

export class PlanManager {
  /** The current active plan (only one at a time) */
  private currentPlan: Plan | null = null;

  /**
   * Create a new plan from the agent's analysis.
   *
   * @param request - The original user request
   * @param summary - One-line summary
   * @param steps - Ordered list of step descriptions
   * @returns The created plan
   */
  createPlan(request: string, summary: string, steps: string[]): Plan {
    this.currentPlan = {
      id: `plan_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      summary,
      steps: steps.map((desc, i) => ({
        number: i + 1,
        description: desc,
        status: "pending",
      })),
      status: "pending_approval",
      createdAt: Date.now(),
      originalRequest: request,
    };

    return this.currentPlan;
  }

  /**
   * Get the current active plan.
   */
  getCurrentPlan(): Plan | null {
    return this.currentPlan;
  }

  /**
   * Approve the plan for execution.
   */
  approvePlan(): boolean {
    if (!this.currentPlan || this.currentPlan.status !== "pending_approval") {
      return false;
    }
    this.currentPlan.status = "approved";
    return true;
  }

  /**
   * Reject the plan.
   */
  rejectPlan(): boolean {
    if (!this.currentPlan) return false;
    this.currentPlan.status = "rejected";
    return true;
  }

  /**
   * Mark the plan as executing.
   */
  startExecution(): boolean {
    if (!this.currentPlan || this.currentPlan.status !== "approved") {
      return false;
    }
    this.currentPlan.status = "executing";
    return true;
  }

  /**
   * Update a step's status.
   */
  updateStep(stepNumber: number, status: PlanStep["status"], details?: string): boolean {
    if (!this.currentPlan) return false;

    const step = this.currentPlan.steps.find((s) => s.number === stepNumber);
    if (!step) return false;

    step.status = status;
    if (details) step.details = details;

    // Check if all steps are completed
    const allDone = this.currentPlan.steps.every(
      (s) => s.status === "completed" || s.status === "skipped"
    );
    if (allDone) {
      this.currentPlan.status = "completed";
    }

    return true;
  }

  /**
   * Format the plan as markdown for display.
   *
   * Learning note: We use checkbox syntax (- [ ] / - [x]) so the
   * plan looks like an interactive checklist in the chat.
   */
  formatPlan(): string {
    if (!this.currentPlan) return "No active plan.";

    const plan = this.currentPlan;
    const lines: string[] = [
      `## Plan: ${plan.summary}`,
      "",
      `**Status:** ${this.formatStatus(plan.status)}`,
      "",
    ];

    for (const step of plan.steps) {
      const checkbox = step.status === "completed" ? "[x]"
        : step.status === "skipped" ? "[-]"
        : step.status === "in_progress" ? "[~]"
        : "[ ]";

      let line = `${step.number}. ${checkbox} ${step.description}`;
      if (step.tool) line += ` _(${step.tool})_`;
      if (step.target) line += ` → \`${step.target}\``;
      lines.push(line);

      if (step.details) {
        lines.push(`   _${step.details}_`);
      }
    }

    return lines.join("\n");
  }

  /**
   * Get the plan as a system prompt addition.
   * Used to guide the agent during execution.
   */
  getPlanPrompt(): string {
    if (!this.currentPlan) return "";

    const plan = this.currentPlan;
    const stepList = plan.steps
      .map((s) => `${s.number}. [${s.status}] ${s.description}`)
      .join("\n");

    return [
      "# Active Plan",
      "",
      `Goal: ${plan.summary}`,
      "",
      "Steps:",
      stepList,
      "",
      "Execute the next pending step. After completing each step, update its status.",
      "If a step fails, explain why and suggest alternatives.",
    ].join("\n");
  }

  /**
   * Clear the current plan.
   */
  clearPlan(): void {
    this.currentPlan = null;
  }

  /**
   * Format a plan status as a human-readable string.
   */
  private formatStatus(status: PlanStatus): string {
    switch (status) {
      case "drafting": return "Drafting...";
      case "pending_approval": return "Waiting for approval";
      case "approved": return "Approved";
      case "executing": return "Executing...";
      case "completed": return "Completed";
      case "rejected": return "Rejected";
    }
  }
}
