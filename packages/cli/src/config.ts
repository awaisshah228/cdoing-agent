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
import { resolveOAuthToken, oauthLogin, saveOAuthTokens } from "./oauth";

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
    rl.question(question, (a) => { rl.close(); process.stdin.resume(); resolve(a.trim()); });
  });
}

// ── API key resolution ──────────────────────────────────────

const PROVIDER_MENU = [
  { label: "Anthropic (Claude)",  provider: "anthropic", keyUrl: "https://console.anthropic.com/settings/keys",  defaultModel: "claude-sonnet-4-6" },
  { label: "OpenAI (GPT / o-series)", provider: "openai",    keyUrl: "https://platform.openai.com/api-keys",    defaultModel: "gpt-4o" },
  { label: "Google (Gemini)",     provider: "google",    keyUrl: "https://aistudio.google.com/apikey",          defaultModel: "gemini-2.0-flash" },
  { label: "Ollama (local)",      provider: "ollama",    keyUrl: "",                                            defaultModel: "llama3.1" },
  { label: "Custom / other",      provider: "custom",    keyUrl: "",                                            defaultModel: "" },
] as const;

/**
 * Resolve API key from: flag → env → stored config → OAuth token → interactive setup.
 * Mutates options.apiKey / options.oauthToken / options.provider / options.model.
 */
export async function resolveApiKey(options: CLIOptions): Promise<void> {
  if (options.apiKey) return;

  const provider = options.provider.toLowerCase();
  const envVar = getApiKeyEnvVar(provider);

  if (process.env[envVar]) return;

  // Check OAuth tokens (Anthropic only)
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

  // ── No auth found — run interactive setup wizard ─────────
  console.log();
  console.log(chalk.bold.cyan("  No authentication set up yet.\n"));
  console.log(chalk.bold("  Choose a provider:\n"));

  PROVIDER_MENU.forEach((p, i) => {
    console.log(`    ${chalk.dim(`${i + 1}.`)} ${p.label}`);
  });
  console.log();

  const providerChoice = await ask(chalk.green("  Enter number (or press Enter to cancel): "));
  if (!providerChoice) {
    console.log(chalk.red("\n  No provider selected. Exiting.\n"));
    process.exit(1);
  }

  const idx = parseInt(providerChoice, 10) - 1;
  if (isNaN(idx) || idx < 0 || idx >= PROVIDER_MENU.length) {
    console.log(chalk.red("\n  Invalid choice. Exiting.\n"));
    process.exit(1);
  }

  const selected = PROVIDER_MENU[idx];

  // Handle custom provider — ask for name and base URL
  if (selected.provider === "custom") {
    const customName = await ask(chalk.green("  Provider name (e.g. groq): "));
    const baseUrl    = await ask(chalk.green("  Base URL (OpenAI-compatible endpoint): "));
    const modelName  = await ask(chalk.green("  Model name: "));
    if (!customName || !baseUrl || !modelName) {
      console.log(chalk.red("\n  Incomplete setup. Exiting.\n"));
      process.exit(1);
    }
    options.provider = customName.toLowerCase();
    options.baseUrl  = baseUrl;
    options.model    = modelName;
    const apiKey = await ask(chalk.green("  Paste your API key (or leave blank if not required): "));
    if (apiKey) {
      options.apiKey = apiKey;
      await saveProviderKey(options.provider, apiKey, options.provider, options.model);
    }
    return;
  }

  // Update provider (and default model) in options
  options.provider = selected.provider;
  if (!options.model) options.model = selected.defaultModel;

  // Anthropic: offer API key OR OAuth
  if (selected.provider === "anthropic") {
    console.log();
    console.log(`    ${chalk.dim("1.")} Paste an API key       ${chalk.dim("(console.anthropic.com/settings/keys)")}`);
    console.log(`    ${chalk.dim("2.")} Login with Claude OAuth ${chalk.dim("(Claude Pro/Max subscription)")}`);
    console.log();
    const authChoice = await ask(chalk.green("  Choose (1/2): "));

    if (authChoice === "2") {
      const tokens = await oauthLogin();
      saveOAuthTokens(tokens);
      options.oauthToken = tokens.access_token;
      console.log(chalk.green("\n  ✓ Logged in with Claude OAuth!\n"));
      return;
    }
  }

  // Ollama: no key required
  if (selected.provider === "ollama") {
    const customModel = await ask(chalk.green(`  Model name (press Enter for ${selected.defaultModel}): `));
    if (customModel) options.model = customModel;
    console.log(chalk.green("\n  ✓ Ollama configured (no API key needed).\n"));
    await saveProviderKey("ollama", "ollama", "ollama", options.model!);
    return;
  }

  // All other providers: ask for API key
  if (selected.keyUrl) console.log(chalk.dim(`\n  Get a key: ${selected.keyUrl}\n`));
  const apiKey = await ask(chalk.green("  Paste your API key: "));
  if (!apiKey) {
    console.log(chalk.red("\n  No key provided. Exiting.\n"));
    process.exit(1);
  }

  options.apiKey = apiKey;
  await saveProviderKey(selected.provider, apiKey, selected.provider, options.model!);
}

async function saveProviderKey(provider: string, apiKey: string, configProvider: string, model: string): Promise<void> {
  const save = await ask(chalk.green("  Save for next time? (Y/n): "));
  if (save.toLowerCase() !== "n") {
    const config = loadConfig();
    config.apiKeys = config.apiKeys || {};
    config.apiKeys[provider] = apiKey;
    config.provider = configProvider;
    if (model) config.model = model;
    saveConfig(config);
    console.log(chalk.green("  ✓ Saved!\n"));
  }
}
