#!/usr/bin/env node

/**
 * Cdoing CLI — Entry point.
 * Parses args, resolves API key, launches interactive or one-shot mode.
 */

import { Command } from "commander";
import { AgentRunner } from "@cdoing/ai";
import { ChatInterface } from "./chat";
import { buildModelConfig, createPermissionManager, resolveApiKey, type CLIOptions } from "./config";
import { createToolRegistry } from "./tools";
import { createOneShotCallbacks } from "./callbacks";

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
  .argument("[prompt]", "One-shot prompt (skips interactive mode)")
  .action(run);

async function run(prompt: string | undefined, options: CLIOptions) {
  await resolveApiKey(options);

  const modelConfig = buildModelConfig(options);
  const permissionManager = createPermissionManager(options);
  const toolRegistry = createToolRegistry(options.dir);

  if (prompt) {
    const agent = new AgentRunner(modelConfig, toolRegistry, permissionManager);
    await agent.run(prompt, createOneShotCallbacks());
  } else {
    const chat = new ChatInterface(modelConfig, toolRegistry, permissionManager);
    await chat.start();
  }
}

program.parse();
