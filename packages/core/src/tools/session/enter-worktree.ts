/**
 * Enter Worktree Tool — create an isolated git worktree for safe experimentation.
 *
 * Inspired by Claude Code's EnterWorktreeTool. Creates a temporary git worktree
 * so the agent (or sub-agent) can make changes without affecting the main branch.
 */

import { execSync } from "child_process";
import * as path from "path";
import type { BaseTool, ToolDefinition, ToolResult } from "../types";

/** Shared state for the active worktree session */
export interface WorktreeSession {
  worktreePath: string;
  worktreeBranch: string;
  originalCwd: string;
  originalHeadCommit: string;
}

let currentSession: WorktreeSession | null = null;

export function getCurrentWorktreeSession(): WorktreeSession | null {
  return currentSession;
}

export function clearWorktreeSession(): void {
  currentSession = null;
}

export class EnterWorktreeTool implements BaseTool {
  // ── Behavioral flags ──
  // Sequential: changes the working directory context
  definition: ToolDefinition = {
    name: "enter_worktree",
    description:
      "Create an isolated git worktree for safe experimentation. " +
      "Changes in the worktree do not affect the main working directory. " +
      "Use exit_worktree to return and optionally keep or discard changes.",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Optional name for the worktree (used as branch suffix). Auto-generated if omitted.",
        },
      },
    },
    requiresPermission: true,
    permissionMessage: (input) => `Create git worktree: ${input.name || "auto-named"}`,
  };

  private workingDir: string;

  constructor(workingDir: string) {
    this.workingDir = workingDir;
  }

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    if (currentSession) {
      return {
        success: false,
        output: `Already in a worktree session at ${currentSession.worktreePath}. Call exit_worktree first.`,
      };
    }

    try {
      // Validate we're in a git repo
      execSync("git rev-parse --is-inside-work-tree", { cwd: this.workingDir, stdio: "pipe" });
    } catch {
      return { success: false, output: "Not a git repository. Worktrees require git." };
    }

    try {
      const repoRoot = execSync("git rev-parse --show-toplevel", { cwd: this.workingDir, stdio: "pipe" })
        .toString().trim();
      const headCommit = execSync("git rev-parse HEAD", { cwd: this.workingDir, stdio: "pipe" })
        .toString().trim();

      // Generate worktree name and branch
      const slug = String(input.name || `agent-${Date.now()}`).replace(/[^a-zA-Z0-9._-]/g, "-").substring(0, 64);
      const branch = `worktree-${slug}`;
      const worktreePath = path.join(repoRoot, "..", `.worktree-${slug}`);

      // Create the worktree
      execSync(`git worktree add -b "${branch}" "${worktreePath}" HEAD`, {
        cwd: repoRoot,
        stdio: "pipe",
      });

      currentSession = {
        worktreePath,
        worktreeBranch: branch,
        originalCwd: this.workingDir,
        originalHeadCommit: headCommit,
      };

      return {
        success: true,
        output: `Created worktree at ${worktreePath} on branch ${branch}.\n` +
          `You are now working in an isolated copy. Use exit_worktree when done.`,
      };
    } catch (err: any) {
      return {
        success: false,
        output: `Failed to create worktree: ${err.message || err}`,
      };
    }
  }
}
