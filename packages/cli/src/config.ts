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

interface SelectOption {
  label: string;
  hint?: string;
  value: string;
}

function selectMenu(title: string, options: SelectOption[], defaultIndex = 0): Promise<string> {
  return new Promise((resolve) => {
    let idx = defaultIndex;

    const render = () => {
      // Move cursor up to redraw (skip on first render)
      if ((render as any).drawn) {
        process.stdout.write(`\x1b[${options.length + 1}A`);
      }
      (render as any).drawn = true;

      process.stdout.write(`\n`);
      options.forEach((opt, i) => {
        const selected = i === idx;
        const pointer = selected ? chalk.cyan("  ❯ ") : "    ";
        const label = selected ? chalk.bold.white(opt.label) : chalk.white(opt.label);
        const hint = opt.hint ? chalk.dim(`  ${opt.hint}`) : "";
        process.stdout.write(`${pointer}${label}${hint}\n`);
      });
    };

    console.log(chalk.bold.cyan(`\n  ${title}`));
    render();

    readline.emitKeypressEvents(process.stdin);
    if (process.stdin.isTTY) process.stdin.setRawMode(true);

    const onKey = (_: string, key: readline.Key) => {
      if (key.name === "up") {
        idx = (idx - 1 + options.length) % options.length;
        render();
      } else if (key.name === "down") {
        idx = (idx + 1) % options.length;
        render();
      } else if (key.name === "return") {
        if (process.stdin.isTTY) process.stdin.setRawMode(false);
        process.stdin.removeListener("keypress", onKey);
        process.stdout.write("\n");
        resolve(options[idx].value);
      } else if (key.name === "c" && key.ctrl) {
        process.stdout.write("\n");
        process.exit(0);
      }
    };

    process.stdin.on("keypress", onKey);
  });
}

// ── API key resolution ──────────────────────────────────────

const PROVIDER_INFO: Record<string, { name: string; url: string }> = {
  anthropic: { name: "Anthropic (Claude)", url: "https://console.anthropic.com/settings/keys" },
  openai: { name: "OpenAI (GPT)", url: "https://platform.openai.com/api-keys" },
  google: { name: "Google (Gemini)", url: "https://aistudio.google.com/apikey" },
};

const PROVIDER_MODELS: Record<string, SelectOption[]> = {
  anthropic: [
    { value: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", hint: "recommended · fast & smart" },
    { value: "claude-opus-4-6",   label: "Claude Opus 4.6",   hint: "most capable" },
    { value: "claude-haiku-4-5",  label: "Claude Haiku 4.5",  hint: "fastest" },
  ],
  openai: [
    { value: "gpt-4o",      label: "GPT-4o",      hint: "recommended" },
    { value: "gpt-4o-mini", label: "GPT-4o mini",  hint: "fastest" },
    { value: "o3-mini",     label: "o3-mini",      hint: "reasoning" },
  ],
  google: [
    { value: "gemini-2.0-flash",  label: "Gemini 2.0 Flash",  hint: "recommended · fast" },
    { value: "gemini-1.5-pro",    label: "Gemini 1.5 Pro",    hint: "most capable" },
    { value: "gemini-1.5-flash",  label: "Gemini 1.5 Flash",  hint: "fastest" },
  ],
};

/**
 * Resolve API key from: flag → env → stored config → OAuth token → interactive setup.
 * Mutates options.apiKey so downstream code can use it.
 */
export async function resolveApiKey(options: CLIOptions): Promise<void> {
  if (options.apiKey) return;

  // Apply stored config to options (stored provider wins over CLI default "anthropic")
  const stored = loadConfig();
  const isDefaultProvider = options.provider === "anthropic";
  if (isDefaultProvider && stored.provider) options.provider = stored.provider;
  if (!options.model && stored.model) options.model = stored.model;

  const provider = options.provider.toLowerCase();
  const envVar = getApiKeyEnvVar(provider);

  if (process.env[envVar]) return;

  if (stored.apiKeys?.[provider]) {
    options.apiKey = stored.apiKeys[provider];
    return;
  }

  // Check OAuth tokens (Anthropic only)
  if (provider === "anthropic") {
    const oauthToken = await resolveOAuthToken();
    if (oauthToken) {
      options.apiKey = oauthToken;
      return;
    }
  }

  // Interactive setup — no key found, prompt user
  const stored2 = stored;
  console.log();
  console.log(chalk.bold.cyan("  Welcome to Cdoing Agent!"));
  console.log(chalk.dim("  Let's set up authentication."));

  // Always show provider selection — pre-select stored or current value
  const providerOptions = [
    { value: "anthropic", label: "Anthropic (Claude)", hint: "claude-sonnet-4-6, claude-opus-4-6" },
    { value: "openai",    label: "OpenAI (GPT)",       hint: "gpt-4o, gpt-4o-mini" },
    { value: "google",    label: "Google (Gemini)",    hint: "gemini-2.0-flash, gemini-1.5-pro" },
  ];
  const currentProvider = stored2.provider || options.provider || "anthropic";
  const defaultProviderIdx = Math.max(0, providerOptions.findIndex(p => p.value === currentProvider));
  const chosenProvider = await selectMenu("Choose a provider  (↑↓ navigate · Enter select)", providerOptions, defaultProviderIdx);
  options.provider = chosenProvider;

  const provider2 = options.provider.toLowerCase();

  // Re-check env/stored now that provider is confirmed
  const envVar2 = getApiKeyEnvVar(provider2);
  if (process.env[envVar2]) return;
  if (stored2.apiKeys?.[provider2]) {
    options.apiKey = stored2.apiKeys[provider2];
    return;
  }
  if (provider2 === "anthropic") {
    const oauthToken = await resolveOAuthToken();
    if (oauthToken) { options.apiKey = oauthToken; return; }
  }

  // Model selection
  const modelOptions = PROVIDER_MODELS[provider2];
  if (modelOptions && !options.model && !stored2.model) {
    const chosenModel = await selectMenu("Choose a model  (↑↓ navigate · Enter select)", modelOptions);
    options.model = chosenModel;
  }

  const info = PROVIDER_INFO[provider2];

  // Anthropic: offer API key or OAuth
  if (provider2 === "anthropic") {
    const authMethod = await selectMenu("Choose authentication method", [
      { value: "apikey", label: "API key",        hint: "from console.anthropic.com" },
      { value: "oauth",  label: "OAuth token",    hint: "Claude Pro/Max · run: claude config get oauth_token" },
    ]);

    if (authMethod === "oauth") {
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
        config.apiKeys[provider2] = token;
        config.provider = provider2;
        if (options.model) config.model = options.model;
        saveConfig(config);
        options.apiKey = token;
        console.log(chalk.green("\n  Token saved!\n"));
        return;
      }
      console.log(chalk.yellow("\n  That doesn't look like a Claude token. Falling back to API key.\n"));
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
    config.apiKeys[provider2] = apiKey;
    config.provider = provider2;
    if (options.model) config.model = options.model;
    saveConfig(config);
    console.log(chalk.green("  Saved!\n"));
  }

  options.apiKey = apiKey;
}
