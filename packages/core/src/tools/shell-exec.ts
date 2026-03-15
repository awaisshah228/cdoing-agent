import { exec } from "child_process";
import * as os from "os";
import type { BaseTool, ToolDefinition, ToolResult } from "./types";
import type { SandboxManager } from "../sandbox";
import type { PermissionManager } from "../permissions";
import { extractShellPaths } from "../utils/shell-paths";

const IS_WINDOWS = os.platform() === "win32";

/**
 * Get the shell command and args for the current platform.
 * - Windows: PowerShell (more capable than cmd.exe)
 * - macOS: user's shell with login flag (loads .zshrc/.bashrc for PATH, nvm, pyenv, etc.)
 * - Linux: user's shell with login flag
 */
function getShellCommand(command: string): { shell: string; args: string[] } {
  if (IS_WINDOWS) {
    return {
      shell: "powershell.exe",
      args: ["-NoLogo", "-ExecutionPolicy", "Bypass", "-Command", command],
    };
  }
  const userShell = process.env.SHELL || (os.platform() === "darwin" ? "/bin/zsh" : "/bin/bash");
  return { shell: userShell, args: ["-l", "-c", command] };
}

/** For exec() — the shell to use */
const SHELL = IS_WINDOWS ? "powershell.exe" : process.env.SHELL || "/bin/sh";

/** Color-supporting environment variables */
const COLOR_ENV = {
  FORCE_COLOR: "1",
  COLORTERM: "truecolor",
  TERM: "xterm-256color",
  CLICOLOR: "1",
  CLICOLOR_FORCE: "1",
};

/** Absolute danger — always blocked regardless of permissions */
const ALWAYS_BLOCKED = [
  // Unix
  "rm -rf /",
  "rm -rf ~",
  "rm -rf /*",
  "rm -rf ~/*",
  "mkfs",
  "dd if=",
  ":(){",
  // Windows
  "rd /s /q C:\\",
  "del /f /s /q C:\\",
  "format C:",
  "rd /s /q %systemroot%",
];

/** Destructive patterns for elevated permission message */
const DESTRUCTIVE_PATTERNS = [
  // Unix
  /\brm\s/, /\brm$/, /\brmdir\s/, /\bunlink\s/, /\bshred\s/,
  // Windows
  /\bdel\s/, /\brd\s/, /\berase\s/, /\brmdir\s/,
  // Git (cross-platform)
  /\bgit\s+clean\b/, /\bgit\s+reset\s+--hard\b/,
];


export class ShellExecTool implements BaseTool {
  definition: ToolDefinition = {
    name: "shell_exec",
    description:
      `Execute a shell command and return its output. Use for builds, tests, git commands, etc. Requires user permission before execution.

All file paths in commands are checked against permission rules:
- Read paths (cat, less, grep, etc.) are checked against Read deny rules.
- Write paths (cp, mv, redirect >, tee, etc.) are checked against Edit deny rules.
- Delete paths (rm, rmdir, unlink, etc.) are checked against Delete deny rules.
- Destructive commands are flagged as high-risk in the permission prompt.

Commands are also subject to sandbox restrictions.`,
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string", description: "The shell command to execute" },
        timeout: { type: "number", description: "Timeout in ms. Default: 120000" },
        background: {
          type: "boolean",
          description: "Run in background. Returns immediately with PID. Use for servers/watchers. Default: false.",
        },
        env_vars: {
          type: "object",
          description: "Environment variables to set (e.g., {\"PORT\": \"3001\", \"DEBUG\": \"app:*\"})",
          additionalProperties: { type: "string" },
        },
        debug: {
          type: "boolean",
          description: "Enable debug/verbose mode. Sets DEBUG=*, NODE_DEBUG=*, RUST_BACKTRACE=1, PYTHONTRACEBACK=1. Default: false",
        },
        dangerouslyDisableSandbox: {
          type: "boolean",
          description: "Set to true to run this command outside the sandbox. Requires permission approval.",
        },
      },
      required: ["command"],
    },
    requiresPermission: true,
    permissionMessage: (input) => {
      const cmd = String(input.command || "");
      if (DESTRUCTIVE_PATTERNS.some((p) => p.test(cmd))) {
        return `⚠ DESTRUCTIVE command: ${cmd}`;
      }
      return `Run command: ${cmd}`;
    },
  };

  private workingDir: string;
  private sandboxManager?: SandboxManager;
  private permissionManager?: PermissionManager;

  constructor(workingDir: string, sandboxManager?: SandboxManager, permissionManager?: PermissionManager) {
    this.workingDir = workingDir;
    this.sandboxManager = sandboxManager;
    this.permissionManager = permissionManager;
  }

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const command = input.command as string;
    const timeout = (input.timeout as number) || 120000;
    const dangerouslyDisableSandbox = (input.dangerouslyDisableSandbox as boolean) || false;

    // Always-blocked patterns (catastrophic destruction)
    for (const pat of ALWAYS_BLOCKED) {
      if (command.includes(pat))
        return { success: false, output: "", error: `Blocked dangerous pattern: ${pat}` };
    }

    // ── Permission-based path checks ────────────────────────────────────────
    if (this.permissionManager) {
      const paths = extractShellPaths(command, this.workingDir);

      // Check read paths against Read deny rules
      for (const p of paths.read) {
        const result = this.permissionManager.checkPathPermission(p, "Read");
        if (result === "deny") {
          return { success: false, output: "", error: `Permission denied: read access to "${p}" is blocked by settings rules` };
        }
      }

      // Check write paths against Edit deny rules
      for (const p of paths.write) {
        const result = this.permissionManager.checkPathPermission(p, "Edit");
        if (result === "deny") {
          return { success: false, output: "", error: `Permission denied: write access to "${p}" is blocked by settings rules` };
        }
      }

      // Check delete paths against Delete deny rules
      for (const p of paths.delete) {
        const result = this.permissionManager.checkPathPermission(p, "Delete");
        if (result === "deny") {
          return { success: false, output: "", error: `Permission denied: delete access to "${p}" is blocked by settings rules` };
        }
      }
    }

    // ── Sandbox checks ──────────────────────────────────────────────────────
    if (this.sandboxManager) {
      const check = this.sandboxManager.checkShellCommand(command, dangerouslyDisableSandbox);
      if (!check.allowed) {
        return { success: false, output: "", error: check.reason || "Sandbox: command blocked" };
      }
    }

    // Build environment
    const env = this.sandboxManager ? this.sandboxManager.getShellEnv() : { ...process.env };

    // Merge user-provided env vars
    const envVars = input.env_vars as Record<string, string> | undefined;
    if (envVars && typeof envVars === "object") {
      for (const [key, val] of Object.entries(envVars)) {
        env[key] = String(val);
      }
    }

    // Debug mode
    if (input.debug) {
      env.DEBUG = env.DEBUG || "*";
      env.NODE_DEBUG = env.NODE_DEBUG || "*";
      env.RUST_BACKTRACE = env.RUST_BACKTRACE || "1";
      env.PYTHONTRACEBACK = env.PYTHONTRACEBACK || "1";
      env.PYTHONFAULTHANDLER = env.PYTHONFAULTHANDLER || "1";
    }

    const background = (input.background as boolean) || false;

    // Merge color env for better terminal output
    Object.assign(env, COLOR_ENV);

    // Background mode: spawn detached, return immediately with PID
    if (background) {
      const { spawn } = require("child_process") as typeof import("child_process");
      const { shell, args } = getShellCommand(command);
      const child = spawn(shell, args, {
        cwd: this.workingDir,
        env,
        detached: !IS_WINDOWS,
        stdio: "ignore",
      });
      child.unref();
      return { success: true, output: `Started in background (PID: ${child.pid})` };
    }

    return new Promise((resolve) => {
      exec(command, { cwd: this.workingDir, timeout, maxBuffer: 10 * 1024 * 1024, env, shell: SHELL },
        (error, stdout, stderr) => {
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
