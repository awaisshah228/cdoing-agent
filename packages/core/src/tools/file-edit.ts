import * as fs from "fs";
import * as path from "path";
import type { BaseTool, ToolDefinition, ToolResult } from "./types";

export class FileEditTool implements BaseTool {
  definition: ToolDefinition = {
    name: "file_edit",
    description:
      "Edit a file by replacing an exact string match with new content. The old_string must match exactly (including whitespace and indentation). Use this for precise, targeted edits.",
    inputSchema: {
      type: "object",
      properties: {
        file_path: {
          type: "string",
          description: "Path to the file to edit",
        },
        old_string: {
          type: "string",
          description: "The exact string to find and replace. Must be unique in the file.",
        },
        new_string: {
          type: "string",
          description: "The replacement string",
        },
        replace_all: {
          type: "boolean",
          description: "Replace all occurrences (default: false)",
        },
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
    const filePath = this.resolvePath(input.file_path as string);
    const oldString = input.old_string as string;
    const newString = input.new_string as string;
    const replaceAll = (input.replace_all as boolean) || false;

    if (!fs.existsSync(filePath)) {
      return { success: false, output: "", error: `File not found: ${filePath}` };
    }

    const content = fs.readFileSync(filePath, "utf-8");

    if (!content.includes(oldString)) {
      return {
        success: false,
        output: "",
        error: `old_string not found in ${filePath}. Make sure you're matching the exact content including whitespace.`,
      };
    }

    if (!replaceAll) {
      const firstIndex = content.indexOf(oldString);
      const lastIndex = content.lastIndexOf(oldString);
      if (firstIndex !== lastIndex) {
        return {
          success: false,
          output: "",
          error: `old_string has multiple matches in ${filePath}. Provide more context to make it unique, or set replace_all to true.`,
        };
      }
    }

    const updated = replaceAll
      ? content.split(oldString).join(newString)
      : content.replace(oldString, newString);

    fs.writeFileSync(filePath, updated, "utf-8");

    const occurrences = replaceAll
      ? content.split(oldString).length - 1
      : 1;

    return {
      success: true,
      output: `Edited ${filePath}: replaced ${occurrences} occurrence(s)`,
    };
  }

  private resolvePath(filePath: string): string {
    if (path.isAbsolute(filePath)) return filePath;
    return path.resolve(this.workingDir, filePath);
  }
}
