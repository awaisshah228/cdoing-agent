/**
 * CLI Configuration — parses options, validates API key,
 * interactive setup wizard on first run.
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as readline from "readline";
import chalk from "chalk";
import { PermissionManager, PermissionMode } from "@cdoing/core";
import { getApiKeyEnvVar, type ModelConfig } from "@cdoing/ai";

const CONFIG_DIR = path.join(os.homedir(), ".cdoing");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");

interface StoredConfig {
  provider?: string;
  apiKeys?: Record<string, string>;
}

export interface CLIOptions {
  model?: string;
  provider: string;
  baseUrl?: string;
  apiKey?: string;
  mode: string;
  dir: string;
}

export function parsePermissionMode(mode: string): PermissionMode {
  switch (mode) {
    case "auto": return PermissionMode.AUTO;
    case "auto-edit": return PermissionMode.AUTO_EDIT;
    default: return PermissionMode.ASK;
  }
}

export function buildModelConfig(options: CLIOptions): Partial<ModelConfig> {
  return {
    provider: options.provider.toLowerCase(),
    model: options.model,
    baseURL: options.baseUrl,
    apiKey: options.apiKey,
  };
}

export function createPermissionManager(options: CLIOptions): PermissionManager {
  return new PermissionManager(parsePermissionMode(options.mode));
}

// ── Config file ─────────────────────────────────────────────

function loadConfig(): StoredConfig {
  try {
    if (fs.existsSync(CONFIG_FILE))
      return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
  } catch {}
  return {};
}

function saveConfig(config: StoredConfig): void {
  if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), "utf-8");
}

function ask(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (a) => { rl.close(); resolve(a.trim()); });
  });
}

// ── API key resolution ──────────────────────────────────────

const PROVIDER_INFO: Record<string, { name: string; url: string }> = {
  anthropic: { name: "Anthropic (Claude)", url: "https://console.anthropic.com/settings/keys" },
  openai: { name: "OpenAI (GPT)", url: "https://platform.openai.com/api-keys" },
  google: { name: "Google (Gemini)", url: "https://aistudio.google.com/apikey" },
};

/**
 * Resolve API key from: flag → env → stored config → interactive setup.
 * Mutates options.apiKey so downstream code can use it.
 */
export async function resolveApiKey(options: CLIOptions): Promise<void> {
  if (options.apiKey) return;

  const provider = options.provider.toLowerCase();
  const envVar = getApiKeyEnvVar(provider);

  if (process.env[envVar]) return;

  // Check stored config
  const stored = loadConfig();
  if (stored.apiKeys?.[provider]) {
    options.apiKey = stored.apiKeys[provider];
    return;
  }

  // Interactive setup
  const info = PROVIDER_INFO[provider];
  console.log();
  console.log(chalk.bold.cyan("  Welcome to Cdoing Agent!"));
  console.log(chalk.dim("  Let's set up your API key.\n"));
  console.log(chalk.white(`  Provider: ${chalk.bold(info?.name || provider)}`));
  if (info?.url) console.log(chalk.dim(`  Get a key: ${info.url}\n`));

  const apiKey = await ask(chalk.green("  Enter your API key: "));
  if (!apiKey) {
    console.log(chalk.red("\n  No key provided. Exiting.\n"));
    process.exit(1);
  }

  const save = await ask(chalk.green("  Save to ~/.cdoing/config.json? (Y/n): "));
  if (save.toLowerCase() !== "n") {
    const config = loadConfig();
    config.apiKeys = config.apiKeys || {};
    config.apiKeys[provider] = apiKey;
    config.provider = provider;
    saveConfig(config);
    console.log(chalk.green("  Saved!\n"));
  }

  options.apiKey = apiKey;
}
