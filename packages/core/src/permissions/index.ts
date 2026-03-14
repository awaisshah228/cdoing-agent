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

  async requestPermission(
    toolDef: ToolDefinition,
    input: Record<string, unknown>
  ): Promise<boolean> {
    if (!toolDef.requiresPermission) return true;

    if (this.mode === PermissionMode.AUTO) return true;

    if (this.mode === PermissionMode.AUTO_EDIT) {
      // Auto-approve file operations, ask for shell commands
      if (toolDef.name !== "shell_exec") return true;
    }

    // Ask mode or shell_exec in auto-edit mode
    const message = toolDef.permissionMessage
      ? toolDef.permissionMessage(input)
      : `Execute tool: ${toolDef.name}`;

    return this.prompt(message);
  }

  private prompt(message: string): Promise<boolean> {
    return new Promise((resolve) => {
      this.rl = readline.createInterface({
        input: process.stdin,
        output: process.stderr,
      });

      this.rl.question(`\n⚡ Permission required: ${message}\n  Allow? (y/n): `, (answer) => {
        this.rl?.close();
        this.rl = null;
        resolve(answer.trim().toLowerCase() === "y" || answer.trim().toLowerCase() === "yes");
      });
    });
  }

  destroy(): void {
    this.rl?.close();
  }
}
