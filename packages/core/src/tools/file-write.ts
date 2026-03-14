import * as fs from "fs";
import * as path from "path";
import type { BaseTool, ToolDefinition, ToolResult } from "./types";

export class FileWriteTool implements BaseTool {
  definition: ToolDefinition = {
    name: "file_write",
    description:
      "Create or overwrite a file with the given content. Creates parent directories if needed.",
    inputSchema: {
      type: "object",
      properties: {
        file_path: {
          type: "string",
          description: "Path to the file to write",
        },
        content: {
          type: "string",
          description: "Content to write to the file",
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
    const filePath = this.resolve(input.file_path as string);
    const content = input.content as string;

    try {
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      const existed = fs.existsSync(filePath);
      fs.writeFileSync(filePath, content, "utf-8");
      const lines = content.split("\n").length;

      return {
        success: true,
        output: `${existed ? "Updated" : "Created"} file: ${filePath} (${lines} lines)`,
      };
    } catch (err) {
      return { success: false, output: "", error: `Failed to write: ${err}` };
    }
  }

  private resolve(p: string): string {
    return path.isAbsolute(p) ? p : path.resolve(this.workingDir, p);
  }
}
