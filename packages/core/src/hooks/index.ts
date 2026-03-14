/**
 * Hooks System — run user-configured shell commands before/after tool execution.
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
  /** Shell command to execute. Supports {{variable}} placeholders. */
  command: string;
  /** Timeout in ms (default: 10000) */
  timeout?: number;
}

export interface HookResult {
  hook: HookDefinition;
  success: boolean;
  output: string;
  error?: string;
}

export class HookManager {
  private hooks: HookDefinition[] = [];
  private workingDir: string;

  constructor(workingDir: string) {
    this.workingDir = workingDir;
    this.loadHooks();
  }

  setWorkingDir(dir: string): void {
    this.workingDir = dir;
    this.loadHooks();
  }

  private loadHooks(): void {
    this.hooks = [];

    // Load global hooks
    const globalFile = path.join(os.homedir(), ".cdoing", "hooks.json");
    this.loadFromFile(globalFile);

    // Load project hooks (overrides/supplements global)
    const projectFile = path.join(this.workingDir, ".cdoing", "hooks.json");
    this.loadFromFile(projectFile);
  }

  private loadFromFile(filePath: string): void {
    try {
      if (fs.existsSync(filePath)) {
        const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
        if (Array.isArray(data.hooks)) {
          this.hooks.push(...data.hooks);
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

    const results: HookResult[] = [];
    for (const hook of matching) {
      const result = await this.executeHook(hook, variables);
      results.push(result);
    }
    return results;
  }

  /** Execute a single hook */
  private executeHook(
    hook: HookDefinition,
    variables: Record<string, string>
  ): Promise<HookResult> {
    // Replace {{variable}} placeholders
    let command = hook.command;
    for (const [key, value] of Object.entries(variables)) {
      command = command.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), value);
    }

    const timeout = hook.timeout || 10000;

    return new Promise((resolve) => {
      exec(command, {
        cwd: this.workingDir,
        timeout,
        maxBuffer: 1024 * 1024,
        env: { ...process.env },
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
}
