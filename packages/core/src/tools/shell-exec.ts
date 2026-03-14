import { exec } from "child_process";
import type { BaseTool, ToolDefinition, ToolResult } from "./types";

export class ShellExecTool implements BaseTool {
  definition: ToolDefinition = {
    name: "shell_exec",
    description:
      "Execute a shell command and return its output. Use this for running builds, tests, git commands, and other terminal operations. Commands run in the project's working directory.",
    inputSchema: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "The shell command to execute",
        },
        timeout: {
          type: "number",
          description: "Timeout in milliseconds. Default: 120000 (2 minutes).",
        },
      },
      required: ["command"],
    },
    requiresPermission: true,
    permissionMessage: (input) => `Run shell command: ${input.command}`,
  };

  private workingDir: string;

  constructor(workingDir: string) {
    this.workingDir = workingDir;
  }

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const command = input.command as string;
    const timeout = (input.timeout as number) || 120000;

    // Block obviously dangerous commands
    const blocked = ["rm -rf /", "rm -rf ~", "mkfs", "dd if=", ":(){"];
    for (const pattern of blocked) {
      if (command.includes(pattern)) {
        return {
          success: false,
          output: "",
          error: `Blocked dangerous command pattern: ${pattern}`,
        };
      }
    }

    return new Promise((resolve) => {
      exec(
        command,
        {
          cwd: this.workingDir,
          timeout,
          maxBuffer: 10 * 1024 * 1024, // 10MB
          env: { ...process.env },
        },
        (error, stdout, stderr) => {
          if (error && error.killed) {
            resolve({
              success: false,
              output: stdout || "",
              error: `Command timed out after ${timeout}ms`,
            });
            return;
          }

          const output = [
            stdout ? `STDOUT:\n${stdout}` : "",
            stderr ? `STDERR:\n${stderr}` : "",
          ]
            .filter(Boolean)
            .join("\n\n");

          if (error) {
            resolve({
              success: false,
              output,
              error: `Exit code: ${error.code}`,
            });
          } else {
            resolve({ success: true, output: output || "(no output)" });
          }
        }
      );
    });
  }
}
