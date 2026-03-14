#!/usr/bin/env node

import { Command } from "commander";
import {
  ToolRegistry,
  FileReadTool,
  FileWriteTool,
  FileEditTool,
  GlobSearchTool,
  GrepSearchTool,
  ShellExecTool,
  PermissionManager,
  PermissionMode,
} from "@cdoing/core";
import {
  ModelProvider,
  getApiKeyEnvVar,
  getRegisteredProviders,
  type ModelConfig,
} from "@cdoing/ai";
import { ChatInterface } from "./chat";

const program = new Command();

program
  .name("cdoing")
  .description("AI-powered coding assistant CLI")
  .version("0.1.0")
  .option(
    "-m, --model <model>",
    "Model to use (e.g., claude-sonnet-4-20250514, gpt-4o, gemini-2.0-flash)"
  )
  .option(
    "-p, --provider <provider>",
    "AI provider: anthropic, openai, google, or any custom provider",
    "anthropic"
  )
  .option(
    "--base-url <url>",
    "Base URL for custom/self-hosted providers"
  )
  .option(
    "--api-key <key>",
    "API key (overrides environment variable)"
  )
  .option(
    "--mode <mode>",
    "Permission mode: ask, auto-edit, auto",
    "ask"
  )
  .option(
    "-d, --dir <directory>",
    "Working directory",
    process.cwd()
  )
  .argument("[prompt]", "One-shot prompt (skips interactive mode)")
  .action(async (prompt, options) => {
    const workingDir = options.dir;

    // Set up permission manager
    const permMode = parsePermissionMode(options.mode);
    const permissionManager = new PermissionManager(permMode);

    // Set up tool registry
    const toolRegistry = new ToolRegistry();
    toolRegistry.register(new FileReadTool(workingDir));
    toolRegistry.register(new FileWriteTool(workingDir));
    toolRegistry.register(new FileEditTool(workingDir));
    toolRegistry.register(new GlobSearchTool(workingDir));
    toolRegistry.register(new GrepSearchTool(workingDir));
    toolRegistry.register(new ShellExecTool(workingDir));

    // Set up model config
    const provider = options.provider.toLowerCase();
    const modelConfig: Partial<ModelConfig> = {
      provider,
      model: options.model,
      baseURL: options.baseUrl,
      apiKey: options.apiKey,
    };

    // Validate API key
    if (!options.apiKey) {
      const apiKeyEnv = getApiKeyEnvVar(provider);
      if (!process.env[apiKeyEnv]) {
        console.error(`\n  Error: ${apiKeyEnv} environment variable is not set.`);
        console.error(`  Set it with: export ${apiKeyEnv}=your-api-key`);
        console.error(`  Or pass --api-key directly.\n`);
        process.exit(1);
      }
    }

    // Start chat
    const chat = new ChatInterface(modelConfig, toolRegistry, permissionManager);

    if (prompt) {
      // One-shot mode: send prompt and exit
      const { AgentRunner } = await import("@cdoing/ai");
      const agent = new AgentRunner(modelConfig, toolRegistry, permissionManager);
      await agent.run(prompt, {
        onToken: (t) => process.stdout.write(t),
        onToolCall: (name) => console.log(`\n⚡ ${name}`),
        onToolResult: (name, _, isErr) =>
          console.log(isErr ? `✗ ${name}` : `✓ ${name}`),
        onComplete: () => console.log(),
        onError: (e) => console.error(`Error: ${e.message}`),
      });
    } else {
      // Interactive mode
      await chat.start();
    }
  });

function parsePermissionMode(mode: string): PermissionMode {
  switch (mode) {
    case "auto":
      return PermissionMode.AUTO;
    case "auto-edit":
      return PermissionMode.AUTO_EDIT;
    default:
      return PermissionMode.ASK;
  }
}

program.parse();
