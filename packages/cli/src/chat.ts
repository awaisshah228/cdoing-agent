/**
 * Interactive Chat Interface
 *
 * Commands:
 *   ? or /help         — show help
 *   !<command>          — run shell command directly
 *   /config             — show current config
 *   /model <name>       — switch model
 *   /provider <name>    — switch provider
 *   /mode <mode>        — change permission mode
 *   /dir <path>         — change working directory
 *   /new                — start a new conversation
 *   /history            — list saved conversations
 *   /resume <id>        — resume a saved conversation
 *   /delete <id>        — delete a saved conversation
 *   /clear              — clear current conversation
 *   /exit               — quit
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
import {
  createConversation,
  addMessage,
  loadConversation,
  printConversationList,
  deleteConversation,
  type Conversation,
} from "./history";

export class ChatInterface {
  private rl!: readline.Interface;
  private agent: AgentRunner;
  private spinner = ora();
  private modelConfig: Partial<ModelConfig>;
  private toolRegistry: ToolRegistry;
  private permissionManager: PermissionManager;
  private workingDir: string;
  private conversation: Conversation;

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
    this.conversation = createConversation(
      String(modelConfig.provider || "anthropic"),
      String(modelConfig.model || "default")
    );
    this.createReadline();
  }

  private createReadline(): void {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
  }

  async start(): Promise<void> {
    // Ctrl+C during idle prompt → show hint instead of killing CLI
    process.on("SIGINT", () => {
      console.log(chalk.dim("\n  Type /exit to quit, or Ctrl+C twice to force exit.\n"));
      this.promptUser();
    });

    printWelcome();
    this.promptUser();
  }

  private promptUser(): void {
    this.rl.question(chalk.green("❯ "), async (input) => {
      const trimmed = input.trim();
      if (!trimmed) { this.promptUser(); return; }

      if (trimmed === "?") { printHelp(); this.promptUser(); return; }

      if (trimmed.startsWith("!")) {
        await this.runShellCommand(trimmed.slice(1).trim());
        this.promptUser();
        return;
      }

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

      case "/new":
        this.agent.clearHistory();
        this.conversation = createConversation(
          String(this.modelConfig.provider || "anthropic"),
          String(this.modelConfig.model || "default")
        );
        console.log(chalk.green("\n  New conversation started.\n"));
        return true;

      case "/history":
        printConversationList();
        return true;

      case "/resume":
        if (!arg) {
          console.log(chalk.dim("\n  Usage: /resume <id>\n"));
          printConversationList();
          return true;
        }
        return this.resumeConversation(arg);

      case "/delete":
        if (!arg) {
          console.log(chalk.dim("\n  Usage: /delete <id>\n"));
          return true;
        }
        if (deleteConversation(arg)) {
          console.log(chalk.green(`\n  Deleted conversation: ${arg}\n`));
        } else {
          console.log(chalk.red(`\n  Conversation not found: ${arg}\n`));
        }
        return true;

      case "/config":
        printConfig({
          provider: String(this.modelConfig.provider || "anthropic"),
          model: String(this.modelConfig.model || "(default)"),
          mode: this.permissionManager.getMode(),
          dir: this.workingDir,
        });
        console.log(chalk.dim(`    Chat ID:     ${this.conversation.id}`));
        console.log(chalk.dim(`    Messages:    ${this.conversation.messages.length}\n`));
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
        this.modelConfig.model = undefined;
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

  /** Resume a saved conversation by replaying its messages into the agent */
  private resumeConversation(id: string): boolean {
    const conv = loadConversation(id);
    if (!conv) {
      console.log(chalk.red(`\n  Conversation not found: ${id}\n`));
      return true;
    }

    // Clear current state
    this.agent.clearHistory();
    this.conversation = conv;

    // Replay messages into the agent's history
    for (const msg of conv.messages) {
      if (msg.role === "user") {
        this.agent.addToHistory("user", msg.content);
      } else if (msg.role === "assistant") {
        this.agent.addToHistory("assistant", msg.content);
      }
    }

    console.log(chalk.green(`\n  Resumed: ${conv.title}`));
    console.log(chalk.dim(`  ${conv.messages.length} messages loaded.\n`));

    // Show last few messages for context
    const recent = conv.messages.slice(-6);
    for (const msg of recent) {
      if (msg.role === "user") {
        console.log(chalk.green("  ❯ ") + chalk.dim(msg.content.substring(0, 80)));
      } else if (msg.role === "assistant") {
        console.log(chalk.cyan("    ") + chalk.dim(msg.content.substring(0, 80)));
      }
    }
    console.log();

    return true;
  }

  /** Run a shell command directly (! prefix). Intercepts `cd` to change working dir. */
  private runShellCommand(command: string): Promise<void> {
    if (!command) {
      console.log(chalk.dim("\n  Usage: !<command>  (e.g. !ls, !git status, !npm test)\n"));
      return Promise.resolve();
    }

    // Intercept `cd` — change working directory like /dir
    const cdMatch = command.match(/^cd\s+(.+)$/);
    if (cdMatch) {
      const target = cdMatch[1].trim().replace(/^~/, process.env.HOME || "~");
      const newDir = path.resolve(this.workingDir, target);
      if (!fs.existsSync(newDir) || !fs.statSync(newDir).isDirectory()) {
        console.log(chalk.red(`\n  Not a valid directory: ${newDir}\n`));
        return Promise.resolve();
      }
      this.workingDir = newDir;
      this.toolRegistry = createToolRegistry(newDir);
      this.rebuildAgent();
      console.log(chalk.green(`\n  ${newDir}\n`));
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      console.log(chalk.dim(`\n  $ ${command}`));
      console.log(chalk.dim("  (Ctrl+C to stop)\n"));
      const child = exec(command, {
        cwd: this.workingDir,
        timeout: 600000, // 10 min for long-running commands
        maxBuffer: 10 * 1024 * 1024,
        env: { ...process.env },
      });
      child.stdout?.pipe(process.stdout);
      child.stderr?.pipe(process.stderr);

      // Ctrl+C kills the child process, not the CLI
      const onSigint = () => {
        child.kill("SIGTERM");
        console.log(chalk.dim("\n  Command stopped.\n"));
      };
      process.on("SIGINT", onSigint);

      child.on("close", (code) => {
        process.removeListener("SIGINT", onSigint);
        if (code !== 0 && code !== null) console.log(chalk.dim(`\n  Exit code: ${code}`));
        console.log();
        resolve();
      });
    });
  }

  private rebuildAgent(): void {
    this.agent = new AgentRunner(this.modelConfig, this.toolRegistry, this.permissionManager);
  }

  private async sendMessage(message: string): Promise<void> {
    // Save user message to conversation history
    addMessage(this.conversation, "user", message);

    console.log();
    const callbacks = createInteractiveCallbacks(this.spinner);

    // Wrap callbacks to also save to conversation history
    let assistantResponse = "";
    const wrappedCallbacks = {
      ...callbacks,
      onToken: (token: string) => {
        assistantResponse += token;
        callbacks.onToken(token);
      },
      onToolCall: (name: string, input: Record<string, unknown>) => {
        addMessage(this.conversation, "tool", JSON.stringify(input), name);
        callbacks.onToolCall(name, input);
      },
      onComplete: () => {
        if (assistantResponse) {
          addMessage(this.conversation, "assistant", assistantResponse);
        }
        callbacks.onComplete();
      },
    };

    this.spinner.start(chalk.dim("  Thinking..."));
    this.rl.close();

    try {
      await this.agent.run(message, wrappedCallbacks);
    } catch (error) {
      this.spinner.stop();
      const msg = error instanceof Error ? error.message : String(error);
      console.log(chalk.red(`\n  Error: ${msg}\n`));
    }

    this.createReadline();
  }
}
