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
      const { Engine, loadConfig, CredentialManager } = await import("@cdoing/remote-coding-agent");
      const { startTUI } = await import("./app");

      const config = loadConfig(buildConfig(opts));

      // Resolve credentials from the remote agent's own store
      const creds = new CredentialManager();
      if (!config.agent.apiKey) {
        const key = await creds.resolveApiKey(config.agent.provider, "assistant");
        if (key) config.agent.apiKey = key;
      }
      if (config.agent.codingProvider && !config.agent.codingApiKey) {
        const key = await creds.resolveApiKey(config.agent.codingProvider, "coding");
        if (key) config.agent.codingApiKey = key;
      }

      const engine = new Engine(config);
      await engine.start();

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

program.parse();
