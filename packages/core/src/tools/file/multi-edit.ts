/**
 * Multi Edit Tool — apply multiple find-and-replace edits to a single file atomically.
 *
 * Edits are applied sequentially (each operates on the result of the previous).
 * If any edit fails, none are applied. Uses multi-strategy matching.
 */

import * as fs from "fs";
import type { BaseTool, ToolDefinition, ToolResult } from "../types";
import { safePath } from "../../utils/path-safety";
import { executeMultiFindAndReplace } from "../../utils/search-match";
import type { SandboxManager } from "../../sandbox";

export class MultiEditTool implements BaseTool {
  // ── Behavioral flags ──
  concurrencyMode = () => "parallel-file" as const;
  getFilePath = (input: Record<string, unknown>) => input.file_path as string | undefined;

  definition: ToolDefinition = {
    name: "multi_edit",
    description:
      `Apply multiple find-and-replace edits to a single file in one atomic operation. Uses multi-strategy matching (exact → trimmed → case-insensitive → whitespace-ignored). Requires user permission.

Use this when you need to make several changes to different parts of the same file. This is more efficient than multiple file_edit calls and ensures all changes are applied together.

IMPORTANT:
- Always read the file first to see its current contents.
- All edits are applied sequentially — each edit operates on the result of the previous one.
- Edits are ATOMIC: if any edit fails, none are applied.
- old_string and new_string in each edit MUST be different.
- Plan edit order carefully — earlier edits change the text that later edits search in.
- This tool CANNOT be called in parallel with itself or file_edit on the SAME file.`,
    inputSchema: {
      type: "object",
      properties: {
        file_path: {
          type: "string",
          description: "Path to the file to edit",
        },
        edits: {
          type: "array",
          description: "Array of edit operations to apply sequentially",
          items: {
            type: "object",
            properties: {
              old_string: {
                type: "string",
                description: "The text to replace (matches with tolerance for whitespace/case differences)",
              },
              new_string: {
                type: "string",
                description: "The replacement text (MUST be different from old_string)",
              },
              replace_all: {
                type: "boolean",
                description: "Replace all occurrences of old_string (default: false)",
              },
            },
            required: ["old_string", "new_string"],
          },
        },
      },
      required: ["file_path", "edits"],
    },
    requiresPermission: true,
    permissionMessage: (input) => {
      const edits = input.edits as unknown[];
      return `Multi-edit file: ${input.file_path} (${Array.isArray(edits) ? edits.length : "?"} edits)`;
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

    // Sandbox write check
    if (this.sandboxManager) {
      const check = this.sandboxManager.checkFileWrite(filePath);
      if (!check.allowed) {
        return { success: false, output: "", error: check.reason || "Sandbox: write access denied" };
      }
    }

    const edits = input.edits as Array<{ old_string: string; new_string: string; replace_all?: boolean }>;

    // Validation
    if (!Array.isArray(edits) || edits.length === 0) {
      return { success: false, output: "", error: "edits must be a non-empty array" };
    }

    for (let i = 0; i < edits.length; i++) {
      const e = edits[i];
      if (!e.old_string && i > 0) {
        return { success: false, output: "", error: `Edit ${i + 1}: only the first edit may have an empty old_string (insertion at beginning)` };
      }
      if (e.old_string === e.new_string) {
        return { success: false, output: "", error: `Edit ${i + 1}: old_string and new_string are identical` };
      }
    }

    if (!fs.existsSync(filePath))
      return { success: false, output: "", error: `File not found: ${filePath}` };

    const content = fs.readFileSync(filePath, "utf-8");

    try {
      const { result, totalCount } = executeMultiFindAndReplace(content, edits);
      fs.writeFileSync(filePath, result, "utf-8");

      // Generate summary diff
      const diffLines: string[] = [
        `--- a/${filePath}`,
        `+++ b/${filePath}`,
      ];
      for (let i = 0; i < edits.length; i++) {
        const e = edits[i];
        diffLines.push(`@@ Edit ${i + 1}/${edits.length} @@`);
        for (const line of e.old_string.split("\n")) diffLines.push(`- ${line}`);
        for (const line of e.new_string.split("\n")) diffLines.push(`+ ${line}`);
      }

      return {
        success: true,
        output: `Multi-edited ${filePath}: ${edits.length} edit(s), ${totalCount} total replacement(s)\n\n${diffLines.join("\n")}`,
      };
    } catch (err) {
      return { success: false, output: "", error: (err as Error).message };
    }
  }
}
