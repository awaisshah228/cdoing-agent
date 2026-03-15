/**
 * Folder Context Provider — @folder
 *
 * Includes all files from a directory as context.
 * Usage:
 *   @folder src/utils     — include all files from src/utils
 *   @folder src/api 5     — include files, max 5 files
 */

import * as fs from "fs";
import * as path from "path";
import type { ContextProvider, ContextResult, ContextResolveOptions } from "./types";

const MAX_FILES = 20;
const MAX_FILE_CHARS = 3000;
const MAX_TOTAL_CHARS = 50000;

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", "__pycache__", ".cache", "coverage"]);

export class FolderContextProvider implements ContextProvider {
  id = "folder";
  trigger = "@folder";
  description = "Include all files from a directory as context";
  requiresArg = true;

  async resolve(arg?: string, options?: ContextResolveOptions): Promise<ContextResult> {
    if (!arg?.trim()) {
      return { label: "Folder", content: "Usage: @folder <directory> [maxFiles]" };
    }

    const parts = arg.trim().split(/\s+/);
    const dirPath = parts[0];
    const maxFiles = parseInt(parts[1], 10) || MAX_FILES;
    const workingDir = options?.workingDir || process.cwd();
    const fullPath = path.isAbsolute(dirPath) ? dirPath : path.resolve(workingDir, dirPath);

    if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isDirectory()) {
      return { label: "Folder", content: `Directory not found: ${dirPath}` };
    }

    const files = this.collectFiles(fullPath, maxFiles);
    if (files.length === 0) {
      return { label: `Folder: ${dirPath}`, content: `No files found in ${dirPath}` };
    }

    let totalChars = 0;
    const sections: string[] = [`## Folder: ${dirPath} (${files.length} files)`];

    for (const file of files) {
      if (totalChars >= MAX_TOTAL_CHARS) {
        sections.push(`\n... [truncated, ${MAX_TOTAL_CHARS} char limit reached]`);
        break;
      }

      const rel = path.relative(fullPath, file);
      try {
        let content = fs.readFileSync(file, "utf-8");
        if (content.length > MAX_FILE_CHARS) {
          content = content.substring(0, MAX_FILE_CHARS) + "\n... [truncated]";
        }
        const ext = path.extname(file).substring(1) || "txt";
        sections.push(`\n### ${rel}\n\`\`\`${ext}\n${content}\n\`\`\``);
        totalChars += content.length;
      } catch {
        sections.push(`\n### ${rel}\n(unable to read)`);
      }
    }

    return {
      label: `Folder: ${dirPath}`,
      content: sections.join("\n"),
      metadata: { itemCount: files.length },
    };
  }

  private collectFiles(dir: string, limit: number): string[] {
    const result: string[] = [];
    this.walk(dir, result, limit);
    return result;
  }

  private walk(dir: string, result: string[], limit: number): void {
    if (result.length >= limit) return;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    // Files first, then directories
    const files = entries.filter((e) => e.isFile());
    const dirs = entries.filter((e) => e.isDirectory() && !SKIP_DIRS.has(e.name) && !e.name.startsWith("."));

    for (const f of files) {
      if (result.length >= limit) return;
      result.push(path.join(dir, f.name));
    }

    for (const d of dirs) {
      if (result.length >= limit) return;
      this.walk(path.join(dir, d.name), result, limit);
    }
  }
}
