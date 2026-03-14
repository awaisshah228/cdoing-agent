import { exec } from "child_process";
import type { BaseTool, ToolDefinition, ToolResult } from "./types";

export class ShellExecTool implements BaseTool {
  definition: ToolDefinition = {
    name: "shell_exec",
    description:
      "Execute a shell command and return its output. Use for builds, tests, git commands, etc.",
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string", description: "The shell command to execute" },
        timeout: { type: "number", description: "Timeout in ms. Default: 120000" },
      },
      required: ["command"],
    },
    requiresPermission: true,
    permissionMessage: (input) => `Run command: ${input.command}`,
  };

  private workingDir: string;
  constructor(workingDir: string) {
    this.workingDir = workingDir;
  }

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const command = input.command as string;
    const timeout = (input.timeout as number) || 120000;

    // Block dangerous commands
    const blocked = ["rm -rf /", "rm -rf ~", "mkfs", "dd if=", ":(){"];
    for (const pat of blocked) {
      if (command.includes(pat))
        return { success: false, output: "", error: `Blocked dangerous pattern: ${pat}` };
    }

    return new Promise((resolve) => {
      exec(command, { cwd: this.workingDir, timeout, maxBuffer: 10 * 1024 * 1024, env: { ...process.env } },
        (error, stdout, stderr) => {
          // Always capture full output (stdout + stderr) regardless of success/failure
          const outputParts: string[] = [];
          if (stdout) outputParts.push(stdout.trimEnd());
          if (stderr) outputParts.push(`STDERR:\n${stderr.trimEnd()}`);
          const output = outputParts.join("\n\n") || "(no output)";

          if (error?.killed) {
            return resolve({ success: false, output, error: `Timed out after ${timeout}ms` });
          }

          if (error) {
            resolve({ success: false, output, error: `Exit code: ${error.code}` });
          } else {
            resolve({ success: true, output });
          }
        });
    });
  }
}
