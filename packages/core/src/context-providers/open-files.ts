/**
 * Open Files Context Provider — @open
 *
 * Attaches the content of all currently open editor tabs.
 * Useful for providing broad context about what the user is working on.
 *
 * How it works:
 *   1. Receives list of open file paths from the IDE
 *   2. Reads each file's content
 *   3. Formats them with file headers for the LLM
 *   4. Applies smart truncation for large files
 *
 * Learning note: We truncate large files rather than skipping them
 * entirely — the file header + first N lines still provides useful
 * context about the file's purpose and structure.
 */

import * as fs from "fs";
import * as path from "path";
import type { ContextProvider, ContextResult, ContextResolveOptions } from "./types";

/** Max chars per file before truncation */
const PER_FILE_LIMIT = 5000;

/** Max total chars for all open files combined */
const TOTAL_LIMIT = 30000;

export class OpenFilesContextProvider implements ContextProvider {
  id = "open";
  trigger = "@open";
  description = "Include all open editor files";
  requiresArg = false;

  async resolve(_arg?: string, options?: ContextResolveOptions): Promise<ContextResult> {
    const openFiles = options?.openFiles || [];
    const workingDir = options?.workingDir || process.cwd();

    if (openFiles.length === 0) {
      return {
        label: "Open Files",
        content: "[No files are currently open in the editor.]",
        metadata: { source: "editor", itemCount: 0 },
      };
    }

    const sections: string[] = [];
    let totalChars = 0;
    let truncatedCount = 0;

    for (const filePath of openFiles) {
      // Resolve relative paths against working directory
      const absPath = path.isAbsolute(filePath)
        ? filePath
        : path.join(workingDir, filePath);

      // Read file content safely
      let content: string;
      try {
        content = fs.readFileSync(absPath, "utf-8");
      } catch {
        sections.push(`### ${filePath}\n\n[Unable to read file]`);
        continue;
      }

      // Truncate individual files that are too large
      let wasTruncated = false;
      if (content.length > PER_FILE_LIMIT) {
        content = content.substring(0, PER_FILE_LIMIT);
        wasTruncated = true;
        truncatedCount++;
      }

      // Stop adding files if we've exceeded the total limit
      if (totalChars + content.length > TOTAL_LIMIT) {
        sections.push(`\n... [${openFiles.length - sections.length} more files omitted for context space]`);
        break;
      }

      // Detect language from file extension for syntax highlighting
      const ext = path.extname(filePath).slice(1);
      const lang = EXT_TO_LANG[ext] || ext || "text";

      sections.push(
        `### ${filePath}${wasTruncated ? " (truncated)" : ""}\n\n\`\`\`${lang}\n${content}\n\`\`\``
      );
      totalChars += content.length;
    }

    return {
      label: `Open Files (${openFiles.length})`,
      content: `## Open Editor Files\n\n${sections.join("\n\n")}`,
      metadata: {
        source: "editor",
        truncated: truncatedCount > 0,
        itemCount: openFiles.length,
      },
    };
  }
}

/** Map file extensions to markdown language identifiers */
const EXT_TO_LANG: Record<string, string> = {
  ts: "typescript", tsx: "tsx", js: "javascript", jsx: "jsx",
  py: "python", rs: "rust", go: "go", java: "java",
  rb: "ruby", php: "php", cs: "csharp", cpp: "cpp",
  c: "c", h: "c", hpp: "cpp", swift: "swift",
  kt: "kotlin", scala: "scala", r: "r",
  html: "html", css: "css", scss: "scss", less: "less",
  json: "json", yaml: "yaml", yml: "yaml", toml: "toml",
  xml: "xml", sql: "sql", sh: "bash", bash: "bash",
  zsh: "bash", fish: "fish", ps1: "powershell",
  md: "markdown", mdx: "markdown", txt: "text",
};
