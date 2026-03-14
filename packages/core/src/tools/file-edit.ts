import * as fs from "fs";
import * as path from "path";
import type { BaseTool, ToolDefinition, ToolResult } from "./types";

export class FileEditTool implements BaseTool {
  definition: ToolDefinition = {
    name: "file_edit",
    description:
      "Edit a file by replacing an exact string match with new content. The old_string must match exactly including whitespace.",
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
    const filePath = this.resolve(input.file_path as string);
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
    return { success: true, output: `Edited ${filePath}: replaced ${count} occurrence(s)` };
  }

  private resolve(p: string): string {
    return path.isAbsolute(p) ? p : path.resolve(this.workingDir, p);
  }
}
