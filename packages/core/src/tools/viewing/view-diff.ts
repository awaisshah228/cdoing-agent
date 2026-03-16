/**
 * View Diff Tool — show git diff (working changes, staged, between commits).
 */

import { exec } from "child_process";
import type { BaseTool, ToolDefinition, ToolResult } from "../types";

export class ViewDiffTool implements BaseTool {
  definition: ToolDefinition = {
    name: "view_diff",
    description:
      `Show git diff of changes. Supports working changes, staged changes, and diff between commits/branches.

Examples:
- No args: shows unstaged working changes
- staged=true: shows staged changes (what would be committed)
- target="main": diff between current branch and main
- target="HEAD~3": diff against 3 commits ago
- file_path="src/app.ts": diff for a specific file only`,
    inputSchema: {
      type: "object",
      properties: {
        staged: {
          type: "boolean",
          description: "Show staged changes instead of working changes. Default: false.",
        },
        target: {
          type: "string",
          description: "Compare against a branch, commit, or ref. E.g. 'main', 'HEAD~1', 'abc123'.",
        },
        file_path: {
          type: "string",
          description: "Limit diff to a specific file or directory.",
        },
      },
      required: [],
    },
    requiresPermission: false,
  };

  private workingDir: string;

  constructor(workingDir: string) {
    this.workingDir = workingDir;
  }

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const staged = (input.staged as boolean) || false;
    const target = (input.target as string) || "";
    const filePath = (input.file_path as string) || "";

    // Build git diff command
    const parts = ["git", "diff"];

    if (staged && !target) {
      parts.push("--cached");
    } else if (target) {
      // Sanitize target — only allow safe git ref characters
      if (!/^[a-zA-Z0-9_.\/~^@{}\-]+$/.test(target)) {
        return { success: false, output: "", error: `Invalid git ref: "${target}"` };
      }
      parts.push(target);
    }

    parts.push("--stat", "--patch");

    if (filePath) {
      parts.push("--", filePath);
    }

    const command = parts.join(" ");

    return new Promise((resolve) => {
      exec(command, { cwd: this.workingDir, timeout: 30000, maxBuffer: 5 * 1024 * 1024 },
        (error, stdout, stderr) => {
          if (error && !stdout) {
            const msg = stderr?.trim() || error.message;
            resolve({ success: false, output: "", error: `git diff failed: ${msg}` });
            return;
          }

          const output = stdout.trim();
          if (!output) {
            const context = staged ? "staged" : target ? `vs ${target}` : "working";
            resolve({ success: true, output: `No changes (${context})` });
            return;
          }

          // Truncate if too large
          const maxLen = 50000;
          const truncated = output.length > maxLen
            ? output.substring(0, maxLen) + `\n\n... [truncated at ${maxLen} characters]`
            : output;

          resolve({ success: true, output: truncated });
        });
    });
  }
}
