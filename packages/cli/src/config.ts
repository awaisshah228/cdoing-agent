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
import { resolveOAuthToken } from "./oauth";

const CONFIG_DIR = path.join(os.homedir(), ".cdoing");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");

export interface StoredConfig {
  provider?: string;
  model?: string;
  apiKeys?: Record<string, string>;
  mode?: string;
  baseUrl?: string;
}

export interface CLIOptions {
  model?: string;
  provider: string;
  baseUrl?: string;
  apiKey?: string;
  oauthToken?: string;
  mode: string;
  dir: string;
  login?: boolean;
  logout?: boolean;
  // New flags
  print?: boolean;
  resume?: string;
  continue?: boolean;
  maxTurns?: string;
  outputFormat?: string;
  verbose?: boolean;
  systemPrompt?: string;
  allowedTools?: string;
  disallowedTools?: string;
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
    oauthToken: options.oauthToken,
  };
}

export function createPermissionManager(options: CLIOptions): PermissionManager {
  const dir = path.resolve(options.dir || process.cwd());
  return new PermissionManager(parsePermissionMode(options.mode), dir);
}

// ── Config file ─────────────────────────────────────────────

export function loadConfig(): StoredConfig {
  try {
    if (fs.existsSync(CONFIG_FILE))
      return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
  } catch {}
  return {};
}

export function saveConfig(config: StoredConfig): void {
  if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), "utf-8");
}

const VALID_CONFIG_KEYS = ["provider", "model", "mode", "api-key", "base-url"] as const;
type ConfigKey = typeof VALID_CONFIG_KEYS[number];

/**
 * Update a stored config value. Returns true on success.
 */
export function updateStoredConfig(key: string, value: string): { success: boolean; error?: string } {
  if (!VALID_CONFIG_KEYS.includes(key as ConfigKey)) {
    return {
      success: false,
      error: `Unknown key "${key}". Valid keys: ${VALID_CONFIG_KEYS.join(", ")}`,
    };
  }

  const config = loadConfig();

  switch (key) {
    case "provider":
      config.provider = value;
      break;
    case "model":
      config.model = value;
      break;
    case "mode": {
      const validModes = ["ask", "auto-edit", "auto"];
      if (!validModes.includes(value)) {
        return { success: false, error: `Invalid mode "${value}". Valid: ${validModes.join(", ")}` };
      }
      config.mode = value;
      break;
    }
    case "api-key": {
      const provider = config.provider || "anthropic";
      config.apiKeys = config.apiKeys || {};
      config.apiKeys[provider] = value;
      break;
    }
    case "base-url":
      config.baseUrl = value;
      break;
  }

  saveConfig(config);
  return { success: true };
}

/**
 * Show all stored config values.
 */
export function getStoredConfigDisplay(): string[] {
  const config = loadConfig();
  const lines: string[] = [];

  lines.push(`  provider:  ${config.provider || "(not set — defaults to anthropic)"}`);
  lines.push(`  model:     ${config.model || "(not set — uses provider default)"}`);
  lines.push(`  mode:      ${config.mode || "(not set — defaults to ask)"}`);
  lines.push(`  base-url:  ${config.baseUrl || "(not set)"}`);

  if (config.apiKeys) {
    for (const [provider, key] of Object.entries(config.apiKeys)) {
      const masked = key.slice(0, 8) + "..." + key.slice(-4);
      lines.push(`  api-key [${provider}]: ${masked}`);
    }
  } else {
    lines.push(`  api-key:   (not set)`);
  }

  return lines;
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
 * Resolve API key from: flag → env → stored config → OAuth token → interactive setup.
 * Mutates options.apiKey so downstream code can use it.
 */
export async function resolveApiKey(options: CLIOptions): Promise<void> {
  if (options.apiKey) return;

  const provider = options.provider.toLowerCase();
  const envVar = getApiKeyEnvVar(provider);

  if (process.env[envVar]) return;

  // Check OAuth tokens (Anthropic only — uses Bearer auth with beta headers)
  if (provider === "anthropic") {
    const oauthToken = await resolveOAuthToken();
    if (oauthToken) {
      options.oauthToken = oauthToken;
      return;
    }
  }

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
  console.log(chalk.dim("  Let's set up authentication.\n"));
  console.log(chalk.white(`  Provider: ${chalk.bold(info?.name || provider)}`));

  if (provider === "anthropic") {
    console.log();
    console.log(chalk.white("  Choose authentication method:\n"));
    console.log(chalk.white("    1) API key from Anthropic Console") + chalk.dim(" (recommended)"));
    console.log(chalk.dim("       Get one at: https://console.anthropic.com/settings/keys\n"));
    console.log(chalk.white("    2) Claude Code OAuth token") + chalk.dim(" (if you have Claude Pro/Max)"));
    console.log(chalk.dim("       Run: claude config get oauth_token"));
    console.log();

    const choice = await ask(chalk.green("  Choose (1/2): "));

    if (choice === "2") {
      console.log();
      console.log(chalk.dim("  To get your OAuth token:"));
      console.log(chalk.dim("    1. Install Claude Code: npm install -g @anthropic-ai/claude-code"));
      console.log(chalk.dim("    2. Login: claude login"));
      console.log(chalk.dim("    3. Get token: claude config get oauth_token"));
      console.log();
      const token = await ask(chalk.green("  Paste your OAuth token (sk-ant-oat01-...): "));
      if (token && token.startsWith("sk-ant-")) {
        const config = loadConfig();
        config.apiKeys = config.apiKeys || {};
        config.apiKeys[provider] = token;
        config.provider = provider;
        saveConfig(config);
        options.apiKey = token;
        console.log(chalk.green("\n  Token saved!\n"));
        return;
      } else if (token) {
        console.log(chalk.yellow("\n  That doesn't look like a Claude token."));
        console.log(chalk.dim("  Tokens should start with sk-ant-\n"));
      }
    }
  }

  // API key entry
  if (info?.url) console.log(chalk.dim(`\n  Get a key: ${info.url}\n`));

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
