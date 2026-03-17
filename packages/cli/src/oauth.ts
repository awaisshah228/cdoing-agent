/**
 * CLI OAuth — thin wrapper around @cdoing/core OAuth
 *
 * Only contains CLI-specific UI code (readline prompts, chalk output, browser opener).
 * All credential storage, PKCE, token management lives in @cdoing/core.
 */

import chalk from "chalk";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// Re-export everything from core so existing imports keep working
export {
  saveOAuthTokens,
  loadOAuthTokens,
  clearOAuthTokens,
  isOAuthExpired,
  refreshAccessToken,
  resolveOAuthToken,
  generateOAuthUrl,
  exchangeOAuthCode,
  getOAuthStatus,
  getAllOAuthStatuses,
  getOAuthProvider,
  getOAuthProviders,
  supportsOAuth,
  startLocalOAuthServer,
} from "@cdoing/core";
export type { OAuthTokens, OAuthProviderConfig, LocalOAuthServer } from "@cdoing/core";

import {
  exchangeOAuthCode,
  clearOAuthTokens,
  loadOAuthTokens,
  isOAuthExpired,
  getAllOAuthStatuses,
  getOAuthProvider,
  startLocalOAuthServer,
} from "@cdoing/core";
import type { OAuthTokens } from "@cdoing/core";

// ── CLI-specific: Interactive login ──────────────────────

export async function oauthLogin(provider: string = "anthropic"): Promise<OAuthTokens> {
  const providerConfig = getOAuthProvider(provider);
  const providerName = providerConfig?.name || provider;

  console.log();
  console.log(chalk.bold.cyan(`  ${providerName} OAuth Login`));
  console.log(chalk.dim("  Starting local server for automatic code capture...\n"));

  const { url, codeVerifier, state, port, codePromise, close } = await startLocalOAuthServer(provider);

  console.log(chalk.white("  If the browser doesn't open, visit:"));
  console.log(chalk.dim(`  ${url}\n`));
  console.log(chalk.dim(`  Listening on http://localhost:${port}/callback ...\n`));

  openBrowser(url);

  const localRedirectUri = `http://localhost:${port}/callback`;

  let code: string;
  let usedLocalRedirect = true;
  try {
    // Auto-capture: browser redirects to localhost, server captures code
    code = await codePromise;
  } catch {
    close();
    usedLocalRedirect = false;
    // Fallback: local server failed — ask user to paste the code manually
    const readline = await import("readline");
    console.log(chalk.yellow("\n  Auto-capture failed. Please paste the authorization code manually."));
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    code = await new Promise<string>((resolve) => {
      rl.question(chalk.green("  Paste the authorization code here: "), (a) => {
        rl.close();
        resolve(a.trim());
      });
    });
  }

  if (!code) throw new Error("No authorization code provided");
  // Pass the localhost redirect URI + state only when the local server was used
  return exchangeOAuthCode(
    code,
    codeVerifier,
    provider,
    usedLocalRedirect ? localRedirectUri : undefined,
    usedLocalRedirect ? state : undefined,
  );
}

// ── CLI-specific: Browser opener ─────────────────────────

function openBrowser(urlToOpen: string): void {
  const { exec } = require("child_process");
  const platform = process.platform;

  let command: string;
  if (platform === "darwin") {
    command = `open "${urlToOpen}"`;
  } else if (platform === "win32") {
    command = `start "" "${urlToOpen}"`;
  } else {
    command = `xdg-open "${urlToOpen}"`;
  }

  exec(command, (err: Error | null) => {
    if (err) {
      console.log(chalk.yellow("  Could not open browser automatically."));
      console.log(chalk.white("  Please open the URL above manually.\n"));
    }
  });
}

// ── CLI-specific: Logout with message ────────────────────

export function oauthLogout(): string {
  const { fullLogout } = require("@cdoing/core");
  return fullLogout();
}

// ── CLI-specific: Detailed status report ─────────────────

export function oauthStatus(): string {
  const tokens = loadOAuthTokens();

  const configPath = path.join(os.homedir(), ".cdoing", "config.json");
  let apiKeys: Record<string, string> | undefined;
  let apiKeyHelper: string | undefined;
  try {
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      apiKeys = config.apiKeys;
      apiKeyHelper = config.apiKeyHelper;
    }
  } catch {}

  const lines: string[] = [];
  lines.push("Authentication Status");
  lines.push("");

  // Show OAuth status for all providers
  const oauthStatuses = getAllOAuthStatuses();
  lines.push("OAuth:");
  let hasAnyOAuth = false;
  for (const s of oauthStatuses) {
    const providerTokens = loadOAuthTokens(s.provider);
    if (providerTokens) {
      hasAnyOAuth = true;
      const expired = isOAuthExpired(providerTokens);
      lines.push(`  ${s.name}: ${expired ? "✗ expired" : "✓ active"}`);
      if (providerTokens.expires_at) {
        lines.push(`    Expires: ${new Date(providerTokens.expires_at).toLocaleString()}`);
      }
      lines.push(`    Refresh token: ${providerTokens.refresh_token ? "available" : "none"}`);
    }
  }
  if (!hasAnyOAuth) {
    lines.push("  Not logged in — use --login to authenticate");
  }

  lines.push("");
  lines.push("API Key Helper (dynamic):");
  if (apiKeyHelper) {
    lines.push(`  ✓ Script: ${apiKeyHelper}`);
    lines.push(`  Key is fetched by running this script on every startup`);
  } else {
    lines.push("  Not configured");
    lines.push("  Set with: /config set api-key-helper ~/path/to/script.sh");
  }

  lines.push("");
  lines.push("Manually stored API keys:");
  if (apiKeys && Object.keys(apiKeys).length > 0) {
    for (const [provider, key] of Object.entries(apiKeys)) {
      const masked = key.slice(0, 8) + "..." + key.slice(-4);
      lines.push(`  ✓ ${provider}: ${masked}  (saved via /config set api-key)`);
    }
  } else {
    lines.push("  None");
    lines.push("  Set with: /config set api-key <your-key>");
  }

  lines.push("");
  lines.push("Environment variables:");
  const envVars: [string, string | undefined][] = [
    ["ANTHROPIC_API_KEY", process.env.ANTHROPIC_API_KEY],
    ["OPENAI_API_KEY", process.env.OPENAI_API_KEY],
    ["GOOGLE_API_KEY", process.env.GOOGLE_API_KEY],
  ];
  let hasEnvKey = false;
  for (const [name, value] of envVars) {
    if (value) {
      hasEnvKey = true;
      const masked = value.slice(0, 8) + "..." + value.slice(-4);
      lines.push(`  ✓ ${name}: ${masked}`);
    }
  }
  if (!hasEnvKey) lines.push("  None");

  return lines.join("\n");
}
