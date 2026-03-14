import * as fs from "fs";
import type { BaseTool, ToolDefinition, ToolResult } from "./types";
import { safePath } from "../utils/path-safety";

export class FileEditTool implements BaseTool {
  definition: ToolDefinition = {
    name: "file_edit",
    description:
      "Edit a file by replacing an exact string match with new content. The old_string must match exactly including whitespace. Returns a unified diff of the changes.",
    inputSchema: {
      type: "object",
      properties: {
        file_path: { type: "string", description: "Path to the file to edit" },
        old_string: { type: "string", description: "Exact string to find and replace" },
        new_string: { type: "string", description: "Replacement string" },
        replace_all: { type: "boolean", description: "Replace all occurrences (default: false)" },
      },
      required: ["file_path", "old_string", "new_string"],
    },
    requiresPermission: true,
    permissionMessage: (input) => `Edit file: ${input.file_path}`,
  };

  private workingDir: string;
  constructor(workingDir: string) {
    this.workingDir = workingDir;
  }

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    let filePath: string;
    try {
      filePath = safePath(input.file_path as string, this.workingDir);
    } catch (err) {
      return { success: false, output: "", error: (err as Error).message };
    }

    const oldStr = input.old_string as string;
    const newStr = input.new_string as string;
    const replaceAll = (input.replace_all as boolean) || false;

    if (!fs.existsSync(filePath))
      return { success: false, output: "", error: `File not found: ${filePath}` };

    const content = fs.readFileSync(filePath, "utf-8");
    if (!content.includes(oldStr))
      return { success: false, output: "", error: `old_string not found in ${filePath}` };

    if (!replaceAll) {
      const first = content.indexOf(oldStr);
      const last = content.lastIndexOf(oldStr);
      if (first !== last)
        return { success: false, output: "", error: `Multiple matches found. Use replace_all or add more context.` };
    }

    const updated = replaceAll
      ? content.split(oldStr).join(newStr)
      : content.replace(oldStr, newStr);

    fs.writeFileSync(filePath, updated, "utf-8");
    const count = replaceAll ? content.split(oldStr).length - 1 : 1;

    // Generate a simple diff
    const diff = generateDiff(filePath, oldStr, newStr, count);

    return { success: true, output: `Edited ${filePath}: replaced ${count} occurrence(s)\n\n${diff}` };
  }
}

/** Generate a unified-style diff showing what changed */
function generateDiff(filePath: string, oldStr: string, newStr: string, count: number): string {
  const oldLines = oldStr.split("\n");
  const newLines = newStr.split("\n");

  const parts: string[] = [`--- a/${filePath}`, `+++ b/${filePath}`, `@@ -1,${oldLines.length} +1,${newLines.length} @@ (${count} replacement${count > 1 ? "s" : ""})`];

  for (const line of oldLines) {
    parts.push(`- ${line}`);
  }
  for (const line of newLines) {
    parts.push(`+ ${line}`);
  }

  return parts.join("\n");
}
