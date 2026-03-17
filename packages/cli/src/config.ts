/**
 * CLI Configuration — parses options, validates API key,
 * interactive setup wizard on first run.
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as readline from "readline";
import chalk from "chalk";
import { PermissionManager, PermissionMode, SandboxManager, supportsOAuth, getOAuthProvider } from "@cdoing/core";
import { getApiKeyEnvVar, getProviderCatalog, type ModelConfig } from "@cdoing/ai";
import { resolveOAuthToken, oauthLogin } from "./oauth";

const CONFIG_DIR = path.join(os.homedir(), ".cdoing");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");

export interface StoredConfig {
  provider?: string;
  model?: string;
  apiKeys?: Record<string, string>;
  mode?: string;
  baseUrl?: string;
  apiKeyHelper?: string;
  /** UI theme: "dark", "light", or "auto" (default) */
  theme?: string;
  /** Indexer configuration */
  indexer?: {
    /** Embedding model ID (e.g. "text-embedding-3-small", "nomic-embed-text") */
    embeddingModel?: string;
    /** Embedding provider: "openai", "ollama", or "none" (FTS only) */
    embeddingProvider?: string;
    /** Base URL for embedding API (e.g. "http://localhost:11434" for Ollama) */
    embeddingBaseUrl?: string;
    /** API key for embedding provider (uses main provider key if not set) */
    embeddingApiKey?: string;
    /** Auto-index on startup. Default: true */
    autoIndex?: boolean;
  };
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
    case "bypassPermissions": return PermissionMode.BYPASS;
    case "auto":              return PermissionMode.BYPASS;     // legacy alias
    case "acceptEdits":       return PermissionMode.ACCEPT_EDITS;
    case "auto-edit":         return PermissionMode.ACCEPT_EDITS; // legacy alias
    case "plan":              return PermissionMode.PLAN;
    case "dontAsk":           return PermissionMode.DONT_ASK;
    case "default":           return PermissionMode.DEFAULT;
    default:                  return PermissionMode.DEFAULT;    // "ask" and unknown → default
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

export function createSandboxManager(options: CLIOptions): SandboxManager {
  const dir = path.resolve(options.dir || process.cwd());
  return new SandboxManager(dir, dir);
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

const VALID_CONFIG_KEYS = ["provider", "model", "mode", "api-key", "base-url", "api-key-helper"] as const;
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
      const validModes = ["default", "acceptEdits", "plan", "dontAsk", "bypassPermissions", "ask", "auto-edit", "auto"];
      if (!validModes.includes(value)) {
        return { success: false, error: `Invalid mode "${value}". Valid: ${validModes.slice(0, 5).join(", ")}` };
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
    case "api-key-helper":
      config.apiKeyHelper = value;
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

  lines.push(`  api-key-helper: ${config.apiKeyHelper || "(not set)"}`);

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

/**
 * Check if an API key exists for the provider (env var or stored config).
 * If missing, prompt the user to enter one and optionally save it.
 * Returns the key, or undefined if skipped.
 */
export async function promptApiKeyIfMissing(provider: string): Promise<string | undefined> {
  const envVar = getApiKeyEnvVar(provider);
  if (process.env[envVar]) return process.env[envVar];

  const stored = loadConfig();
  if (stored.apiKeys?.[provider]) return stored.apiKeys[provider];

  // Ollama doesn't need a key
  if (provider === "ollama") return undefined;

  const info = PROVIDER_INFO[provider];
  console.log(chalk.yellow(`\n  No API key found for ${provider}.`));
  if (info?.url) console.log(chalk.dim(`  Get a key: ${info.url}\n`));

  const key = await ask(chalk.green(`  Enter your ${provider} API key (or press Enter to skip): `));
  if (!key) {
    console.log(chalk.dim("  Skipped. You can set it later with: /config set api-key <key>\n"));
    return undefined;
  }

  const save = await ask(chalk.green("  Save to ~/.cdoing/config.json? (Y/n): "));
  if (save.toLowerCase() !== "n") {
    const config = loadConfig();
    config.apiKeys = config.apiKeys || {};
    config.apiKeys[provider] = key;
    saveConfig(config);
    console.log(chalk.green("  Saved!\n"));
  }

  return key;
}

export interface SelectOption {
  label: string;
  hint?: string;
  value: string;
}

export function selectMenu(title: string, options: SelectOption[], defaultIndex = 0): Promise<string> {
  return new Promise((resolve) => {
    let idx = defaultIndex;

    const render = () => {
      // Move cursor up to redraw (skip on first render)
      if ((render as any).drawn) {
        process.stdout.write(`\x1b[${options.length + 1}A`);
      }
      (render as any).drawn = true;

      process.stdout.write(`\x1b[2K\n`);
      options.forEach((opt, i) => {
        const selected = i === idx;
        const pointer = selected ? chalk.cyan("  ❯ ") : "    ";
        const label = selected ? chalk.bold.white(opt.label) : chalk.white(opt.label);
        const hint = opt.hint ? chalk.dim(`  ${opt.hint}`) : "";
        process.stdout.write(`\x1b[2K${pointer}${label}${hint}\n`);
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

// Build provider info and model lists from the centralized catalog (single source of truth)
const _catalog = getProviderCatalog();
const PROVIDER_INFO: Record<string, { name: string; url: string }> = {};
const PROVIDER_MODELS: Record<string, SelectOption[]> = {};
for (const p of _catalog) {
  PROVIDER_INFO[p.id] = { name: p.label, url: p.keyUrl || "" };
  if (p.models.length > 0) PROVIDER_MODELS[p.id] = p.models;
}

/**
 * Run the apiKeyHelper script and return its stdout trimmed, or null on failure.
 */
function runApiKeyHelper(scriptPath: string): string | null {
  try {
    const { execFileSync } = require("child_process") as typeof import("child_process");
    const resolved = scriptPath.startsWith("~")
      ? path.join(os.homedir(), scriptPath.slice(1))
      : scriptPath;
    const key = execFileSync(resolved, { encoding: "utf-8", timeout: 5000 }).trim();
    return key || null;
  } catch {
    return null;
  }
}

/**
 * Resolve API key from: flag → apiKeyHelper → env → stored config → OAuth token → interactive setup.
 * Mutates options.apiKey so downstream code can use it.
 */
export async function resolveApiKey(options: CLIOptions): Promise<void> {
  if (options.apiKey) return;

  // Apply stored config to options (stored provider wins over CLI default "anthropic")
  const stored = loadConfig();
  const isDefaultProvider = options.provider === "anthropic";
  if (isDefaultProvider && stored.provider) options.provider = stored.provider;
  if (!options.model && stored.model) options.model = stored.model;
  if (!options.baseUrl && stored.baseUrl) options.baseUrl = stored.baseUrl;

  const provider = options.provider.toLowerCase();
  const envVar = getApiKeyEnvVar(provider);

  // apiKeyHelper: run a script to get the key dynamically (e.g. for proxies)
  if (stored.apiKeyHelper) {
    const key = runApiKeyHelper(stored.apiKeyHelper);
    if (key) {
      options.apiKey = key;
      return;
    }
    console.log(chalk.yellow(`  Warning: apiKeyHelper script failed or returned empty — falling back.\n`));
  }

  if (process.env[envVar]) return;

  if (stored.apiKeys?.[provider]) {
    options.apiKey = stored.apiKeys[provider];
    return;
  }

  // Check OAuth tokens for any provider that supports OAuth
  if (supportsOAuth(provider)) {
    const oauthToken = await resolveOAuthToken(provider);
    if (oauthToken) {
      options.oauthToken = oauthToken;
      return;
    }
  }

  // Interactive setup — no key found, prompt user
  const stored2 = stored;
  console.log();
  console.log(chalk.bold.cyan("  Welcome to Cdoing Agent!"));
  console.log(chalk.dim("  Let's set up authentication."));

  // Always show provider selection — pre-select stored or current value
  // Build provider options from the centralized catalog
  const providerOptions = _catalog.map(p => ({
    value: p.id,
    label: p.label,
    hint: p.supportsOAuth ? `${p.hint} · OAuth` : p.hint,
  }));
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
  if (supportsOAuth(provider2)) {
    const oauthToken = await resolveOAuthToken(provider2);
    if (oauthToken) { options.oauthToken = oauthToken; return; }
  }

  // Model selection
  const modelOptions = PROVIDER_MODELS[provider2];
  if (modelOptions && !options.model && !stored2.model) {
    const chosenModel = await selectMenu("Choose a model  (↑↓ navigate · Enter select)", modelOptions);
    options.model = chosenModel;
  }

  const info = PROVIDER_INFO[provider2];

  // Offer OAuth for any provider that supports it
  if (supportsOAuth(provider2)) {
    const oauthConfig = getOAuthProvider(provider2);
    const oauthName = oauthConfig?.name || provider2;
    const authMethod = await selectMenu("Choose authentication method", [
      { value: "apikey", label: "API key",        hint: info?.url ? `from ${new URL(info.url).hostname}` : "enter manually" },
      { value: "oauth",  label: "OAuth (free)",   hint: `login with ${oauthName}` },
    ]);

    if (authMethod === "oauth") {
      try {
        const tokens = await oauthLogin(provider2);
        const config = loadConfig();
        config.provider = provider2;
        if (options.model) config.model = options.model;
        saveConfig(config);
        options.oauthToken = tokens.access_token;
        console.log(chalk.green("\n  OAuth login successful!\n"));
        return;
      } catch (err) {
        console.log(chalk.yellow(`\n  OAuth login failed: ${(err as Error).message}. Falling back to API key.\n`));
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
    config.apiKeys[provider2] = apiKey;
    config.provider = provider2;
    if (options.model) config.model = options.model;
    saveConfig(config);
    console.log(chalk.green("  Saved!\n"));
  }

  options.apiKey = apiKey;
}
