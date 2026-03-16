/**
 * File Delete Tool — permission-controlled file/directory deletion.
 *
 * Unlike raw `rm` via shell_exec, this tool:
 *   - Goes through the permission system (Delete category — can be allow/deny/ask via settings)
 *   - Checks sandbox write rules before deletion
 *   - Reports what will be deleted (file count for directories)
 *   - Requires explicit recursive flag for directories
 *   - Requires force flag for large directories (>50 items)
 *
 * Users can control deletion via settings rules:
 *   - Delete         → allow/deny all file deletions
 *   - Delete(path)   → allow/deny deletion of specific paths
 *   - Delete(*.log)  → allow/deny deletion by pattern
 */

import * as fs from "fs";
import * as path from "path";
import type { BaseTool, ToolDefinition, ToolResult } from "../types";
import { safePath } from "../../utils/path-safety";
import type { SandboxManager } from "../../sandbox";

const MAX_DIR_FILES = 50;

export class FileDeleteTool implements BaseTool {
  definition: ToolDefinition = {
    name: "file_delete",
    description:
      `Delete a file or directory. You can also use shell_exec with rm/del for simple deletions if preferred.`,
    inputSchema: {
      type: "object",
      properties: {
        file_path: {
          type: "string",
          description: "Path to the file or directory to delete",
        },
        recursive: {
          type: "boolean",
          description: "Required for directory deletion. Deletes all contents. Default: false.",
        },
        force: {
          type: "boolean",
          description: "Required for directories with more than 50 items. Default: false.",
        },
      },
      required: ["file_path"],
    },
    requiresPermission: true,
    permissionMessage: (input) => {
      const recursive = input.recursive ? " (recursive)" : "";
      return `Delete${recursive}: ${input.file_path}`;
    },
  };

  private workingDir: string;
  private sandboxManager?: SandboxManager;

  constructor(workingDir: string, sandboxManager?: SandboxManager) {
    this.workingDir = workingDir;
    this.sandboxManager = sandboxManager;
  }

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    let filePath: string;
    try {
      filePath = safePath(input.file_path as string, this.workingDir);
    } catch (err) {
      return { success: false, output: "", error: (err as Error).message };
    }

    const recursive = (input.recursive as boolean) || false;
    const force = (input.force as boolean) || false;

    // Sandbox write check (deletion requires write access to parent)
    if (this.sandboxManager) {
      const check = this.sandboxManager.checkFileWrite(filePath);
      if (!check.allowed) {
        return { success: false, output: "", error: check.reason || "Sandbox: delete access denied" };
      }
    }

    // Existence check
    if (!fs.existsSync(filePath)) {
      return { success: false, output: "", error: `Path not found: ${filePath}` };
    }

    const stat = fs.statSync(filePath);

    // ── File deletion ─────────────────────────────────────────────────────────
    if (stat.isFile() || stat.isSymbolicLink()) {
      try {
        fs.unlinkSync(filePath);
        return { success: true, output: `Deleted file: ${filePath}` };
      } catch (err) {
        return { success: false, output: "", error: `Failed to delete: ${(err as Error).message}` };
      }
    }

    // ── Directory deletion ────────────────────────────────────────────────────
    if (!stat.isDirectory()) {
      return { success: false, output: "", error: `Unsupported file type at: ${filePath}` };
    }

    if (!recursive) {
      // Show what's inside so the user can make an informed decision
      const entries = fs.readdirSync(filePath);
      const preview = entries.slice(0, 10).join(", ");
      const more = entries.length > 10 ? ` ... and ${entries.length - 10} more` : "";
      return {
        success: false,
        output: "",
        error: `"${filePath}" is a directory with ${entries.length} items (${preview}${more}). Set recursive=true to delete it and all its contents.`,
      };
    }

    // Count files before deleting
    const fileCount = this.countItems(filePath);

    if (fileCount > MAX_DIR_FILES && !force) {
      return {
        success: false,
        output: "",
        error: `Directory contains ${fileCount} items. Set force=true to confirm bulk deletion of "${filePath}".`,
      };
    }

    try {
      fs.rmSync(filePath, { recursive: true, force: true });
      return {
        success: true,
        output: `Deleted directory: ${filePath} (${fileCount} items removed)`,
      };
    } catch (err) {
      return { success: false, output: "", error: `Failed to delete directory: ${(err as Error).message}` };
    }
  }

  private countItems(dirPath: string, limit = 10000): number {
    let count = 0;
    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        count++;
        if (count >= limit) return count;
        if (entry.isDirectory()) {
          count += this.countItems(path.join(dirPath, entry.name), limit - count);
          if (count >= limit) return count;
        }
      }
    } catch {
      // Permission denied — count what we can
    }
    return count;
  }
}
