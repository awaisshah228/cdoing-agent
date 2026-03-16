import { spawn } from "child_process";
import * as os from "os";
import type { BaseTool, ToolDefinition, ToolResult, ToolProgressCallback } from "../types";
export type { ToolProgressCallback };
import type { SandboxManager } from "../../sandbox";
import type { PermissionManager } from "../../permissions";
import { extractShellPaths } from "../../utils/shell-paths";
import { ProcessManager } from "./process-manager";
import { getHumanReadableCommand } from "../../permissions/bash-arity";

const IS_WINDOWS = os.platform() === "win32";

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
  // Unix — catastrophic filesystem destruction
  "rm -rf /",
  "rm -rf ~",
  "rm -rf /*",
  "rm -rf ~/*",
  "rm -rf $HOME",
  "mkfs",
  "dd if=",
  ":(){",           // fork bomb
  // Windows — catastrophic filesystem destruction
  "rd /s /q C:\\",
  "del /f /s /q C:\\",
  "format C:",
  "rd /s /q %systemroot%",
];

/** Destructive patterns for elevated permission message */
const DESTRUCTIVE_PATTERNS = [
  // File deletion (Unix)
  /\brm\s/, /\brm$/, /\brmdir\s/, /\bunlink\s/, /\bshred\s/,
  // File deletion (Windows)
  /\bdel\s/, /\brd\s/, /\berase\s/,
  // Git destructive operations
  /\bgit\s+clean\b/,
  /\bgit\s+reset\s+--hard\b/,
  /\bgit\s+push\s+.*--force\b/, /\bgit\s+push\s+-f\b/,
  /\bgit\s+checkout\s+--\s/, /\bgit\s+restore\s/,
  /\bgit\s+branch\s+-[dD]\b/,
  /\bgit\s+rebase\b/,
  /\bgit\s+stash\s+drop\b/,
  // Process killing
  /\bkill\s+-9\b/, /\bkillall\b/, /\bpkill\b/,
  // Permission changes
  /\bchmod\s+777\b/, /\bchmod\s+-R\b/, /\bchown\s+-R\b/,
  // Database destructive (SQL injection risk via shell)
  /\bDROP\s+(TABLE|DATABASE)\b/i, /\bTRUNCATE\s+TABLE\b/i, /\bDELETE\s+FROM\b/i,
  // Disk/system
  /\bdd\s/, /\bmv\s+\//, /\bsudo\s/,
  // Docker destructive
  /\bdocker\s+(rm|rmi|system\s+prune)\b/,
  // npm/package destructive
  /\bnpm\s+unpublish\b/,
];


export class ShellExecTool implements BaseTool {
  definition: ToolDefinition = {
    name: "shell_exec",
    description:
      `Execute a shell command and return its output. Use for builds, tests, git commands, etc.

IMPORTANT:
- Non-zero exit codes are reported as error but may be informational (e.g., build errors, test failures). Read the output to understand what happened.
- For long-running processes (servers, watchers, dev tools), ALWAYS use background=true. Commands with & are auto-detected and run in background mode.
- Server commands (node server.js, npm start, npm run dev, etc.) are auto-detected as background processes.

Background mode: Set background=true to spawn a detached process. Returns a process_id.
- Use action="status" (with process_id) to read output/logs.
- Use action="kill" (with process_id) to stop it.
- Use action="kill_all" to cleanup all background processes.

Actions:
- "run" (default): Execute command and wait for result (up to timeout).
- "status": Check a background process. Requires process_id (or omit for all).
- "kill": Kill a background process by process_id.
- "kill_all": Kill all running background processes.`,
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string", description: "The shell command to execute (required for run/background)" },
        timeout: { type: "number", description: "Timeout in ms. Default: 120000" },
        background: {
          type: "boolean",
          description: "Run as detached background process. Returns process_id for later status/kill. Use for servers, watchers, dev tools. Default: false.",
        },
        action: {
          type: "string",
          enum: ["run", "status", "kill", "kill_all"],
          description: "Action to perform. 'run' (default): execute command. 'status': check background process. 'kill': stop background process. 'kill_all': stop all background processes.",
        },
        process_id: {
          type: "string",
          description: "Background process ID (from background=true). Required for action=status/kill.",
        },
        wait_for_ready: {
          type: "number",
          description: "When background=true, ms to wait before returning (lets process start). Default: 1000.",
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
      required: [],
    },
    requiresPermission: true,
    permissionMessage: (input) => {
      const action = String(input.action || "run");
      if (action === "status") return `Check background process status`;
      if (action === "kill") return `Kill background process: ${input.process_id || "unknown"}`;
      if (action === "kill_all") return `Kill all background processes`;
      const cmd = String(input.command || "");
      const humanCmd = getHumanReadableCommand(cmd);
      if (input.background) return `Start background process: ${humanCmd}`;
      if (DESTRUCTIVE_PATTERNS.some((p) => p.test(cmd))) {
        return `⚠ DESTRUCTIVE command: ${humanCmd} (${cmd.slice(0, 200)})`;
      }
      return `Run command: ${humanCmd}`;
    },
  };

  private workingDir: string;
  private sandboxManager?: SandboxManager;
  private permissionManager?: PermissionManager;
  private processManager: ProcessManager;

  constructor(workingDir: string, sandboxManager?: SandboxManager, permissionManager?: PermissionManager, processManager?: ProcessManager) {
    this.workingDir = workingDir;
    this.sandboxManager = sandboxManager;
    this.permissionManager = permissionManager;
    this.processManager = processManager || new ProcessManager();
  }

  /** Get the process manager (for cleanup on chat exit) */
  getProcessManager(): ProcessManager {
    return this.processManager;
  }

  async execute(input: Record<string, unknown>, onProgress?: ToolProgressCallback): Promise<ToolResult> {
    const action = (input.action as string) || "run";

    // ── Action: status — check background process ───────────────────────────
    if (action === "status") {
      return this.handleStatus(input);
    }

    // ── Action: kill — stop a background process ────────────────────────────
    if (action === "kill") {
      return this.handleKill(input);
    }

    // ── Action: kill_all — stop all background processes ────────────────────
    if (action === "kill_all") {
      const count = this.processManager.killAll();
      return {
        success: true,
        output: count > 0
          ? `Killed ${count} running process${count > 1 ? "es" : ""}.`
          : "No running processes to kill.",
      };
    }

    // ── Action: run (default) — execute command ─────────────────────────────
    const command = input.command as string;
    if (!command || command.trim().length === 0) {
      return { success: false, output: "", error: "command is required for action=run" };
    }

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

    let background = (input.background as boolean) || false;

    // Auto-detect background intent:
    // 1. Command ends with & (e.g., "node server.js &")
    // 2. Last part of compound command ends with & (e.g., "cd /path && node server.js &")
    // 3. Command is a known long-running server/watcher pattern
    let actualCommand = command;
    if (!background) {
      const trimmed = actualCommand.trim();
      // Strip trailing & from simple or compound commands
      if (/&\s*$/.test(trimmed)) {
        background = true;
        actualCommand = trimmed.replace(/&\s*$/, "").trim();
      }
      // Detect server-like commands that will run forever
      else if (/\b(node|nodemon|ts-node|python|ruby|php|java|go\s+run)\b.*\b(server|app|index|main)\b/i.test(trimmed)
        || /\b(npm|yarn|pnpm)\s+(start|run\s+dev|run\s+start|run\s+serve)\b/i.test(trimmed)
        || /\b(uvicorn|gunicorn|flask\s+run|rails\s+s|cargo\s+run)\b/i.test(trimmed)) {
        background = true;
      }
    }

    // Merge color env for better terminal output
    Object.assign(env, COLOR_ENV);

    // ── Background mode: spawn detached, track with ProcessManager ──────────
    if (background) {
      const waitForReady = (input.wait_for_ready as number) || 1000;
      const { id, pid } = this.processManager.spawn(actualCommand, this.workingDir, envVars);

      // Wait for process to start and produce initial output
      if (waitForReady > 0) {
        await new Promise((resolve) => setTimeout(resolve, Math.min(waitForReady, 10000)));
      }

      // Check if it crashed immediately
      const status = this.processManager.getStatus(id);
      if (status && status.status !== "running") {
        return {
          success: false,
          output: status.output || "(no output)",
          error: `Process exited immediately (${status.status}${status.exitCode !== undefined ? `, exit code: ${status.exitCode}` : ""})`,
        };
      }

      return {
        success: true,
        output: JSON.stringify({
          process_id: id,
          pid,
          status: "running",
          initial_output: status?.output ? status.output.slice(0, 2000) : "(no output yet)",
          hint: `Use shell_exec({ action: "status", process_id: "${id}" }) to read output. Use shell_exec({ action: "kill", process_id: "${id}" }) to stop.`,
        }, null, 2),
      };
    }

    // ── Foreground mode: spawn and stream output in real-time ──────────────
    return new Promise((resolve) => {
      const args = IS_WINDOWS
        ? ["-NoLogo", "-ExecutionPolicy", "Bypass", "-Command", actualCommand]
        : ["-c", actualCommand];

      const child = spawn(SHELL, args, {
        cwd: this.workingDir,
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";
      let killed = false;

      // Stream stdout in real-time
      child.stdout?.on("data", (chunk: Buffer) => {
        const text = chunk.toString();
        stdout += text;
        onProgress?.(text);
      });

      // Stream stderr in real-time
      child.stderr?.on("data", (chunk: Buffer) => {
        const text = chunk.toString();
        stderr += text;
        onProgress?.(text);
      });

      // Timeout handling
      const timer = setTimeout(() => {
        killed = true;
        child.kill("SIGTERM");
        setTimeout(() => { try { child.kill("SIGKILL"); } catch {} }, 3000);
      }, timeout);

      child.on("error", (err) => {
        clearTimeout(timer);
        resolve({ success: false, output: stdout || "(no output)", error: err.message });
      });

      child.on("close", (code) => {
        clearTimeout(timer);

        const outputParts: string[] = [];
        if (stdout) outputParts.push(stdout.trimEnd());
        if (stderr) outputParts.push(`STDERR:\n${stderr.trimEnd()}`);
        const output = outputParts.join("\n\n") || "(no output)";

        if (killed) {
          return resolve({ success: false, output, error: `Timed out after ${timeout}ms` });
        }

        if (code !== 0 && code !== null) {
          const exitInfo = `\n\nExit code: ${code}`;
          // Follow Continue's pattern: only mark as failure if stderr has content.
          if (stderr && stderr.trim()) {
            resolve({ success: false, output: output + exitInfo, error: `Exit code: ${code}` });
          } else {
            resolve({ success: true, output: output + exitInfo });
          }
        } else {
          resolve({ success: true, output });
        }
      });
    });
  }

  /** Handle action=status */
  private handleStatus(input: Record<string, unknown>): ToolResult {
    const processId = input.process_id as string | undefined;

    if (processId) {
      const status = this.processManager.getStatus(processId);
      if (!status) {
        return { success: false, output: "", error: `No process found with ID "${processId}". Use action="status" without process_id to list all.` };
      }

      // Tail output to keep response size reasonable
      let output = status.output;
      if (output.length > 8192) {
        output = "...[truncated]...\n" + output.slice(-8192);
      }

      return {
        success: true,
        output: JSON.stringify({
          process_id: status.id,
          command: status.command,
          status: status.status,
          pid: status.pid,
          exit_code: status.exitCode,
          duration_ms: status.durationMs,
          output: output || "(no output)",
        }, null, 2),
      };
    }

    // List all processes
    const all = this.processManager.listAll();
    if (all.length === 0) {
      return { success: true, output: "No background processes tracked." };
    }
    return { success: true, output: JSON.stringify(all, null, 2) };
  }

  /** Handle action=kill */
  private handleKill(input: Record<string, unknown>): ToolResult {
    const processId = input.process_id as string | undefined;
    if (!processId) {
      return { success: false, output: "", error: "process_id is required for action=kill. Use action=kill_all to stop all." };
    }

    const killed = this.processManager.kill(processId);
    if (!killed) {
      const status = this.processManager.getStatus(processId);
      if (!status) {
        return { success: false, output: "", error: `No process found with ID "${processId}".` };
      }
      return { success: false, output: "", error: `Process "${processId}" is not running (status: ${status.status}).` };
    }

    return { success: true, output: `Process "${processId}" killed successfully.` };
  }
}
