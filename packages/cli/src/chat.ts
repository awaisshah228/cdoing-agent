/**
 * Interactive Chat Interface — readline REPL with slash commands.
 *
 * Key detail: we close readline before agent.run() so that the
 * permission manager's readline can use stdin without conflict.
 * We recreate it after the agent finishes.
 */

import * as readline from "readline";
import chalk from "chalk";
import ora from "ora";
import { AgentRunner } from "@cdoing/ai";
import type { ToolRegistry, PermissionManager } from "@cdoing/core";
import type { ModelConfig } from "@cdoing/ai";
import { printWelcome, printHelp } from "./help";
import { createInteractiveCallbacks } from "./callbacks";

export class ChatInterface {
  private rl!: readline.Interface;
  private agent: AgentRunner;
  private spinner = ora();

  constructor(
    modelConfig: Partial<ModelConfig>,
    toolRegistry: ToolRegistry,
    permissionManager: PermissionManager
  ) {
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

      if (trimmed.startsWith("/")) {
        const cont = this.handleCommand(trimmed);
        if (cont) this.promptUser();
        return;
      }

      await this.sendMessage(trimmed);
      this.promptUser();
    });
  }

  private handleCommand(command: string): boolean {
    const [cmd] = command.split(" ");
    switch (cmd) {
      case "/help":
        printHelp();
        return true;
      case "/clear":
        this.agent.clearHistory();
        console.log(chalk.yellow("\n  Conversation cleared.\n"));
        return true;
      case "/model":
        console.log(chalk.dim("\n  Model config loaded from env/flags.\n"));
        return true;
      case "/mode":
        console.log(chalk.dim("\n  Permission mode set via --mode flag.\n"));
        return true;
      case "/exit":
      case "/quit":
        console.log(chalk.dim("\n  Goodbye!\n"));
        this.rl.close();
        process.exit(0);
      default:
        console.log(chalk.red(`\n  Unknown command: ${cmd}`));
        console.log(chalk.dim("  Type /help for commands.\n"));
        return true;
    }
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

    // Recreate readline for next prompt
    this.createReadline();
  }
}
