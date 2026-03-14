/**
 * FileRunTool — Run/execute a file
 *
 * Auto-detects the language from the file extension and runs it
 * with the appropriate runtime (node, python, etc.).
 * Shows both stdout and stderr from the program.
 */

import * as fs from "fs";
import * as path from "path";
import { exec } from "child_process";
import type { BaseTool, ToolDefinition, ToolResult } from "./types";

/** Map file extensions to the command that runs them */
const RUNNERS: Record<string, string> = {
  ".js": "node",
  ".mjs": "node",
  ".cjs": "node",
  ".ts": "npx ts-node",
  ".tsx": "npx ts-node",
  ".py": "python3",
  ".rb": "ruby",
  ".sh": "bash",
  ".bash": "bash",
  ".zsh": "zsh",
  ".php": "php",
  ".pl": "perl",
  ".go": "go run",
  ".rs": "rustc -o /tmp/rs_out && /tmp/rs_out; rm -f /tmp/rs_out #",
  ".java": "java",
  ".kt": "kotlinc -script",
  ".swift": "swift",
  ".lua": "lua",
  ".r": "Rscript",
  ".R": "Rscript",
};

export class FileRunTool implements BaseTool {
  definition: ToolDefinition = {
    name: "file_run",
    description:
      "Run/execute a file. Auto-detects the language from the file extension and uses the appropriate runtime (node for .js, python3 for .py, etc.). Use this after creating or editing a program to test it.",
    inputSchema: {
      type: "object",
      properties: {
        file_path: {
          type: "string",
          description: "Path to the file to run",
        },
        args: {
          type: "string",
          description: "Optional command-line arguments to pass to the program",
        },
        timeout: {
          type: "number",
          description: "Timeout in milliseconds. Default: 30000 (30 seconds).",
        },
      },
      required: ["file_path"],
    },
    requiresPermission: true,
    permissionMessage: (input) => `Run file: ${input.file_path}`,
  };

  private workingDir: string;

  constructor(workingDir: string) {
    this.workingDir = workingDir;
  }

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const filePath = this.resolvePath(input.file_path as string);
    const args = (input.args as string) || "";
    const timeout = (input.timeout as number) || 30000;

    // Check file exists
    if (!fs.existsSync(filePath)) {
      return {
        success: false,
        output: "",
        error: `File not found: ${filePath}`,
      };
    }

    // Detect runner from extension
    const ext = path.extname(filePath).toLowerCase();
    const runner = RUNNERS[ext];

    if (!runner) {
      return {
        success: false,
        output: "",
        error: `Don't know how to run ${ext} files. Supported: ${Object.keys(RUNNERS).join(", ")}`,
      };
    }

    const command = `${runner} "${filePath}"${args ? ` ${args}` : ""}`;

    return new Promise((resolve) => {
      exec(
        command,
        {
          cwd: this.workingDir,
          timeout,
          maxBuffer: 10 * 1024 * 1024,
          env: { ...process.env },
        },
        (error, stdout, stderr) => {
          if (error && error.killed) {
            resolve({
              success: false,
              output: stdout || "",
              error: `Program timed out after ${timeout}ms`,
            });
            return;
          }

          const parts: string[] = [];
          if (stdout) parts.push(stdout);
          if (stderr) parts.push(`STDERR:\n${stderr}`);
          const output = parts.join("\n\n") || "(no output)";

          if (error) {
            resolve({
              success: false,
              output,
              error: `Exit code: ${error.code}`,
            });
          } else {
            resolve({ success: true, output });
          }
        }
      );
    });
  }

  private resolvePath(filePath: string): string {
    if (path.isAbsolute(filePath)) return filePath;
    return path.resolve(this.workingDir, filePath);
  }
}
