/**
 * Plan Manager — Creates, stores, persists, and executes implementation plans.
 *
 * Plans are saved to .cdoing/plans/ as markdown files so they:
 *   - Survive across sessions
 *   - Can be referenced by the LLM during build mode
 *   - Are human-readable and editable
 *   - Follow OpenCode's pattern of plan files
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";

/** Max plans to keep per project — oldest beyond this are auto-deleted */
const MAX_PLANS_PER_PROJECT = 20;

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

  /** Path where the plan is saved on disk */
  filePath?: string;
}

export class PlanManager {
  /** The current active plan (only one at a time) */
  private currentPlan: Plan | null = null;
  /** Working directory */
  private workingDir: string;

  constructor(workingDir?: string) {
    this.workingDir = workingDir || process.cwd();
  }

  /**
   * Get the plans directory — follows OpenCode's pattern:
   *   - Git repo: <project>/.cdoing/plans/  (version-controllable, project-scoped)
   *   - No git:   ~/.cdoing/plans/<safe-path>/  (global fallback)
   */
  getPlansDir(): string {
    // Check if we're in a git repo
    const isGit = fs.existsSync(path.join(this.workingDir, ".git"));
    if (isGit) {
      return path.join(this.workingDir, ".cdoing", "plans");
    }
    // Global fallback — isolate by project path
    const safeName = this.workingDir.replace(/[/\\]/g, "-").replace(/^-/, "");
    return path.join(os.homedir(), ".cdoing", "plans", safeName);
  }

  /**
   * Auto-cleanup: keep only the most recent MAX_PLANS_PER_PROJECT plans.
   * Runs after each save to prevent unbounded growth.
   */
  private cleanup(): void {
    const dir = this.getPlansDir();
    if (!fs.existsSync(dir)) return;

    const files = fs.readdirSync(dir)
      .filter(f => f.endsWith(".md") && f.startsWith("plan_"))
      .sort()
      .reverse(); // newest first

    // Delete everything beyond the limit
    for (const file of files.slice(MAX_PLANS_PER_PROJECT)) {
      try { fs.unlinkSync(path.join(dir, file)); } catch { /* ignore */ }
    }
  }

  /** Generate a slug from the summary for the filename */
  private slugify(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40);
  }

  /**
   * Create a new plan from the agent's analysis.
   */
  createPlan(request: string, summary: string, steps: string[]): Plan {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const slug = this.slugify(summary);
    const id = `plan_${timestamp}_${slug}`;

    this.currentPlan = {
      id,
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

    // Save to disk immediately
    this.saveToDisk();
    return this.currentPlan;
  }

  /** Save the current plan to a .md file in .cdoing/plans/ */
  saveToDisk(): string | null {
    if (!this.currentPlan) return null;

    const dir = this.getPlansDir();
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const fileName = `${this.currentPlan.id}.md`;
    const filePath = path.join(dir, fileName);
    this.currentPlan.filePath = filePath;

    const content = this.formatPlanAsFile();
    fs.writeFileSync(filePath, content, "utf-8");

    // Cleanup old plans to prevent unbounded growth
    this.cleanup();

    return filePath;
  }

  /** Format the plan as a full markdown file (for disk persistence) */
  formatPlanAsFile(): string {
    if (!this.currentPlan) return "";
    const plan = this.currentPlan;

    const lines: string[] = [
      `# Plan: ${plan.summary}`,
      "",
      `**Status:** ${this.formatStatus(plan.status)}`,
      `**Created:** ${new Date(plan.createdAt).toLocaleString()}`,
      "",
      "## Original Request",
      "",
      plan.originalRequest,
      "",
      "## Steps",
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

    lines.push("");
    lines.push("## Verification");
    lines.push("");
    lines.push("- [ ] All steps completed successfully");
    lines.push("- [ ] No regressions introduced");
    lines.push("- [ ] Tests pass (if applicable)");
    lines.push("");

    return lines.join("\n");
  }

  /** Load the most recent plan from disk (for session resume) */
  loadLatestPlan(): Plan | null {
    const dir = this.getPlansDir();
    if (!fs.existsSync(dir)) return null;

    const files = fs.readdirSync(dir)
      .filter(f => f.endsWith(".md") && f.startsWith("plan_"))
      .sort()
      .reverse();

    if (files.length === 0) return null;

    // Return the file path so the LLM can read it
    const filePath = path.join(dir, files[0]);
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      // Parse status from the file
      const statusMatch = content.match(/\*\*Status:\*\*\s*(\w+)/);
      const status = statusMatch ? statusMatch[1].toLowerCase() : "unknown";

      // Only return non-completed plans
      if (status === "completed" || status === "rejected") return null;

      return {
        id: files[0].replace(".md", ""),
        summary: content.match(/^# Plan: (.+)$/m)?.[1] || "Unknown",
        steps: [],
        status: "pending_approval",
        createdAt: fs.statSync(filePath).mtimeMs,
        originalRequest: "",
        filePath,
      };
    } catch {
      return null;
    }
  }

  /** Get the file path of the current plan */
  getPlanFilePath(): string | null {
    return this.currentPlan?.filePath || null;
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
    this.saveToDisk();
    return true;
  }

  /**
   * Reject the plan.
   */
  rejectPlan(): boolean {
    if (!this.currentPlan) return false;
    this.currentPlan.status = "rejected";
    this.saveToDisk();
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
    this.saveToDisk();
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

    this.saveToDisk();
    return true;
  }

  /**
   * Format the plan as markdown for display (chat output).
   */
  formatPlan(): string {
    if (!this.currentPlan) return "No active plan.";

    const plan = this.currentPlan;
    const lines: string[] = [
      `## Plan: ${plan.summary}`,
      "",
      `**Status:** ${this.formatStatus(plan.status)}`,
    ];

    if (plan.filePath) {
      lines.push(`**Saved to:** \`${plan.filePath}\``);
    }

    lines.push("");

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

    const parts = [
      "# Active Plan",
      "",
      `Goal: ${plan.summary}`,
      "",
      "Steps:",
      stepList,
      "",
      "Execute the next pending step. After completing each step, update its status.",
      "If a step fails, explain why and suggest alternatives.",
    ];

    if (plan.filePath) {
      parts.push("", `Plan file: ${plan.filePath}`);
    }

    return parts.join("\n");
  }

  /**
   * Clear the current plan.
   */
  clearPlan(): void {
    this.currentPlan = null;
  }

  /**
   * List all saved plans from disk.
   */
  listPlans(): Array<{ id: string; filePath: string; summary: string; createdAt: number }> {
    const dir = this.getPlansDir();
    if (!fs.existsSync(dir)) return [];

    return fs.readdirSync(dir)
      .filter(f => f.endsWith(".md") && f.startsWith("plan_"))
      .sort()
      .reverse()
      .map(f => {
        const filePath = path.join(dir, f);
        let summary = f;
        try {
          const content = fs.readFileSync(filePath, "utf-8");
          summary = content.match(/^# Plan: (.+)$/m)?.[1] || f;
        } catch { /* ignore */ }
        return {
          id: f.replace(".md", ""),
          filePath,
          summary,
          createdAt: fs.statSync(filePath).mtimeMs,
        };
      });
  }

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
