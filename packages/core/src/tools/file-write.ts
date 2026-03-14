import * as fs from "fs";
import * as path from "path";
import type { BaseTool, ToolDefinition, ToolResult } from "./types";

export class FileWriteTool implements BaseTool {
  definition: ToolDefinition = {
    name: "file_write",
    description:
      "Create a new file or overwrite an existing file with the given content. Creates parent directories if they don't exist.",
    inputSchema: {
      type: "object",
      properties: {
        file_path: {
          type: "string",
          description: "Absolute or relative path to the file to write",
        },
        content: {
          type: "string",
          description: "The content to write to the file",
        },
      },
      required: ["file_path", "content"],
    },
    requiresPermission: true,
    permissionMessage: (input) => `Write to file: ${input.file_path}`,
  };

  private workingDir: string;

  constructor(workingDir: string) {
    this.workingDir = workingDir;
  }

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const filePath = this.resolvePath(input.file_path as string);
    const content = input.content as string;

    try {
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const existed = fs.existsSync(filePath);
      fs.writeFileSync(filePath, content, "utf-8");

      const lineCount = content.split("\n").length;
      const action = existed ? "Updated" : "Created";

      return {
        success: true,
        output: `${action} file: ${filePath} (${lineCount} lines)`,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, output: "", error: `Failed to write file: ${message}` };
    }
  }

  private resolvePath(filePath: string): string {
    if (path.isAbsolute(filePath)) return filePath;
    return path.resolve(this.workingDir, filePath);
  }
}
