import * as readline from "readline";
import chalk from "chalk";
import ora from "ora";
import { AgentRunner, type AgentCallbacks } from "@cdoing/ai";
import type { ToolRegistry, PermissionManager } from "@cdoing/core";
import type { ModelConfig } from "@cdoing/ai";

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

  async start(): Promise<void> {
    this.printWelcome();
    this.promptUser();
  }

  private printWelcome(): void {
    console.log();
    console.log(chalk.bold.cyan("  ╔══════════════════════════════════════╗"));
    console.log(chalk.bold.cyan("  ║") + chalk.bold.white("       Cdoing Agent v0.1.0            ") + chalk.bold.cyan("║"));
    console.log(chalk.bold.cyan("  ║") + chalk.dim("   AI-Powered Coding Assistant        ") + chalk.bold.cyan("║"));
    console.log(chalk.bold.cyan("  ╚══════════════════════════════════════╝"));
    console.log();
    console.log(chalk.dim("  Type your message and press Enter to chat."));
    console.log(chalk.dim("  Commands: /help, /clear, /model, /mode, /exit"));
    console.log();
  }

  private promptUser(): void {
    this.rl.question(chalk.green("❯ "), async (input) => {
      const trimmed = input.trim();

      if (!trimmed) {
        this.promptUser();
        return;
      }

      // Handle slash commands
      if (trimmed.startsWith("/")) {
        await this.handleCommand(trimmed);
        this.promptUser();
        return;
      }

      // Send to agent
      await this.sendMessage(trimmed);
      this.promptUser();
    });
  }

  private async handleCommand(command: string): Promise<void> {
    const [cmd, ...args] = command.split(" ");

    switch (cmd) {
      case "/help":
        console.log();
        console.log(chalk.bold("Available commands:"));
        console.log(chalk.cyan("  /help    ") + chalk.dim("Show this help message"));
        console.log(chalk.cyan("  /clear   ") + chalk.dim("Clear conversation history"));
        console.log(chalk.cyan("  /model   ") + chalk.dim("Show current model info"));
        console.log(chalk.cyan("  /mode    ") + chalk.dim("Show/change permission mode"));
        console.log(chalk.cyan("  /exit    ") + chalk.dim("Exit the agent"));
        console.log();
        break;

      case "/clear":
        this.agent.clearHistory();
        console.log(chalk.yellow("\n  Conversation cleared.\n"));
        break;

      case "/model":
        console.log(chalk.dim("\n  Current model configuration loaded from env.\n"));
        break;

      case "/mode":
        console.log(chalk.dim("\n  Permission mode: ask (use --mode flag to change)\n"));
        break;

      case "/exit":
      case "/quit":
        console.log(chalk.dim("\n  Goodbye! 👋\n"));
        this.rl.close();
        process.exit(0);

      default:
        console.log(chalk.red(`\n  Unknown command: ${cmd}\n`));
    }
  }

  private async sendMessage(message: string): Promise<void> {
    console.log();
    let isFirstToken = true;

    const callbacks: AgentCallbacks = {
      onToken: (token) => {
        if (isFirstToken) {
          this.spinner.stop();
          process.stdout.write(chalk.cyan("  "));
          isFirstToken = false;
        }
        process.stdout.write(token);
      },
      onToolCall: (name, input) => {
        this.spinner.stop();
        const inputPreview = JSON.stringify(input).substring(0, 80);
        console.log(chalk.yellow(`\n  ⚡ ${name}`) + chalk.dim(` ${inputPreview}`));
        this.spinner.start(chalk.dim("  Executing..."));
      },
      onToolResult: (name, result, isError) => {
        this.spinner.stop();
        if (isError) {
          console.log(chalk.red(`  ✗ ${name} failed`));
        } else {
          const preview = result.substring(0, 120).replace(/\n/g, " ");
          console.log(chalk.green(`  ✓ ${name}`) + chalk.dim(` ${preview}`));
        }
        this.spinner.start(chalk.dim("  Thinking..."));
      },
      onComplete: () => {
        this.spinner.stop();
        console.log("\n");
      },
      onError: (error) => {
        this.spinner.stop();
        console.log(chalk.red(`\n  Error: ${error.message}\n`));
      },
    };

    this.spinner.start(chalk.dim("  Thinking..."));

    try {
      await this.agent.run(message, callbacks);
    } catch (error) {
      this.spinner.stop();
      const msg = error instanceof Error ? error.message : String(error);
      console.log(chalk.red(`\n  Error: ${msg}\n`));
    }
  }

  destroy(): void {
    this.rl.close();
  }
}
