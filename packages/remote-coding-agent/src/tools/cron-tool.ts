/**
 * Cron Tool — Lets the LLM manage scheduled jobs via chat.
 *
 * When a user says "remind me to check logs every hour" or
 * "schedule a daily code review at 9am", the LLM uses this tool
 * to create, list, update, or delete cron jobs.
 *
 * Actions:
 *   - list:    Show all scheduled jobs
 *   - add:     Create a new job (name, schedule, message)
 *   - update:  Modify an existing job
 *   - remove:  Delete a job
 *   - trigger: Run a job immediately
 *   - status:  Show scheduler status
 */

import type { BaseTool, ToolDefinition, ToolResult } from "@cdoing/core";
import type { CronService } from "../cron/service";

/** Mutable state injected from the engine. */
export interface CronToolState {
  cronService: CronService;
}

export class CronTool implements BaseTool {
  definition: ToolDefinition = {
    name: "cron_manager",
    description:
      "Manage scheduled/recurring tasks (cron jobs). Create reminders, " +
      "schedule recurring agent tasks, list jobs, or trigger them manually.",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["list", "add", "update", "remove", "trigger", "status"],
          description: "The action to perform",
        },
        name: { type: "string", description: "Job name (for add/update)" },
        schedule_kind: {
          type: "string",
          enum: ["every", "at", "cron"],
          description: "Schedule type: 'every' for intervals, 'at' for one-shot, 'cron' for expressions",
        },
        interval_ms: { type: "number", description: "Interval in milliseconds (for 'every' schedule)" },
        at: { type: "string", description: "ISO-8601 datetime (for 'at' schedule)" },
        cron_expr: { type: "string", description: "Cron expression (for 'cron' schedule)" },
        message: { type: "string", description: "Agent message/task to execute when the job fires" },
        enabled: { type: "boolean", description: "Whether the job is enabled" },
        job_id: { type: "string", description: "Job ID (for update/remove/trigger)" },
      },
      required: ["action"],
    },
    requiresPermission: false,
  };

  constructor(private state: CronToolState) {}

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    try {
      const output = await this.run(input);
      return { success: true, output };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, output: "", error: msg };
    }
  }

  private async run(input: Record<string, unknown>): Promise<string> {
    const { action } = input;

    switch (action) {
      case "status": {
        const s = this.state.cronService.status();
        return `Cron scheduler: ${s.running ? "running" : "stopped"}\nTotal jobs: ${s.totalJobs}\nEnabled: ${s.enabledJobs}\nTotal runs: ${s.totalRuns}`;
      }

      case "list": {
        const jobs = this.state.cronService.list();
        if (jobs.length === 0) return "No cron jobs configured.";
        return jobs.map((j) => {
          const sched = j.schedule.kind === "every"
            ? `every ${j.schedule.everyMs}ms`
            : j.schedule.kind === "at"
            ? `at ${j.schedule.at}`
            : `cron: ${(j.schedule as any).expr}`;
          const status = j.enabled ? "enabled" : "disabled";
          const lastRun = j.state.lastRunAtMs ? new Date(j.state.lastRunAtMs).toISOString() : "never";
          return `[${j.id}] ${j.name} — ${sched} — ${status} — last run: ${lastRun} — runs: ${j.state.runCount || 0}`;
        }).join("\n");
      }

      case "add": {
        const name = input.name as string;
        const message = input.message as string;
        if (!name || !message) return "Error: name and message are required for adding a job.";

        const scheduleKind = (input.schedule_kind as string) || "every";
        let schedule: any;
        if (scheduleKind === "every") {
          schedule = { kind: "every", everyMs: (input.interval_ms as number) || 3600000 };
        } else if (scheduleKind === "at") {
          schedule = { kind: "at", at: input.at as string };
        } else {
          schedule = { kind: "cron", expr: input.cron_expr as string };
        }

        const job = this.state.cronService.add({
          name,
          enabled: input.enabled !== false,
          schedule,
          payload: { kind: "agentTurn", message },
        });
        return `Job created: [${job.id}] ${job.name}`;
      }

      case "update": {
        const jobId = input.job_id as string;
        if (!jobId) return "Error: job_id is required.";
        const patch: any = {};
        if (input.name) patch.name = input.name;
        if (input.enabled !== undefined) patch.enabled = input.enabled;
        if (input.message) patch.payload = { kind: "agentTurn", message: input.message };
        const updated = this.state.cronService.update(jobId, patch);
        return updated ? `Job updated: ${updated.name}` : "Job not found.";
      }

      case "remove": {
        const jobId = input.job_id as string;
        if (!jobId) return "Error: job_id is required.";
        return this.state.cronService.remove(jobId) ? "Job removed." : "Job not found.";
      }

      case "trigger": {
        const jobId = input.job_id as string;
        if (!jobId) return "Error: job_id is required.";
        const entry = await this.state.cronService.triggerNow(jobId);
        return entry ? `Job triggered: ${entry.status} (${entry.durationMs}ms)` : "Job not found.";
      }

      default:
        return `Unknown action: ${action}. Use: list, add, update, remove, trigger, status`;
    }
  }
}
