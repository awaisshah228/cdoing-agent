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

/** Sensitive env vars to strip even without sandbox manager */
const SENSITIVE_ENV_VARS_SHELL = [
  "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN", "AWS_ACCESS_KEY_ID",
  "GH_TOKEN", "GITHUB_TOKEN", "GITHUB_APP_PRIVATE_KEY",
  "NPM_TOKEN", "NPM_AUTH_TOKEN",
  "DOCKER_PASSWORD", "DOCKER_AUTH_CONFIG",
  "GOOGLE_APPLICATION_CREDENTIALS",
  "AZURE_CLIENT_SECRET", "AZURE_TENANT_ID",
  "SECRET_KEY", "PRIVATE_KEY", "API_SECRET", "ENCRYPTION_KEY",
  "VERCEL_TOKEN", "SLACK_TOKEN", "STRIPE_SECRET_KEY",
  "TWILIO_AUTH_TOKEN", "SENDGRID_API_KEY",
  "CI_JOB_TOKEN", "CIRCLE_TOKEN", "TRAVIS_TOKEN",
];

/** Strip sensitive env vars from a process environment */
function stripSensitiveEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  for (const v of SENSITIVE_ENV_VARS_SHELL) {
    delete env[v];
  }
  return env;
}

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
  // find with destructive flags
  /\bfind\b.*-delete\b/,
  /\bfind\b.*-exec\s+rm\b/,
];

// ── Dangerous interpreter detection (matches Claude Code) ────────────────────
// These commands can execute arbitrary code and should always require explicit
// user permission, even if auto-approval rules would otherwise allow them.

/**
 * Patterns for commands that execute arbitrary code via interpreters.
 * Claude Code strips these from auto-mode approval to prevent the ML
 * classifier from auto-approving code execution.
 */
const DANGEROUS_INTERPRETER_PATTERNS = [
  // Script interpreters
  /^\s*python[23]?\s/i, /^\s*python[23]?\s*$/i,
  /^\s*node\s/, /^\s*node\s*$/,
  /^\s*ruby\s/, /^\s*ruby\s*$/,
  /^\s*perl\s/, /^\s*perl\s*$/,
  /^\s*php\s/, /^\s*php\s*$/,
  /^\s*lua\s/, /^\s*lua\s*$/,
  // Shell evaluation
  /^\s*eval\s/, /^\s*exec\s/,
  /^\s*bash\s+-c\s/, /^\s*sh\s+-c\s/, /^\s*zsh\s+-c\s/,
  // Package runners (can run arbitrary scripts)
  /^\s*npx\s/, /^\s*bunx\s/,
  /^\s*npm\s+exec\b/,
  // Remote execution
  /^\s*ssh\s/,
  /^\s*curl\s.*\|\s*(?:bash|sh|zsh)\b/,  // curl | bash
  /^\s*wget\s.*\|\s*(?:bash|sh|zsh)\b/,  // wget | bash
];

/**
 * Check if a command invokes a dangerous interpreter.
 * Returns the matched interpreter name, or null if safe.
 */
function isDangerousInterpreter(command: string): string | null {
  const trimmed = command.trim();
  for (const pattern of DANGEROUS_INTERPRETER_PATTERNS) {
    if (pattern.test(trimmed)) {
      const match = trimmed.match(/^\s*(\S+)/);
      return match ? match[1] : "interpreter";
    }
  }
  return null;
}

// ── Compound command splitting ───────────────────────────────────────────────

/**
 * Split a compound shell command into individual sub-commands.
 * Handles &&, ||, ;, and | operators.
 *
 * Each sub-command is validated separately to prevent:
 *   safe-cmd && evil-cmd
 * from bypassing checks on "safe-cmd".
 */
function splitCompoundCommand(command: string): string[] {
  // Simple split on shell operators — doesn't handle quoted strings perfectly
  // but sufficient for security heuristics
  const parts = command.split(/\s*(?:&&|\|\||;)\s*/);
  return parts.map(p => p.trim()).filter(Boolean);
}

/**
 * Check if a compound command contains a directory change followed by a write.
 * Prevents CWD-bypass attacks like: cd /etc && echo evil > passwd
 */
function hasCwdBypassRisk(command: string): boolean {
  const parts = splitCompoundCommand(command);
  let hasCdCommand = false;

  for (const part of parts) {
    if (/^\s*cd\s/.test(part)) {
      hasCdCommand = true;
    } else if (hasCdCommand) {
      // After cd, check if any subsequent command writes
      if (/>{1,2}/.test(part) || /\btee\b/.test(part) ||
          /\brm\b/.test(part) || /\bmv\b/.test(part) || /\bcp\b/.test(part) ||
          /\bchmod\b/.test(part) || /\bchown\b/.test(part)) {
        return true;
      }
    }
  }
  return false;
}


// ── Output Summarization (token-saving) ─────────────────────────────────────
// Inspired by OpenCode (2000 lines / 50KB limit, temp file for full output)
// and Continue (line-boundary snapping, status field verdict).

/** Max lines to send back to LLM */
const MAX_OUTPUT_LINES = 200;
/** Max bytes to send back to LLM (~50KB like OpenCode) */
const MAX_OUTPUT_BYTES = 50_000;

/** Patterns for noisy lines we can strip (progress bars, spinners, etc.) */
const NOISE_PATTERNS = [
  /^\s*[\|\/\-\\]\s*$/, // spinner chars
  /^[\s░▒▓█▓▒░⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]+$/, // progress bar chars
  /^\s*\r/, // carriage return lines (overwritten progress)
  /^npm warn\s/, // npm warnings (noisy, rarely useful)
  /^npm notice\s/, // npm notices
  /^warning\s.*peer\s*dep/i, // yarn peer dep warnings
  /^\s*$/, // blank lines (collapse them)
];

/**
 * Summarize command output to save tokens.
 *
 * Strategy (combines best of OpenCode, Continue, and Claude Code):
 *  1. Strip noisy lines (progress bars, npm warnings, blank lines)
 *  2. On error: show stderr first (the actual error), then last N stdout lines for context
 *  3. On success: truncate keeping head + tail (like Claude Code), respect byte limit (like OpenCode)
 *  4. Append a clear verdict line so LLM instantly knows result (like Continue's status field)
 *  5. If truncated, tell LLM it can use file_read/grep_search for full output
 */
function summarizeOutput(
  _command: string,
  stdout: string,
  stderr: string,
  exitCode: number | null,
  killed: boolean,
  timeout: number,
): string {
  const success = exitCode === 0 || exitCode === null;

  // ── Verdict line (like Continue's status field) ────────────────────────
  let verdict: string;
  if (killed) {
    verdict = `<status>Command timed out after ${timeout}ms</status>`;
  } else if (success) {
    verdict = `<status>Command completed successfully (exit code 0)</status>`;
  } else {
    verdict = `<status>Command failed (exit code ${exitCode})</status>`;
  }

  // ── Filter noisy lines ─────────────────────────────────────────────────
  const filterNoise = (text: string): string[] => {
    return text.split("\n").filter(line =>
      !NOISE_PATTERNS.some(p => p.test(line))
    );
  };

  const stdoutLines = filterNoise(stdout);
  const parts: string[] = [];
  let wasTruncated = false;

  // ── Error path: prioritize stderr ──────────────────────────────────────
  if (!success && stderr && stderr.trim()) {
    const stderrLines = filterNoise(stderr);
    // Show last 20 stdout lines for context
    const contextLines = stdoutLines.slice(-20);
    if (contextLines.length > 0) {
      parts.push(contextLines.join("\n").trim());
    }
    // Show stderr (the actual error — keep more of it)
    if (stderrLines.length > 80) {
      parts.push(`\nSTDERR (last 80 of ${stderrLines.length} lines):\n${stderrLines.slice(-80).join("\n")}`);
      wasTruncated = true;
    } else {
      parts.push(`\nSTDERR:\n${stderrLines.join("\n")}`);
    }
  }
  // ── Success path: truncate stdout ──────────────────────────────────────
  else {
    if (stdoutLines.length <= MAX_OUTPUT_LINES) {
      parts.push(stdoutLines.join("\n").trim());
    } else {
      // Keep first 15 + last 80 lines (like Claude Code: head + tail)
      const head = stdoutLines.slice(0, 15).join("\n");
      const tail = stdoutLines.slice(-80).join("\n");
      const skipped = stdoutLines.length - 95;
      parts.push(`${head}\n\n... (${skipped} lines omitted — use grep_search or file_read for full output) ...\n\n${tail}`);
      wasTruncated = true;
    }
  }

  let output = parts.join("\n").trim() || "(no output)";

  // ── Byte limit (like OpenCode's 50KB) ──────────────────────────────────
  if (Buffer.byteLength(output, "utf-8") > MAX_OUTPUT_BYTES) {
    // Snap to line boundary (like Continue's TRUNCATION_LINE_SNAP_THRESHOLD)
    const truncated = output.slice(0, MAX_OUTPUT_BYTES);
    const lastNewline = truncated.lastIndexOf("\n");
    output = (lastNewline > 0 ? truncated.slice(0, lastNewline) : truncated)
      + `\n\n... (output truncated at ${MAX_OUTPUT_BYTES} bytes — use grep_search or file_read for full content) ...`;
    wasTruncated = true;
  }

  // ── Assemble final result ──────────────────────────────────────────────
  return `${output}\n\n${verdict}`;
}

/** Read-only shell commands that are safe to run concurrently */
const READ_ONLY_COMMANDS = /^\s*(ls|cat|head|tail|wc|echo|pwd|which|whoami|date|uname|env|printenv|id|hostname|df|du|file|stat|type|test|git\s+(status|log|diff|show|branch|remote|rev-parse|describe|tag\s+-l)|find|grep|rg|ag|ack|tree|sort|uniq|diff|comm|tee|cut|tr|fold|column|less|more|bat|hexdump|xxd|sha256sum|md5sum|openssl\s+(dgst|sha|md5))\b/;

export class ShellExecTool implements BaseTool {
  // ── Behavioral flags ──
  isDestructive = (input: Record<string, unknown>) => {
    const cmd = (input.command as string) || "";
    return DESTRUCTIVE_PATTERNS.some((p) => p.test(cmd));
  };

  /** Per-input concurrency: read-only commands (ls, git status, grep, etc.) are parallel-safe */
  concurrencyMode = (input: Record<string, unknown>): "parallel" | "sequential" => {
    const cmd = (input.command as string) || "";
    const action = (input.action as string) || "run";
    // status/kill actions are always safe
    if (action === "status") return "parallel";
    // Read-only commands can run concurrently
    if (READ_ONLY_COMMANDS.test(cmd)) return "parallel";
    return "sequential";
  };

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
      const interp = isDangerousInterpreter(cmd);
      if (interp) {
        return `⚠ Code execution (${interp}): ${humanCmd}`;
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

    // Dangerous interpreter detection — flag for elevated permission warning
    const interpreter = isDangerousInterpreter(command);
    if (interpreter) {
      // The permission system will still prompt the user, but we add
      // context about why this is flagged as dangerous
      // (This is informational — the actual block happens in permission checks)
    }

    // CWD-bypass detection: cd /somewhere && write-operation
    if (hasCwdBypassRisk(command)) {
      return {
        success: false,
        output: "",
        error: `Blocked: command changes directory then performs write operations. This pattern can bypass sandbox restrictions. Split into separate commands instead.`,
      };
    }

    // Compound command sub-validation: check each sub-command for blocked patterns
    const subCommands = splitCompoundCommand(command);
    for (const sub of subCommands) {
      for (const pat of ALWAYS_BLOCKED) {
        if (sub.includes(pat)) {
          return { success: false, output: "", error: `Blocked dangerous pattern in compound command: ${pat}` };
        }
      }
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

    // Build environment — always strip sensitive vars even without sandbox manager
    const env = this.sandboxManager ? this.sandboxManager.getShellEnv() : stripSensitiveEnv({ ...process.env });

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

        const success = code === 0 || code === null;
        const output = summarizeOutput(actualCommand, stdout, stderr, code, killed, timeout);

        if (killed) {
          return resolve({ success: false, output, error: `Timed out after ${timeout}ms` });
        }

        if (!success) {
          if (stderr && stderr.trim()) {
            resolve({ success: false, output, error: `Exit code: ${code}` });
          } else {
            resolve({ success: true, output });
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
