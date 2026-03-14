/**
 * CLI Subcommand Handlers
 *
 * Handlers for: cdoing config, cdoing init, cdoing doctor
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import chalk from "chalk";
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
      console.log(chalk.bold("\n  Stored Config") + chalk.dim(" (~/.cdoing/config.json):\n"));
      for (const line of getStoredConfigDisplay()) {
        console.log(chalk.white(`  ${line}`));
      }
      console.log();
      break;

    case "get":
      if (!key) {
        console.log(chalk.red("\n  Usage: cdoing config get <key>\n"));
        console.log(chalk.dim("  Keys: provider, model, mode, api-key, base-url\n"));
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
          console.log(chalk.red(`\n  Unknown key: ${key}\n`));
          return;
      }
      console.log(val || "(not set)");
      break;

    case "set":
      if (!key || value === undefined) {
        console.log(chalk.red("\n  Usage: cdoing config set <key> <value>\n"));
        console.log(chalk.dim("  Keys: provider, model, mode, api-key, base-url\n"));
        return;
      }
      const result = updateStoredConfig(key, value);
      if (result.success) {
        const display = key === "api-key" ? value.slice(0, 8) + "..." : value;
        console.log(chalk.green(`\n  Saved: ${key} = ${display}\n`));
      } else {
        console.log(chalk.red(`\n  ${result.error}\n`));
      }
      break;

    default:
      console.log(chalk.red(`\n  Unknown action: ${action}`));
      console.log(chalk.dim("  Usage: cdoing config <list|get|set> [key] [value]\n"));
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
    console.log(chalk.yellow("\n  Project already initialized: .cdoing/config.md exists\n"));
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
  console.log(chalk.green("\n  Created: .cdoing/config.md"));
  console.log(chalk.dim("  Edit this file to customize agent behavior for your project.\n"));
}

/**
 * Handle `cdoing doctor` - diagnose setup and configuration issues
 */
export function handleDoctor(): void {
  console.log(chalk.bold("\n  System Diagnostics\n"));

  let issues = 0;

  // Check global config directory
  if (fs.existsSync(CONFIG_DIR)) {
    console.log(chalk.green("  [OK]") + chalk.dim("  Global config: ~/.cdoing/"));
  } else {
    console.log(chalk.yellow("  [--]") + chalk.dim("  Global config: not created yet"));
  }

  // Check API keys
  const config = loadConfig();
  const providers = ["anthropic", "openai", "google"];

  for (const provider of providers) {
    const envVar = getApiKeyEnvVar(provider);
    const hasEnv = !!process.env[envVar];
    const hasStored = !!config.apiKeys?.[provider];

    if (hasEnv) {
      console.log(chalk.green("  [OK]") + chalk.dim(`  ${provider}: API key in ${envVar}`));
    } else if (hasStored) {
      console.log(chalk.green("  [OK]") + chalk.dim(`  ${provider}: API key in config`));
    } else {
      console.log(chalk.dim("  [--]") + chalk.dim(`  ${provider}: no API key configured`));
    }
  }

  // Check project config
  const projectConfig = path.join(process.cwd(), PROJECT_CONFIG_DIR, PROJECT_CONFIG_FILE);
  if (fs.existsSync(projectConfig)) {
    console.log(chalk.green("  [OK]") + chalk.dim("  Project config: .cdoing/config.md"));
  } else {
    console.log(chalk.dim("  [--]") + chalk.dim("  Project config: not initialized (run: cdoing init)"));
  }

  // Check hooks
  const globalHooks = path.join(CONFIG_DIR, "hooks.json");
  const projectHooks = path.join(process.cwd(), PROJECT_CONFIG_DIR, "hooks.json");

  if (fs.existsSync(globalHooks)) {
    console.log(chalk.green("  [OK]") + chalk.dim("  Global hooks: ~/.cdoing/hooks.json"));
  }
  if (fs.existsSync(projectHooks)) {
    console.log(chalk.green("  [OK]") + chalk.dim("  Project hooks: .cdoing/hooks.json"));
  }

  // Check permissions
  const globalPerms = path.join(CONFIG_DIR, "permissions.json");
  const projectPerms = path.join(process.cwd(), PROJECT_CONFIG_DIR, "permissions.json");

  if (fs.existsSync(globalPerms)) {
    console.log(chalk.green("  [OK]") + chalk.dim("  Global permissions: ~/.cdoing/permissions.json"));
  }
  if (fs.existsSync(projectPerms)) {
    console.log(chalk.green("  [OK]") + chalk.dim("  Project permissions: .cdoing/permissions.json"));
  }

  // Check Node.js version
  const nodeVersion = process.version;
  const major = parseInt(nodeVersion.slice(1).split(".")[0], 10);
  if (major >= 18) {
    console.log(chalk.green("  [OK]") + chalk.dim(`  Node.js: ${nodeVersion}`));
  } else {
    console.log(chalk.red("  [!!]") + chalk.red(`  Node.js: ${nodeVersion} (requires 18+)`));
    issues++;
  }

  // Summary
  console.log();
  if (issues === 0) {
    console.log(chalk.green("  All checks passed!\n"));
  } else {
    console.log(chalk.yellow(`  ${issues} issue(s) found.\n`));
  }
}
