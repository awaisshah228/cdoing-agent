import { glob } from "glob";
import * as path from "path";
import type { BaseTool, ToolDefinition, ToolResult } from "../types";
import { loadIgnorePatterns } from "../../utils/gitignore";

export class GlobSearchTool implements BaseTool {
  definition: ToolDefinition = {
    name: "glob_search",
    description:
      "Search for files matching a glob pattern. Returns matching file paths sorted by modification time. Use patterns like '**/*.ts', 'src/**/*.js', '*.json'. Respects .gitignore. The search always starts from the project working directory — do NOT pass directory unless you specifically need a subdirectory (e.g. 'src/components'). Never pass '/' or an absolute path.",
    inputSchema: {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description: "Glob pattern to match files (e.g., '**/*.ts', 'src/**/*.js')",
        },
        directory: {
          type: "string",
          description: "Optional subdirectory to narrow the search (e.g. 'src/components'). Omit to search the entire project. Never use '/' or absolute paths.",
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
    const rawDir = (input.directory as string | undefined) || "";
    // Clamp to workingDir: reject "/" or paths outside the project
    let searchDir: string;
    if (!rawDir || rawDir === "/") {
      searchDir = this.workingDir;
    } else {
      const resolved = path.isAbsolute(rawDir)
        ? rawDir
        : path.resolve(this.workingDir, rawDir);
      // Don't allow searching outside the working directory
      searchDir = resolved.startsWith(this.workingDir) ? resolved : this.workingDir;
    }

    try {
      const ignorePatterns = loadIgnorePatterns(this.workingDir);
      const files = await glob(pattern, {
        cwd: searchDir,
        nodir: true,
        ignore: ignorePatterns,
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
