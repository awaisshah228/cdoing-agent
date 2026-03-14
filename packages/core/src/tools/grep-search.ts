import * as fs from "fs";
import * as path from "path";
import { glob } from "glob";
import type { BaseTool, ToolDefinition, ToolResult } from "./types";
import { loadIgnorePatterns } from "../utils/gitignore";

interface GrepMatch {
  file: string;
  line: number;
  content: string;
}

export class GrepSearchTool implements BaseTool {
  definition: ToolDefinition = {
    name: "grep_search",
    description:
      "Search file contents using a regex pattern. Returns matching lines with file paths and line numbers. Use this to find code patterns, function definitions, variable usages, etc. Respects .gitignore.",
    inputSchema: {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description: "Regex pattern to search for in file contents",
        },
        directory: {
          type: "string",
          description: "Directory to search in. Defaults to working directory.",
        },
        file_pattern: {
          type: "string",
          description: "Glob pattern to filter files (e.g., '*.ts', '*.py'). Optional.",
        },
        case_insensitive: {
          type: "boolean",
          description: "Case insensitive search. Default: false.",
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
    const filePattern = (input.file_pattern as string) || "**/*";
    const caseInsensitive = (input.case_insensitive as boolean) || false;

    const searchDir = path.isAbsolute(directory)
      ? directory
      : path.resolve(this.workingDir, directory);

    try {
      const regex = new RegExp(pattern, caseInsensitive ? "gi" : "g");
      const ignorePatterns = loadIgnorePatterns(this.workingDir);
      const files = await glob(filePattern, {
        cwd: searchDir,
        nodir: true,
        ignore: ignorePatterns,
      });

      const matches: GrepMatch[] = [];
      const maxMatches = 200;

      for (const file of files) {
        if (matches.length >= maxMatches) break;

        const fullPath = path.join(searchDir, file);
        try {
          const stat = fs.statSync(fullPath);
          if (stat.size > 1024 * 1024) continue; // skip files > 1MB

          const content = fs.readFileSync(fullPath, "utf-8");
          const lines = content.split("\n");

          for (let i = 0; i < lines.length; i++) {
            if (matches.length >= maxMatches) break;
            if (regex.test(lines[i])) {
              matches.push({
                file: fullPath,
                line: i + 1,
                content: lines[i].trim(),
              });
            }
            regex.lastIndex = 0;
          }
        } catch {
          // skip unreadable files
        }
      }

      if (matches.length === 0) {
        return { success: true, output: "No matches found." };
      }

      const result = matches
        .map((m) => `${m.file}:${m.line}: ${m.content}`)
        .join("\n");

      const summary =
        matches.length >= maxMatches
          ? `\n\n... results truncated at ${maxMatches} matches`
          : "";

      return {
        success: true,
        output: `Found ${matches.length} match(es):\n${result}${summary}`,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, output: "", error: `Grep search failed: ${message}` };
    }
  }
}
