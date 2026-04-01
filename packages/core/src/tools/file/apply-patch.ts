/**
 * Apply Patch Tool — apply unified diff patches to files.
 *
 * Supports operations: add (create new file), update (modify existing),
 * delete (remove file), and move (rename + update).
 *
 * Reuses the existing applyUnifiedDiff() utility from search-match.ts.
 */

import * as fs from "fs";
import * as path from "path";
import type { BaseTool, ToolDefinition, ToolResult } from "../types";
import type { SandboxManager } from "../../sandbox";
import { safePath } from "../../utils/path-safety";
import { applyUnifiedDiff } from "../../utils/search-match";

/** Parsed file operation from a patch */
interface PatchOperation {
  type: "add" | "update" | "delete" | "move";
  filePath: string;
  moveTo?: string;
  diff: string;
}

export class ApplyPatchTool implements BaseTool {
  // ── Behavioral flags ──
  concurrencyMode = () => "parallel-file" as const;
  getFilePath = (input: Record<string, unknown>) => input.file_path as string | undefined;
  definition: ToolDefinition = {
    name: "apply_patch",
    description:
      "Apply a unified diff patch to one or more files. Supports creating, updating, deleting, and moving files. Use this for bulk changes or when you have a complete diff to apply.",
    inputSchema: {
      type: "object",
      properties: {
        patch: {
          type: "string",
          description:
            "The unified diff patch text. Must include file headers (--- a/path, +++ b/path) and @@ hunk headers.",
        },
      },
      required: ["patch"],
    },
    requiresPermission: true,
    permissionMessage: (input) => {
      const patch = String(input.patch || "");
      const files = extractFilePathsFromPatch(patch);
      return files.length > 0
        ? `Apply patch to: ${files.join(", ")}`
        : "Apply unified diff patch";
    },
  };

  private workingDir: string;
  private sandboxManager?: SandboxManager;

  constructor(workingDir: string, sandboxManager?: SandboxManager) {
    this.workingDir = workingDir;
    this.sandboxManager = sandboxManager;
  }

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const patch = String(input.patch || "").trim();
    if (!patch) {
      return { success: false, output: "", error: "Empty patch provided" };
    }

    try {
      const operations = parsePatch(patch);
      if (operations.length === 0) {
        return { success: false, output: "", error: "No valid operations found in patch" };
      }

      const results: string[] = [];
      let totalAdded = 0;
      let totalRemoved = 0;

      for (const op of operations) {
        const absPath = safePath(this.workingDir, op.filePath);

        // Sandbox check for all write operations
        if (this.sandboxManager && op.type !== "delete") {
          const target = op.moveTo ? safePath(this.workingDir, op.moveTo) : absPath;
          const check = this.sandboxManager.checkFileWrite(target);
          if (!check.allowed) {
            results.push(`BLOCKED ${op.filePath}: ${check.reason}`);
            continue;
          }
        }

        switch (op.type) {
          case "add": {
            const dir = path.dirname(absPath);
            if (!fs.existsSync(dir)) {
              fs.mkdirSync(dir, { recursive: true });
            }
            // Extract new content from diff (lines starting with +)
            const newContent = extractAddedContent(op.diff);
            fs.writeFileSync(absPath, newContent, "utf-8");
            const lines = newContent.split("\n").length;
            totalAdded += lines;
            results.push(`A ${op.filePath} (+${lines} lines)`);
            break;
          }

          case "update": {
            if (!fs.existsSync(absPath)) {
              results.push(`SKIP ${op.filePath}: file not found`);
              continue;
            }
            const original = fs.readFileSync(absPath, "utf-8");
            const updated = applyUnifiedDiff(original, op.diff);
            fs.writeFileSync(absPath, updated, "utf-8");

            const origLines = original.split("\n").length;
            const updatedLines = updated.split("\n").length;
            const added = Math.max(0, updatedLines - origLines);
            const removed = Math.max(0, origLines - updatedLines);
            totalAdded += added;
            totalRemoved += removed;
            results.push(`M ${op.filePath} (+${added}/-${removed})`);
            break;
          }

          case "delete": {
            if (!fs.existsSync(absPath)) {
              results.push(`SKIP ${op.filePath}: already deleted`);
              continue;
            }
            if (this.sandboxManager) {
              const check = this.sandboxManager.checkFileWrite(absPath);
              if (!check.allowed) {
                results.push(`BLOCKED ${op.filePath}: ${check.reason}`);
                continue;
              }
            }
            const content = fs.readFileSync(absPath, "utf-8");
            totalRemoved += content.split("\n").length;
            fs.unlinkSync(absPath);
            results.push(`D ${op.filePath}`);
            break;
          }

          case "move": {
            if (!op.moveTo) {
              results.push(`SKIP ${op.filePath}: move target not specified`);
              continue;
            }
            const moveTarget = safePath(this.workingDir, op.moveTo);
            const moveDir = path.dirname(moveTarget);
            if (!fs.existsSync(moveDir)) {
              fs.mkdirSync(moveDir, { recursive: true });
            }
            if (fs.existsSync(absPath)) {
              let content = fs.readFileSync(absPath, "utf-8");
              // Apply diff if present
              if (op.diff && op.diff.includes("@@")) {
                content = applyUnifiedDiff(content, op.diff);
              }
              fs.writeFileSync(moveTarget, content, "utf-8");
              fs.unlinkSync(absPath);
              results.push(`R ${op.filePath} → ${op.moveTo}`);
            } else {
              results.push(`SKIP ${op.filePath}: source not found for move`);
            }
            break;
          }
        }
      }

      const summary = `Applied patch: ${results.length} operations (+${totalAdded}/-${totalRemoved} lines)`;
      return {
        success: true,
        output: `${summary}\n${results.join("\n")}`,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, output: "", error: `Patch failed: ${message}` };
    }
  }
}

/** Parse a unified diff into individual file operations */
function parsePatch(patch: string): PatchOperation[] {
  const operations: PatchOperation[] = [];
  // Split by diff file headers
  const fileSections = patch.split(/^diff --git /m).filter(Boolean);

  for (const section of fileSections) {
    const lines = section.split("\n");
    let oldPath = "";
    let newPath = "";
    let diffContent = "";

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith("--- a/") || line.startsWith("--- ")) {
        oldPath = line.replace(/^---\s+(?:a\/)?/, "").trim();
        if (oldPath === "/dev/null") oldPath = "";
      } else if (line.startsWith("+++ b/") || line.startsWith("+++ ")) {
        newPath = line.replace(/^\+\+\+\s+(?:b\/)?/, "").trim();
        if (newPath === "/dev/null") newPath = "";
      } else if (line.startsWith("@@") || line.startsWith("+") || line.startsWith("-") || line.startsWith(" ")) {
        diffContent += line + "\n";
      }
    }

    // Also try to get paths from the diff --git header line
    if (!oldPath && !newPath) {
      const headerMatch = lines[0]?.match(/^a\/(.+?)\s+b\/(.+)/);
      if (headerMatch) {
        oldPath = headerMatch[1];
        newPath = headerMatch[2];
      }
    }

    if (!oldPath && !newPath) continue;

    let type: PatchOperation["type"];
    if (!oldPath && newPath) {
      type = "add";
    } else if (oldPath && !newPath) {
      type = "delete";
    } else if (oldPath && newPath && oldPath !== newPath) {
      type = "move";
    } else {
      type = "update";
    }

    operations.push({
      type,
      filePath: type === "add" ? newPath : oldPath,
      moveTo: type === "move" ? newPath : undefined,
      diff: diffContent.trim(),
    });
  }

  // Handle simple patches without "diff --git" header
  if (operations.length === 0 && patch.includes("@@")) {
    let oldPath = "";
    let newPath = "";
    const lines = patch.split("\n");
    for (const line of lines) {
      if (line.startsWith("--- ")) oldPath = line.replace(/^---\s+(?:a\/)?/, "").trim();
      if (line.startsWith("+++ ")) newPath = line.replace(/^\+\+\+\s+(?:b\/)?/, "").trim();
    }
    if (oldPath === "/dev/null") oldPath = "";
    if (newPath === "/dev/null") newPath = "";
    const filePath = newPath || oldPath;
    if (filePath) {
      operations.push({
        type: !oldPath ? "add" : !newPath ? "delete" : "update",
        filePath,
        diff: patch,
      });
    }
  }

  return operations;
}

/** Extract file paths from a patch for permission messages */
function extractFilePathsFromPatch(patch: string): string[] {
  const paths = new Set<string>();
  const lines = patch.split("\n");
  for (const line of lines) {
    if (line.startsWith("--- a/") || line.startsWith("+++ b/")) {
      const p = line.replace(/^(?:---|\+\+\+)\s+(?:[ab]\/)?/, "").trim();
      if (p && p !== "/dev/null") paths.add(p);
    }
  }
  return Array.from(paths);
}

/** Extract content from added lines in a diff (for new files) */
function extractAddedContent(diff: string): string {
  const lines = diff.split("\n");
  const addedLines: string[] = [];
  for (const line of lines) {
    if (line.startsWith("+") && !line.startsWith("+++")) {
      addedLines.push(line.substring(1));
    }
  }
  return addedLines.join("\n");
}
