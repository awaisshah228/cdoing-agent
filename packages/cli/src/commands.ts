/**
 * CLI Subcommand Handlers
 *
 * Handlers for: cdoing config, cdoing init, cdoing doctor
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import chalk from "chalk";
import figlet from "figlet";
import { loadConfig, saveConfig, getStoredConfigDisplay, updateStoredConfig } from "./config";
import { getApiKeyEnvVar } from "@cdoing/ai";

const CONFIG_DIR = path.join(os.homedir(), ".cdoing");
const PROJECT_CONFIG_DIR = ".cdoing";
const PROJECT_CONFIG_FILE = "config.md";

/**
 * Handle `cdoing config <action> [key] [value]`
 */
export function handleConfigCommand(action: string, key?: string, value?: string): void {
  switch (action) {
    case "list":
      console.log();
      console.log(chalk.hex("#4FC3F7").bold("  ⚙️  Stored Config"));
      console.log(chalk.hex("#78909C")("  ─────────────────────────────────────"));
      for (const line of getStoredConfigDisplay()) {
        console.log(chalk.hex("#B0BEC5")(`  ${line}`));
      }
      console.log();
      break;

    case "get":
      if (!key) {
        console.log(chalk.hex("#EF5350")("\n  ❌ Usage: cdoing config get <key>"));
        console.log(chalk.hex("#78909C")("     Keys: provider, model, mode, api-key, base-url\n"));
        return;
      }
      const config = loadConfig();
      let val: string | undefined;
      switch (key) {
        case "provider": val = config.provider; break;
        case "model": val = config.model; break;
        case "mode": val = config.mode; break;
        case "base-url": val = config.baseUrl; break;
        case "api-key":
          const provider = config.provider || "anthropic";
          val = config.apiKeys?.[provider];
          if (val) val = val.slice(0, 8) + "..." + val.slice(-4);
          break;
        default:
          console.log(chalk.hex("#EF5350")(`\n  ❌ Unknown key: ${key}\n`));
          return;
      }
      console.log(val ? chalk.hex("#81C784")(val) : chalk.hex("#78909C")("(not set)"));
      break;

    case "set":
      if (!key || value === undefined) {
        console.log(chalk.hex("#EF5350")("\n  ❌ Usage: cdoing config set <key> <value>"));
        console.log(chalk.hex("#78909C")("     Keys: provider, model, mode, api-key, base-url\n"));
        return;
      }
      const result = updateStoredConfig(key, value);
      if (result.success) {
        const display = key === "api-key" ? value.slice(0, 8) + "..." : value;
        console.log();
        console.log(chalk.hex("#81C784")("  ✓ Saved: ") + chalk.hex("#4FC3F7")(key) + chalk.hex("#78909C")(" = ") + chalk.hex("#FFFFFF")(display));
        console.log();
      } else {
        console.log(chalk.hex("#EF5350")(`\n  ❌ ${result.error}\n`));
      }
      break;

    default:
      console.log(chalk.hex("#EF5350")(`\n  ❌ Unknown action: ${action}`));
      console.log(chalk.hex("#78909C")("     Usage: cdoing config <list|get|set> [key] [value]\n"));
  }
}

/**
 * Handle `cdoing init` - create .cdoing/ directory and config.md template
 */
export function handleInit(): void {
  const cwd = process.cwd();
  const configDir = path.join(cwd, PROJECT_CONFIG_DIR);
  const configFile = path.join(configDir, PROJECT_CONFIG_FILE);

  if (fs.existsSync(configFile)) {
    console.log();
    console.log(chalk.hex("#FFB74D")("  ⚠️  Project already initialized"));
    console.log(chalk.hex("#90A4AE")("     .cdoing/config.md exists"));
    console.log();
    return;
  }

  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }

  const template = `# Project Configuration

This file configures cdoing for this project.

## Instructions

Add project-specific instructions here. The agent will follow these guidelines.

\`\`\`
- Use TypeScript for all new code
- Follow existing code patterns
- Write tests for new features
\`\`\`

## Context

Describe your project here:
- What does this project do?
- What technologies does it use?
- Any special conventions?

## Files to Ignore

Files the agent should not modify:
- node_modules/
- dist/
- .env

## Preferred Tools

- Use npm for package management
- Use vitest for testing
`;

  fs.writeFileSync(configFile, template, "utf-8");
  console.log();
  console.log(chalk.hex("#6BCB77")(figlet.textSync("Init!", { font: "Small" })));
  console.log(chalk.hex("#81C784")("  ✨ Project initialized!"));
  console.log(chalk.hex("#90A4AE")("     Created: ") + chalk.hex("#4FC3F7")(".cdoing/config.md"));
  console.log();
  console.log(chalk.hex("#78909C")("  Edit this file to customize agent behavior for your project."));
  console.log();
}

/**
 * Handle `cdoing doctor` - diagnose setup and configuration issues
 */
export function handleDoctor(): void {
  console.log();
  console.log(chalk.hex("#4FC3F7").bold("  🏥 System Diagnostics"));
  console.log(chalk.hex("#78909C")("  ─────────────────────────────────────"));
  console.log();

  let issues = 0;
  let passed = 0;

  const ok = (msg: string) => {
    passed++;
    console.log(chalk.hex("#81C784")("  ✓ ") + chalk.hex("#B0BEC5")(msg));
  };
  const skip = (msg: string) => {
    console.log(chalk.hex("#78909C")("  ○ ") + chalk.hex("#78909C")(msg));
  };
  const fail = (msg: string) => {
    issues++;
    console.log(chalk.hex("#EF5350")("  ✗ ") + chalk.hex("#FFCDD2")(msg));
  };

  // Check global config directory
  if (fs.existsSync(CONFIG_DIR)) {
    ok("Global config: ~/.cdoing/");
  } else {
    skip("Global config: not created yet");
  }

  // Check API keys
  const config = loadConfig();
  const providers = ["anthropic", "openai", "google"];
  const providerIcons: Record<string, string> = {
    anthropic: "🤖",
    openai: "🧠",
    google: "🌐",
  };

  for (const provider of providers) {
    const envVar = getApiKeyEnvVar(provider);
    const hasEnv = !!process.env[envVar];
    const hasStored = !!config.apiKeys?.[provider];
    const icon = providerIcons[provider] || "🔑";

    if (hasEnv) {
      ok(`${icon} ${provider}: API key in ${envVar}`);
    } else if (hasStored) {
      ok(`${icon} ${provider}: API key in config`);
    } else {
      skip(`${icon} ${provider}: no API key configured`);
    }
  }

  // Check project config
  const projectConfig = path.join(process.cwd(), PROJECT_CONFIG_DIR, PROJECT_CONFIG_FILE);
  if (fs.existsSync(projectConfig)) {
    ok("📁 Project config: .cdoing/config.md");
  } else {
    skip("📁 Project config: not initialized (run: cdoing init)");
  }

  // Check hooks
  const globalHooks = path.join(CONFIG_DIR, "hooks.json");
  const projectHooks = path.join(process.cwd(), PROJECT_CONFIG_DIR, "hooks.json");

  if (fs.existsSync(globalHooks)) {
    ok("🪝 Global hooks: ~/.cdoing/hooks.json");
  }
  if (fs.existsSync(projectHooks)) {
    ok("🪝 Project hooks: .cdoing/hooks.json");
  }

  // Check permissions
  const globalPerms = path.join(CONFIG_DIR, "permissions.json");
  const projectPerms = path.join(process.cwd(), PROJECT_CONFIG_DIR, "permissions.json");

  if (fs.existsSync(globalPerms)) {
    ok("🔐 Global permissions: ~/.cdoing/permissions.json");
  }
  if (fs.existsSync(projectPerms)) {
    ok("🔐 Project permissions: .cdoing/permissions.json");
  }

  // Check Node.js version
  const nodeVersion = process.version;
  const major = parseInt(nodeVersion.slice(1).split(".")[0], 10);
  if (major >= 18) {
    ok(`📦 Node.js: ${nodeVersion}`);
  } else {
    fail(`📦 Node.js: ${nodeVersion} (requires 18+)`);
  }

  // Summary
  console.log();
  console.log(chalk.hex("#78909C")("  ─────────────────────────────────────"));
  if (issues === 0) {
    console.log(chalk.hex("#81C784").bold(`  ✨ All ${passed} checks passed!`));
  } else {
    console.log(chalk.hex("#FFB74D")(`  ⚠️  ${passed} passed, ${issues} issue(s) found`));
  }
  console.log();
}
