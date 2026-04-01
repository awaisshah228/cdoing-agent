/**
 * Hooks System — run user-configured shell commands before/after tool execution.
 *
 * Security features:
 *   - Placeholder values are shell-escaped to prevent command injection
 *   - Sensitive environment variables are stripped from hook processes
 *   - Project-scoped hooks require user confirmation on first load
 *   - Managed settings can disable project-scoped hooks entirely
 *
 * Configuration stored in ~/.cdoing/hooks.json or .cdoing/hooks.json (project-level).
 *
 * Example hooks.json:
 * {
 *   "hooks": [
 *     { "event": "pre:file_write", "command": "echo 'Writing file: {{file_path}}'" },
 *     { "event": "post:shell_exec", "command": "echo 'Command finished'" },
 *     { "event": "pre:*", "command": "echo 'Tool called: {{tool_name}}'" }
 *   ]
 * }
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { exec } from "child_process";

export interface HookDefinition {
  /** Event pattern: "pre:tool_name", "post:tool_name", "pre:*", "post:*" */
  event: string;
  /** Shell command to execute. Supports {{variable}} placeholders (values are shell-escaped). */
  command: string;
  /** Timeout in ms (default: 10000) */
  timeout?: number;
  /** Source of this hook: "global" or "project" */
  source?: "global" | "project";
}

export interface HookResult {
  hook: HookDefinition;
  success: boolean;
  output: string;
  error?: string;
}

// ── Sensitive env vars to strip from hook processes ──────────────────────────

const SENSITIVE_ENV_VARS = [
  "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN", "AWS_ACCESS_KEY_ID",
  "GH_TOKEN", "GITHUB_TOKEN", "GITHUB_APP_PRIVATE_KEY",
  "NPM_TOKEN", "NPM_AUTH_TOKEN",
  "DOCKER_PASSWORD", "DOCKER_AUTH_CONFIG",
  "GOOGLE_APPLICATION_CREDENTIALS",
  "AZURE_CLIENT_SECRET", "AZURE_TENANT_ID",
  "DATABASE_URL", "DB_PASSWORD", "REDIS_PASSWORD", "MONGO_PASSWORD",
  "SECRET_KEY", "PRIVATE_KEY", "API_SECRET", "ENCRYPTION_KEY",
  "VERCEL_TOKEN", "SLACK_TOKEN", "STRIPE_SECRET_KEY",
  "TWILIO_AUTH_TOKEN", "SENDGRID_API_KEY",
  "CI_JOB_TOKEN", "CIRCLE_TOKEN", "TRAVIS_TOKEN",
];

/**
 * Shell-escape a string value for safe interpolation into shell commands.
 * Wraps in single quotes and escapes any embedded single quotes.
 *
 * This prevents command injection via {{placeholder}} values like:
 *   file_path: "; rm -rf /; "  →  '"; rm -rf /; "'
 */
function shellEscape(value: string): string {
  // Replace single quotes with '\'' (end quote, escaped quote, start quote)
  return "'" + value.replace(/'/g, "'\\''") + "'";
}

/**
 * Build a sanitized environment for hook execution.
 * Strips sensitive vars and vars matching secret patterns.
 */
function buildHookEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };

  // Strip known sensitive vars
  for (const v of SENSITIVE_ENV_VARS) {
    delete env[v];
  }

  // Strip vars whose names suggest they contain secrets
  for (const key of Object.keys(env)) {
    const upper = key.toUpperCase();
    if (
      (upper.includes("SECRET") ||
       upper.includes("PRIVATE_KEY") ||
       (upper.includes("_TOKEN") && !upper.includes("COLOR")) ||
       upper.includes("_PASSWORD") ||
       upper.includes("_CREDENTIALS")) &&
      !["COLORTERM", "FORCE_COLOR"].some(safe => upper.includes(safe))
    ) {
      delete env[key];
    }
  }

  return env;
}

export class HookManager {
  private hooks: HookDefinition[] = [];
  private workingDir: string;
  private projectHooksApproved = false;
  private managedHooksOnly = false;

  /** Callback to ask user for project hook approval */
  private approvalFn: ((message: string) => Promise<boolean>) | null = null;

  constructor(workingDir: string, managedHooksOnly?: boolean) {
    this.workingDir = workingDir;
    this.managedHooksOnly = managedHooksOnly ?? false;
    this.loadHooks();
  }

  setWorkingDir(dir: string): void {
    this.workingDir = dir;
    this.projectHooksApproved = false; // Reset approval for new project
    this.loadHooks();
  }

  setApprovalFn(fn: (message: string) => Promise<boolean>): void {
    this.approvalFn = fn;
  }

  private loadHooks(): void {
    this.hooks = [];

    // Load global hooks (always trusted — user configured them)
    const globalFile = path.join(os.homedir(), ".cdoing", "hooks.json");
    this.loadFromFile(globalFile, "global");

    // Load project hooks (potentially untrusted — could come from cloned repo)
    if (!this.managedHooksOnly) {
      const projectFile = path.join(this.workingDir, ".cdoing", "hooks.json");
      this.loadFromFile(projectFile, "project");
    }
  }

  private loadFromFile(filePath: string, source: "global" | "project"): void {
    try {
      if (fs.existsSync(filePath)) {
        const raw = fs.readFileSync(filePath, "utf-8");

        // Validate JSON structure
        let data: unknown;
        try {
          data = JSON.parse(raw);
        } catch {
          console.error(`[Hooks] Invalid JSON in ${filePath}, skipping`);
          return;
        }

        if (!data || typeof data !== "object") return;
        const obj = data as Record<string, unknown>;

        if (Array.isArray(obj.hooks)) {
          for (const hook of obj.hooks) {
            // Validate hook structure
            if (!hook || typeof hook !== "object") continue;
            const h = hook as Record<string, unknown>;
            if (typeof h.event !== "string" || typeof h.command !== "string") continue;

            // Validate event pattern format
            if (!/^(pre|post):[a-zA-Z_*]+$/.test(h.event)) {
              console.error(`[Hooks] Invalid event pattern "${h.event}" in ${filePath}, skipping`);
              continue;
            }

            this.hooks.push({
              event: h.event,
              command: h.command,
              timeout: typeof h.timeout === "number" ? h.timeout : undefined,
              source,
            });
          }
        }
      }
    } catch {
      // skip invalid files
    }
  }

  /** Find hooks matching a given event */
  private findHooks(event: string): HookDefinition[] {
    const [phase, toolName] = event.split(":");
    return this.hooks.filter((h) => {
      const [hPhase, hTool] = h.event.split(":");
      return hPhase === phase && (hTool === "*" || hTool === toolName);
    });
  }

  /** Run all hooks for an event */
  async runHooks(
    event: string,
    variables: Record<string, string>
  ): Promise<HookResult[]> {
    const matching = this.findHooks(event);
    if (matching.length === 0) return [];

    // Check if any project hooks need approval
    const hasProjectHooks = matching.some(h => h.source === "project");
    if (hasProjectHooks && !this.projectHooksApproved) {
      if (this.approvalFn) {
        const projectHookCommands = matching
          .filter(h => h.source === "project")
          .map(h => `  ${h.event}: ${h.command}`)
          .join("\n");

        const approved = await this.approvalFn(
          `This project has hooks that want to run shell commands:\n${projectHookCommands}\n\nAllow project hooks to execute?`
        );

        if (approved) {
          this.projectHooksApproved = true;
        } else {
          // Skip project hooks, only run global ones
          const globalOnly = matching.filter(h => h.source === "global");
          const results: HookResult[] = [];
          for (const hook of globalOnly) {
            results.push(await this.executeHook(hook, variables));
          }
          return results;
        }
      } else {
        // No approval function — skip project hooks for safety
        const globalOnly = matching.filter(h => h.source === "global");
        const results: HookResult[] = [];
        for (const hook of globalOnly) {
          results.push(await this.executeHook(hook, variables));
        }
        return results;
      }
    }

    const results: HookResult[] = [];
    for (const hook of matching) {
      const result = await this.executeHook(hook, variables);
      results.push(result);
    }
    return results;
  }

  /** Execute a single hook with security protections */
  private executeHook(
    hook: HookDefinition,
    variables: Record<string, string>
  ): Promise<HookResult> {
    // Replace {{variable}} placeholders with SHELL-ESCAPED values
    let command = hook.command;
    for (const [key, value] of Object.entries(variables)) {
      // Shell-escape the value to prevent command injection
      const escapedValue = shellEscape(value);
      command = command.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), escapedValue);
    }

    const timeout = hook.timeout || 10000;

    return new Promise((resolve) => {
      exec(command, {
        cwd: this.workingDir,
        timeout,
        maxBuffer: 1024 * 1024,
        // Use sanitized environment — no sensitive vars
        env: buildHookEnv(),
      }, (error, stdout, stderr) => {
        if (error) {
          resolve({
            hook,
            success: false,
            output: stdout || "",
            error: stderr || error.message,
          });
        } else {
          resolve({
            hook,
            success: true,
            output: (stdout || "").trim(),
          });
        }
      });
    });
  }

  /** Check if any hooks are configured */
  hasHooks(): boolean {
    return this.hooks.length > 0;
  }

  /** Get all configured hooks */
  getHooks(): ReadonlyArray<HookDefinition> {
    return this.hooks;
  }

  /** Check if project hooks have been approved this session */
  isProjectHooksApproved(): boolean {
    return this.projectHooksApproved;
  }
}
