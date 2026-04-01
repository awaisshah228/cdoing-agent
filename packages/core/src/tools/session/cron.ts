/**
 * Cron Tools — scheduled agent execution.
 *
 * Inspired by Claude Code's CronCreate/CronList/CronDelete tools.
 * Manages scheduled tasks stored in .cdoing/cron.json.
 */

import * as fs from "fs";
import * as path from "path";
import type { BaseTool, ToolDefinition, ToolResult } from "../types";

interface CronEntry {
  id: string;
  schedule: string;
  task: string;
  description: string;
  createdAt: string;
  enabled: boolean;
}

function getCronPath(workingDir: string): string {
  return path.join(workingDir, ".cdoing", "cron.json");
}

function loadCrons(workingDir: string): CronEntry[] {
  try {
    const data = fs.readFileSync(getCronPath(workingDir), "utf-8");
    return JSON.parse(data);
  } catch {
    return [];
  }
}

function saveCrons(workingDir: string, crons: CronEntry[]): void {
  const dir = path.join(workingDir, ".cdoing");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(getCronPath(workingDir), JSON.stringify(crons, null, 2));
}

export class CronCreateTool implements BaseTool {
  definition: ToolDefinition = {
    name: "cron_create",
    description:
      "Create a scheduled cron job that runs an agent task on a recurring schedule. " +
      "Uses standard cron syntax (e.g., '0 9 * * *' for daily at 9am).",
    inputSchema: {
      type: "object",
      properties: {
        schedule: { type: "string", description: "Cron expression (e.g., '*/30 * * * *' for every 30 min)." },
        task: { type: "string", description: "The agent task/prompt to execute on schedule." },
        description: { type: "string", description: "Human-readable description of this cron job." },
      },
      required: ["schedule", "task"],
    },
    requiresPermission: true,
    permissionMessage: (input) => `Create cron: ${input.schedule} — ${String(input.description || input.task).substring(0, 60)}`,
  };

  private workingDir: string;
  constructor(workingDir: string) { this.workingDir = workingDir; }

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const schedule = String(input.schedule || "");
    const task = String(input.task || "");
    const description = String(input.description || task.substring(0, 80));

    if (!schedule || !task) {
      return { success: false, output: "Both 'schedule' and 'task' are required." };
    }

    const crons = loadCrons(this.workingDir);
    const entry: CronEntry = {
      id: `cron_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      schedule,
      task,
      description,
      createdAt: new Date().toISOString(),
      enabled: true,
    };
    crons.push(entry);
    saveCrons(this.workingDir, crons);

    return { success: true, output: `Created cron job ${entry.id}: "${description}" (${schedule})` };
  }
}

export class CronListTool implements BaseTool {
  definition: ToolDefinition = {
    name: "cron_list",
    description: "List all scheduled cron jobs for this project.",
    inputSchema: { type: "object", properties: {} },
    requiresPermission: false,
  };

  private workingDir: string;
  constructor(workingDir: string) { this.workingDir = workingDir; }

  async execute(): Promise<ToolResult> {
    const crons = loadCrons(this.workingDir);
    if (crons.length === 0) {
      return { success: true, output: "No cron jobs configured." };
    }
    const lines = crons.map((c) =>
      `${c.enabled ? "●" : "○"} ${c.id} | ${c.schedule} | ${c.description}`
    );
    return { success: true, output: lines.join("\n") };
  }
}

export class CronDeleteTool implements BaseTool {
  definition: ToolDefinition = {
    name: "cron_delete",
    description: "Delete a scheduled cron job by its ID.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "The cron job ID to delete." },
      },
      required: ["id"],
    },
    requiresPermission: true,
    permissionMessage: (input) => `Delete cron: ${input.id}`,
  };

  private workingDir: string;
  constructor(workingDir: string) { this.workingDir = workingDir; }

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const id = String(input.id || "");
    const crons = loadCrons(this.workingDir);
    const idx = crons.findIndex((c) => c.id === id);
    if (idx === -1) return { success: false, output: `Cron job "${id}" not found.` };
    const removed = crons.splice(idx, 1)[0];
    saveCrons(this.workingDir, crons);
    return { success: true, output: `Deleted cron job: ${removed.description}` };
  }
}
