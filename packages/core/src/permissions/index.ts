/**
 * Permission Manager
 *
 * Controls whether tools need user approval.
 * Supports storing permissions at two levels:
 *   - Global:  ~/.cdoing/permissions.json (applies everywhere)
 *   - Project: .cdoing/permissions.json   (applies to this project only)
 *
 * When prompted, user can choose:
 *   y / Enter  → Allow once
 *   a          → Always allow globally (stored to ~/.cdoing/permissions.json)
 *   p          → Allow for this project (stored to .cdoing/permissions.json)
 *   n          → Deny
 *
 * Uses a standalone readline that only opens when needed —
 * no conflict with the chat's readline.
 */

import * as readline from "readline";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import type { ToolDefinition } from "../tools/types";

const GLOBAL_DIR = path.join(os.homedir(), ".cdoing");
const GLOBAL_PERMISSIONS_FILE = path.join(GLOBAL_DIR, "permissions.json");

/** A stored permission rule */
export interface PermissionRule {
  tool: string;
  /** Optional: allow only when the input matches this value (e.g. a specific command) */
  inputMatch?: string;
  /** When the rule was created */
  createdAt: string;
}

export type PermissionScope = "global" | "project";

export enum PermissionMode {
  ASK = "ask",
  AUTO_EDIT = "auto-edit",
  AUTO = "auto",
}

export class PermissionManager {
  private mode: PermissionMode;
  private globalRules: PermissionRule[] = [];
  private projectRules: PermissionRule[] = [];
  private projectDir: string | null = null;

  constructor(mode: PermissionMode = PermissionMode.ASK, projectDir?: string) {
    this.mode = mode;
    this.projectDir = projectDir || null;
    this.loadRules();
  }

  setMode(mode: PermissionMode): void {
    this.mode = mode;
  }

  getMode(): PermissionMode {
    return this.mode;
  }

  /** Update the project directory (e.g. when user runs /dir) */
  setProjectDir(dir: string): void {
    this.projectDir = dir;
    this.loadProjectRules();
  }

  // ── File paths ────────────────────────────────────────────

  private getProjectPermissionsFile(): string | null {
    if (!this.projectDir) return null;
    return path.join(this.projectDir, ".cdoing", "permissions.json");
  }

  // ── Load / Save ───────────────────────────────────────────

  private loadRules(): void {
    this.loadGlobalRules();
    this.loadProjectRules();
  }

  private loadGlobalRules(): void {
    try {
      if (fs.existsSync(GLOBAL_PERMISSIONS_FILE)) {
        const data = JSON.parse(fs.readFileSync(GLOBAL_PERMISSIONS_FILE, "utf-8"));
        this.globalRules = Array.isArray(data.rules) ? data.rules : [];
      }
    } catch {
      this.globalRules = [];
    }
  }

  private loadProjectRules(): void {
    this.projectRules = [];
    const file = this.getProjectPermissionsFile();
    if (!file) return;
    try {
      if (fs.existsSync(file)) {
        const data = JSON.parse(fs.readFileSync(file, "utf-8"));
        this.projectRules = Array.isArray(data.rules) ? data.rules : [];
      }
    } catch {
      this.projectRules = [];
    }
  }

  private saveGlobalRules(): void {
    if (!fs.existsSync(GLOBAL_DIR)) fs.mkdirSync(GLOBAL_DIR, { recursive: true });
    fs.writeFileSync(
      GLOBAL_PERMISSIONS_FILE,
      JSON.stringify({ rules: this.globalRules }, null, 2),
      "utf-8"
    );
  }

  private saveProjectRules(): void {
    const file = this.getProjectPermissionsFile();
    if (!file) return;
    const dir = path.dirname(file);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ rules: this.projectRules }, null, 2), "utf-8");
  }

  // ── Rule matching ─────────────────────────────────────────

  /** Check if any stored rule (global or project) covers this tool+input */
  private hasStoredPermission(toolName: string, input: Record<string, unknown>): boolean {
    const allRules = [...this.globalRules, ...this.projectRules];
    return allRules.some((rule) => {
      if (rule.tool !== toolName) return false;
      if (!rule.inputMatch) return true;
      const value = String(input.file_path || input.command || input.pattern || Object.values(input)[0] || "");
      return value === rule.inputMatch;
    });
  }

  /** Store a new permission rule in the given scope */
  private addRule(toolName: string, scope: PermissionScope, inputMatch?: string): void {
    const rules = scope === "project" ? this.projectRules : this.globalRules;
    const exists = rules.some((r) => r.tool === toolName && r.inputMatch === inputMatch);
    if (!exists) {
      rules.push({
        tool: toolName,
        inputMatch,
        createdAt: new Date().toISOString(),
      });
      if (scope === "project") {
        this.saveProjectRules();
      } else {
        this.saveGlobalRules();
      }
    }
  }

  /** Remove stored rules for a tool (or all rules) from the given scope */
  removeRule(toolName?: string, scope?: PermissionScope): void {
    if (scope === "project" || !scope) {
      if (!toolName) {
        this.projectRules = [];
      } else {
        this.projectRules = this.projectRules.filter((r) => r.tool !== toolName);
      }
      this.saveProjectRules();
    }
    if (scope === "global" || !scope) {
      if (!toolName) {
        this.globalRules = [];
      } else {
        this.globalRules = this.globalRules.filter((r) => r.tool !== toolName);
      }
      this.saveGlobalRules();
    }
  }

  /** Get all stored rules (for display in /permissions) */
  getStoredRules(): { global: ReadonlyArray<PermissionRule>; project: ReadonlyArray<PermissionRule> } {
    return { global: this.globalRules, project: this.projectRules };
  }

  // ── Permission request ────────────────────────────────────

  async requestPermission(
    toolDef: ToolDefinition,
    input: Record<string, unknown>
  ): Promise<boolean> {
    if (!toolDef.requiresPermission) return true;
    if (this.mode === PermissionMode.AUTO) return true;
    if (this.mode === PermissionMode.AUTO_EDIT && toolDef.name !== "shell_exec") return true;

    // Check stored permissions (global + project)
    if (this.hasStoredPermission(toolDef.name, input)) return true;

    const message = this.describeAction(toolDef, input);
    return this.askUser(toolDef.name, message);
  }

  /** Build description from tool's permissionMessage or fallback to input summary */
  private describeAction(toolDef: ToolDefinition, input: Record<string, unknown>): string {
    if (toolDef.permissionMessage) {
      const msg = toolDef.permissionMessage(input);
      if (msg && !msg.includes("undefined")) return msg;
    }
    const value = input.file_path || input.command || input.pattern || Object.values(input)[0];
    return `${toolDef.name.replace(/_/g, " ")}: ${value || "(no details)"}`;
  }

  /**
   * Prompt user with four options:
   *   y / Enter  → Allow once
   *   a          → Always allow globally
   *   p          → Allow for this project only
   *   n          → Deny
   */
  private askUser(toolName: string, message: string): Promise<boolean> {
    return new Promise((resolve) => {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      const hasProject = !!this.projectDir;
      const projectHint = hasProject ? ` · (p)roject only` : "";

      rl.question(
        `\n  \x1b[33m⚡ Permission:\x1b[0m ${message}\n  \x1b[2m(y)es, allow once · (a)lways allow${projectHint} · (n)o, deny\x1b[0m\n  \x1b[2mChoice [Y/a${hasProject ? "/p" : ""}/n]:\x1b[0m `,
        (answer: string) => {
          rl.close();
          const a = answer.trim().toLowerCase();
          const label = toolName.replace(/_/g, " ");
          if (a === "a" || a === "always") {
            this.addRule(toolName, "global");
            console.log(`  \x1b[32m✓ Permission saved globally for ${label}\x1b[0m`);
            resolve(true);
          } else if ((a === "p" || a === "project") && hasProject) {
            this.addRule(toolName, "project");
            console.log(`  \x1b[32m✓ Permission saved for project for ${label}\x1b[0m`);
            resolve(true);
          } else if (a === "n" || a === "no") {
            resolve(false);
          } else {
            // Default: allow once (y, yes, or Enter)
            resolve(true);
          }
        }
      );
    });
  }
}
