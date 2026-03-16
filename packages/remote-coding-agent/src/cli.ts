#!/usr/bin/env node
/**
 * CLI Entry Point — Remote Coding Agent
 *
 * Commands:
 *   start     — Start all enabled channels + gateway (default)
 *   tui       — Start with TUI dashboard
 *   dashboard — Start with web dashboard (served at /dashboard/)
 *   init      — Generate a config file template
 *   status    — Check connection status for all channels
 */

import { Command } from "commander";
import { loadConfig, generateConfigTemplate } from "./config";
import * as fs from "fs";
import * as path from "path";

const program = new Command();

program
  .name("remote-coding-agent")
  .description("Multi-channel remote coding agent — Telegram, Discord, and more")
  .version("0.1.0");

// ── Common CLI options (shared across start/tui/dashboard) ────────────────

function addCommonOptions(cmd: Command): Command {
  return cmd
    .option("-c, --config <path>", "Path to config file")
    .option("-d, --dir <directory>", "Working directory for coding operations")
    .option("-p, --provider <provider>", "AI provider (anthropic, openai, google, ollama)")
    .option("-m, --model <model>", "AI model name")
    .option("--api-key <key>", "API key for the AI provider")
    .option("--mode <mode>", "Permission mode (ask, auto-edit, auto)", "auto")
    .option("--port <port>", "Gateway server port", "4567")
    .option("--telegram-token <token>", "Telegram bot token")
    .option("--discord-token <token>", "Discord bot token")
    .option("--log-level <level>", "Log level (debug, info, warn, error)", "info");
}

// ── Start Command ──────────────────────────────────────────────────────────

addCommonOptions(
  program
    .command("start", { isDefault: true })
    .description("Start the remote coding agent")
    .option("--dashboard", "Also serve the web dashboard at /dashboard/")
)
  .action(async (opts) => {
    try {
      const config = buildConfig(opts);
      const enableDashboard = !!opts.dashboard;

      printBanner(config, enableDashboard ? "dashboard" : undefined);

      const { Engine } = await import("./core/engine");
      const engine = new Engine(config, { enableDashboard });
      await engine.start();

      setupShutdown(engine);
    } catch (err) {
      handleStartError(err);
    }
  });

// ── TUI Command ────────────────────────────────────────────────────────────

addCommonOptions(
  program
    .command("tui")
    .description("Start with the TUI dashboard")
)
  .action(async (opts) => {
    try {
      const config = buildConfig(opts);

      const { Engine } = await import("./core/engine");
      const engine = new Engine(config);
      await engine.start();

      // Launch TUI dashboard
      const { renderDashboard } = await import("./tui/app");
      await renderDashboard(engine);

      await engine.stop();
    } catch (err) {
      handleStartError(err);
    }
  });

// ── Dashboard Command ──────────────────────────────────────────────────────

addCommonOptions(
  program
    .command("dashboard")
    .description("Start with the web dashboard at /dashboard/")
)
  .action(async (opts) => {
    try {
      const config = buildConfig(opts);

      printBanner(config, "dashboard");

      const { Engine } = await import("./core/engine");
      const engine = new Engine(config, { enableDashboard: true });
      await engine.start();

      const dashUrl = config.gateway.authToken
        ? `http://localhost:${config.gateway.port}/dashboard/?token=${config.gateway.authToken}`
        : `http://localhost:${config.gateway.port}/dashboard/`;
      console.log(`\n  Dashboard: ${dashUrl}\n`);

      setupShutdown(engine);
    } catch (err) {
      handleStartError(err);
    }
  });

// ── Setup Command (Interactive Wizard) ─────────────────────────────────────

program
  .command("setup")
  .description("Interactive setup wizard — configure everything step by step")
  .option("-o, --output <path>", "Output config file path", "remote-coding-agent.config.json")
  .action(async (opts) => {
    try {
      const { runSetupWizard, writeSetupConfig, printSetupSummary } = await import("./tui/setup-wizard");
      const result = await runSetupWizard();
      const configPath = writeSetupConfig(result, path.resolve(opts.output));
      printSetupSummary(result, configPath);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      console.error(`Setup failed: ${error.message}`);
      process.exit(1);
    }
  });

// ── Login Command (OAuth + API Keys) ──────────────────────────────────────

program
  .command("login")
  .description("Login with Claude OAuth or save API keys")
  .option("--oauth", "Login with Claude OAuth (opens browser)")
  .option("--provider <provider>", "Provider to save API key for (anthropic, openai, google)")
  .option("--key <key>", "API key to save")
  .option("--role <role>", "Role: 'assistant' or 'coding' (default: assistant)", "assistant")
  .option("--status", "Show credential status")
  .option("--logout", "Clear OAuth tokens")
  .action(async (opts) => {
    const { CredentialManager } = await import("./auth/credentials");
    const creds = new CredentialManager();

    if (opts.status) {
      const status = creds.getStatus();
      const oauthStatus = await creds.getOAuthStatus();
      console.log("\nCredential Status\n");
      console.log("  OAuth (Claude):");
      console.log(`    ${oauthStatus.status === "active" ? "✓ active" : oauthStatus.status === "expired" ? "✗ expired" : "not logged in"}`);
      if (oauthStatus.expiresAt) console.log(`    Expires: ${new Date(oauthStatus.expiresAt).toLocaleString()}`);
      console.log("\n  API Keys:");
      if (status.apiKeys.length === 0) {
        console.log("    None stored");
      } else {
        for (const k of status.apiKeys) {
          console.log(`    ✓ ${k.provider} (${k.role}): ${k.masked}`);
        }
      }
      console.log("\n  Environment:");
      for (const [name, val] of [["ANTHROPIC_API_KEY", process.env.ANTHROPIC_API_KEY], ["OPENAI_API_KEY", process.env.OPENAI_API_KEY]]) {
        console.log(`    ${val ? "✓" : "✗"} ${name}`);
      }
      console.log();
      return;
    }

    if (opts.logout) {
      await creds.oauthLogout();
      console.log("Logged out. OAuth tokens cleared.");
      return;
    }

    if (opts.oauth) {
      try {
        const result = await creds.oauthLogin();
        console.log("\n  ✓ Claude OAuth login successful!");
        if (result.expiresAt) {
          console.log(`  Expires: ${new Date(result.expiresAt).toLocaleString()}`);
        }
        console.log("  The agent will use this token automatically.\n");
      } catch (err) {
        console.error(`OAuth login failed: ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      }
      return;
    }

    if (opts.provider && opts.key) {
      const role = opts.role === "coding" ? "coding" as const : "assistant" as const;
      creds.saveApiKey(opts.provider, opts.key, role);
      console.log(`✓ API key saved for ${opts.provider} (${role})`);
      return;
    }

    console.log("Usage:");
    console.log("  remote-coding-agent login --oauth              # Claude OAuth (opens browser)");
    console.log("  remote-coding-agent login --provider anthropic --key sk-...   # Save API key");
    console.log("  remote-coding-agent login --provider openai --key sk-... --role coding  # Coding model key");
    console.log("  remote-coding-agent login --status             # Show credential status");
    console.log("  remote-coding-agent login --logout             # Clear OAuth tokens");
  });

// ── Init Command ───────────────────────────────────────────────────────────

program
  .command("init")
  .description("Generate a config file template (non-interactive)")
  .option("-o, --output <path>", "Output file path", "remote-coding-agent.config.json")
  .action((opts) => {
    const outputPath = path.resolve(opts.output);
    if (fs.existsSync(outputPath)) {
      console.error(`Config file already exists: ${outputPath}`);
      process.exit(1);
    }

    // Auto-generate a secret key for security
    const { generateSecretKey } = require("./auth/secret");
    const template = JSON.parse(generateConfigTemplate());
    template.gateway.authToken = generateSecretKey();
    fs.writeFileSync(outputPath, JSON.stringify(template, null, 2), "utf-8");

    const token = template.gateway.authToken;
    console.log(`Config template created: ${outputPath}`);
    console.log(`\n  Auth token generated: ${token.substring(0, 8)}...${token.substring(56)}`);
    console.log("  (saved in config file — needed for API & dashboard access)\n");
    console.log("Next steps:");
    console.log("  1. Edit the config with your channel tokens (Telegram, Discord, etc.)");
    console.log("  2. Set your AI provider API key (ANTHROPIC_API_KEY or OPENAI_API_KEY)");
    console.log("  3. Run: remote-coding-agent setup   (interactive wizard)");
    console.log("  4. Or:  remote-coding-agent start    (headless)");
    console.log("  5. Or:  remote-coding-agent dashboard (with web UI)");
  });

// ── Status Command ─────────────────────────────────────────────────────────

program
  .command("status")
  .description("Check connection status")
  .option("-c, --config <path>", "Path to config file")
  .action(async (opts) => {
    try {
      const config = loadConfig({ configFile: opts.config });

      console.log("Configuration:");
      console.log(`  Provider: ${config.agent.provider}`);
      console.log(`  Model: ${config.agent.model}`);
      console.log(`  Working dir: ${config.workingDir}`);
      console.log(`  Gateway port: ${config.gateway.port}`);
      console.log();

      console.log("Channels:");
      for (const [id, ch] of Object.entries(config.channels)) {
        const status = ch.enabled ? "enabled" : "disabled";
        console.log(`  ${id}: ${status}`);

        // Test Telegram connection
        if (id === "telegram" && ch.enabled && ch.botToken) {
          try {
            const res = await fetch(`https://api.telegram.org/bot${ch.botToken}/getMe`);
            const data = await res.json() as { ok: boolean; result?: { username: string } };
            if (data.ok && data.result) {
              console.log(`    Connected: @${data.result.username}`);
            } else {
              console.log("    Connection failed — check token");
            }
          } catch {
            console.log("    Connection failed — network error");
          }
        }
      }
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      console.error(`Error: ${e.message}`);
      process.exit(1);
    }
  });

// ── Helpers ────────────────────────────────────────────────────────────────

function buildConfig(opts: Record<string, string>) {
  const cliOverrides: Record<string, unknown> = {};

  if (opts.dir) cliOverrides.workingDir = opts.dir;
  if (opts.logLevel) cliOverrides.logLevel = opts.logLevel;

  const agent: Record<string, unknown> = {};
  if (opts.provider) agent.provider = opts.provider;
  if (opts.model) agent.model = opts.model;
  if (opts.apiKey) agent.apiKey = opts.apiKey;
  if (opts.mode) agent.permissionMode = opts.mode;
  if (Object.keys(agent).length > 0) cliOverrides.agent = agent;

  const gateway: Record<string, unknown> = {};
  if (opts.port) gateway.port = parseInt(opts.port, 10);
  if (Object.keys(gateway).length > 0) cliOverrides.gateway = gateway;

  const channels: Record<string, Record<string, unknown>> = {};
  if (opts.telegramToken) channels.telegram = { enabled: true, botToken: opts.telegramToken };
  if (opts.discordToken) channels.discord = { enabled: true, botToken: opts.discordToken };
  if (Object.keys(channels).length > 0) cliOverrides.channels = channels;

  return loadConfig({ configFile: opts.config, cliOverrides });
}

function printBanner(config: ReturnType<typeof loadConfig>, ui?: "dashboard") {
  console.log("Starting Remote Coding Agent...");
  console.log(`  Provider: ${config.agent.provider}`);
  console.log(`  Model: ${config.agent.model}`);
  console.log(`  Working dir: ${config.workingDir}`);
  console.log(`  Permission mode: ${config.agent.permissionMode}`);
  console.log(`  Gateway port: ${config.gateway.port}`);
  const enabledChannels = Object.entries(config.channels)
    .filter(([, c]) => c.enabled)
    .map(([id]) => id);
  console.log(`  Channels: ${enabledChannels.length > 0 ? enabledChannels.join(", ") : "none"}`);
  if (ui === "dashboard") {
    const token = config.gateway.authToken;
    const url = token
      ? `http://localhost:${config.gateway.port}/dashboard/?token=${token}`
      : `http://localhost:${config.gateway.port}/dashboard/`;
    console.log(`  Dashboard: ${url}`);
  }
  console.log();
}

function setupShutdown(engine: { stop(): Promise<void> }) {
  const shutdown = async () => {
    console.log("\nShutting down...");
    await engine.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

function handleStartError(err: unknown) {
  const error = err instanceof Error ? err : new Error(String(err));
  console.error(`Failed to start: ${error.message}`);
  if (error.message.includes("token") || error.message.includes("required")) {
    console.error("\nSetup options:");
    console.error("  1. Run: remote-coding-agent init  (generates config template)");
    console.error("  2. Set env vars: TELEGRAM_BOT_TOKEN, ANTHROPIC_API_KEY");
    console.error("  3. CLI flags: --telegram-token TOKEN --api-key KEY");
  }
  process.exit(1);
}

program.parse();
