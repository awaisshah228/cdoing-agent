/**
 * Exit Worktree Tool — cleanup and return from an isolated git worktree.
 *
 * Inspired by Claude Code's ExitWorktreeTool. Supports:
 *   - 'keep': preserve the worktree and branch for later use
 *   - 'remove': delete the worktree and branch (requires discard_changes if dirty)
 */

import { execSync } from "child_process";
import type { BaseTool, ToolDefinition, ToolResult } from "../types";
import { getCurrentWorktreeSession, clearWorktreeSession } from "./enter-worktree";

export class ExitWorktreeTool implements BaseTool {
  // ── Behavioral flags ──
  // Sequential: changes the working directory context
  isDestructive = () => true; // may delete worktree
  definition: ToolDefinition = {
    name: "exit_worktree",
    description:
      "Return from an isolated git worktree. " +
      "Use action='keep' to preserve the worktree and branch, or action='remove' to delete both. " +
      "If removing with uncommitted changes, set discard_changes=true.",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["keep", "remove"],
          description: "'keep' preserves the worktree/branch. 'remove' deletes both.",
        },
        discard_changes: {
          type: "boolean",
          description: "Required when action='remove' and worktree has uncommitted changes.",
        },
      },
      required: ["action"],
    },
    requiresPermission: true,
    permissionMessage: (input) => `Exit worktree (${input.action})`,
  };

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const session = getCurrentWorktreeSession();
    if (!session) {
      return { success: false, output: "Not in a worktree session. Nothing to exit." };
    }

    const action = String(input.action);
    const discardChanges = Boolean(input.discard_changes);

    try {
      if (action === "remove") {
        // Check for uncommitted changes
        const changes = this.countChanges(session.worktreePath, session.originalHeadCommit);
        if (changes && (changes.files > 0 || changes.commits > 0) && !discardChanges) {
          return {
            success: false,
            output: `Worktree has ${changes.files} changed file(s) and ${changes.commits} new commit(s). ` +
              `Set discard_changes=true to remove anyway, or use action='keep' to preserve.`,
          };
        }

        // Remove the worktree and branch
        try {
          execSync(`git worktree remove --force "${session.worktreePath}"`, {
            cwd: session.originalCwd,
            stdio: "pipe",
          });
        } catch {
          // If worktree remove fails, try manual cleanup
          execSync(`rm -rf "${session.worktreePath}"`, { stdio: "pipe" });
          execSync("git worktree prune", { cwd: session.originalCwd, stdio: "pipe" });
        }

        // Delete the temporary branch
        try {
          execSync(`git branch -D "${session.worktreeBranch}"`, {
            cwd: session.originalCwd,
            stdio: "pipe",
          });
        } catch {
          // Branch may not exist if worktree had no commits
        }

        clearWorktreeSession();

        const discardMsg = changes
          ? ` Discarded ${changes.files} file(s) and ${changes.commits} commit(s).`
          : "";
        return {
          success: true,
          output: `Removed worktree and branch ${session.worktreeBranch}.${discardMsg} Returned to ${session.originalCwd}.`,
        };
      }

      // action === 'keep'
      clearWorktreeSession();
      return {
        success: true,
        output: `Worktree preserved at ${session.worktreePath} on branch ${session.worktreeBranch}. ` +
          `Returned to ${session.originalCwd}. You can merge the branch later with: git merge ${session.worktreeBranch}`,
      };
    } catch (err: any) {
      return {
        success: false,
        output: `Failed to exit worktree: ${err.message || err}`,
      };
    }
  }

  private countChanges(worktreePath: string, originalHead: string): { files: number; commits: number } | null {
    try {
      const filesOutput = execSync("git status --porcelain", { cwd: worktreePath, stdio: "pipe" }).toString();
      const files = filesOutput.trim() ? filesOutput.trim().split("\n").length : 0;

      let commits = 0;
      try {
        const commitOutput = execSync(`git rev-list --count ${originalHead}..HEAD`, {
          cwd: worktreePath,
          stdio: "pipe",
        }).toString().trim();
        commits = parseInt(commitOutput, 10) || 0;
      } catch {
        // Original head might not be reachable
      }

      return { files, commits };
    } catch {
      return null;
    }
  }
}
