/**
 * CLI Configuration
 *
 * Handles parsing and validation of CLI options into
 * structured config objects for the model and permissions.
 * Supports interactive first-time setup when no API key is found.
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as readline from "readline";
import chalk from "chalk";
import {
  PermissionManager,
  PermissionMode,
} from "@cdoing/core";
import {
  getApiKeyEnvVar,
  type ModelConfig,
} from "@cdoing/ai";

/** Path to the persistent config file */
const CONFIG_DIR = path.join(os.homedir(), ".cdoing");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");

/** Stored configuration shape */
interface StoredConfig {
  provider?: string;
  apiKeys?: Record<string, string>;
  defaultModel?: string;
}

/** CLI options passed from Commander */
export interface CLIOptions {
  model?: string;
  provider: string;
  baseUrl?: string;
  apiKey?: string;
  mode: string;
  dir: string;
}

/**
 * Parse the --mode flag into a PermissionMode enum value.
 * Defaults to ASK if the value is unrecognized.
 */
export function parsePermissionMode(mode: string): PermissionMode {
  switch (mode) {
    case "auto":
      return PermissionMode.AUTO;
    case "auto-edit":
      return PermissionMode.AUTO_EDIT;
    default:
      return PermissionMode.ASK;
  }
}

/**
 * Build a ModelConfig from the CLI options.
 * Only includes fields that were explicitly provided.
 */
export function buildModelConfig(options: CLIOptions): Partial<ModelConfig> {
  return {
    provider: options.provider.toLowerCase(),
    model: options.model,
    baseURL: options.baseUrl,
    apiKey: options.apiKey,
  };
}

/**
 * Create a PermissionManager from the CLI --mode flag.
 */
export function createPermissionManager(options: CLIOptions): PermissionManager {
  const mode = parsePermissionMode(options.mode);
  return new PermissionManager(mode);
}

// ── Config file persistence ─────────────────────────────────

/** Load stored config from ~/.cdoing/config.json */
function loadStoredConfig(): StoredConfig {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
    }
  } catch {
    // Corrupted config — start fresh
  }
  return {};
}

/** Save config to ~/.cdoing/config.json */
function saveStoredConfig(config: StoredConfig): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), "utf-8");
}

/** Prompt the user for a single line of input */
function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// ── Provider display names ──────────────────────────────────

const PROVIDERS = [
  { key: "anthropic", name: "Anthropic (Claude)", envVar: "ANTHROPIC_API_KEY" },
  { key: "openai", name: "OpenAI (GPT)", envVar: "OPENAI_API_KEY" },
  { key: "google", name: "Google (Gemini)", envVar: "GOOGLE_API_KEY" },
];

// ── API key validation & interactive setup ──────────────────

/**
 * Ensure an API key is available for the chosen provider.
 *
 * Resolution order:
 *   1. --api-key flag
 *   2. Environment variable (e.g. ANTHROPIC_API_KEY)
 *   3. Stored config (~/.cdoing/config.json)
 *   4. Interactive setup prompt (first-time experience)
 *
 * Mutates `options.apiKey` so downstream code can use it directly.
 */
export async function resolveApiKey(options: CLIOptions): Promise<void> {
  // 1. Explicitly passed via flag — nothing to do
  if (options.apiKey) return;

  const provider = options.provider.toLowerCase();
  const envVar = getApiKeyEnvVar(provider);

  // 2. Available in environment
  if (process.env[envVar]) return;

  // 3. Check stored config
  const stored = loadStoredConfig();
  if (stored.apiKeys?.[provider]) {
    options.apiKey = stored.apiKeys[provider];
    return;
  }

  // 4. Interactive setup — guide the user through first-time config
  await runSetupWizard(options, provider, envVar);
}

/**
 * Interactive first-time setup wizard.
 * Walks the user through selecting a provider and entering an API key.
 */
async function runSetupWizard(
  options: CLIOptions,
  provider: string,
  envVar: string
): Promise<void> {
  console.log();
  console.log(chalk.bold.cyan("  Welcome to Cdoing Agent!"));
  console.log(chalk.dim("  Let's get you set up. This only takes a moment.\n"));

  // Show provider info
  const providerInfo = PROVIDERS.find((p) => p.key === provider);
  const providerName = providerInfo?.name ?? provider;

  console.log(chalk.white(`  Provider: ${chalk.bold(providerName)}`));
  console.log(
    chalk.dim(`  No API key found in --api-key flag, ${envVar}, or ~/.cdoing/config.json\n`)
  );

  // Ask for the key
  console.log(chalk.white("  You can get an API key from:"));
  if (provider === "anthropic") {
    console.log(chalk.dim("    https://console.anthropic.com/settings/keys\n"));
  } else if (provider === "openai") {
    console.log(chalk.dim("    https://platform.openai.com/api-keys\n"));
  } else if (provider === "google") {
    console.log(chalk.dim("    https://aistudio.google.com/apikey\n"));
  } else {
    console.log(chalk.dim("    Check your provider's documentation.\n"));
  }

  const apiKey = await prompt(chalk.green("  Enter your API key: "));

  if (!apiKey) {
    console.log(chalk.red("\n  No API key provided. Exiting.\n"));
    process.exit(1);
  }

  // Ask if they want to save it
  const save = await prompt(
    chalk.green("  Save to ~/.cdoing/config.json for future use? (Y/n): ")
  );

  if (save.toLowerCase() !== "n") {
    const stored = loadStoredConfig();
    stored.apiKeys = stored.apiKeys ?? {};
    stored.apiKeys[provider] = apiKey;
    stored.provider = provider;
    saveStoredConfig(stored);
    console.log(chalk.green("\n  Config saved to ~/.cdoing/config.json"));
  }

  // Set the key so the rest of the CLI can use it
  options.apiKey = apiKey;
  console.log(chalk.dim("  Setup complete — starting Cdoing Agent...\n"));
}
