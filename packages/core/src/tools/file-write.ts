import * as fs from "fs";
import * as path from "path";
import type { BaseTool, ToolDefinition, ToolResult } from "./types";
import { safePath } from "../utils/path-safety";

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
    let filePath: string;
    try {
      filePath = safePath(input.file_path as string, this.workingDir);
    } catch (err) {
      return { success: false, output: "", error: (err as Error).message };
    }

    const content = input.content as string;

    try {
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      const existed = fs.existsSync(filePath);
      const oldContent = existed ? fs.readFileSync(filePath, "utf-8") : "";
      fs.writeFileSync(filePath, content, "utf-8");
      const lines = content.split("\n").length;

      // Generate diff for the extension to render
      let diff = "";
      if (existed && oldContent !== content) {
        const oldLines = oldContent.split("\n");
        const newLines = content.split("\n");
        diff = `--- a/${input.file_path}\n+++ b/${input.file_path}\n@@ -1,${oldLines.length} +1,${newLines.length} @@\n`;
        for (const line of oldLines) diff += `- ${line}\n`;
        for (const line of newLines) diff += `+ ${line}\n`;
      } else if (!existed) {
        const newLines = content.split("\n");
        diff = `--- /dev/null\n+++ b/${input.file_path}\n@@ -0,0 +1,${newLines.length} @@\n`;
        for (const line of newLines) diff += `+ ${line}\n`;
      }

      const summary = `${existed ? "Updated" : "Created"} file: ${filePath} (${lines} lines)`;
      return {
        success: true,
        output: diff ? `${summary}\n\n${diff}` : summary,
      };
    } catch (err) {
      return { success: false, output: "", error: `Failed to write: ${err}` };
    }
  }
}
