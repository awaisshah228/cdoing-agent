import * as fs from "fs";
import * as path from "path";
import { exec } from "child_process";
import type { BaseTool, ToolDefinition, ToolResult } from "./types";
import { safePath } from "../utils/path-safety";

/** Map file extensions to the command that runs them */
const RUNNERS: Record<string, string> = {
  ".js": "node", ".mjs": "node", ".cjs": "node",
  ".ts": "npx ts-node", ".tsx": "npx ts-node",
  ".py": "python3", ".rb": "ruby",
  ".sh": "bash", ".bash": "bash", ".zsh": "zsh",
  ".go": "go run", ".swift": "swift", ".lua": "lua",
  ".php": "php", ".pl": "perl",
};

export class FileRunTool implements BaseTool {
  definition: ToolDefinition = {
    name: "file_run",
    description:
      "Run a file. Auto-detects language from extension (node for .js, python3 for .py, etc). Use after writing a program to test it.",
    inputSchema: {
      type: "object",
      properties: {
        file_path: { type: "string", description: "Path to the file to run" },
        args: { type: "string", description: "Command-line arguments (optional)" },
        timeout: { type: "number", description: "Timeout in ms. Default: 30000" },
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
    let filePath: string;
    try {
      filePath = safePath(input.file_path as string, this.workingDir);
    } catch (err) {
      return { success: false, output: "", error: (err as Error).message };
    }

    const args = (input.args as string) || "";
    const timeout = (input.timeout as number) || 30000;

    if (!fs.existsSync(filePath))
      return { success: false, output: "", error: `File not found: ${filePath}` };

    const ext = path.extname(filePath).toLowerCase();
    const runner = RUNNERS[ext];
    if (!runner)
      return { success: false, output: "", error: `Can't run ${ext} files. Supported: ${Object.keys(RUNNERS).join(", ")}` };

    const command = `${runner} "${filePath}"${args ? ` ${args}` : ""}`;

    return new Promise((resolve) => {
      exec(command, { cwd: this.workingDir, timeout, maxBuffer: 10 * 1024 * 1024, env: { ...process.env } },
        (error, stdout, stderr) => {
          if (error?.killed)
            return resolve({ success: false, output: stdout || "", error: `Timed out after ${timeout}ms` });

          const parts: string[] = [];
          if (stdout) parts.push(stdout);
          if (stderr) parts.push(`STDERR:\n${stderr}`);
          const output = parts.join("\n\n") || "(no output)";

          if (error) resolve({ success: false, output, error: `Exit code: ${error.code}` });
          else resolve({ success: true, output });
        });
    });
  }
}
