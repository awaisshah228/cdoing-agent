#!/usr/bin/env node

/**
 * Cdoing CLI — Entry point.
 * Parses args, resolves API key, launches interactive or one-shot mode.
 */

import { Command } from "commander";
import { AgentRunner } from "@cdoing/ai";
import { HookManager, loadProjectConfig, MemoryStore } from "@cdoing/core";
import { ChatInterface } from "./chat";
import { buildModelConfig, createPermissionManager, resolveApiKey, type CLIOptions } from "./config";
import { createToolRegistry } from "./tools";
import { createOneShotCallbacks } from "./callbacks";
import chalk from "chalk";
import { oauthLogout } from "./oauth";

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
  .option("--login", "Login with Claude via OAuth (opens browser)")
  .option("--logout", "Clear stored OAuth tokens")
  .argument("[prompt]", "One-shot prompt (skips interactive mode)")
  .action(run);

/** Create a sub-agent factory: spawns a child agent without sub_agent tool */
function createSubAgentFactory(
  modelConfig: Partial<import("@cdoing/ai").ModelConfig>,
  workingDir: string,
  permissionManager: import("@cdoing/core").PermissionManager,
  hookManager: HookManager,
  options?: { projectConfig?: string; memory?: string },
) {
  return async (prompt: string): Promise<string> => {
    // Child registry has no sub_agent tool (no recursion)
    const childRegistry = createToolRegistry(workingDir);
    const childAgent = new AgentRunner(modelConfig, childRegistry, permissionManager, hookManager, options);
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
    oauthLogout();
    return;
  }

  // Handle --login: prompt for token setup
  if (options.login) {
    console.log();
    console.log(chalk.bold.cyan("  Claude Authentication Setup"));
    console.log();
    console.log(chalk.white("  To use with Claude Pro/Max subscription:"));
    console.log(chalk.dim("    1. Install Claude Code: npm install -g @anthropic-ai/claude-code"));
    console.log(chalk.dim("    2. Login: claude login"));
    console.log(chalk.dim("    3. Get token: claude config get oauth_token"));
    console.log();
    console.log(chalk.white("  To use with API key:"));
    console.log(chalk.dim("    Get a key from: https://console.anthropic.com/settings/keys"));
    console.log();
    // Continue to resolveApiKey which will prompt for the key
  }

  await resolveApiKey(options);

  const modelConfig = buildModelConfig(options);
  const permissionManager = createPermissionManager(options);
  const hookManager = new HookManager(options.dir);
  const memoryStore = new MemoryStore();
  const projectConfig = loadProjectConfig(options.dir);

  const agentOptions = {
    projectConfig: projectConfig || undefined,
    memory: memoryStore.formatForPrompt() || undefined,
  };

  const subAgentFactory = createSubAgentFactory(
    modelConfig, options.dir, permissionManager, hookManager, agentOptions,
  );

  const toolRegistry = createToolRegistry(options.dir, subAgentFactory);

  if (prompt) {
    const agent = new AgentRunner(modelConfig, toolRegistry, permissionManager, hookManager, agentOptions);
    await agent.run(prompt, createOneShotCallbacks());
  } else {
    const chat = new ChatInterface(modelConfig, toolRegistry, permissionManager, hookManager, memoryStore);
    await chat.start();
  }
}

program.parse();
