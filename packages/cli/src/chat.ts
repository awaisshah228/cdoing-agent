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

/**
 * Interactive Chat Interface
 *
 * The main REPL loop for the Cdoing CLI. Handles:
 *   - User input parsing (messages, slash commands, shell commands)
 *   - Message queuing for concurrent input during processing
 *   - Slash command routing (/plan, /effort, /btw, /rules, etc.)
 *   - Context providers (@terminal, @open, @url, @tree, @problems, @codebase)
 *   - Real-time suggestion autocomplete
 *   - Streaming input bar during agent processing
 *
 * Learning note: This file is the largest in the CLI package because
 * it's the user-facing interface that ties everything together. Each
 * command handler is kept small and delegates to the appropriate module.
 */

import * as readline from "readline";
import * as path from "path";
import * as fs from "fs";
import { exec } from "child_process";
import chalk from "chalk";
import ora from "ora";
import { AgentRunner } from "@cdoing/ai";
import type { ToolRegistry, PermissionManager, PermissionMode, HookManager, MemoryStore, TodoStore } from "@cdoing/core";
import {
  loadProjectConfig,
  PlanManager,
  RulesManager,
  McpManager,
  EffortManager,
  ContextProviderRegistry,
  TerminalContextProvider,
  OpenFilesContextProvider,
  UrlContextProvider,
  TreeContextProvider,
  ProblemsContextProvider,
  CodebaseContextProvider,
} from "@cdoing/core";
import type { EffortLevel } from "@cdoing/core";
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
import { oauthLogout, oauthStatus } from "./oauth";
import { handleInit, handleDoctor } from "./commands";

export class ChatInterface {
  private rl!: readline.Interface;
  private agent: AgentRunner;
  private spinner = ora();
  private modelConfig: Partial<ModelConfig>;
  private toolRegistry: ToolRegistry;
  private permissionManager: PermissionManager;
  private hookManager: HookManager;
  private memoryStore: MemoryStore;
  private todoStore: TodoStore | null;
  private workingDir: string;
  private conversation: Conversation;
  private lastSigint = 0;
  private suggestionsVisible = 0;
  private selectedSuggestion = -1;
  private currentMatches: { cmd: string; desc: string }[] = [];
  private inSuggestionMode = false;
  private messageQueue: string[] = [];
  private isProcessing = false;
  private currentAbortController: AbortController | null = null;
  private keypressHandler: ((_char: string, key: readline.Key) => void) | null = null;

  // ── New Feature Managers ──────────────────────────────
  // Each manager handles a specific feature domain, keeping this class focused.

  /** Plan mode: analyze-before-execute workflow */
  private planManager: PlanManager;

  /** Project rules: glob-scoped coding standards */
  private rulesManager: RulesManager;

  /** MCP servers: external tool integrations */
  private mcpManager: McpManager;

  /** Effort level: controls analysis depth (low/medium/high/max) */
  private effortManager: EffortManager;

  /** Context providers: @terminal, @url, @tree, @codebase, etc. */
  private contextProviders: ContextProviderRegistry;

  /** Stores the last shell command output for @terminal context */
  private lastTerminalOutput = "";

  /** Whether plan mode is active (read-only tools only) */
  private planModeActive = false;

  constructor(
    modelConfig: Partial<ModelConfig>,
    toolRegistry: ToolRegistry,
    permissionManager: PermissionManager,
    hookManager: HookManager,
    memoryStore: MemoryStore,
    todoStore?: TodoStore,
  ) {
    this.modelConfig = modelConfig;
    this.toolRegistry = toolRegistry;
    this.permissionManager = permissionManager;
    this.hookManager = hookManager;
    this.memoryStore = memoryStore;
    this.todoStore = todoStore || null;
    this.workingDir = process.cwd();

    // Initialize new feature managers
    this.planManager = new PlanManager();
    this.rulesManager = new RulesManager(this.workingDir);
    this.mcpManager = new McpManager(this.workingDir);
    this.effortManager = new EffortManager();
    this.contextProviders = this.createContextProviders();

    this.agent = this.buildAgent();
    this.conversation = createConversation(
      String(modelConfig.provider || "anthropic"),
      String(modelConfig.model || "default")
    );
    this.createReadline();
  }

  /**
   * Create and register all built-in context providers.
   * Each provider handles a different @ trigger.
   *
   * Learning note: The registry pattern lets us add new @ providers
   * without modifying the input parsing code.
   */
  private createContextProviders(): ContextProviderRegistry {
    const registry = new ContextProviderRegistry();
    registry.register(new TerminalContextProvider());
    registry.register(new UrlContextProvider());
    registry.register(new TreeContextProvider());
    registry.register(new CodebaseContextProvider());
    // Note: @open and @problems require VS Code APIs, so they're
    // only available in the extension, not the CLI.
    return registry;
  }

  /**
   * Build a new AgentRunner with current configuration.
   *
   * Combines project config, memory, rules, and effort level
   * into the system prompt for the agent.
   *
   * Learning note: We rebuild the agent whenever settings change
   * (model, provider, effort, etc.) because the system prompt
   * and model binding are set at construction time.
   */
  private buildAgent(): AgentRunner {
    const projectConfig = loadProjectConfig(this.workingDir);

    // Gather rules for the system prompt
    const rulesText = this.rulesManager?.formatForPrompt() || "";

    // Get effort level additions
    const effortAddition = this.effortManager?.getSystemPromptAddition() || "";

    // Combine all config sources into the project config
    const combinedConfig = [
      projectConfig || "",
      rulesText,
      effortAddition,
    ].filter(Boolean).join("\n\n");

    return new AgentRunner(
      this.modelConfig,
      this.toolRegistry,
      this.permissionManager,
      this.hookManager,
      {
        projectConfig: combinedConfig || undefined,
        memory: this.memoryStore.formatForPrompt() || undefined,
      }
    );
  }

  private static SLASH_COMMANDS = [
    { cmd: "/help", desc: "Show help" },
    { cmd: "/clear", desc: "Clear conversation" },
    { cmd: "/new", desc: "Start new conversation" },
    { cmd: "/history", desc: "List saved conversations" },
    { cmd: "/resume", desc: "Resume a conversation" },
    { cmd: "/delete", desc: "Delete a conversation" },
    { cmd: "/config", desc: "View/update config" },
    { cmd: "/model", desc: "Switch model" },
    { cmd: "/provider", desc: "Switch provider" },
    { cmd: "/mode", desc: "Change permission mode" },
    { cmd: "/dir", desc: "Change working directory" },
    { cmd: "/permissions", desc: "View/clear permissions" },
    { cmd: "/memory", desc: "View/manage memory" },
    { cmd: "/hooks", desc: "View configured hooks" },
    { cmd: "/usage", desc: "Show token usage" },
    { cmd: "/compact", desc: "Compress context" },
    { cmd: "/cost", desc: "Show cost breakdown" },
    { cmd: "/tasks", desc: "Show task list" },
    { cmd: "/doctor", desc: "Check system health" },
    { cmd: "/init", desc: "Initialize project" },
    { cmd: "/queue", desc: "Show message queue" },
    { cmd: "/login", desc: "Authentication setup" },
    { cmd: "/logout", desc: "Clear OAuth tokens" },
    { cmd: "/auth-status", desc: "Show auth status" },
    // ── New commands ────────────────────────────────
    { cmd: "/plan", desc: "Plan before executing" },
    { cmd: "/effort", desc: "Set analysis depth" },
    { cmd: "/btw", desc: "Ask without adding to history" },
    { cmd: "/rules", desc: "View project rules" },
    { cmd: "/mcp", desc: "View MCP server status" },
    { cmd: "/context", desc: "List @ context providers" },
    { cmd: "/exit", desc: "Quit" },
  ];

  private createReadline(): void {
    // Remove old keypress listener and close old rl before re-creating
    if (this.keypressHandler) {
      process.stdin.removeListener("keypress", this.keypressHandler);
      this.keypressHandler = null;
    }
    if (this.rl) {
      this.rl.close();
    }

    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      completer: (line: string) => this.completer(line),
    });
    this.rl.on("SIGINT", () => {
      this.handleSigint();
    });

    // Enable keypress events (do NOT set rawMode — readline manages the terminal)
    if (process.stdin.isTTY) {
      readline.emitKeypressEvents(process.stdin, this.rl);
    }

    // Handle keypress events including ESC and arrow keys for suggestions
    this.keypressHandler = (_char, key) => {
      if (key) {
        // ESC key to cancel current processing
        if (key.name === "escape" && this.isProcessing) {
          this.cancelCurrentOperation();
          return;
        }

        // Arrow key navigation in suggestion list
        if (this.inSuggestionMode && this.currentMatches.length > 0) {
          if (key.name === "down") {
            this.selectedSuggestion = Math.min(
              this.selectedSuggestion + 1,
              Math.min(this.currentMatches.length, 8) - 1,
            );
            this.renderSuggestionList();
            return;
          }
          if (key.name === "up") {
            this.selectedSuggestion = Math.max(this.selectedSuggestion - 1, -1);
            this.renderSuggestionList();
            return;
          }
          // Tab or Enter on a selected suggestion → accept it
          if (
            (key.name === "tab" || key.name === "return") &&
            this.selectedSuggestion >= 0
          ) {
            const selected = this.currentMatches[this.selectedSuggestion];
            if (selected) {
              this.clearSuggestions();
              this.inSuggestionMode = false;
              this.selectedSuggestion = -1;
              // Replace the current line with the selected command
              const rlAny = this.rl as unknown as { line: string; cursor: number };
              rlAny.line = selected.cmd + " ";
              rlAny.cursor = selected.cmd.length + 1;
              // Rewrite the prompt line
              const prompt = chalk.green("❯ ");
              process.stdout.write(`\r${prompt}${selected.cmd} \x1b[K`);
              return;
            }
          }
        }
      }

      // Real-time suggestions as user types
      setImmediate(() => {
        const line = (this.rl as unknown as { line: string }).line || "";
        this.renderSuggestions(line);
      });
    };
    process.stdin.on("keypress", this.keypressHandler);
  }

  /** Cancel current operation with ESC */
  private cancelCurrentOperation(): void {
    if (this.currentAbortController) {
      this.currentAbortController.abort();
      this.spinner.stop();
      console.log(chalk.hex("#FFB74D")("\n  ⏹️  Cancelled by ESC\n"));
      this.isProcessing = false;
      this.currentAbortController = null;

      // Show queued messages if any
      if (this.messageQueue.length > 0) {
        console.log(chalk.hex("#78909C")(`  📬 ${this.messageQueue.length} message(s) in queue`));
      }

      this.createReadline();
      this.promptUser();
    }
  }

  /** Show message queue status */
  private showQueueStatus(): void {
    if (this.messageQueue.length > 0) {
      console.log(chalk.hex("#4FC3F7")(`\n  📬 Message Queue (${this.messageQueue.length}):`));
      for (let i = 0; i < Math.min(this.messageQueue.length, 3); i++) {
        const preview = this.messageQueue[i].substring(0, 50);
        console.log(chalk.hex("#90A4AE")(`     ${i + 1}. ${preview}${this.messageQueue[i].length > 50 ? "..." : ""}`));
      }
      if (this.messageQueue.length > 3) {
        console.log(chalk.hex("#78909C")(`     ... and ${this.messageQueue.length - 3} more`));
      }
      console.log();
    }
  }

  private completer(line: string): [string[], string] {
    if (line.startsWith("/")) {
      const matches = ChatInterface.SLASH_COMMANDS
        .map((c) => c.cmd)
        .filter((cmd) => cmd.startsWith(line));
      return [matches.length ? matches : ChatInterface.SLASH_COMMANDS.map((c) => c.cmd), line];
    }
    return [[], line];
  }

  private clearSuggestions(): void {
    if (this.suggestionsVisible > 0) {
      // Save cursor, move below, clear suggestion lines, restore cursor
      const cols = process.stdout.columns || 80;
      process.stdout.write("\x1b[s"); // save cursor
      for (let i = 0; i < this.suggestionsVisible; i++) {
        process.stdout.write("\x1b[1B"); // move down
        process.stdout.write(`\r${" ".repeat(cols)}`); // clear line
      }
      process.stdout.write("\x1b[u"); // restore cursor
      this.suggestionsVisible = 0;
    }
  }

  private renderSuggestions(line: string): void {
    this.clearSuggestions();

    if (!process.stdout.isTTY) return;

    let matches: { cmd: string; desc: string }[] = [];

    if (line.startsWith("/") && line.length >= 1) {
      matches = ChatInterface.SLASH_COMMANDS.filter((c) =>
        c.cmd.startsWith(line),
      );
      // Don't show if exact match
      if (matches.length === 1 && matches[0].cmd === line) matches = [];
    } else if (line === "!") {
      matches = [
        { cmd: "!<cmd>", desc: "Run shell command (e.g. !git status)" },
      ];
    }

    this.currentMatches = matches;
    this.inSuggestionMode = matches.length > 0;
    this.selectedSuggestion = -1;

    if (matches.length === 0) return;

    this.renderSuggestionList();
  }

  private renderSuggestionList(): void {
    this.clearSuggestions();

    if (this.currentMatches.length === 0) return;

    const shown = this.currentMatches.slice(0, 8);
    process.stdout.write("\x1b[s"); // save cursor
    for (let i = 0; i < shown.length; i++) {
      const { cmd, desc } = shown[i];
      process.stdout.write("\n");
      if (i === this.selectedSuggestion) {
        // Highlighted: white bg, bold text
        process.stdout.write(
          `  \x1b[46m\x1b[30m\x1b[1m ${cmd.padEnd(17)}\x1b[22m${desc} \x1b[0m`,
        );
      } else {
        process.stdout.write(
          `  \x1b[36m ${cmd.padEnd(17)}\x1b[0m\x1b[2m${desc}\x1b[0m`,
        );
      }
    }
    this.suggestionsVisible = shown.length;
    process.stdout.write("\x1b[u"); // restore cursor
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
    // Check if there are queued messages to process
    if (this.messageQueue.length > 0 && !this.isProcessing) {
      const nextMessage = this.messageQueue.shift()!;
      console.log(chalk.hex("#4FC3F7")(`\n  📤 Processing queued message: `) + chalk.hex("#B0BEC5")(nextMessage.substring(0, 40) + (nextMessage.length > 40 ? "..." : "")));
      this.processMessage(nextMessage);
      return;
    }

    // Show queue status if there are queued messages
    if (this.messageQueue.length > 0) {
      this.showQueueStatus();
    }

    const prompt = this.messageQueue.length > 0
      ? chalk.hex("#FFB74D")(`❯ [${this.messageQueue.length} queued] `)
      : chalk.hex("#6BCB77")("❯ ");

    this.rl.question(prompt, async (input) => {
      const trimmed = input.trim();
      if (!trimmed) { this.promptUser(); return; }

      this.clearSuggestions();

      if (trimmed === "?") { printHelp(); this.promptUser(); return; }

      // Queue command - show queued messages
      if (trimmed === "/queue") {
        if (this.messageQueue.length === 0) {
          console.log(chalk.hex("#78909C")("\n  No messages in queue.\n"));
        } else {
          this.showQueueStatus();
        }
        this.promptUser();
        return;
      }

      // Clear queue command
      if (trimmed === "/queue clear") {
        this.messageQueue = [];
        console.log(chalk.hex("#81C784")("\n  ✓ Queue cleared.\n"));
        this.promptUser();
        return;
      }

      if (trimmed.startsWith("!")) {
        await this.runShellCommand(trimmed.slice(1).trim());
        this.promptUser();
        return;
      }

      // Auto-detect common shell commands and run directly
      if (this.isShellCommand(trimmed)) {
        await this.runShellCommand(trimmed);
        this.promptUser();
        return;
      }

      if (trimmed.startsWith("/")) {
        const cont = this.handleCommand(trimmed);
        if (cont) this.promptUser();
        return;
      }

      await this.processMessage(trimmed);
      this.promptUser();
    });
  }

  /**
   * Process a message — resolves @ context providers, then sends to agent.
   *
   * If the message contains @ triggers (e.g., @tree, @url https://...),
   * they are resolved first and the content is appended to the message.
   *
   * Learning note: Context resolution happens BEFORE the message reaches
   * the agent. This keeps the agent's tool-calling logic simple — it just
   * sees extra context in the user message.
   */
  private async processMessage(message: string): Promise<void> {
    // If already processing, add to queue
    if (this.isProcessing) {
      this.messageQueue.push(message);
      console.log(chalk.hex("#4FC3F7")(`\n  📬 Message queued (${this.messageQueue.length} in queue)`));
      console.log(chalk.hex("#78909C")(`     Press ESC to cancel current operation`));
      return;
    }

    // Resolve @ context providers in the message
    const enrichedMessage = await this.resolveContextProviders(message);

    await this.sendMessage(enrichedMessage);
  }

  /**
   * Scan a message for @ triggers and resolve them.
   *
   * Looks for patterns like @terminal, @tree src, @url https://...
   * and replaces them with the resolved content.
   *
   * Learning note: We match against registered provider triggers
   * rather than a fixed list. This means new providers added to
   * the registry are automatically supported.
   */
  private async resolveContextProviders(message: string): Promise<string> {
    const providers = this.contextProviders.getAll();
    if (providers.length === 0) return message;

    // Find @ triggers in the message
    const contextParts: string[] = [];
    let cleanMessage = message;

    for (const provider of providers) {
      const trigger = provider.trigger; // e.g., "@terminal"
      const triggerIndex = message.indexOf(trigger);

      if (triggerIndex < 0) continue;

      // Extract the trigger and its argument (if any)
      const afterTrigger = message.substring(triggerIndex + trigger.length);
      let arg: string | undefined;
      if (provider.requiresArg) {
        // Take the rest of the line as the argument
        const lineEnd = afterTrigger.indexOf("\n");
        arg = (lineEnd >= 0 ? afterTrigger.substring(0, lineEnd) : afterTrigger).trim();
      }

      // Remove the trigger from the message
      const fullTrigger = provider.requiresArg && arg
        ? `${trigger} ${arg}`
        : trigger;
      cleanMessage = cleanMessage.replace(fullTrigger, "").trim();

      // Resolve the context
      try {
        console.log(chalk.dim(`  Resolving ${trigger}...`));
        const result = await provider.resolve(arg, {
          workingDir: this.workingDir,
          terminalOutput: this.lastTerminalOutput,
        });
        if (result.content) {
          contextParts.push(result.content);
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.log(chalk.yellow(`  Warning: Failed to resolve ${trigger}: ${errMsg}`));
      }
    }

    // Append resolved context to the message
    if (contextParts.length > 0) {
      return `${cleanMessage}\n\n---\n\n${contextParts.join("\n\n---\n\n")}`;
    }

    return cleanMessage;
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

      case "/compact":
        this.compactContext();
        return true;

      case "/cost":
        this.showDetailedCost();
        return true;

      case "/tasks":
        this.showTasks(arg);
        return true;

      case "/doctor":
        handleDoctor();
        return true;

      case "/init":
        handleInit();
        return true;

      case "/login":
        this.showLoginHelp();
        return true;

      case "/logout":
        oauthLogout();
        return true;

      case "/auth-status":
        oauthStatus();
        return true;

      // ── Plan Mode ──────────────────────────────────────
      case "/plan":
        this.handlePlanCommand(arg);
        return true;

      // ── Effort Level ──────────────────────────────────
      case "/effort":
        this.handleEffortCommand(arg);
        return true;

      // ── Side Question (/btw) ──────────────────────────
      case "/btw":
        if (!arg) {
          console.log(chalk.dim("\n  Usage: /btw <question>"));
          console.log(chalk.dim("  Ask a question without adding to conversation history.\n"));
          return true;
        }
        // Process as ephemeral question — don't add to history
        this.sendEphemeralMessage(arg);
        return false; // Don't prompt yet, sendEphemeralMessage handles it

      // ── Project Rules ─────────────────────────────────
      case "/rules":
        this.handleRulesCommand(arg);
        return true;

      // ── MCP Servers ──────────────────────────────────
      case "/mcp":
        this.handleMcpCommand(arg);
        return true;

      // ── Context Providers ─────────────────────────────
      case "/context":
        this.showContextProviders();
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

  // ── New Command Handlers ──────────────────────────────

  /**
   * /plan — Toggle plan mode or show current plan.
   *
   * When plan mode is active, the agent analyzes the request
   * and generates a step-by-step plan before making any changes.
   *
   * Learning note: Plan mode works by modifying the system prompt
   * to restrict the agent to read-only tools and instruct it to
   * output a structured plan instead of executing changes.
   */
  private handlePlanCommand(arg: string): void {
    if (arg === "off" || arg === "cancel") {
      this.planModeActive = false;
      this.planManager.clearPlan();
      console.log(chalk.yellow("\n  Plan mode disabled.\n"));
      return;
    }

    if (arg === "show") {
      const plan = this.planManager.getCurrentPlan();
      if (!plan) {
        console.log(chalk.dim("\n  No active plan. Use /plan <request> to create one.\n"));
      } else {
        console.log("\n" + this.planManager.formatPlan() + "\n");
      }
      return;
    }

    if (arg === "approve" || arg === "yes") {
      if (this.planManager.approvePlan()) {
        this.planModeActive = false;
        console.log(chalk.green("\n  Plan approved! Executing...\n"));
        const plan = this.planManager.getCurrentPlan();
        if (plan) {
          this.planManager.startExecution();
          // Send the plan as context for execution
          this.processMessage(
            `Execute this plan step by step:\n\n${this.planManager.formatPlan()}\n\nOriginal request: ${plan.originalRequest}`
          );
        }
      } else {
        console.log(chalk.red("\n  No plan to approve.\n"));
      }
      return;
    }

    if (arg === "reject" || arg === "no") {
      this.planManager.rejectPlan();
      this.planModeActive = false;
      console.log(chalk.yellow("\n  Plan rejected.\n"));
      return;
    }

    if (!arg) {
      // Toggle plan mode
      this.planModeActive = !this.planModeActive;
      if (this.planModeActive) {
        console.log(chalk.cyan("\n  Plan mode enabled. Next message will generate a plan."));
        console.log(chalk.dim("  The agent will analyze but NOT modify files."));
        console.log(chalk.dim("  Use /plan approve to execute, /plan off to cancel.\n"));
      } else {
        console.log(chalk.yellow("\n  Plan mode disabled.\n"));
      }
      return;
    }

    // If arg is provided, create a plan for it
    this.planModeActive = true;
    console.log(chalk.cyan("\n  Generating plan...\n"));
    this.processMessage(
      `[PLAN MODE] Analyze this request and create a detailed step-by-step implementation plan. ` +
      `Do NOT modify any files. Only read files and search code to understand the codebase. ` +
      `Output a numbered plan with specific files and changes needed.\n\nRequest: ${arg}`
    );
  }

  /**
   * /effort — Set or show the current effort level.
   *
   * Learning note: Effort level is a UX abstraction that controls
   * how thorough the agent is. Higher effort = more tokens used,
   * more files read, deeper analysis.
   */
  private handleEffortCommand(arg: string): void {
    if (!arg) {
      const current = this.effortManager.getLevel();
      console.log(chalk.dim(`\n  Current effort: ${current}`));
      console.log(chalk.dim("  Available levels:"));
      for (const { level, description } of EffortManager.getAllLevels()) {
        const marker = level === current ? chalk.green(" ●") : "  ";
        console.log(`  ${marker} ${chalk.cyan(level.padEnd(8))} ${chalk.dim(description)}`);
      }
      console.log(chalk.dim("\n  Usage: /effort <level>\n"));
      return;
    }

    const parsed = EffortManager.parse(arg);
    if (!parsed) {
      console.log(chalk.red(`\n  Invalid effort level: ${arg}`));
      console.log(chalk.dim("  Use: low, medium, high, max\n"));
      return;
    }

    this.effortManager.setLevel(parsed);
    this.rebuildAgent(); // Rebuild to apply new effort settings
    console.log(chalk.green(`\n  Effort level: ${parsed} (${this.effortManager.getConfig().description})\n`));
  }

  /**
   * Send an ephemeral message (/btw) — results shown but not persisted.
   *
   * Learning note: This creates a temporary agent that shares no
   * history with the main conversation. The response is displayed
   * but doesn't pollute the conversation context.
   */
  private async sendEphemeralMessage(message: string): Promise<void> {
    console.log(chalk.dim("\n  [ephemeral — not added to conversation history]"));

    // Create a separate agent for the ephemeral question
    const projectConfig = loadProjectConfig(this.workingDir);
    const tempAgent = new AgentRunner(
      this.modelConfig,
      this.toolRegistry,
      this.permissionManager,
      this.hookManager,
      { projectConfig: projectConfig || undefined },
    );

    const callbacks = createInteractiveCallbacks(this.spinner);
    this.spinner.start(chalk.hex("#B0BEC5")("  💭 Thinking (ephemeral)..."));

    try {
      await tempAgent.run(message, {
        ...callbacks,
        onToolResult: (name: string, result: string, isError?: boolean) => {
          callbacks.onToolResult(name, result, isError ?? false);
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(chalk.red(`\n  Error: ${msg}\n`));
    }

    console.log(chalk.dim("  [end ephemeral]\n"));
    this.promptUser();
  }

  /**
   * /rules — Show loaded project rules.
   */
  private handleRulesCommand(arg: string): void {
    if (arg === "reload") {
      this.rulesManager.invalidateCache();
      console.log(chalk.green("\n  Rules cache cleared. Will reload on next request.\n"));
      return;
    }

    const rules = this.rulesManager.getRulesForFile();
    if (rules.length === 0) {
      console.log(chalk.dim("\n  No project rules found."));
      console.log(chalk.dim("  Add rules in .cdoing/rules/ or ~/.cdoing/rules/ as .md files."));
      console.log(chalk.dim("  Example: .cdoing/rules/typescript.md\n"));
      console.log(chalk.dim("  ---"));
      console.log(chalk.dim('  globs: ["*.ts", "*.tsx"]'));
      console.log(chalk.dim("  description: TypeScript coding standards"));
      console.log(chalk.dim("  ---"));
      console.log(chalk.dim("  Always use strict TypeScript.\n"));
      return;
    }

    console.log(chalk.bold("\n  Project Rules:\n"));
    for (const rule of rules) {
      const icon = rule.source === "global" ? "🌐" : "📁";
      const globs = rule.globs.length > 0 ? chalk.dim(` (${rule.globs.join(", ")})`) : "";
      console.log(`    ${icon} ${chalk.cyan(rule.description)}${globs}`);
      console.log(chalk.dim(`       ${rule.content.substring(0, 80)}${rule.content.length > 80 ? "..." : ""}`));
    }
    console.log(chalk.dim(`\n    /rules reload — refresh from disk\n`));
  }

  /**
   * /mcp — Show MCP server status or connect/disconnect.
   */
  private handleMcpCommand(arg: string): void {
    if (arg === "connect") {
      console.log(chalk.dim("\n  Connecting to MCP servers..."));
      this.mcpManager.connectAll()
        .then(() => {
          const servers = this.mcpManager.getConnectedServers();
          if (servers.length === 0) {
            console.log(chalk.dim("  No MCP servers configured."));
            console.log(chalk.dim("  Add servers in .cdoing/mcp.json\n"));
          } else {
            console.log(chalk.green(`  Connected to ${servers.length} server(s): ${servers.join(", ")}\n`));
          }
        })
        .catch((e: Error) => {
          console.log(chalk.red(`  Error: ${e.message}\n`));
        });
      return;
    }

    if (arg === "disconnect") {
      this.mcpManager.disconnectAll();
      console.log(chalk.yellow("\n  Disconnected from all MCP servers.\n"));
      return;
    }

    const servers = this.mcpManager.getConnectedServers();
    const allTools = this.mcpManager.getAllTools();

    if (servers.length === 0) {
      console.log(chalk.dim("\n  No MCP servers connected."));
      console.log(chalk.dim("  Configure in .cdoing/mcp.json:"));
      console.log(chalk.dim('  { "servers": [{ "name": "...", "command": "...", "args": [...] }] }'));
      console.log(chalk.dim("\n  /mcp connect    — connect to configured servers"));
      console.log(chalk.dim("  /mcp disconnect — disconnect all\n"));
      return;
    }

    console.log(chalk.bold(`\n  MCP Servers (${servers.length} connected):\n`));
    for (const name of servers) {
      const tools = allTools.filter((t: { serverName: string }) => t.serverName === name);
      console.log(`    ${chalk.green("●")} ${chalk.cyan(name)} — ${tools.length} tool(s)`);
      for (const tool of tools.slice(0, 5)) {
        console.log(chalk.dim(`      • ${tool.name}: ${tool.description.substring(0, 60)}`));
      }
      if (tools.length > 5) {
        console.log(chalk.dim(`      ... and ${tools.length - 5} more`));
      }
    }
    console.log();
  }

  /**
   * /context — List all available @ context providers.
   */
  private showContextProviders(): void {
    const providers = this.contextProviders.getAll();
    console.log(chalk.bold("\n  @ Context Providers:\n"));
    for (const p of providers) {
      const argHint = p.requiresArg ? chalk.dim(" <arg>") : "";
      console.log(`    ${chalk.cyan(p.trigger)}${argHint}  ${chalk.dim(p.description)}`);
    }
    console.log(chalk.dim("\n  Use @ followed by a trigger in your message to attach context."));
    console.log(chalk.dim("  Example: @tree src  or  @url https://docs.example.com\n"));
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

  /** Compress conversation context manually */
  private compactContext(): void {
    const cm = this.agent.getContextManager();
    const history = this.agent.getHistory();
    const before = cm.estimateMessages(history);
    const compressed = cm.compressIfNeeded(history, "");
    const after = cm.estimateMessages(compressed);

    if (before === after) {
      console.log(chalk.dim("\n  Context is already compact.\n"));
    } else {
      // Update agent history with compressed version
      this.agent.setHistory(compressed);
      console.log(chalk.green(`\n  Compressed: ${before.toLocaleString()} -> ${after.toLocaleString()} tokens\n`));
    }
  }

  /** Show detailed cost breakdown */
  private showDetailedCost(): void {
    const cm = this.agent.getContextManager();
    const { tokens, cost, turns } = cm.getTotalUsage();

    console.log(chalk.bold("\n  Session Cost Breakdown:\n"));
    console.log(`    Turns:         ${turns}`);
    console.log(`    Input tokens:  ${tokens.inputTokens.toLocaleString()}`);
    console.log(`    Output tokens: ${tokens.outputTokens.toLocaleString()}`);
    console.log(`    Total tokens:  ${tokens.totalTokens.toLocaleString()}`);
    if (cost !== undefined) {
      console.log(`    Estimated cost: $${cost.toFixed(4)}`);
    }
    console.log();
  }

  /** Show task list */
  private showTasks(arg: string): void {
    if (!this.todoStore) {
      console.log(chalk.dim("\n  Task tracking not available.\n"));
      return;
    }

    if (arg === "clear") {
      this.todoStore.clear();
      console.log(chalk.green("\n  All tasks cleared.\n"));
      return;
    }

    const todos = this.todoStore.getAll();
    if (todos.length === 0) {
      console.log(chalk.dim("\n  No tasks."));
      console.log(chalk.dim("  The agent can create tasks using the todo tool.\n"));
      return;
    }

    console.log(chalk.bold("\n  Tasks:\n"));
    for (const todo of todos) {
      const icon = this.getTaskIcon(todo.status);
      const statusColor = this.getTaskStatusColor(todo.status);
      const desc = todo.description ? chalk.dim(` - ${todo.description}`) : "";
      console.log(`    ${icon} ${chalk.white(`#${todo.id}`)} ${statusColor(`[${todo.status}]`)} ${todo.subject}${desc}`);
    }

    const summary = this.todoStore.getSummary();
    console.log();
    console.log(chalk.dim(`    ${summary.completed}/${summary.total} completed`));
    if (summary.in_progress > 0) console.log(chalk.dim(`    ${summary.in_progress} in progress`));
    if (summary.blocked > 0) console.log(chalk.dim(`    ${summary.blocked} blocked`));
    console.log(chalk.dim(`\n    /tasks clear — clear all tasks\n`));
  }

  private getTaskIcon(status: string): string {
    switch (status) {
      case "pending": return chalk.dim("[ ]");
      case "in_progress": return chalk.yellow("[~]");
      case "completed": return chalk.green("[x]");
      case "blocked": return chalk.red("[!]");
      default: return "[ ]";
    }
  }

  private getTaskStatusColor(status: string): (text: string) => string {
    switch (status) {
      case "pending": return chalk.dim;
      case "in_progress": return chalk.yellow;
      case "completed": return chalk.green;
      case "blocked": return chalk.red;
      default: return chalk.dim;
    }
  }

  /** Show login/auth help */
  private showLoginHelp(): void {
    console.log();
    console.log(chalk.bold.cyan("  Authentication Options\n"));
    console.log(chalk.white("  Option 1: API Key") + chalk.dim(" (recommended)"));
    console.log(chalk.dim("    Get a key from: https://console.anthropic.com/settings/keys"));
    console.log(chalk.dim("    Then run: /config set api-key <your-key>\n"));
    console.log(chalk.white("  Option 2: Claude Code OAuth Token") + chalk.dim(" (requires Pro/Max)"));
    console.log(chalk.dim("    1. Install Claude Code: npm install -g @anthropic-ai/claude-code"));
    console.log(chalk.dim("    2. Login: claude login"));
    console.log(chalk.dim("    3. Get token: claude config get oauth_token"));
    console.log(chalk.dim("    4. Use here: /config set api-key <token>\n"));
    console.log(chalk.dim("  Check status: /auth-status"));
    console.log();
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
      // Capture output for @terminal context provider
      let capturedOutput = "";
      const child = exec(command, {
        cwd: this.workingDir,
        timeout: 600000,
        maxBuffer: 10 * 1024 * 1024,
        env: { ...process.env },
      });
      child.stdout?.on("data", (data: Buffer) => {
        capturedOutput += data.toString();
        process.stdout.write(data);
      });
      child.stderr?.on("data", (data: Buffer) => {
        capturedOutput += data.toString();
        process.stderr.write(data);
      });

      const onSigint = () => {
        child.kill("SIGTERM");
        console.log(chalk.dim("\n  Command stopped.\n"));
      };
      process.on("SIGINT", onSigint);

      child.on("close", (code) => {
        process.removeListener("SIGINT", onSigint);
        // Store output for @terminal context
        this.lastTerminalOutput = `$ ${command}\n${capturedOutput}${code !== 0 && code !== null ? `\n[exit code: ${code}]` : ""}`;
        if (code !== 0 && code !== null) console.log(chalk.dim(`\n  Exit code: ${code}`));
        console.log();
        resolve();
      });
    });
  }

  private isShellCommand(input: string): boolean {
    const cmd = input.split(/\s+/)[0];
    const shellCommands = [
      "ls", "pwd", "cd", "cat", "mkdir", "rmdir", "rm", "cp", "mv",
      "touch", "head", "tail", "wc", "find", "grep", "echo", "which",
      "whoami", "date", "df", "du", "ps", "kill", "chmod", "chown",
      "curl", "wget", "tar", "zip", "unzip", "man",
      "git", "npm", "npx", "yarn", "pnpm", "node", "python", "python3",
      "pip", "pip3", "cargo", "go", "make", "docker", "brew",
    ];
    return shellCommands.includes(cmd);
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
      onToolResult: (name: string, result: string, isError?: boolean) => {
        callbacks.onToolResult(name, result, isError ?? false);
      },
      onComplete: () => {
        if (assistantResponse) {
          addMessage(this.conversation, "assistant", assistantResponse);
        }
        this.clearStreamingInputBar();
        callbacks.onComplete();
      },
    };

    this.spinner.start(chalk.hex("#B0BEC5")("  🧠 Thinking..."));

    // Set up abort controller
    this.isProcessing = true;
    this.currentAbortController = new AbortController();

    // Start streaming input bar — allow user to type while streaming
    this.streamingInputBuffer = "";
    this.startStreamingInput();

    let cancelled = false;
    const onSigint = () => {
      cancelled = true;
      this.currentAbortController?.abort();
      this.spinner.stop();
      this.clearStreamingInputBar();
      console.log(chalk.hex("#FFB74D")("\n  ⏹️  Cancelled.\n"));
    };
    process.once("SIGINT", onSigint);

    try {
      if (!cancelled && !this.currentAbortController.signal.aborted) {
        await this.agent.run(message, wrappedCallbacks);
      }
    } catch (error) {
      this.spinner.stop();
      this.clearStreamingInputBar();
      if (!cancelled && !this.currentAbortController?.signal.aborted) {
        const msg = error instanceof Error ? error.message : String(error);
        console.log(chalk.hex("#EF5350")(`\n  ❌ Error: ${msg}\n`));
      }
    }

    this.isProcessing = false;
    this.currentAbortController = null;
    process.removeListener("SIGINT", onSigint);
    this.stopStreamingInput();

    // If user typed something during streaming, queue it
    if (this.streamingInputBuffer.trim()) {
      this.messageQueue.push(this.streamingInputBuffer.trim());
      console.log(
        chalk.hex("#4FC3F7")(`\n  📬 Queued: `) +
        chalk.dim(this.streamingInputBuffer.trim().substring(0, 60)) +
        (this.streamingInputBuffer.trim().length > 60 ? "..." : ""),
      );
    }
    this.streamingInputBuffer = "";

    this.createReadline();

    // Process queued messages
    if (this.messageQueue.length > 0) {
      const next = this.messageQueue.shift()!;
      console.log(chalk.hex("#4FC3F7")(`\n  📬 Processing queued message...\n`));
      await this.sendMessage(next);
    }
  }

  // ── Streaming input bar ─────────────────────────────────────

  private streamingInputBuffer = "";
  private streamingInputActive = false;
  private streamingKeypressHandler: ((chunk: Buffer) => void) | null = null;

  private startStreamingInput(): void {
    this.streamingInputActive = true;
    this.streamingInputBuffer = "";

    if (process.stdout.isTTY) {
      const rows = process.stdout.rows || 24;
      // Set scroll region to all rows except the last one
      // This makes streaming output scroll in rows 1..(rows-1)
      // while the bottom row stays fixed for our input bar
      process.stdout.write(`\x1b[1;${rows - 1}r`);
      // Move cursor into the scroll region
      process.stdout.write(`\x1b[${rows - 1};1H`);
      // Draw the fixed input bar at the bottom
      this.drawStreamingInputBar();
    }

    // Use raw data handler to capture keystrokes during streaming
    this.streamingKeypressHandler = (chunk: Buffer) => {
      if (!this.streamingInputActive) return;

      for (const byte of chunk) {
        // Enter key — queue the message
        if (byte === 13 || byte === 10) {
          if (this.streamingInputBuffer.trim()) {
            this.messageQueue.push(this.streamingInputBuffer.trim());
            // Print queued confirmation in the scroll region
            process.stdout.write("\x1b[s");
            const rows = process.stdout.rows || 24;
            process.stdout.write(`\x1b[${rows - 1};1H`);
            process.stdout.write(
              chalk.hex("#4FC3F7")(`  📬 Queued: `) +
              chalk.dim(this.streamingInputBuffer.trim().substring(0, 50)) +
              "\n",
            );
            process.stdout.write("\x1b[u");
            this.streamingInputBuffer = "";
            this.drawStreamingInputBar();
          }
          continue;
        }
        // Backspace
        if (byte === 127 || byte === 8) {
          if (this.streamingInputBuffer.length > 0) {
            this.streamingInputBuffer = this.streamingInputBuffer.slice(0, -1);
            this.drawStreamingInputBar();
          }
          continue;
        }
        // Ctrl+C
        if (byte === 3) {
          return; // Let the SIGINT handler deal with it
        }
        // Escape — clear the input
        if (byte === 27) {
          this.streamingInputBuffer = "";
          this.drawStreamingInputBar();
          continue;
        }
        // Regular printable character
        if (byte >= 32 && byte < 127) {
          this.streamingInputBuffer += String.fromCharCode(byte);
          this.drawStreamingInputBar();
        }
      }
    };

    process.stdin.on("data", this.streamingKeypressHandler);
  }

  private stopStreamingInput(): void {
    this.streamingInputActive = false;
    if (this.streamingKeypressHandler) {
      process.stdin.removeListener("data", this.streamingKeypressHandler);
      this.streamingKeypressHandler = null;
    }
    this.clearStreamingInputBar();

    if (process.stdout.isTTY) {
      // Reset scroll region to full terminal
      process.stdout.write("\x1b[r");
      // Move cursor to bottom of content area
      const rows = process.stdout.rows || 24;
      process.stdout.write(`\x1b[${rows};1H`);
    }
  }

  private drawStreamingInputBar(): void {
    if (!this.streamingInputActive || !process.stdout.isTTY) return;

    const rows = process.stdout.rows || 24;
    const cols = process.stdout.columns || 80;
    const text = this.streamingInputBuffer;
    const hint = text
      ? ""
      : chalk.dim(" Type while waiting... (Enter to queue)");

    process.stdout.write("\x1b[s"); // save cursor position
    process.stdout.write(`\x1b[${rows};1H`); // go to last row (outside scroll region)
    process.stdout.write("\x1b[2K"); // clear the line
    process.stdout.write(
      chalk.bgHex("#1e293b")(
        (chalk.dim("  ❯ ") + chalk.white(text) + hint).padEnd(cols),
      ),
    );
    process.stdout.write("\x1b[u"); // restore cursor to where streaming output was
  }

  private clearStreamingInputBar(): void {
    if (!process.stdout.isTTY) return;
    const rows = process.stdout.rows || 24;
    process.stdout.write("\x1b[s");
    process.stdout.write(`\x1b[${rows};1H`);
    process.stdout.write("\x1b[2K");
    process.stdout.write("\x1b[u");
  }
}
