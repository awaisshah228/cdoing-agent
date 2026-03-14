import * as fs from "fs";
import * as path from "path";
import type { BaseTool, ToolDefinition, ToolResult } from "./types";

export class FileReadTool implements BaseTool {
  definition: ToolDefinition = {
    name: "file_read",
    description:
      "Read the contents of a file. Returns content with line numbers. Always read before editing.",
    inputSchema: {
      type: "object",
      properties: {
        file_path: {
          type: "string",
          description: "Path to the file to read",
        },
        offset: {
          type: "number",
          description: "Line number to start from (1-based). Optional.",
        },
        limit: {
          type: "number",
          description: "Max lines to read. Default: 2000.",
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
    const filePath = this.resolve(input.file_path as string);
    const offset = (input.offset as number) || 1;
    const limit = (input.limit as number) || 2000;

    if (!fs.existsSync(filePath))
      return { success: false, output: "", error: `File not found: ${filePath}` };
    if (fs.statSync(filePath).isDirectory())
      return { success: false, output: "", error: `Path is a directory: ${filePath}` };

    const lines = fs.readFileSync(filePath, "utf-8").split("\n");
    const selected = lines.slice(offset - 1, offset - 1 + limit);
    const numbered = selected
      .map((line, i) => `${String(offset + i).padStart(5)}  ${line}`)
      .join("\n");

    return { success: true, output: numbered || "(empty file)" };
  }

  private resolve(p: string): string {
    return path.isAbsolute(p) ? p : path.resolve(this.workingDir, p);
  }
}
