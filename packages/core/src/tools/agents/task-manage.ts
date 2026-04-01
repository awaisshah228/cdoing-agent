/**
 * Task Management Tools — Create, list, get status, and stop background tasks.
 *
 * Inspired by Claude Code's TaskCreate/TaskGet/TaskList/TaskStop tools.
 * Wraps the SubAgentManager for richer task lifecycle management.
 */

import type { BaseTool, ToolDefinition, ToolResult } from "../types";
import type { SubAgentManager } from "./sub-agent-manager";
import type { ProcessManager } from "../execution/process-manager";

export class TaskListTool implements BaseTool {
  // ── Behavioral flags ──
  isReadOnly = () => true;
  concurrencyMode = () => "parallel" as const;
  definition: ToolDefinition = {
    name: "task_list",
    description:
      "List all running and completed background tasks (sub-agents and processes). " +
      "Shows task ID, status, description, and duration.",
    inputSchema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["all", "running", "completed", "failed"],
          description: "Filter by status (default: 'all').",
        },
      },
    },
    requiresPermission: false,
  };

  private agentManager?: SubAgentManager;
  private processManager?: ProcessManager;

  constructor(agentManager?: SubAgentManager, processManager?: ProcessManager) {
    this.agentManager = agentManager;
    this.processManager = processManager;
  }

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const filter = String(input.status || "all");
    const lines: string[] = [];

    // List sub-agents
    if (this.agentManager) {
      const agents = this.agentManager.listAll();
      for (const a of agents) {
        if (filter !== "all" && a.status !== filter) continue;
        const duration = `${(a.durationMs / 1000).toFixed(1)}s`;
        lines.push(`[agent] ${a.id} | ${a.status} | ${duration} | ${a.task.substring(0, 80)}`);
      }
    }

    // List background processes
    if (this.processManager) {
      const procs = this.processManager.listAll();
      for (const p of procs) {
        if (filter !== "all") {
          if (filter === "running" && p.status !== "running") continue;
          if (filter === "completed" && p.status !== "exited") continue;
        }
        lines.push(`[process] ${p.id} | ${p.status} | pid ${p.pid} | ${p.command.substring(0, 80)}`);
      }
    }

    if (lines.length === 0) {
      return { success: true, output: filter === "all" ? "No tasks." : `No ${filter} tasks.` };
    }

    return { success: true, output: lines.join("\n") };
  }
}

export class TaskGetTool implements BaseTool {
  // ── Behavioral flags ──
  isReadOnly = () => true;
  concurrencyMode = () => "parallel" as const;
  definition: ToolDefinition = {
    name: "task_get",
    description:
      "Get detailed status and output of a specific background task by its ID.",
    inputSchema: {
      type: "object",
      properties: {
        task_id: {
          type: "string",
          description: "The task/agent ID to query.",
        },
      },
      required: ["task_id"],
    },
    requiresPermission: false,
  };

  private agentManager?: SubAgentManager;
  private processManager?: ProcessManager;

  constructor(agentManager?: SubAgentManager, processManager?: ProcessManager) {
    this.agentManager = agentManager;
    this.processManager = processManager;
  }

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const id = String(input.task_id || "");
    if (!id) return { success: false, output: "Missing task_id." };

    // Check agents
    if (this.agentManager) {
      const agent = this.agentManager.getStatus(id);
      if (agent) {
        const duration = agent.durationMs ? `${(agent.durationMs / 1000).toFixed(1)}s` : "unknown";
        return {
          success: true,
          output: [
            `ID: ${agent.id}`,
            `Status: ${agent.status}`,
            `Duration: ${duration}`,
            `Task: ${agent.task}`,
            agent.output ? `Output:\n${agent.output.substring(0, 5000)}` : "",
            agent.error ? `Error: ${agent.error}` : "",
          ].filter(Boolean).join("\n"),
        };
      }
    }

    // Check processes
    if (this.processManager) {
      const proc = this.processManager.getStatus(id);
      if (proc) {
        return {
          success: true,
          output: [
            `ID: ${proc.id}`,
            `Status: ${proc.status}`,
            `PID: ${proc.pid}`,
            `Command: ${proc.command}`,
            proc.output ? `Output:\n${proc.output.substring(0, 5000)}` : "",
          ].filter(Boolean).join("\n"),
        };
      }
    }

    return { success: false, output: `Task "${id}" not found.` };
  }
}

export class TaskStopTool implements BaseTool {
  // ── Behavioral flags ──
  isDestructive = () => true; // terminates a running task
  definition: ToolDefinition = {
    name: "task_stop",
    description:
      "Stop a running background task (sub-agent or process) by its ID.",
    inputSchema: {
      type: "object",
      properties: {
        task_id: {
          type: "string",
          description: "The task/agent ID to stop.",
        },
      },
      required: ["task_id"],
    },
    requiresPermission: true,
    permissionMessage: (input) => `Stop task: ${input.task_id}`,
  };

  private agentManager?: SubAgentManager;
  private processManager?: ProcessManager;

  constructor(agentManager?: SubAgentManager, processManager?: ProcessManager) {
    this.agentManager = agentManager;
    this.processManager = processManager;
  }

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const id = String(input.task_id || "");
    if (!id) return { success: false, output: "Missing task_id." };

    // Try agents
    if (this.agentManager) {
      const agent = this.agentManager.get(id);
      if (agent) {
        this.agentManager.terminate(id);
        return { success: true, output: `Agent ${id} terminated.` };
      }
    }

    // Try processes
    if (this.processManager) {
      const proc = this.processManager.getStatus(id);
      if (proc) {
        this.processManager.kill(id);
        return { success: true, output: `Process ${id} (pid ${proc.pid}) killed.` };
      }
    }

    return { success: false, output: `Task "${id}" not found.` };
  }
}
