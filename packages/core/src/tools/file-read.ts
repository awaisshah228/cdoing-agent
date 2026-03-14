import * as fs from "fs";
import * as path from "path";
import type { BaseTool, ToolDefinition, ToolResult } from "./types";

export class FileReadTool implements BaseTool {
  definition: ToolDefinition = {
    name: "file_read",
    description:
      "Read the contents of a file. Returns the file content with line numbers. Use this to understand existing code before making changes.",
    inputSchema: {
      type: "object",
      properties: {
        file_path: {
          type: "string",
          description: "Absolute or relative path to the file to read",
        },
        offset: {
          type: "number",
          description: "Line number to start reading from (1-based). Optional.",
        },
        limit: {
          type: "number",
          description: "Maximum number of lines to read. Optional, defaults to 2000.",
        },
      },
      required: ["file_path"],
    },
    requiresPermission: false,
  };

  private workingDir: string;

  constructor(workingDir: string) {
    this.workingDir = workingDir;
  }

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const filePath = this.resolvePath(input.file_path as string);
    const offset = (input.offset as number) || 1;
    const limit = (input.limit as number) || 2000;

    if (!fs.existsSync(filePath)) {
      return { success: false, output: "", error: `File not found: ${filePath}` };
    }

    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      return { success: false, output: "", error: `Path is a directory, not a file: ${filePath}` };
    }

    const content = fs.readFileSync(filePath, "utf-8");
    const lines = content.split("\n");
    const selectedLines = lines.slice(offset - 1, offset - 1 + limit);

    const numbered = selectedLines
      .map((line, i) => `${String(offset + i).padStart(5)}  ${line}`)
      .join("\n");

    return {
      success: true,
      output: numbered || "(empty file)",
    };
  }

  private resolvePath(filePath: string): string {
    if (path.isAbsolute(filePath)) return filePath;
    return path.resolve(this.workingDir, filePath);
  }
}
