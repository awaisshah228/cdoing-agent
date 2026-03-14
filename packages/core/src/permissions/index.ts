/**
 * Permission Manager
 *
 * Controls whether tools need user approval.
 * Uses a standalone readline that only opens when needed —
 * no conflict with the chat's readline.
 */

import * as readline from "readline";
import type { ToolDefinition } from "../tools/types";

export enum PermissionMode {
  ASK = "ask",
  AUTO_EDIT = "auto-edit",
  AUTO = "auto",
}

export class PermissionManager {
  private mode: PermissionMode;

  constructor(mode: PermissionMode = PermissionMode.ASK) {
    this.mode = mode;
  }

  setMode(mode: PermissionMode): void {
    this.mode = mode;
  }

  getMode(): PermissionMode {
    return this.mode;
  }

  async requestPermission(
    toolDef: ToolDefinition,
    input: Record<string, unknown>
  ): Promise<boolean> {
    if (!toolDef.requiresPermission) return true;
    if (this.mode === PermissionMode.AUTO) return true;
    if (this.mode === PermissionMode.AUTO_EDIT && toolDef.name !== "shell_exec") return true;

    // Build a human-readable description
    const message = this.describeAction(toolDef, input);
    return this.askUser(message);
  }

  /** Build description from tool's permissionMessage or fallback to input summary */
  private describeAction(toolDef: ToolDefinition, input: Record<string, unknown>): string {
    if (toolDef.permissionMessage) {
      const msg = toolDef.permissionMessage(input);
      if (msg && !msg.includes("undefined")) return msg;
    }
    // Fallback: show tool name + first useful input value
    const value = input.file_path || input.command || input.pattern || Object.values(input)[0];
    return `${toolDef.name.replace(/_/g, " ")}: ${value || "(no details)"}`;
  }

  /** Prompt user with Y/n — Enter defaults to yes */
  private askUser(message: string): Promise<boolean> {
    return new Promise((resolve) => {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      rl.question(
        `\n  \x1b[33m⚡ Permission:\x1b[0m ${message}\n  \x1b[2mAllow? (Y/n):\x1b[0m `,
        (answer: string) => {
          rl.close();
          const a = answer.trim().toLowerCase();
          resolve(a === "" || a === "y" || a === "yes");
        }
      );
    });
  }
}
