/**
 * Permission Manager
 *
 * Controls whether tools need user approval before executing.
 * Three modes:
 *   - ASK: prompt before every permission-required tool
 *   - AUTO_EDIT: auto-approve file operations, ask for shell commands
 *   - AUTO: auto-approve everything (use with caution)
 */

import * as readline from "readline";
import type { ToolDefinition } from "../tools/types";

export enum PermissionMode {
  /** Ask before every tool that requires permission */
  ASK = "ask",
  /** Auto-approve file edits, ask for shell commands */
  AUTO_EDIT = "auto-edit",
  /** Auto-approve everything */
  AUTO = "auto",
}

export class PermissionManager {
  private mode: PermissionMode;
  private rl: readline.Interface | null = null;

  constructor(mode: PermissionMode = PermissionMode.ASK) {
    this.mode = mode;
  }

  setMode(mode: PermissionMode): void {
    this.mode = mode;
  }

  getMode(): PermissionMode {
    return this.mode;
  }

  /**
   * Check if a tool call should be allowed to proceed.
   * Depending on the mode, this may prompt the user interactively.
   */
  async requestPermission(
    toolDef: ToolDefinition,
    input: Record<string, unknown>
  ): Promise<boolean> {
    // Tools that don't require permission always pass
    if (!toolDef.requiresPermission) return true;

    // AUTO mode — approve everything
    if (this.mode === PermissionMode.AUTO) return true;

    // AUTO_EDIT mode — approve file operations, ask for shell commands
    if (this.mode === PermissionMode.AUTO_EDIT) {
      if (toolDef.name !== "shell_exec") return true;
    }

    // Build a descriptive message for the user
    const message = this.buildPermissionMessage(toolDef, input);
    return this.prompt(message);
  }

  /**
   * Build a human-readable description of what the tool is about to do.
   * Falls back gracefully if the tool's permissionMessage returns undefined values.
   */
  private buildPermissionMessage(
    toolDef: ToolDefinition,
    input: Record<string, unknown>
  ): string {
    // Try the tool's custom permission message first
    if (toolDef.permissionMessage) {
      const msg = toolDef.permissionMessage(input);
      // Guard against "undefined" appearing in the message
      if (msg && !msg.includes("undefined")) {
        return msg;
      }
    }

    // Fallback: build a useful message from the tool name and input
    const toolName = toolDef.name.replace(/_/g, " ");
    const inputSummary = this.summarizeInput(input);
    return `${toolName}${inputSummary ? `: ${inputSummary}` : ""}`;
  }

  /**
   * Create a short summary of the tool input for the permission prompt.
   * Shows the most relevant field (file path, command, pattern, etc.)
   */
  private summarizeInput(input: Record<string, unknown>): string {
    // Priority order of keys to show
    const keys = ["file_path", "filePath", "command", "pattern", "path"];
    for (const key of keys) {
      if (input[key] && typeof input[key] === "string") {
        return String(input[key]);
      }
    }

    // Fallback: show first string value
    for (const value of Object.values(input)) {
      if (typeof value === "string" && value.length < 100) {
        return value;
      }
    }

    return "";
  }

  /**
   * Show an interactive Y/n prompt to the user.
   * Styled with color and clear formatting.
   */
  private prompt(message: string): Promise<boolean> {
    return new Promise((resolve) => {
      this.rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      const question = `\n  \x1b[33m⚡ Permission required:\x1b[0m ${message}\n  \x1b[2mAllow? (Y/n):\x1b[0m `;

      this.rl.question(question, (answer: string) => {
        this.rl?.close();
        this.rl = null;

        const trimmed = answer.trim().toLowerCase();
        // Default to yes (just pressing Enter = allow)
        resolve(trimmed === "" || trimmed === "y" || trimmed === "yes");
      });
    });
  }

  destroy(): void {
    this.rl?.close();
  }
}
