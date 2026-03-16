/**
 * Interactive Setup Wizard — First-run configuration for Remote Coding Agent.
 *
 * Uses readline for interactive prompts (no Ink dependency for setup).
 * Guides the user through:
 *   1. AI provider selection (Anthropic, OpenAI, Google, Ollama)
 *   2. Model selection
 *   3. API key entry
 *   4. Channel setup (Telegram, Discord)
 *   5. Security (auth token generation, allowed users)
 *   6. Working directory
 *   7. Gateway port
 *   8. Permission mode
 *
 * The wizard writes a config file and generates a secure auth token.
 *
 * Usage:
 *   const config = await runSetupWizard();
 *   // config is a validated AppConfig ready to use
 */

import * as readline from "readline";
import * as fs from "fs";
import * as path from "path";
import { generateSecretKey } from "../auth/secret";
import { CredentialManager } from "../auth/credentials";

// ── ANSI Colors (no chalk dependency) ───────────────────────────────────

const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

// ── Provider & Model Definitions ────────────────────────────────────────

/** Available AI providers with their model options. */
const PROVIDERS = [
  {
    id: "anthropic",
    name: "Anthropic (Claude)",
    envKey: "ANTHROPIC_API_KEY",
    models: ["claude-sonnet-4-6", "claude-opus-4-6", "claude-haiku-4-5-20251001"],
    defaultModel: "claude-sonnet-4-6",
  },
  {
    id: "openai",
    name: "OpenAI (GPT)",
    envKey: "OPENAI_API_KEY",
    models: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "o1-preview"],
    defaultModel: "gpt-4o",
  },
  {
    id: "google",
    name: "Google (Gemini)",
    envKey: "GOOGLE_API_KEY",
    models: ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.0-flash"],
    defaultModel: "gemini-2.5-flash",
  },
  {
    id: "ollama",
    name: "Ollama (Local)",
    envKey: "",
    models: ["llama3.3", "codellama", "deepseek-coder", "mistral"],
    defaultModel: "llama3.3",
  },
];

/** Permission mode options. */
const PERMISSION_MODES = [
  { id: "auto", label: "Auto — Agent runs all tools without asking" },
  { id: "auto-edit", label: "Auto-Edit — Auto for reads, asks for writes" },
  { id: "ask", label: "Ask — Agent asks before every tool call" },
];

// ── Interactive Prompt Helpers ───────────────────────────────────────────

/**
 * Ask the user a text question. Returns the trimmed answer.
 */
async function ask(question: string, defaultValue?: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const suffix = defaultValue ? ` ${DIM}(${defaultValue})${RESET}` : "";
  return new Promise((resolve) => {
    rl.question(`${GREEN}?${RESET} ${question}${suffix}: `, (answer) => {
      rl.close();
      resolve(answer.trim() || defaultValue || "");
    });
  });
}

/**
 * Ask a yes/no question. Returns boolean.
 */
async function confirm(question: string, defaultYes: boolean = true): Promise<boolean> {
  const hint = defaultYes ? "Y/n" : "y/N";
  const answer = await ask(`${question} ${DIM}(${hint})${RESET}`);
  if (!answer) return defaultYes;
  return answer.toLowerCase().startsWith("y");
}

/**
 * Interactive arrow-key menu selection.
 * Returns the index of the selected option.
 */
async function selectMenu(title: string, options: string[], defaultIndex: number = 0): Promise<number> {
  return new Promise((resolve) => {
    let selected = defaultIndex;

    const render = () => {
      // Move cursor up and clear previous render
      if (selected !== defaultIndex || firstRender) {
        process.stdout.write(`\x1b[${options.length + 1}A`);
      }
      console.log(`${CYAN}${BOLD}${title}${RESET}`);
      options.forEach((opt, i) => {
        const prefix = i === selected ? `${CYAN}❯${RESET} ${BOLD}` : "  ";
        const suffix = i === selected ? RESET : "";
        console.log(`${prefix}${opt}${suffix}`);
      });
    };

    let firstRender = true;

    // Initial render
    console.log(`${CYAN}${BOLD}${title}${RESET}`);
    options.forEach((opt, i) => {
      const prefix = i === selected ? `${CYAN}❯${RESET} ${BOLD}` : "  ";
      const suffix = i === selected ? RESET : "";
      console.log(`${prefix}${opt}${suffix}`);
    });
    firstRender = false;

    // Listen for keypresses
    readline.emitKeypressEvents(process.stdin);
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();

    const onKeypress = (_str: string, key: readline.Key) => {
      if (key.name === "up" && selected > 0) {
        selected--;
        render();
      } else if (key.name === "down" && selected < options.length - 1) {
        selected++;
        render();
      } else if (key.name === "return") {
        cleanup();
        resolve(selected);
      } else if (key.ctrl && key.name === "c") {
        cleanup();
        process.exit(0);
      }
    };

    const cleanup = () => {
      process.stdin.removeListener("keypress", onKeypress);
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }
      process.stdin.pause();
    };

    process.stdin.on("keypress", onKeypress);
  });
}

// ── Setup Wizard ────────────────────────────────────────────────────────

/** Config structure built by the wizard. */
export interface SetupResult {
  /** Assistant model provider */
  provider: string;
  /** Assistant model name */
  model: string;
  /** Assistant API key (if manually entered) */
  apiKey?: string;
  /** Whether OAuth was used for auth */
  usedOAuth: boolean;
  /** Whether a separate coding model was configured */
  hasCodingModel: boolean;
  /** Coding model provider */
  codingProvider?: string;
  /** Coding model name */
  codingModel?: string;
  /** Coding API key (if manually entered) */
  codingApiKey?: string;
  telegramEnabled: boolean;
  telegramToken?: string;
  discordEnabled: boolean;
  discordToken?: string;
  authToken: string;
  allowedDirs: string[];
  workingDir: string;
  port: number;
  permissionMode: string;
  logLevel: string;
}

/**
 * Run the full interactive setup wizard.
 * Returns a SetupResult that can be written to a config file.
 */
export async function runSetupWizard(): Promise<SetupResult> {
  console.log();
  console.log(`${CYAN}${BOLD}╔══════════════════════════════════════════════╗${RESET}`);
  console.log(`${CYAN}${BOLD}║   Remote Coding Agent — Setup Wizard        ║${RESET}`);
  console.log(`${CYAN}${BOLD}╚══════════════════════════════════════════════╝${RESET}`);
  console.log();
  console.log(`${DIM}This wizard will help you configure your remote coding agent.${RESET}`);
  console.log(`${DIM}You can change these settings later in the config file or dashboard.${RESET}`);
  console.log();

  // ── Step 1: AI Provider ──
  console.log(`${YELLOW}${BOLD}Step 1: AI Provider${RESET}`);
  const providerIdx = await selectMenu(
    "Select your AI provider:",
    PROVIDERS.map((p) => p.name),
  );
  const provider = PROVIDERS[providerIdx];
  console.log(`  ${DIM}Selected: ${provider.name}${RESET}\n`);

  // ── Step 2: Model ──
  console.log(`${YELLOW}${BOLD}Step 2: Model${RESET}`);
  const modelIdx = await selectMenu(
    "Select model:",
    provider.models,
    0,
  );
  const model = provider.models[modelIdx];
  console.log(`  ${DIM}Selected: ${model}${RESET}\n`);

  // ── Step 3: Authentication ──
  let apiKey: string | undefined;
  let usedOAuth = false;
  const creds = new CredentialManager();

  console.log(`${YELLOW}${BOLD}Step 3: Authentication${RESET}`);

  if (provider.id === "anthropic") {
    // Anthropic supports OAuth + API key
    const authMethodIdx = await selectMenu("How do you want to authenticate?", [
      "Claude OAuth (opens browser — recommended)",
      "API Key (paste manually)",
      "Environment variable (already set)",
      "Skip (configure later)",
    ]);

    if (authMethodIdx === 0) {
      // OAuth flow
      try {
        const result = await creds.oauthLogin();
        usedOAuth = true;
        console.log(`  ${GREEN}✓${RESET} Claude OAuth login successful!`);
        if (result.expiresAt) {
          console.log(`  ${DIM}Expires: ${new Date(result.expiresAt).toLocaleString()}${RESET}`);
        }
        console.log(`  ${DIM}The agent will use this token automatically.${RESET}`);
      } catch (err) {
        console.log(`  ${RED}✗${RESET} OAuth failed: ${err instanceof Error ? err.message : err}`);
        console.log(`  ${DIM}You can try again later with: remote-coding-agent login --oauth${RESET}`);
        apiKey = await ask("Enter API key instead (or press Enter to skip)");
      }
    } else if (authMethodIdx === 1) {
      apiKey = await ask("Enter your Anthropic API key");
      if (apiKey) {
        creds.saveApiKey("anthropic", apiKey, "assistant");
        console.log(`  ${GREEN}✓${RESET} API key saved to credential store`);
      }
    } else if (authMethodIdx === 2) {
      const envValue = process.env[provider.envKey];
      if (envValue) {
        console.log(`  ${GREEN}✓${RESET} Found ${provider.envKey} in environment`);
      } else {
        console.log(`  ${YELLOW}⚠${RESET} ${provider.envKey} not found. Set it before starting.`);
      }
    }
    // authMethodIdx === 3: skip
  } else if (provider.envKey) {
    // Non-Anthropic: API key or env var
    const envValue = process.env[provider.envKey];
    if (envValue) {
      console.log(`  ${GREEN}✓${RESET} Found ${provider.envKey} in environment`);
      const useEnv = await confirm("Use the environment variable?");
      if (!useEnv) {
        apiKey = await ask(`Enter your ${provider.name} API key`);
        if (apiKey) creds.saveApiKey(provider.id, apiKey, "assistant");
      }
    } else {
      apiKey = await ask(`Enter your ${provider.name} API key`);
      if (apiKey) {
        creds.saveApiKey(provider.id, apiKey, "assistant");
        console.log(`  ${GREEN}✓${RESET} API key saved to credential store`);
      } else {
        console.log(`  ${YELLOW}⚠${RESET} No API key set. Set ${provider.envKey} env var before starting.`);
      }
    }
  }
  console.log();

  // ── Step 3b: Separate Coding Model ──
  let hasCodingModel = false;
  let codingProvider: string | undefined;
  let codingModel: string | undefined;
  let codingApiKey: string | undefined;

  console.log(`${YELLOW}${BOLD}Step 3b: Coding Model (optional)${RESET}`);
  console.log(`  ${DIM}You can use a different (more capable) model for coding tasks.${RESET}`);
  console.log(`  ${DIM}The assistant model handles chat, cron, skills. The coding model handles file edits, builds, etc.${RESET}`);
  console.log();

  const wantCodingModel = await confirm("Use a separate model for coding tasks?", false);

  if (wantCodingModel) {
    hasCodingModel = true;

    const codingProviderIdx = await selectMenu(
      "Select coding model provider:",
      PROVIDERS.map((p) => p.name),
      PROVIDERS.findIndex((p) => p.id === provider.id),
    );
    const codingProviderDef = PROVIDERS[codingProviderIdx];
    codingProvider = codingProviderDef.id;

    const codingModelIdx = await selectMenu(
      "Select coding model:",
      codingProviderDef.models,
      0,
    );
    codingModel = codingProviderDef.models[codingModelIdx];
    console.log(`  ${DIM}Coding: ${codingProviderDef.name} / ${codingModel}${RESET}`);

    // API key for coding model (if different provider)
    if (codingProvider !== provider.id) {
      const codingEnvKey = codingProviderDef.envKey;
      const codingEnvVal = codingEnvKey ? process.env[codingEnvKey] : undefined;

      if (codingEnvVal) {
        console.log(`  ${GREEN}✓${RESET} Found ${codingEnvKey} in environment for coding model`);
      } else if (codingEnvKey) {
        codingApiKey = await ask(`Enter ${codingProviderDef.name} API key for coding model`);
        if (codingApiKey) {
          creds.saveApiKey(codingProvider, codingApiKey, "coding");
          console.log(`  ${GREEN}✓${RESET} Coding API key saved to credential store`);
        }
      }
    }
  }
  console.log();

  // ── Step 4: Channels ──
  console.log(`${YELLOW}${BOLD}Step 4: Channels${RESET}`);

  const telegramEnabled = await confirm("Enable Telegram channel?");
  let telegramToken: string | undefined;
  if (telegramEnabled) {
    const envToken = process.env.TELEGRAM_BOT_TOKEN;
    if (envToken) {
      console.log(`  ${GREEN}✓${RESET} Found TELEGRAM_BOT_TOKEN in environment`);
    } else {
      telegramToken = await ask("Enter Telegram bot token (from @BotFather)");
    }
  }

  const discordEnabled = await confirm("Enable Discord channel?", false);
  let discordToken: string | undefined;
  if (discordEnabled) {
    const envToken = process.env.DISCORD_BOT_TOKEN;
    if (envToken) {
      console.log(`  ${GREEN}✓${RESET} Found DISCORD_BOT_TOKEN in environment`);
    } else {
      discordToken = await ask("Enter Discord bot token");
    }
  }
  console.log();

  // ── Step 5: Security ──
  console.log(`${YELLOW}${BOLD}Step 5: Security${RESET}`);

  // Generate auth token
  const authToken = generateSecretKey();
  console.log(`  ${GREEN}✓${RESET} Generated secure auth token for API & dashboard access`);
  console.log(`  ${DIM}Token: ${authToken.substring(0, 8)}...${authToken.substring(56)}${RESET}`);
  console.log(`  ${DIM}This token protects your API and dashboard from unauthorized access.${RESET}`);
  console.log(`  ${DIM}Keep it secret! You'll need it to access the dashboard.${RESET}`);

  // Permission mode
  console.log();
  const modeIdx = await selectMenu(
    "Permission mode (how much freedom the agent has):",
    PERMISSION_MODES.map((m) => m.label),
    0,
  );
  const permissionMode = PERMISSION_MODES[modeIdx].id;
  console.log();

  // ── Step 6: Working Directory ──
  console.log(`${YELLOW}${BOLD}Step 6: Working Directory${RESET}`);
  const workingDir = await ask("Working directory for coding operations", process.cwd());
  console.log();

  // ── Step 7: Gateway ──
  console.log(`${YELLOW}${BOLD}Step 7: Gateway${RESET}`);
  const portStr = await ask("Gateway port", "4567");
  const port = parseInt(portStr, 10) || 4567;
  console.log();

  // ── Step 8: Log Level ──
  const logIdx = await selectMenu("Log level:", ["info", "debug", "warn", "error"], 0);
  const logLevel = ["info", "debug", "warn", "error"][logIdx];
  console.log();

  return {
    provider: provider.id,
    model,
    apiKey,
    usedOAuth,
    hasCodingModel,
    codingProvider,
    codingModel,
    codingApiKey,
    telegramEnabled,
    telegramToken,
    discordEnabled,
    discordToken,
    authToken,
    allowedDirs: [workingDir],
    workingDir,
    port,
    permissionMode,
    logLevel,
  };
}

/**
 * Write the setup result to a config file.
 * Returns the path where the config was written.
 */
export function writeSetupConfig(result: SetupResult, outputPath?: string): string {
  const configPath = outputPath || path.resolve("remote-coding-agent.config.json");

  const config = {
    agent: {
      provider: result.provider,
      model: result.model,
      ...(result.apiKey ? { apiKey: result.apiKey } : {}),
      maxTurns: 25,
      permissionMode: result.permissionMode,
      ...(result.codingProvider ? { codingProvider: result.codingProvider } : {}),
      ...(result.codingModel ? { codingModel: result.codingModel } : {}),
      ...(result.codingApiKey ? { codingApiKey: result.codingApiKey } : {}),
    },
    gateway: {
      port: result.port,
      authToken: result.authToken,
    },
    session: {
      ttlMs: 1800000,
      maxHistoryMessages: 50,
      maxSessions: 100,
    },
    security: {
      channelRules: {},
      rateLimitPerMinute: 20,
      allowedDirs: result.allowedDirs,
    },
    channels: {
      ...(result.telegramEnabled
        ? { telegram: { enabled: true, ...(result.telegramToken ? { botToken: result.telegramToken } : {}) } }
        : {}),
      ...(result.discordEnabled
        ? { discord: { enabled: true, ...(result.discordToken ? { botToken: result.discordToken } : {}) } }
        : {}),
    },
    workingDir: result.workingDir,
    logLevel: result.logLevel,
  };

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
  return configPath;
}

/**
 * Print the post-setup summary.
 */
export function printSetupSummary(result: SetupResult, configPath: string): void {
  console.log(`${GREEN}${BOLD}╔══════════════════════════════════════════════╗${RESET}`);
  console.log(`${GREEN}${BOLD}║   Setup Complete!                            ║${RESET}`);
  console.log(`${GREEN}${BOLD}╚══════════════════════════════════════════════╝${RESET}`);
  console.log();
  console.log(`  Config saved to: ${CYAN}${configPath}${RESET}`);
  console.log();
  console.log(`  ${BOLD}Configuration:${RESET}`);
  console.log(`    Assistant:   ${result.provider} / ${result.model}`);
  if (result.hasCodingModel) {
    console.log(`    Coding:      ${result.codingProvider} / ${result.codingModel}`);
  }
  console.log(`    Auth:        ${result.usedOAuth ? "Claude OAuth" : result.apiKey ? "API key" : "env variable"}`);
  console.log(`    Port:        ${result.port}`);
  console.log(`    Permission:  ${result.permissionMode}`);
  console.log(`    Working dir: ${result.workingDir}`);
  console.log();

  const channels = [];
  if (result.telegramEnabled) channels.push("Telegram");
  if (result.discordEnabled) channels.push("Discord");
  console.log(`    Channels:    ${channels.length > 0 ? channels.join(", ") : "none"}`);
  console.log();

  console.log(`  ${BOLD}${RED}Important — Save your auth token:${RESET}`);
  console.log(`    ${YELLOW}${result.authToken}${RESET}`);
  console.log();
  console.log(`  ${DIM}You need this token to access the API and dashboard.${RESET}`);
  console.log(`  ${DIM}It's also saved in your config file.${RESET}`);
  console.log();
  console.log(`  ${BOLD}Next steps:${RESET}`);
  console.log(`    ${CYAN}remote-coding-agent start${RESET}             # Headless mode`);
  console.log(`    ${CYAN}remote-coding-agent dashboard${RESET}         # With web dashboard`);
  console.log(`    ${CYAN}remote-coding-agent tui${RESET}               # Terminal UI`);
  console.log();
  console.log(`  ${BOLD}Dashboard URL:${RESET}`);
  console.log(`    ${CYAN}http://localhost:${result.port}/dashboard/?token=${result.authToken}${RESET}`);
  console.log();
}
