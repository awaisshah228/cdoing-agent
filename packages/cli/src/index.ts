#!/usr/bin/env node

/**
 * Cdoing CLI — Entry Point
 *
 * Parses command-line arguments and launches either
 * interactive mode (REPL) or one-shot mode (single prompt).
 */

import { Command } from "commander";
import { AgentRunner } from "@cdoing/ai";
import { ChatInterface } from "./chat";
import {
  buildModelConfig,
  createPermissionManager,
  resolveApiKey,
  type CLIOptions,
} from "./config";
import { createToolRegistry } from "./tools";
import { createOneShotCallbacks } from "./callbacks";

const program = new Command();

// ── Define CLI interface ────────────────────────────────────

program
  .name("cdoing")
  .description("AI-powered coding assistant CLI")
  .version("0.1.0")
  .option(
    "-m, --model <model>",
    "Model to use (e.g., claude-sonnet-4-20250514, gpt-4o)"
  )
  .option(
    "-p, --provider <provider>",
    "AI provider: anthropic, openai, google, or custom",
    "anthropic"
  )
  .option("--base-url <url>", "Base URL for custom/self-hosted providers")
  .option("--api-key <key>", "API key (overrides environment variable)")
  .option("--mode <mode>", "Permission mode: ask, auto-edit, auto", "ask")
  .option("-d, --dir <directory>", "Working directory", process.cwd())
  .argument("[prompt]", "One-shot prompt (skips interactive mode)")
  .action(run);

// ── Main action ─────────────────────────────────────────────

async function run(prompt: string | undefined, options: CLIOptions) {
  // Resolve API key — prompts interactively if not found
  await resolveApiKey(options);

  // Build core dependencies from CLI options
  const modelConfig = buildModelConfig(options);
  const permissionManager = createPermissionManager(options);
  const toolRegistry = createToolRegistry(options.dir);

  if (prompt) {
    // One-shot mode: run a single prompt and exit
    const agent = new AgentRunner(modelConfig, toolRegistry, permissionManager);
    await agent.run(prompt, createOneShotCallbacks());
  } else {
    // Interactive mode: start the REPL
    const chat = new ChatInterface(modelConfig, toolRegistry, permissionManager);
    await chat.start();
  }
}

program.parse();
