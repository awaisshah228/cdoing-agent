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
 *   /permissions        — view/clear stored permissions
 *   /memory             — view/manage persistent memory
 *   /hooks              — view configured hooks
 *   /new                — start a new conversation
 *   /history            — list saved conversations
 *   /resume <id>        — resume a saved conversation
 *   /delete <id>        — delete a saved conversation
 *   /clear              — clear current conversation
 *   /usage              — show token usage and cost
 *   /exit               — quit
 */

import * as readline from "readline";
import * as path from "path";
import * as fs from "fs";
import { exec } from "child_process";
import chalk from "chalk";
import ora from "ora";
import { AgentRunner } from "@cdoing/ai";
import type { ToolRegistry, PermissionManager, PermissionMode, HookManager, MemoryStore } from "@cdoing/core";
import { loadProjectConfig } from "@cdoing/core";
import type { ModelConfig } from "@cdoing/ai";
import { printWelcome, printHelp, printConfig } from "./help";
import { createInteractiveCallbacks } from "./callbacks";
import { createToolRegistry } from "./tools";
import { parsePermissionMode, updateStoredConfig, getStoredConfigDisplay } from "./config";
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
  private hookManager: HookManager;
  private memoryStore: MemoryStore;
  private workingDir: string;
  private conversation: Conversation;
  private lastSigint = 0;

  constructor(
    modelConfig: Partial<ModelConfig>,
    toolRegistry: ToolRegistry,
    permissionManager: PermissionManager,
    hookManager: HookManager,
    memoryStore: MemoryStore,
  ) {
    this.modelConfig = modelConfig;
    this.toolRegistry = toolRegistry;
    this.permissionManager = permissionManager;
    this.hookManager = hookManager;
    this.memoryStore = memoryStore;
    this.workingDir = process.cwd();
    this.agent = this.buildAgent();
    this.conversation = createConversation(
      String(modelConfig.provider || "anthropic"),
      String(modelConfig.model || "default")
    );
    this.createReadline();
  }

  private buildAgent(): AgentRunner {
    const projectConfig = loadProjectConfig(this.workingDir);
    return new AgentRunner(
      this.modelConfig,
      this.toolRegistry,
      this.permissionManager,
      this.hookManager,
      {
        projectConfig: projectConfig || undefined,
        memory: this.memoryStore.formatForPrompt() || undefined,
      }
    );
  }

  private createReadline(): void {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    this.rl.on("SIGINT", () => {
      this.handleSigint();
    });
  }

  private handleSigint(): void {
    const now = Date.now();
    if (now - this.lastSigint < 1000) {
      console.log(chalk.dim("\n  Goodbye!\n"));
      process.exit(0);
    }
    this.lastSigint = now;
    console.log(chalk.dim("\n  Press Ctrl+C again to exit, or type /exit.\n"));
    this.promptUser();
  }

  async start(): Promise<void> {
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
        if (arg === "show") {
          console.log(chalk.bold("\n  Stored Config") + chalk.dim(" (~/.cdoing/config.json):\n"));
          for (const line of getStoredConfigDisplay()) {
            console.log(chalk.white(`  ${line}`));
          }
          console.log();
          return true;
        }
        if (arg.startsWith("set ")) {
          const setParts = arg.slice(4).trim().split(/\s+/);
          const key = setParts[0];
          const value = setParts.slice(1).join(" ");
          if (!key || !value) {
            console.log(chalk.dim("\n  Usage: /config set <key> <value>"));
            console.log(chalk.dim("  Keys:  provider, model, mode, api-key, base-url\n"));
            return true;
          }
          const result = updateStoredConfig(key, value);
          if (result.success) {
            console.log(chalk.green(`\n  Saved: ${key} = ${key === "api-key" ? value.slice(0, 8) + "..." : value}\n`));
            // Apply changes to current session
            if (key === "provider") { this.modelConfig.provider = value; this.rebuildAgent(); }
            if (key === "model") { this.modelConfig.model = value; this.rebuildAgent(); }
            if (key === "mode") { this.permissionManager.setMode(parsePermissionMode(value) as PermissionMode); }
            if (key === "api-key") { this.modelConfig.apiKey = value; this.rebuildAgent(); }
            if (key === "base-url") { this.modelConfig.baseURL = value; this.rebuildAgent(); }
          } else {
            console.log(chalk.red(`\n  ${result.error}\n`));
          }
          return true;
        }
        printConfig({
          provider: String(this.modelConfig.provider || "anthropic"),
          model: String(this.modelConfig.model || "(default)"),
          mode: this.permissionManager.getMode(),
          dir: this.workingDir,
        });
        console.log(chalk.dim(`    Chat ID:     ${this.conversation.id}`));
        console.log(chalk.dim(`    Messages:    ${this.conversation.messages.length}`));
        console.log(chalk.dim(`\n    /config show             — view saved config`));
        console.log(chalk.dim(`    /config set <key> <val>  — update saved config\n`));
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
        this.permissionManager.setProjectDir(newDir);
        this.hookManager.setWorkingDir(newDir);
        this.rebuildAgent();
        console.log(chalk.green(`\n  Working directory: ${newDir}\n`));
        return true;

      case "/permissions":
        this.showPermissions(arg);
        return true;

      case "/memory":
        this.showMemory(arg);
        return true;

      case "/hooks":
        this.showHooks();
        return true;

      case "/usage":
        this.showUsage();
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

  /** Show or clear stored permission rules */
  private showPermissions(arg: string): void {
    if (arg === "clear") {
      this.permissionManager.removeRule();
      console.log(chalk.green("\n  All stored permissions cleared.\n"));
      return;
    }
    if (arg === "clear-global") {
      this.permissionManager.removeRule(undefined, "global");
      console.log(chalk.green("\n  Global permissions cleared.\n"));
      return;
    }
    if (arg === "clear-project") {
      this.permissionManager.removeRule(undefined, "project");
      console.log(chalk.green("\n  Project permissions cleared.\n"));
      return;
    }
    if (arg && !arg.startsWith("clear")) {
      this.permissionManager.removeRule(arg);
      console.log(chalk.green(`\n  Permissions cleared for: ${arg}\n`));
      return;
    }

    const { global: globalRules, project: projectRules } = this.permissionManager.getStoredRules();

    if (globalRules.length === 0 && projectRules.length === 0) {
      console.log(chalk.dim("\n  No stored permissions."));
      console.log(chalk.dim("  When prompted, press (a) to always allow or (p) for project only.\n"));
      return;
    }

    if (globalRules.length > 0) {
      console.log(chalk.bold("\n  Global permissions") + chalk.dim(" (~/.cdoing/permissions.json):\n"));
      for (const rule of globalRules) {
        const label = rule.tool.replace(/_/g, " ");
        const match = rule.inputMatch ? chalk.dim(` (${rule.inputMatch})`) : chalk.dim(" (all)");
        console.log(`    ${chalk.green("✓")} ${label}${match}`);
      }
    }

    if (projectRules.length > 0) {
      console.log(chalk.bold("\n  Project permissions") + chalk.dim(" (.cdoing/permissions.json):\n"));
      for (const rule of projectRules) {
        const label = rule.tool.replace(/_/g, " ");
        const match = rule.inputMatch ? chalk.dim(` (${rule.inputMatch})`) : chalk.dim(" (all)");
        console.log(`    ${chalk.green("✓")} ${label}${match}`);
      }
    }

    console.log(chalk.dim(`\n  /permissions clear          — remove all`));
    console.log(chalk.dim(`  /permissions clear-global   — remove global only`));
    console.log(chalk.dim(`  /permissions clear-project  — remove project only`));
    console.log(chalk.dim(`  /permissions <tool_name>    — remove specific tool\n`));
  }

  /** Show or manage memory */
  private showMemory(arg: string): void {
    if (arg === "clear") {
      this.memoryStore.clear();
      console.log(chalk.green("\n  All memories cleared.\n"));
      return;
    }

    if (arg && arg.startsWith("forget ")) {
      const key = arg.slice(7).trim();
      if (this.memoryStore.forget(key)) {
        console.log(chalk.green(`\n  Forgot: ${key}\n`));
      } else {
        console.log(chalk.red(`\n  Memory not found: ${key}\n`));
      }
      return;
    }

    const memories = this.memoryStore.getAll();
    if (memories.length === 0) {
      console.log(chalk.dim("\n  No stored memories."));
      console.log(chalk.dim("  The agent can save memories during conversations.\n"));
      return;
    }

    console.log(chalk.bold("\n  Stored Memories:\n"));
    for (const m of memories) {
      console.log(`    ${chalk.cyan(m.category)} ${chalk.bold(m.key)}: ${chalk.white(m.value)}`);
    }
    console.log(chalk.dim(`\n  /memory clear          — clear all`));
    console.log(chalk.dim(`  /memory forget <key>   — forget specific memory\n`));
  }

  /** Show configured hooks */
  private showHooks(): void {
    const hooks = this.hookManager.getHooks();
    if (hooks.length === 0) {
      console.log(chalk.dim("\n  No hooks configured."));
      console.log(chalk.dim("  Add hooks in ~/.cdoing/hooks.json or .cdoing/hooks.json\n"));
      return;
    }

    console.log(chalk.bold("\n  Configured Hooks:\n"));
    for (const h of hooks) {
      console.log(`    ${chalk.yellow(h.event)} → ${chalk.dim(h.command)}`);
    }
    console.log();
  }

  /** Show token usage stats */
  private showUsage(): void {
    const cm = this.agent.getContextManager();
    const formatted = cm.formatTotalUsage();
    console.log(chalk.dim(`\n  ${formatted}\n`));
  }

  /** Resume a saved conversation by replaying its messages into the agent */
  private resumeConversation(id: string): boolean {
    const conv = loadConversation(id);
    if (!conv) {
      console.log(chalk.red(`\n  Conversation not found: ${id}\n`));
      return true;
    }

    this.agent.clearHistory();
    this.conversation = conv;

    for (const msg of conv.messages) {
      if (msg.role === "user") {
        this.agent.addToHistory("user", msg.content);
      } else if (msg.role === "assistant") {
        this.agent.addToHistory("assistant", msg.content);
      }
    }

    console.log(chalk.green(`\n  Resumed: ${conv.title}`));
    console.log(chalk.dim(`  ${conv.messages.length} messages loaded.\n`));

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
      this.permissionManager.setProjectDir(newDir);
      this.hookManager.setWorkingDir(newDir);
      this.rebuildAgent();
      console.log(chalk.green(`\n  ${newDir}\n`));
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      console.log(chalk.dim(`\n  $ ${command}`));
      console.log(chalk.dim("  (Ctrl+C to stop)\n"));
      const child = exec(command, {
        cwd: this.workingDir,
        timeout: 600000,
        maxBuffer: 10 * 1024 * 1024,
        env: { ...process.env },
      });
      child.stdout?.pipe(process.stdout);
      child.stderr?.pipe(process.stderr);

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
    this.agent = this.buildAgent();
  }

  private async sendMessage(message: string): Promise<void> {
    addMessage(this.conversation, "user", message);

    console.log();
    const callbacks = createInteractiveCallbacks(this.spinner);

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

    let cancelled = false;
    const onSigint = () => {
      cancelled = true;
      this.spinner.stop();
      console.log(chalk.yellow("\n  Cancelled.\n"));
    };
    process.once("SIGINT", onSigint);

    try {
      if (!cancelled) {
        await this.agent.run(message, wrappedCallbacks);
      }
    } catch (error) {
      this.spinner.stop();
      if (!cancelled) {
        const msg = error instanceof Error ? error.message : String(error);
        console.log(chalk.red(`\n  Error: ${msg}\n`));
      }
    }

    process.removeListener("SIGINT", onSigint);
    this.createReadline();
  }
}
