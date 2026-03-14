/**
 * Interactive Chat Interface
 *
 * Provides a readline-based REPL for conversing with the
 * AI agent. Handles slash commands and streams responses
 * with visual feedback (spinners, colors).
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
  private rl: readline.Interface;
  private agent: AgentRunner;
  private spinner = ora();

  constructor(
    modelConfig: Partial<ModelConfig>,
    toolRegistry: ToolRegistry,
    permissionManager: PermissionManager
  ) {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    this.agent = new AgentRunner(modelConfig, toolRegistry, permissionManager);
  }

  /** Launch the interactive REPL */
  async start(): Promise<void> {
    printWelcome();
    this.promptUser();
  }

  /**
   * Show the prompt and wait for user input.
   * Loops until the user exits.
   */
  private promptUser(): void {
    this.rl.question(chalk.green("❯ "), async (input) => {
      const trimmed = input.trim();

      // Skip empty input
      if (!trimmed) {
        this.promptUser();
        return;
      }

      // Route slash commands vs. agent messages
      if (trimmed.startsWith("/")) {
        const shouldContinue = await this.handleCommand(trimmed);
        if (shouldContinue) this.promptUser();
        return;
      }

      // Send user message to the agent
      await this.sendMessage(trimmed);
      this.promptUser();
    });
  }

  /**
   * Handle a slash command.
   * Returns false if the REPL should stop (e.g. /exit).
   */
  private async handleCommand(command: string): Promise<boolean> {
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
        console.log(chalk.dim("\n  Current model configuration loaded from env.\n"));
        return true;

      case "/mode":
        console.log(chalk.dim("\n  Permission mode: ask (use --mode flag to change)\n"));
        return true;

      case "/exit":
      case "/quit":
        console.log(chalk.dim("\n  Goodbye!\n"));
        this.rl.close();
        process.exit(0);

      default:
        console.log(chalk.red(`\n  Unknown command: ${cmd}`));
        console.log(chalk.dim("  Type /help to see available commands.\n"));
        return true;
    }
  }

  /** Send a message to the agent and display the response */
  private async sendMessage(message: string): Promise<void> {
    console.log();
    const callbacks = createInteractiveCallbacks(this.spinner);
    this.spinner.start(chalk.dim("  Thinking..."));

    // Close the chat readline so stdin is free for permission prompts.
    // We'll recreate it after the agent finishes.
    this.rl.close();

    try {
      await this.agent.run(message, callbacks);
    } catch (error) {
      this.spinner.stop();
      const msg = error instanceof Error ? error.message : String(error);
      console.log(chalk.red(`\n  Error: ${msg}\n`));
    }

    // Recreate readline for the next user prompt
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
  }

  /** Clean up readline resources */
  destroy(): void {
    this.rl.close();
  }
}
