/**
 * Interactive Chat Interface
 *
 * Supports:
 *   ? or /help     — show help
 *   !<command>     — run shell command directly (like Claude Code)
 *   /config        — show current config
 *   /model <name>  — switch model
 *   /provider <n>  — switch provider
 *   /mode <mode>   — change permission mode
 *   /dir <path>    — change working directory
 *   /clear         — reset conversation
 *   /exit          — quit
 */

import * as readline from "readline";
import * as path from "path";
import * as fs from "fs";
import { exec } from "child_process";
import chalk from "chalk";
import ora from "ora";
import { AgentRunner } from "@cdoing/ai";
import type { ToolRegistry, PermissionManager, PermissionMode } from "@cdoing/core";
import type { ModelConfig } from "@cdoing/ai";
import { printWelcome, printHelp, printConfig } from "./help";
import { createInteractiveCallbacks } from "./callbacks";
import { createToolRegistry } from "./tools";
import { parsePermissionMode } from "./config";

export class ChatInterface {
  private rl!: readline.Interface;
  private agent: AgentRunner;
  private spinner = ora();
  private modelConfig: Partial<ModelConfig>;
  private toolRegistry: ToolRegistry;
  private permissionManager: PermissionManager;
  private workingDir: string;

  constructor(
    modelConfig: Partial<ModelConfig>,
    toolRegistry: ToolRegistry,
    permissionManager: PermissionManager
  ) {
    this.modelConfig = modelConfig;
    this.toolRegistry = toolRegistry;
    this.permissionManager = permissionManager;
    this.workingDir = process.cwd();
    this.agent = new AgentRunner(modelConfig, toolRegistry, permissionManager);
    this.createReadline();
  }

  private createReadline(): void {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
  }

  async start(): Promise<void> {
    printWelcome();
    this.promptUser();
  }

  private promptUser(): void {
    this.rl.question(chalk.green("❯ "), async (input) => {
      const trimmed = input.trim();
      if (!trimmed) { this.promptUser(); return; }

      // ? = help shortcut
      if (trimmed === "?") {
        printHelp();
        this.promptUser();
        return;
      }

      // ! = run shell command directly
      if (trimmed.startsWith("!")) {
        await this.runShellCommand(trimmed.slice(1).trim());
        this.promptUser();
        return;
      }

      // / = slash commands
      if (trimmed.startsWith("/")) {
        const cont = this.handleCommand(trimmed);
        if (cont) this.promptUser();
        return;
      }

      // Regular message → send to agent
      await this.sendMessage(trimmed);
      this.promptUser();
    });
  }

  private handleCommand(command: string): boolean {
    const parts = command.split(/\s+/);
    const cmd = parts[0];
    const arg = parts.slice(1).join(" ");

    switch (cmd) {
      case "/help":
        printHelp();
        return true;

      case "/clear":
        this.agent.clearHistory();
        console.log(chalk.yellow("\n  Conversation cleared.\n"));
        return true;

      case "/config":
        printConfig({
          provider: String(this.modelConfig.provider || "anthropic"),
          model: String(this.modelConfig.model || "(default)"),
          mode: this.permissionManager.getMode(),
          dir: this.workingDir,
        });
        return true;

      case "/model":
        if (!arg) {
          console.log(chalk.dim(`\n  Current model: ${this.modelConfig.model || "(default)"}`));
          console.log(chalk.dim("  Usage: /model <name>  (e.g. /model gpt-4o)\n"));
          return true;
        }
        this.modelConfig.model = arg;
        this.rebuildAgent();
        console.log(chalk.green(`\n  Model switched to: ${arg}\n`));
        return true;

      case "/provider":
        if (!arg) {
          console.log(chalk.dim(`\n  Current provider: ${this.modelConfig.provider || "anthropic"}`));
          console.log(chalk.dim("  Usage: /provider <name>  (anthropic, openai, google)\n"));
          return true;
        }
        this.modelConfig.provider = arg.toLowerCase();
        this.modelConfig.model = undefined; // reset to provider default
        this.rebuildAgent();
        console.log(chalk.green(`\n  Provider switched to: ${arg}\n`));
        return true;

      case "/mode":
        if (!arg) {
          console.log(chalk.dim(`\n  Current mode: ${this.permissionManager.getMode()}`));
          console.log(chalk.dim("  Usage: /mode <mode>  (ask, auto-edit, auto)\n"));
          return true;
        }
        this.permissionManager.setMode(parsePermissionMode(arg) as PermissionMode);
        console.log(chalk.green(`\n  Permission mode: ${arg}\n`));
        return true;

      case "/dir":
        if (!arg) {
          console.log(chalk.dim(`\n  Working directory: ${this.workingDir}\n`));
          return true;
        }
        const newDir = path.resolve(this.workingDir, arg);
        if (!fs.existsSync(newDir) || !fs.statSync(newDir).isDirectory()) {
          console.log(chalk.red(`\n  Not a valid directory: ${newDir}\n`));
          return true;
        }
        this.workingDir = newDir;
        this.toolRegistry = createToolRegistry(newDir);
        this.rebuildAgent();
        console.log(chalk.green(`\n  Working directory: ${newDir}\n`));
        return true;

      case "/exit":
      case "/quit":
        console.log(chalk.dim("\n  Goodbye!\n"));
        this.rl.close();
        process.exit(0);

      default:
        console.log(chalk.red(`\n  Unknown command: ${cmd}`));
        console.log(chalk.dim("  Type ? or /help for available commands.\n"));
        return true;
    }
  }

  /** Run a shell command directly (! prefix) */
  private runShellCommand(command: string): Promise<void> {
    if (!command) {
      console.log(chalk.dim("\n  Usage: !<command>  (e.g. !ls, !git status, !npm test)\n"));
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      console.log(chalk.dim(`\n  $ ${command}\n`));
      const child = exec(command, {
        cwd: this.workingDir,
        timeout: 120000,
        maxBuffer: 10 * 1024 * 1024,
        env: { ...process.env },
      });

      child.stdout?.pipe(process.stdout);
      child.stderr?.pipe(process.stderr);

      child.on("close", (code) => {
        if (code !== 0) console.log(chalk.dim(`\n  Exit code: ${code}`));
        console.log();
        resolve();
      });
    });
  }

  /** Rebuild agent when config changes */
  private rebuildAgent(): void {
    this.agent = new AgentRunner(this.modelConfig, this.toolRegistry, this.permissionManager);
  }

  private async sendMessage(message: string): Promise<void> {
    console.log();
    const callbacks = createInteractiveCallbacks(this.spinner);
    this.spinner.start(chalk.dim("  Thinking..."));

    // Close readline so permission prompts can use stdin
    this.rl.close();

    try {
      await this.agent.run(message, callbacks);
    } catch (error) {
      this.spinner.stop();
      const msg = error instanceof Error ? error.message : String(error);
      console.log(chalk.red(`\n  Error: ${msg}\n`));
    }

    this.createReadline();
  }
}
