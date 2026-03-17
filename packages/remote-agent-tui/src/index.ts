#!/usr/bin/env node
/**
 * remote-agent-tui — OpenTUI-based terminal interface for cdoing remote coding agent
 *
 * Provides a rich terminal dashboard for managing remote coding agent sessions,
 * viewing events, and configuring the engine.
 */

import { Command } from "commander";

const program = new Command();

program
  .name("remote-agent-tui")
  .description("OpenTUI-based terminal interface for cdoing remote coding agent")
  .version("0.1.0");

program
  .command("start", { isDefault: true })
  .description("Start the engine and open the dashboard TUI")
  .option("-c, --config <path>", "Path to config file")
  .option("-d, --dir <directory>", "Working directory", process.cwd())
  .option("-p, --provider <provider>", "AI provider")
  .option("-m, --model <model>", "Model name")
  .option("--telegram-token <token>", "Telegram bot token")
  .option("--port <port>", "HTTP server port", "3000")
  .option("--log-level <level>", "Log level: debug, info, warn, error", "info")
  .action(async (opts) => {
    const { Engine, loadConfig } = await import("@cdoing/remote-coding-agent");
    const { startTUI } = await import("./app");

    const config = await loadConfig({
      configPath: opts.config,
      overrides: {
        provider: opts.provider,
        model: opts.model,
        telegramToken: opts.telegramToken,
        port: opts.port ? parseInt(opts.port, 10) : undefined,
        logLevel: opts.logLevel,
      },
    });

    const engine = new Engine(config);
    await engine.start();

    await startTUI({
      engine,
      route: "dashboard",
      workingDir: opts.dir,
    });
  });

program
  .command("setup")
  .description("Start the engine and open the setup wizard")
  .option("-c, --config <path>", "Path to config file")
  .option("-d, --dir <directory>", "Working directory", process.cwd())
  .option("-p, --provider <provider>", "AI provider")
  .option("-m, --model <model>", "Model name")
  .option("--telegram-token <token>", "Telegram bot token")
  .option("--port <port>", "HTTP server port", "3000")
  .option("--log-level <level>", "Log level: debug, info, warn, error", "info")
  .action(async (opts) => {
    const { Engine, loadConfig } = await import("@cdoing/remote-coding-agent");
    const { startTUI } = await import("./app");

    const config = await loadConfig({
      configPath: opts.config,
      overrides: {
        provider: opts.provider,
        model: opts.model,
        telegramToken: opts.telegramToken,
        port: opts.port ? parseInt(opts.port, 10) : undefined,
        logLevel: opts.logLevel,
      },
    });

    const engine = new Engine(config);
    await engine.start();

    await startTUI({
      engine,
      route: "setup",
      workingDir: opts.dir,
    });
  });

program.parse();
