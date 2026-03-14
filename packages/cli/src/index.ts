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
import { ModelProvider, type ModelConfig } from "@cdoing/ai";
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
    "AI provider: anthropic, openai, google",
    "anthropic"
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
    const modelConfig: Partial<ModelConfig> = {
      provider: parseProvider(options.provider),
      model: options.model,
    };

    // Validate API key
    const apiKeyEnv = getApiKeyEnvVar(modelConfig.provider!);
    if (!process.env[apiKeyEnv]) {
      console.error(`\n  Error: ${apiKeyEnv} environment variable is not set.`);
      console.error(`  Set it with: export ${apiKeyEnv}=your-api-key\n`);
      process.exit(1);
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

function parseProvider(provider: string): ModelProvider {
  switch (provider.toLowerCase()) {
    case "openai":
      return ModelProvider.OPENAI;
    case "google":
      return ModelProvider.GOOGLE;
    default:
      return ModelProvider.ANTHROPIC;
  }
}

function getApiKeyEnvVar(provider: ModelProvider): string {
  switch (provider) {
    case ModelProvider.OPENAI:
      return "OPENAI_API_KEY";
    case ModelProvider.GOOGLE:
      return "GOOGLE_API_KEY";
    default:
      return "ANTHROPIC_API_KEY";
  }
}

program.parse();
