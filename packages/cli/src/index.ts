#!/usr/bin/env node

/**
 * Cdoing CLI — Entry point.
 * Parses args, resolves API key, launches interactive or one-shot mode.
 */

import { Command } from "commander";
import { AgentRunner } from "@cdoing/ai";
import { HookManager, loadProjectConfig, MemoryStore, TodoStore, SubAgentManager, ProcessManager } from "@cdoing/core";
import { ChatInterface } from "./chat";
import { buildModelConfig, createPermissionManager, resolveApiKey, type CLIOptions } from "./config";
import { createToolRegistry } from "./tools";
import { createOneShotCallbacks, createPrintCallbacks, createJsonCallbacks, createStreamJsonCallbacks } from "./callbacks";
import chalk from "chalk";
import { oauthLogin, oauthLogout } from "./oauth";
import { handleConfigCommand, handleInit, handleDoctor, handleCompletions, handleIndex } from "./commands";
import { loadConversation, loadLastConversation } from "./history";

const program = new Command();

program
  .name("cdoing")
  .description("AI-powered coding assistant CLI")
  .version("0.1.0")
  .option("-m, --model <model>", "Model to use (e.g., claude-sonnet-4-20250514, gpt-4o)")
  .option("-p, --provider <provider>", "AI provider: anthropic, openai, google, custom", "anthropic")
  .option("--base-url <url>", "Base URL for custom providers")
  .option("--api-key <key>", "API key (overrides env var)")
  .option("--mode <mode>", "Permission mode: ask, auto-edit, auto", "ask")
  .option("-d, --dir <directory>", "Working directory", process.cwd())
  .option("--login [provider]", "Login via OAuth (anthropic, openai-codex, google, github-copilot)")
  .option("--logout", "Clear stored OAuth tokens")
  // New flags
  .option("--print", "Print output only (non-interactive)")
  .option("-r, --resume <id>", "Resume conversation by ID")
  .option("-c, --continue", "Continue most recent conversation")
  .option("--max-turns <n>", "Maximum agent turns")
  .option("--output-format <format>", "Output format: text, json, stream-json", "text")
  .option("--verbose", "Enable verbose logging")
  .option("--system-prompt <prompt>", "Custom system prompt")
  .option("--allowed-tools <tools>", "Comma-separated list of allowed tools")
  .option("--disallowed-tools <tools>", "Comma-separated list of disallowed tools")
  .argument("[prompt]", "One-shot prompt (skips interactive mode)")
  .action(run);

// Subcommands
program
  .command("config")
  .description("Manage configuration")
  .argument("<action>", "Action: get, set, or list")
  .argument("[key]", "Config key")
  .argument("[value]", "Config value (for set)")
  .action(handleConfigCommand);

program
  .command("init")
  .description("Initialize project with .cdoing/config.md")
  .action(handleInit);

program
  .command("doctor")
  .description("Diagnose setup and configuration issues")
  .action(handleDoctor);

program
  .command("completions")
  .description("Generate shell completion script (zsh, bash)")
  .argument("[shell]", "Shell type: zsh or bash")
  .action(handleCompletions);

program
  .command("index")
  .description("Index the codebase for faster searches (FTS5 + optional embeddings)")
  .option("--full", "Rebuild index from scratch (clear existing index first)")
  .option("-d, --dir <directory>", "Directory to index", process.cwd())
  .option("--stats", "Show index statistics without re-indexing")
  .action(handleIndex);

/** Create a sub-agent factory: spawns a child agent without sub_agent tool */
function createSubAgentFactory(
  modelConfig: Partial<import("@cdoing/ai").ModelConfig>,
  workingDir: string,
  permissionManager: import("@cdoing/core").PermissionManager,
  hookManager: HookManager,
  options?: { projectConfig?: string; memory?: string },
) {
  return async (prompt: string, signal?: AbortSignal): Promise<string> => {
    // Child registry has no sub_agent tool (no recursion)
    const childRegistry = await createToolRegistry(workingDir);
    const childAgent = new AgentRunner(modelConfig, childRegistry, permissionManager, hookManager, options);

    // If an abort signal is provided, cancel the agent when it fires
    if (signal) {
      signal.addEventListener("abort", () => childAgent.cancel(), { once: true });
    }

    // Silent callbacks — collect result only
    let result = "";
    await childAgent.run(prompt, {
      onToken: (t) => { result += t; },
      onToolCall: () => {},
      onToolResult: () => {},
      onComplete: () => {},
      onError: (e) => { result += `\nError: ${e.message}`; },
    });
    return result;
  };
}

async function run(prompt: string | undefined, options: CLIOptions) {
  // Handle --logout first
  if (options.logout) {
    console.log(chalk.green(`\n  ${oauthLogout()}\n`));
    return;
  }

  // Handle --login [provider]: start OAuth flow
  if (options.login) {
    try {
      const loginProvider = typeof options.login === "string" ? options.login : "anthropic";
      await oauthLogin(loginProvider);
      console.log(chalk.green(`\n  Login successful (${loginProvider})! You can now run cdoing.\n`));
    } catch (err) {
      console.log(chalk.red(`\n  Login failed: ${(err as Error).message}\n`));
      process.exit(1);
    }
    return;
  }

  // Enable verbose logging if requested
  if (options.verbose) {
    process.env.DEBUG = "cdoing:*";
    console.log(chalk.dim("[verbose] Verbose logging enabled"));
  }

  await resolveApiKey(options);

  const modelConfig = buildModelConfig(options);
  const permissionManager = createPermissionManager(options);
  const hookManager = new HookManager(options.dir);
  const memoryStore = new MemoryStore(options.dir);
  const todoStore = new TodoStore();
  const projectConfig = loadProjectConfig(options.dir);

  const agentOptions: import("@cdoing/ai").AgentRunnerOptions = {
    projectConfig: projectConfig || undefined,
    memory: memoryStore.formatForPrompt() || undefined,
  };

  // Handle custom system prompt
  if (options.systemPrompt) {
    agentOptions.systemPrompt = options.systemPrompt;
  }

  // Handle max turns
  if (options.maxTurns) {
    agentOptions.maxTurns = parseInt(options.maxTurns, 10);
  }

  const subAgentManager = new SubAgentManager();
  const processManager = new ProcessManager();

  const subAgentFactory = createSubAgentFactory(
    modelConfig, options.dir, permissionManager, hookManager, agentOptions,
  );

  // plan_exit callback: show approval prompt to user
  const planExitCallback = (summary: string) => {
    console.log();
    console.log(chalk.bold.cyan("  ╔══════════════════════════════════════════════╗"));
    console.log(chalk.bold.cyan("  ║  📋 Plan Ready for Review                   ║"));
    console.log(chalk.bold.cyan("  ╚══════════════════════════════════════════════╝"));
    console.log(chalk.dim(`  ${summary}`));
    console.log();
    console.log(chalk.green("  /plan approve") + chalk.dim("  — approve and start building"));
    console.log(chalk.red("  /plan reject") + chalk.dim("   — reject the plan"));
    console.log(chalk.blue("  /plan show") + chalk.dim("     — review plan details"));
    console.log();
  };

  let toolRegistry = await createToolRegistry(options.dir, { subAgentFactory, subAgentManager, processManager, todoStore, memoryStore, planExitCallback });

  // Handle tool filtering
  if (options.allowedTools) {
    const allowed = options.allowedTools.split(",").map(t => t.trim());
    toolRegistry = filterTools(toolRegistry, allowed, "allow");
    if (options.verbose) {
      console.log(chalk.dim(`[verbose] Allowed tools: ${allowed.join(", ")}`));
    }
  }
  if (options.disallowedTools) {
    const disallowed = options.disallowedTools.split(",").map(t => t.trim());
    toolRegistry = filterTools(toolRegistry, disallowed, "disallow");
    if (options.verbose) {
      console.log(chalk.dim(`[verbose] Disallowed tools: ${disallowed.join(", ")}`));
    }
  }

  // Handle --resume or --continue
  let resumedConversation: import("./history").Conversation | null = null;
  if (options.resume) {
    resumedConversation = loadConversation(options.resume);
    if (!resumedConversation) {
      console.log(chalk.red(`\n  Conversation not found: ${options.resume}\n`));
      process.exit(1);
    }
    if (options.verbose) {
      console.log(chalk.dim(`[verbose] Resuming conversation: ${options.resume}`));
    }
  } else if (options.continue) {
    resumedConversation = loadLastConversation();
    if (!resumedConversation) {
      console.log(chalk.yellow("\n  No previous conversation to continue.\n"));
    } else if (options.verbose) {
      console.log(chalk.dim(`[verbose] Continuing conversation: ${resumedConversation.id}`));
    }
  }

  if (prompt) {
    const agent = new AgentRunner(modelConfig, toolRegistry, permissionManager, hookManager, { ...agentOptions, subAgentManager, processManager });

    // Restore history from resumed conversation
    if (resumedConversation) {
      for (const msg of resumedConversation.messages) {
        if (msg.role === "user") {
          agent.addToHistory("user", msg.content);
        } else if (msg.role === "assistant") {
          agent.addToHistory("assistant", msg.content);
        }
      }
    }

    // Select callbacks based on output format and print mode
    let callbacks;
    if (options.print) {
      callbacks = createPrintCallbacks();
    } else if (options.outputFormat === "json") {
      callbacks = createJsonCallbacks();
    } else if (options.outputFormat === "stream-json") {
      callbacks = createStreamJsonCallbacks();
    } else {
      callbacks = createOneShotCallbacks();
    }

    await agent.run(prompt, callbacks);
    process.exit(0);
  } else {
    const chat = new ChatInterface(modelConfig, toolRegistry, permissionManager, hookManager, memoryStore, todoStore, subAgentManager, processManager);
    await chat.start();
  }
}

/** Filter tools based on allow/disallow list */
function filterTools(
  registry: import("@cdoing/core").ToolRegistry,
  toolNames: string[],
  mode: "allow" | "disallow"
): import("@cdoing/core").ToolRegistry {
  const allTools = registry.getAll();
  const filtered = allTools.filter(tool => {
    const isInList = toolNames.includes(tool.definition.name);
    return mode === "allow" ? isInList : !isInList;
  });

  // Create a new registry with filtered tools
  const { ToolRegistry } = require("@cdoing/core");
  const newRegistry = new ToolRegistry();
  for (const tool of filtered) {
    newRegistry.register(tool);
  }
  return newRegistry;
}

program.parse();
