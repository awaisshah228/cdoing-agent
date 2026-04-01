/**
 * PowerShell Tool — Windows-native shell execution.
 *
 * Inspired by Claude Code's PowerShellTool. Provides PowerShell command
 * execution with safety checks and edition-aware guidance.
 */

import { execSync, type ExecSyncOptions } from "child_process";
import type { BaseTool, ToolDefinition, ToolResult, ToolProgressCallback } from "../types";
import type { SandboxManager } from "../../sandbox";

/** Interactive commands that should be rejected */
const INTERACTIVE_CMDLETS = [
  "read-host", "get-credential", "pause",
  "out-gridview", "show-command",
];

export class PowerShellTool implements BaseTool {
  // ── Behavioral flags ──
  // PowerShell: always sequential (same safety as shell_exec)
  isEnabled = () => process.platform === "win32";
  definition: ToolDefinition = {
    name: "powershell",
    description:
      "Execute a PowerShell command on Windows. Supports both Windows PowerShell 5.1 and PowerShell 7+. " +
      "Use this for Windows-specific operations, registry access, and system administration. " +
      "On non-Windows systems, this tool is not available.",
    inputSchema: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "The PowerShell command to execute.",
        },
        description: {
          type: "string",
          description: "Clear description of what this command does.",
        },
        timeout: {
          type: "number",
          description: "Timeout in milliseconds (default: 30000, max: 600000).",
        },
      },
      required: ["command"],
    },
    requiresPermission: true,
    permissionMessage: (input) => {
      const desc = input.description ? ` — ${input.description}` : "";
      return `Run PowerShell: ${String(input.command).substring(0, 100)}${desc}`;
    },
  };

  private workingDir: string;
  private sandboxManager?: SandboxManager;

  constructor(workingDir: string, sandboxManager?: SandboxManager) {
    this.workingDir = workingDir;
    this.sandboxManager = sandboxManager;
  }

  async execute(input: Record<string, unknown>, onProgress?: ToolProgressCallback): Promise<ToolResult> {
    if (process.platform !== "win32") {
      return { success: false, output: "PowerShell tool is only available on Windows." };
    }

    const command = String(input.command || "");
    if (!command.trim()) {
      return { success: false, output: "Empty command." };
    }

    const timeout = Math.min(Number(input.timeout) || 30000, 600000);
    const cmdLower = command.toLowerCase();

    // Reject interactive commands
    for (const cmdlet of INTERACTIVE_CMDLETS) {
      if (cmdLower.includes(cmdlet)) {
        return {
          success: false,
          output: `Interactive command '${cmdlet}' is not supported. Use non-interactive alternatives.`,
        };
      }
    }

    // Sandbox check
    if (this.sandboxManager) {
      const check = this.sandboxManager.checkShellCommand(command);
      if (!check.allowed) {
        return { success: false, output: `Sandbox blocked: ${check.reason || "command not allowed"}` };
      }
    }

    try {
      const opts: ExecSyncOptions = {
        cwd: this.workingDir,
        timeout,
        maxBuffer: 1024 * 1024 * 10,
        encoding: "utf-8",
        shell: "powershell.exe",
      };

      const output = execSync(command, opts) as unknown as string;
      const trimmed = (output || "").trim();

      if (onProgress && trimmed) {
        onProgress(trimmed);
      }

      return {
        success: true,
        output: trimmed || "(no output)",
      };
    } catch (err: any) {
      const stderr = err.stderr?.toString().trim() || "";
      const stdout = err.stdout?.toString().trim() || "";
      const exitCode = err.status ?? 1;
      const output = [
        `Exit code: ${exitCode}`,
        stdout ? `stdout:\n${stdout}` : "",
        stderr ? `stderr:\n${stderr}` : "",
      ].filter(Boolean).join("\n");

      return { success: false, output, error: stderr || err.message };
    }
  }
}
