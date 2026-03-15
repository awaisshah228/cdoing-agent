import * as fs from "fs";
import type { BaseTool, ToolDefinition, ToolResult } from "./types";
import { safePath } from "../utils/path-safety";
import { executeFindAndReplace, isUnifiedDiff, applyUnifiedDiff } from "../utils/search-match";
import { hasPlaceholders, expandPlaceholders } from "../utils/lazy-apply";
import type { SandboxManager } from "../sandbox";

export class FileEditTool implements BaseTool {
  definition: ToolDefinition = {
    name: "file_edit",
    description:
      `Performs string replacement in a file using multi-strategy matching (exact → trimmed → case-insensitive → whitespace-ignored). Also supports unified diff patches. Requires user permission. Access controlled by sandbox/permission rules.

IMPORTANT:
- Always read the file first before editing to see its current contents.
- old_string should match the file content — the system tolerates minor whitespace/case differences.
- old_string and new_string MUST be different.
- When not using replace_all, old_string must be unique in the file. Add more surrounding context if ambiguous.
- Use replace_all for renaming variables or strings across the file.
- You can pass a unified diff (with @@ hunk headers) as old_string and leave new_string empty to apply the diff patch directly.
- This tool CANNOT be called in parallel with itself on the SAME file.`,
    inputSchema: {
      type: "object",
      properties: {
        file_path: { type: "string", description: "Path to the file to edit" },
        old_string: { type: "string", description: "The text to replace — must match file content (exact match preferred, but tolerates whitespace/case differences)" },
        new_string: { type: "string", description: "The replacement text (MUST be different from old_string)" },
        replace_all: { type: "boolean", description: "Replace all occurrences (default: false)" },
      },
      required: ["file_path", "old_string", "new_string"],
    },
    requiresPermission: true,
    permissionMessage: (input) => `Edit file: ${input.file_path}`,
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

    const oldStr = input.old_string as string;
    const newStr = input.new_string as string;
    const replaceAll = (input.replace_all as boolean) || false;

    if (!fs.existsSync(filePath))
      return { success: false, output: "", error: `File not found: ${filePath}` };

    const content = fs.readFileSync(filePath, "utf-8");

    try {
      // Unified diff mode: detect @@ hunk headers in old_string
      if (isUnifiedDiff(oldStr)) {
        const result = applyUnifiedDiff(content, oldStr);
        fs.writeFileSync(filePath, result, "utf-8");
        return { success: true, output: `Applied unified diff patch to ${filePath}\n\n${oldStr}` };
      }

      // Lazy apply: expand placeholder markers in new_string before replacing
      let expandedNewStr = newStr;
      let lazyNote = "";
      if (hasPlaceholders(newStr)) {
        const { content: expanded, placeholdersExpanded, strategy: lazyStrategy } = expandPlaceholders(content, newStr);
        if (placeholdersExpanded > 0) {
          expandedNewStr = expanded;
          lazyNote = ` (lazy apply: ${placeholdersExpanded} placeholder(s) expanded via ${lazyStrategy})`;
        }
      }

      const { result, count, strategy } = executeFindAndReplace(content, oldStr, expandedNewStr, replaceAll);
      fs.writeFileSync(filePath, result, "utf-8");

      const diff = generateDiff(filePath, oldStr, expandedNewStr, count);
      const strategyNote = strategy !== "exact" ? ` (matched via ${strategy} strategy)` : "";
      return { success: true, output: `Edited ${filePath}: replaced ${count} occurrence(s)${strategyNote}${lazyNote}\n\n${diff}` };
    } catch (err) {
      return { success: false, output: "", error: (err as Error).message };
    }
  }
}

/** Generate a unified-style diff showing what changed */
function generateDiff(filePath: string, oldStr: string, newStr: string, count: number): string {
  const oldLines = oldStr.split("\n");
  const newLines = newStr.split("\n");

  const parts: string[] = [
    `--- a/${filePath}`,
    `+++ b/${filePath}`,
    `@@ -1,${oldLines.length} +1,${newLines.length} @@ (${count} replacement${count > 1 ? "s" : ""})`,
  ];

  for (const line of oldLines) parts.push(`- ${line}`);
  for (const line of newLines) parts.push(`+ ${line}`);

  return parts.join("\n");
}
