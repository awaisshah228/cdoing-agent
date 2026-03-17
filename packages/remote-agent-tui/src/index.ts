#!/usr/bin/env node
/**
 * remote-agent-tui — OpenTUI-based terminal interface for cdoing remote coding agent
 */

import { Command } from "commander";

const program = new Command();

program
  .name("remote-agent-tui")
  .description("OpenTUI-based terminal interface for cdoing remote coding agent")
  .version("0.1.0");

function addCommonOptions(cmd: Command): Command {
  return cmd
    .option("-c, --config <path>", "Path to config file")
    .option("-d, --dir <directory>", "Working directory")
    .option("-p, --provider <provider>", "AI provider")
    .option("-m, --model <model>", "Model name")
    .option("--telegram-token <token>", "Telegram bot token")
    .option("--port <port>", "Gateway port", "4567")
    .option("--log-level <level>", "Log level", "info");
}

function buildConfig(opts: Record<string, string>) {
  // Build CLI overrides matching loadConfig's expected format
  const cliOverrides: Record<string, unknown> = {};

  if (opts.dir) cliOverrides.workingDir = opts.dir;
  if (opts.logLevel) cliOverrides.logLevel = opts.logLevel;

  const agent: Record<string, unknown> = {};
  if (opts.provider) agent.provider = opts.provider;
  if (opts.model) agent.model = opts.model;
  if (Object.keys(agent).length > 0) cliOverrides.agent = agent;

  const gateway: Record<string, unknown> = {};
  if (opts.port) gateway.port = parseInt(opts.port, 10);
  if (Object.keys(gateway).length > 0) cliOverrides.gateway = gateway;

  const channels: Record<string, Record<string, unknown>> = {};
  if (opts.telegramToken) channels.telegram = { enabled: true, botToken: opts.telegramToken };
  if (Object.keys(channels).length > 0) cliOverrides.channels = channels;

  return { configFile: opts.config, cliOverrides };
}

addCommonOptions(
  program
    .command("start", { isDefault: true })
    .description("Start the engine and open the dashboard TUI")
)
  .action(async (opts) => {
    try {
      console.log("⚡ Loading remote-coding-agent…");
      const { Engine, loadConfig, CredentialManager } = await import("@cdoing/remote-coding-agent");
      const { startTUI } = await import("./app");

      console.log("📄 Loading config…");
      const config = loadConfig(buildConfig(opts));

      // Resolve credentials from the remote agent's own store
      console.log("🔑 Resolving credentials…");
      const creds = new CredentialManager();
      if (!config.agent.apiKey) {
        const key = await creds.resolveApiKey(config.agent.provider, "assistant");
        if (key) config.agent.apiKey = key;
      }
      if (config.agent.codingProvider && !config.agent.codingApiKey) {
        const key = await creds.resolveApiKey(config.agent.codingProvider, "coding");
        if (key) config.agent.codingApiKey = key;
      }

      console.log("🚀 Starting engine…");
      const engine = new Engine(config);
      await engine.start();

      console.log("✅ Ready — launching TUI\n");
      await startTUI({ engine, route: "chat", workingDir: opts.dir });
    } catch (err) {
      console.error(`Error: ${err instanceof Error ? err.message : err}`);
      process.exit(1);
    }
  });

addCommonOptions(
  program
    .command("setup")
    .description("Start the setup wizard TUI")
)
  .action(async (opts) => {
    try {
      const { Engine, loadConfig } = await import("@cdoing/remote-coding-agent");
      const { startTUI } = await import("./app");

      // Setup can work without a config file — use defaults
      let config;
      try {
        config = loadConfig(buildConfig(opts));
      } catch {
        // No config file — use minimal defaults
        config = {
          agent: { provider: opts.provider || "anthropic", model: opts.model || "claude-haiku-4-5", maxTurns: 25, permissionMode: "auto" },
          gateway: { port: parseInt(opts.port || "4567", 10), corsOrigin: "*" },
          session: { ttlMs: 1800000, maxHistoryMessages: 50, maxSessions: 100 },
          security: { channelRules: {}, rateLimitPerMinute: 20, allowedDirs: [] },
          channels: {},
          workingDir: opts.dir || process.cwd(),
          logLevel: opts.logLevel || "info",
        };
      }

      const engine = new Engine(config);
      // Don't start channels for setup — just need the engine shell
      await startTUI({ engine, route: "setup", workingDir: opts.dir });
    } catch (err) {
      console.error(`Error: ${err instanceof Error ? err.message : err}`);
      process.exit(1);
    }
  });

program
  .command("setup-cli")
  .description("Run the modular setup wizard (CLI mode, no TUI)")
  .option("--flow <flow>", "Setup flow: quickstart or advanced")
  .option("--accept-risk", "Skip security acknowledgement")
  .option("--skip-channels", "Skip channel setup")
  .option("--skip-skills", "Skip skills setup")
  .option("--skip-health", "Skip gateway health check")
  .option("--non-interactive", "Non-interactive mode (use with --accept-risk)")
  .option("--provider <provider>", "AI provider (non-interactive)")
  .option("--model <model>", "Model name (non-interactive)")
  .option("--api-key <key>", "API key (non-interactive)")
  .option("--coding-provider <provider>", "Coding provider (non-interactive)")
  .option("--coding-model <model>", "Coding model (non-interactive)")
  .option("--coding-api-key <key>", "Coding API key (non-interactive)")
  .option("--telegram-token <token>", "Telegram bot token (non-interactive)")
  .option("--port <port>", "Gateway port (non-interactive)")
  .option("--bind <bind>", "Gateway bind: loopback, lan, custom (non-interactive)")
  .option("--auth-mode <mode>", "Gateway auth: token, password, none (non-interactive)")
  .option("--auth-token <token>", "Gateway auth token (non-interactive)")
  .option("--permission-mode <mode>", "Permission mode: auto, auto-edit, ask (non-interactive)")
  .option("--working-dir <dir>", "Working directory (non-interactive)")
  .option("--log-level <level>", "Log level (non-interactive)")
  .option("--skills <skills>", "Comma-separated skill IDs (non-interactive)")
  .option("-o, --output <path>", "Output config path")
  .action(async (opts) => {
    try {
      const { runSetupWizard, createCliPrompter } = await import("@cdoing/remote-coding-agent");

      // Build non-interactive overrides from flags
      const overrides = opts.nonInteractive ? {
        provider: opts.provider,
        model: opts.model,
        apiKey: opts.apiKey,
        codingProvider: opts.codingProvider,
        codingModel: opts.codingModel,
        codingApiKey: opts.codingApiKey,
        telegramEnabled: Boolean(opts.telegramToken),
        telegramToken: opts.telegramToken,
        port: opts.port ? parseInt(opts.port, 10) : undefined,
        bind: opts.bind as "loopback" | "lan" | "custom" | undefined,
        authMode: opts.authMode as "token" | "password" | "none" | undefined,
        authToken: opts.authToken,
        permissionMode: opts.permissionMode,
        workingDir: opts.workingDir,
        logLevel: opts.logLevel,
        enabledSkills: opts.skills ? opts.skills.split(",").map((s: string) => s.trim()) : undefined,
      } : undefined;

      const { result, configPath, launchChoice } = await runSetupWizard({
        prompter: createCliPrompter(),
        flow: opts.flow as "quickstart" | "advanced" | undefined,
        acceptRisk: opts.acceptRisk,
        skipChannels: opts.skipChannels,
        skipSkills: opts.skipSkills,
        skipHealth: opts.skipHealth,
        outputPath: opts.output,
        nonInteractive: opts.nonInteractive,
        overrides,
      });

      // Handle launch choice
      if (launchChoice === "start" || launchChoice === "tui") {
        const { Engine, loadConfig, CredentialManager } = await import("@cdoing/remote-coding-agent");
        const { startTUI } = await import("./app");

        const config = loadConfig({ configFile: configPath });

        const creds = new CredentialManager();
        if (!config.agent.apiKey) {
          const key = await creds.resolveApiKey(config.agent.provider, "assistant");
          if (key) config.agent.apiKey = key;
        }

        const engine = new Engine(config);
        await engine.start();

        if (launchChoice === "tui") {
          await startTUI({ engine, route: "chat", workingDir: result.workingDir });
        }
      }
      // Dashboard open is now handled inside finalizeSetupWizard via openUrl()
    } catch (err) {
      if (err instanceof Error && err.name === "WizardCancelledError") {
        console.log("\nSetup cancelled.");
        process.exit(0);
      }
      console.error(`Error: ${err instanceof Error ? err.message : err}`);
      process.exit(1);
    }
  });

program.parse();
