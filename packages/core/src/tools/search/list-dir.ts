/**
 * List Directory Tool — list directory contents with optional recursion.
 */

import * as fs from "fs";
import * as path from "path";
import type { BaseTool, ToolDefinition, ToolResult } from "../types";
import { safePath } from "../../utils/path-safety";
import { loadIgnorePatterns } from "../../utils/gitignore";
import type { SandboxManager } from "../../sandbox";

const DEFAULT_MAX_ENTRIES = 500;

export class ListDirTool implements BaseTool {
  definition: ToolDefinition = {
    name: "list_dir",
    description:
      `List directory contents. Shows files and subdirectories with type indicators. Respects .gitignore patterns.

Use this to understand directory structure before reading or editing files. Supports optional recursive listing with depth control.`,
    inputSchema: {
      type: "object",
      properties: {
        directory: {
          type: "string",
          description: "Directory path to list. Defaults to working directory.",
        },
        recursive: {
          type: "boolean",
          description: "List recursively. Default: false.",
        },
        max_depth: {
          type: "number",
          description: "Maximum depth for recursive listing. Default: 3.",
        },
      },
      required: [],
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
    const dirInput = (input.directory as string) || ".";
    const recursive = (input.recursive as boolean) || false;
    const maxDepth = (input.max_depth as number) || 3;

    let dirPath: string;
    try {
      dirPath = safePath(dirInput, this.workingDir);
    } catch (err) {
      return { success: false, output: "", error: (err as Error).message };
    }

    // Sandbox read check
    if (this.sandboxManager) {
      const check = this.sandboxManager.checkFileRead(dirPath);
      if (!check.allowed) {
        return { success: false, output: "", error: check.reason || "Sandbox: read access denied" };
      }
    }

    if (!fs.existsSync(dirPath)) {
      return { success: false, output: "", error: `Directory not found: ${dirPath}` };
    }

    if (!fs.statSync(dirPath).isDirectory()) {
      return { success: false, output: "", error: `Not a directory: ${dirPath}` };
    }

    const ignorePatterns = loadIgnorePatterns(this.workingDir);
    const entries: string[] = [];

    try {
      this.listEntries(dirPath, "", recursive ? maxDepth : 0, 0, entries, ignorePatterns);
    } catch (err) {
      return { success: false, output: "", error: `Failed to list: ${(err as Error).message}` };
    }

    if (entries.length === 0) {
      return { success: true, output: `${dirPath}: (empty directory)` };
    }

    const truncated = entries.length > DEFAULT_MAX_ENTRIES;
    const shown = truncated ? entries.slice(0, DEFAULT_MAX_ENTRIES) : entries;
    const suffix = truncated ? `\n\n... and ${entries.length - DEFAULT_MAX_ENTRIES} more entries (truncated)` : "";

    return {
      success: true,
      output: `${dirPath}:\n${shown.join("\n")}${suffix}`,
    };
  }

  private listEntries(
    basePath: string,
    prefix: string,
    maxDepth: number,
    currentDepth: number,
    result: string[],
    ignorePatterns: string[],
  ): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(basePath, { withFileTypes: true });
    } catch {
      return; // Permission denied
    }

    // Sort: directories first, then alphabetical
    entries.sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name);
    });

    for (const entry of entries) {
      if (result.length >= DEFAULT_MAX_ENTRIES * 2) return;

      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;

      // Skip ignored patterns
      if (this.shouldIgnore(entry.name, relativePath, ignorePatterns)) continue;

      const indent = "  ".repeat(currentDepth);
      if (entry.isDirectory()) {
        result.push(`${indent}${entry.name}/`);
        if (currentDepth < maxDepth) {
          this.listEntries(
            path.join(basePath, entry.name),
            relativePath,
            maxDepth,
            currentDepth + 1,
            result,
            ignorePatterns,
          );
        }
      } else {
        const size = this.getFileSize(path.join(basePath, entry.name));
        result.push(`${indent}${entry.name}${size ? `  (${size})` : ""}`);
      }
    }
  }

  private shouldIgnore(name: string, relativePath: string, patterns: string[]): boolean {
    // Always ignore these
    if (name === ".git" || name === "node_modules" || name === ".DS_Store") return true;
    // Check gitignore patterns (simple prefix/suffix matching)
    for (const p of patterns) {
      if (p === name || relativePath.startsWith(p) || relativePath.endsWith(p)) return true;
    }
    return false;
  }

  private getFileSize(filePath: string): string {
    try {
      const stat = fs.statSync(filePath);
      const bytes = stat.size;
      if (bytes < 1024) return `${bytes}B`;
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
      return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
    } catch {
      return "";
    }
  }
}
