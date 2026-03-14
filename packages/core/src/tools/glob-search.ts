import { glob } from "glob";
import * as path from "path";
import type { BaseTool, ToolDefinition, ToolResult } from "./types";

export class GlobSearchTool implements BaseTool {
  definition: ToolDefinition = {
    name: "glob_search",
    description:
      "Search for files matching a glob pattern. Returns a list of matching file paths sorted by modification time. Use patterns like '**/*.ts', 'src/**/*.js', '*.json'.",
    inputSchema: {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description: "Glob pattern to match files (e.g., '**/*.ts', 'src/**/*.js')",
        },
        directory: {
          type: "string",
          description: "Directory to search in. Defaults to the working directory.",
        },
      },
      required: ["pattern"],
    },
    requiresPermission: false,
  };

  private workingDir: string;

  constructor(workingDir: string) {
    this.workingDir = workingDir;
  }

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const pattern = input.pattern as string;
    const directory = (input.directory as string) || this.workingDir;
    const searchDir = path.isAbsolute(directory)
      ? directory
      : path.resolve(this.workingDir, directory);

    try {
      const files = await glob(pattern, {
        cwd: searchDir,
        nodir: true,
        ignore: ["**/node_modules/**", "**/dist/**", "**/.git/**"],
      });

      if (files.length === 0) {
        return { success: true, output: "No files found matching the pattern." };
      }

      const result = files
        .slice(0, 100)
        .map((f) => path.join(searchDir, f))
        .join("\n");

      const summary =
        files.length > 100
          ? `\n\n... and ${files.length - 100} more files (showing first 100)`
          : "";

      return {
        success: true,
        output: `Found ${files.length} file(s):\n${result}${summary}`,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, output: "", error: `Glob search failed: ${message}` };
    }
  }
}
