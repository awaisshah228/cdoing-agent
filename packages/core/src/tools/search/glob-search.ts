import { glob } from "glob";
import * as path from "path";
import type { BaseTool, ToolDefinition, ToolResult } from "../types";
import { loadIgnorePatterns } from "../../utils/gitignore";
import type { SandboxManager } from "../../sandbox";

export class GlobSearchTool implements BaseTool {
  // ── Behavioral flags ──
  isReadOnly = () => true;
  concurrencyMode = () => "parallel" as const;

  definition: ToolDefinition = {
    name: "glob_search",
    description:
      "Search for files matching a glob pattern. Returns matching file paths sorted by modification time. Use patterns like '**/*.ts', 'src/**/*.js', '*.json'. Respects .gitignore and sandbox read restrictions. The search always starts from the project working directory — do NOT pass directory unless you specifically need a subdirectory (e.g. 'src/components'). Never pass '/' or an absolute path.",
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
  private sandboxManager?: SandboxManager;

  constructor(workingDir: string, sandboxManager?: SandboxManager) {
    this.workingDir = workingDir;
    this.sandboxManager = sandboxManager;
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

    // Sandbox: check if search directory itself is readable
    if (this.sandboxManager) {
      const dirCheck = this.sandboxManager.checkFileRead(searchDir);
      if (!dirCheck.allowed) {
        return { success: false, output: "", error: dirCheck.reason || "Sandbox: read access denied for search directory" };
      }
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

      // Filter results through sandbox read checks
      let filteredFiles = files.map((f) => path.join(searchDir, f));
      if (this.sandboxManager) {
        filteredFiles = filteredFiles.filter((fullPath) => {
          const check = this.sandboxManager!.checkFileRead(fullPath);
          return check.allowed;
        });
      }

      if (filteredFiles.length === 0) {
        return { success: true, output: "No accessible files found matching the pattern." };
      }

      const result = filteredFiles
        .slice(0, 100)
        .join("\n");

      const summary =
        filteredFiles.length > 100
          ? `\n\n... and ${filteredFiles.length - 100} more files (showing first 100)`
          : "";

      return {
        success: true,
        output: `Found ${filteredFiles.length} file(s):\n${result}${summary}`,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, output: "", error: `Glob search failed: ${message}` };
    }
  }
}
