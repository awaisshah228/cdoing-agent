/**
 * Sub-Agent Tool — allows the agent to spawn child agents for parallel research.
 *
 * The sub-agent gets its own conversation context and the same tools,
 * but cannot spawn further sub-agents (prevents infinite recursion).
 *
 * Security:
 *  - Sub-agents inherit the parent's PermissionManager — all tool calls
 *    inside the child go through the same deny/ask/allow rules.
 *  - Task descriptions are screened for destructive intent patterns.
 *  - Permission prompt shows a ⚠ warning for destructive tasks.
 *
 * Features:
 *  - Custom timeout (useful for long-running tasks like npm install)
 *  - Background mode (returns agent ID immediately, check status later)
 *  - Foreground mode (waits for completion, default)
 */

import type { BaseTool, ToolDefinition, ToolResult } from "../types";
import { SubAgentManager } from "./sub-agent-manager";

// ── Destructive task detection ──────────────────────────────────────────────

/**
 * Patterns in task descriptions that indicate destructive intent.
 * These trigger an elevated permission prompt (⚠ DESTRUCTIVE) so the
 * user is clearly warned before the sub-agent is spawned.
 */
const DESTRUCTIVE_TASK_PATTERNS = [
  // File deletion
  /\bdelete\b.*\bfiles?\b/i, /\bremove\b.*\bfiles?\b/i, /\brm\s+-rf\b/i,
  /\bwipe\b/i, /\bpurge\b/i, /\bclean\s*up\b/i, /\bnuke\b/i,
  // Git destructive
  /\bforce\s*push\b/i, /\bgit\s+reset\s+--hard\b/i, /\bgit\s+clean\b/i,
  /\brewrite\s+history\b/i, /\bdelete\b.*\bbranch/i,
  // Database
  /\bdrop\b.*\b(table|database|collection)\b/i, /\btruncate\b/i,
  // System
  /\bkill\b.*\bprocess/i, /\bshutdown\b/i, /\brestart\b.*\bserver/i,
  /\bformat\b.*\bdisk\b/i,
  // Destructive ops
  /\boverwrite\b/i, /\bdestroy\b/i, /\buninstall\b/i,
  /\bdrop\b.*\bpermission/i, /\brevoke\b/i,
];

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
      `Spawn a sub-agent to handle a task autonomously. The sub-agent has access to the same file, search, and shell tools but runs in its own conversation context.

Use sub-agents for:
- Independent research: "find all usages of X", "read and summarize file Y"
- Parallel work: spawn multiple sub-agents for different tasks simultaneously
- Long-running tasks: "run npm install and report results", "run the full test suite"
- Complex multi-step tasks: "refactor all files in src/utils to use async/await"
- Background tasks: set background=true to continue working while the sub-agent runs

Background mode: Set background=true to get an agent ID immediately. Then:
- sub_agent_status({ agent_id }) — check progress and read output
- sub_agent_terminate({ agent_id }) — cancel if needed

The sub-agent cannot spawn further sub-agents (prevents infinite recursion).`,
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
    requiresPermission: true,
    permissionMessage: (input) => {
      const task = String(input.task || "").slice(0, 200);
      if (DESTRUCTIVE_TASK_PATTERNS.some((p) => p.test(task))) {
        return `⚠ DESTRUCTIVE sub-agent task: ${task}`;
      }
      return `Spawn sub-agent: ${task}`;
    },
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

    // Prepend a safety instruction if the task looks destructive.
    // The sub-agent inherits the parent's PermissionManager so each tool call
    // will still go through deny/ask/allow checks, but this extra context
    // makes the LLM aware it should proceed cautiously.
    const isDestructive = DESTRUCTIVE_TASK_PATTERNS.some((p) => p.test(task));
    const safeTask = isDestructive
      ? `[CAUTION: This task involves potentially destructive operations. ` +
        `You MUST ask for explicit user confirmation before executing any ` +
        `destructive commands (rm, delete, drop, force push, reset --hard, etc.). ` +
        `Prefer safe alternatives when possible.]\n\n${task}`
      : task;

    const runnerFn = (signal: AbortSignal) => this.runnerFactory(safeTask, signal);

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
