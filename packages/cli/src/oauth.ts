/**
 * Claude OAuth Login
 *
 * Implements OAuth 2.0 Authorization Code flow with PKCE
 * for Claude login. Uses the same OAuth endpoints as Claude Code.
 *
 * Credential storage:
 *  - macOS: encrypted Keychain via `security` CLI
 *  - Linux: libsecret via `secret-tool` if available, else file fallback
 *  - Windows: Windows Credential Manager via `cmdkey`, else file fallback
 *
 * Flow:
 *  1. Generate PKCE code verifier + challenge
 *  2. Start a local HTTP server on a random port
 *  3. Open browser to Claude's authorization URL
 *  4. User authorizes → browser redirects to localhost with auth code
 *  5. Exchange code for access token + refresh token
 *  6. Store tokens securely in OS credential store
 */

import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { execSync } from "child_process";
import chalk from "chalk";

const CONFIG_DIR = path.join(os.homedir(), ".cdoing");
const KEYCHAIN_SERVICE = "cdoing-agent";
const KEYCHAIN_ACCOUNT = "oauth-tokens";

// Claude OAuth endpoints (matching Claude Code CLI)
const CLAUDE_AUTH_URL = "https://claude.ai/oauth/authorize";
const CLAUDE_TOKEN_URL = "https://console.anthropic.com/v1/oauth/token";
const CLAUDE_REDIRECT_URI = "https://console.anthropic.com/oauth/code/callback";
const CLAUDE_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const SCOPES = "org:create_api_key user:profile user:inference";

export interface OAuthTokens {
  access_token: string;
  refresh_token?: string;
  expires_at?: number;
  token_type: string;
}

// ── PKCE helpers ────────────────────────────────────────────

function generateCodeVerifier(): string {
  return crypto.randomBytes(32).toString("base64url");
}

function generateCodeChallenge(verifier: string): string {
  return crypto.createHash("sha256").update(verifier).digest("base64url");
}


// ── Secure credential storage ───────────────────────────────

/**
 * Store a secret in the OS credential manager.
 * macOS: Keychain, Linux: secret-tool, Windows: cmdkey.
 * Falls back to encrypted file if native store unavailable.
 */
function storeSecret(value: string): void {
  const platform = process.platform;

  try {
    if (platform === "darwin") {
      // macOS Keychain
      try {
        // Delete existing entry first (ignore errors if not found)
        execSync(
          `security delete-generic-password -s "${KEYCHAIN_SERVICE}" -a "${KEYCHAIN_ACCOUNT}" 2>/dev/null`,
          { stdio: "ignore" },
        );
      } catch {}
      execSync(
        `security add-generic-password -s "${KEYCHAIN_SERVICE}" -a "${KEYCHAIN_ACCOUNT}" -w "${value.replace(/"/g, '\\"')}" -U`,
        { stdio: "ignore" },
      );
      return;
    }

    if (platform === "linux") {
      // Try libsecret (GNOME/KDE)
      try {
        execSync(
          `echo -n "${value.replace(/"/g, '\\"')}" | secret-tool store --label="Cdoing Agent OAuth" service "${KEYCHAIN_SERVICE}" account "${KEYCHAIN_ACCOUNT}"`,
          { stdio: "ignore" },
        );
        return;
      } catch {}
    }

    if (platform === "win32") {
      // Windows Credential Manager
      try {
        execSync(
          `cmdkey /generic:"${KEYCHAIN_SERVICE}" /user:"${KEYCHAIN_ACCOUNT}" /pass:"${value.replace(/"/g, '""')}"`,
          { stdio: "ignore" },
        );
        return;
      } catch {}
    }
  } catch {}

  // Fallback: encrypted file storage
  storeSecretToFile(value);
}

/**
 * Retrieve a secret from the OS credential manager.
 */
function loadSecret(): string | null {
  const platform = process.platform;

  try {
    if (platform === "darwin") {
      const result = execSync(
        `security find-generic-password -s "${KEYCHAIN_SERVICE}" -a "${KEYCHAIN_ACCOUNT}" -w 2>/dev/null`,
        { encoding: "utf-8" },
      );
      return result.trim();
    }

    if (platform === "linux") {
      try {
        const result = execSync(
          `secret-tool lookup service "${KEYCHAIN_SERVICE}" account "${KEYCHAIN_ACCOUNT}" 2>/dev/null`,
          { encoding: "utf-8" },
        );
        return result.trim() || null;
      } catch {}
    }

    if (platform === "win32") {
      try {
        const result = execSync(
          `cmdkey /list:"${KEYCHAIN_SERVICE}"`,
          { encoding: "utf-8" },
        );
        if (result.includes(KEYCHAIN_SERVICE)) {
          // cmdkey doesn't expose password directly, use file fallback
          return loadSecretFromFile();
        }
      } catch {}
    }
  } catch {}

  // Fallback: file storage
  return loadSecretFromFile();
}

/**
 * Delete a secret from the OS credential manager.
 */
function deleteSecret(): void {
  const platform = process.platform;

  try {
    if (platform === "darwin") {
      execSync(
        `security delete-generic-password -s "${KEYCHAIN_SERVICE}" -a "${KEYCHAIN_ACCOUNT}" 2>/dev/null`,
        { stdio: "ignore" },
      );
    } else if (platform === "linux") {
      execSync(
        `secret-tool clear service "${KEYCHAIN_SERVICE}" account "${KEYCHAIN_ACCOUNT}" 2>/dev/null`,
        { stdio: "ignore" },
      );
    } else if (platform === "win32") {
      execSync(`cmdkey /delete:"${KEYCHAIN_SERVICE}" 2>nul`, { stdio: "ignore" });
    }
  } catch {}

  // Also clean up file fallback
  deleteSecretFile();
}

// ── File-based fallback (encrypted with machine-derived key) ──

function deriveFileKey(): Buffer {
  const machineId = os.hostname() + os.userInfo().username;
  return crypto.createHash("sha256").update(machineId).digest();
}

function getSecretFilePath(): string {
  return path.join(CONFIG_DIR, ".oauth-tokens.enc");
}

function storeSecretToFile(value: string): void {
  if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
  const key = deriveFileKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
  let encrypted = cipher.update(value, "utf-8", "hex");
  encrypted += cipher.final("hex");
  const data = iv.toString("hex") + ":" + encrypted;
  fs.writeFileSync(getSecretFilePath(), data, { mode: 0o600 });
}

function loadSecretFromFile(): string | null {
  try {
    const filePath = getSecretFilePath();
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, "utf-8");
    const [ivHex, encrypted] = raw.split(":");
    if (!ivHex || !encrypted) return null;
    const key = deriveFileKey();
    const iv = Buffer.from(ivHex, "hex");
    const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
    let decrypted = decipher.update(encrypted, "hex", "utf-8");
    decrypted += decipher.final("utf-8");
    return decrypted;
  } catch {
    return null;
  }
}

function deleteSecretFile(): void {
  try {
    const filePath = getSecretFilePath();
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {}
}

// ── Token storage (uses secure credential store) ────────────

export function saveOAuthTokens(tokens: OAuthTokens): void {
  const payload = JSON.stringify({
    ...tokens,
    saved_at: Date.now(),
  });
  storeSecret(payload);
}

export function loadOAuthTokens(): OAuthTokens | null {
  const raw = loadSecret();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as OAuthTokens;
    if (!parsed.access_token) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearOAuthTokens(): void {
  deleteSecret();
}

export function isOAuthExpired(tokens: OAuthTokens): boolean {
  if (!tokens.expires_at) return false;
  return Date.now() >= tokens.expires_at;
}

// ── Refresh token ───────────────────────────────────────────

export async function refreshAccessToken(refreshToken: string): Promise<OAuthTokens | null> {
  try {
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: CLAUDE_CLIENT_ID,
    });

    const response = await fetch(CLAUDE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    if (!response.ok) return null;

    const data = (await response.json()) as Record<string, unknown>;
    const tokens: OAuthTokens = {
      access_token: data.access_token as string,
      refresh_token: (data.refresh_token as string) || refreshToken,
      expires_at: data.expires_in
        ? Date.now() + (data.expires_in as number) * 1000
        : undefined,
      token_type: (data.token_type as string) || "Bearer",
    };

    saveOAuthTokens(tokens);
    return tokens;
  } catch {
    return null;
  }
}

// ── Resolve OAuth token (with auto-refresh) ─────────────────

export async function resolveOAuthToken(): Promise<string | null> {
  const tokens = loadOAuthTokens();
  if (!tokens) return null;

  if (isOAuthExpired(tokens) && tokens.refresh_token) {
    const refreshed = await refreshAccessToken(tokens.refresh_token);
    if (refreshed) return refreshed.access_token;
    return null;
  }

  return tokens.access_token;
}

// ── OAuth login flow ────────────────────────────────────────

/**
 * Generate the OAuth authorization URL + code verifier.
 * Call this first, open the URL in a browser, then pass the returned
 * code (from the redirect URL) to exchangeOAuthCode().
 */
export function generateOAuthUrl(): { url: string; codeVerifier: string } {
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);

  const authParams = new URLSearchParams({
    code: "true",
    client_id: CLAUDE_CLIENT_ID,
    response_type: "code",
    redirect_uri: CLAUDE_REDIRECT_URI,
    scope: SCOPES,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    state: codeVerifier,
  });

  return {
    url: `${CLAUDE_AUTH_URL}?${authParams.toString()}`,
    codeVerifier,
  };
}

/**
 * Exchange the authorization code (pasted from the browser redirect URL)
 * for OAuth tokens.  The code may be "code#state" — we split on "#".
 */
export async function exchangeOAuthCode(code: string, codeVerifier: string): Promise<OAuthTokens> {
  const splits = code.split("#");
  const tokenResponse = await fetch(CLAUDE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      code: splits[0],
      state: splits[1] || codeVerifier,
      grant_type: "authorization_code",
      client_id: CLAUDE_CLIENT_ID,
      redirect_uri: CLAUDE_REDIRECT_URI,
      code_verifier: codeVerifier,
    }),
  });

  if (!tokenResponse.ok) {
    const errText = await tokenResponse.text();
    throw new Error(`Token exchange failed (${tokenResponse.status}): ${errText.substring(0, 200)}`);
  }

  const tokenData = (await tokenResponse.json()) as Record<string, unknown>;
  const tokens: OAuthTokens = {
    access_token: tokenData.access_token as string,
    refresh_token: tokenData.refresh_token as string | undefined,
    expires_at: tokenData.expires_in
      ? Date.now() + (tokenData.expires_in as number) * 1000
      : undefined,
    token_type: (tokenData.token_type as string) || "Bearer",
  };

  saveOAuthTokens(tokens);
  return tokens;
}

/**
 * CLI (non-TUI) OAuth login — opens browser, prompts for pasted code via readline.
 */
export async function oauthLogin(): Promise<OAuthTokens> {
  const readline = await import("readline");
  const { url, codeVerifier } = generateOAuthUrl();

  console.log();
  console.log(chalk.bold.cyan("  Claude OAuth Login"));
  console.log(chalk.dim("  Opening browser for authentication...\n"));
  console.log(chalk.white("  If the browser doesn't open, visit:"));
  console.log(chalk.dim(`  ${url}\n`));

  openBrowser(url);

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const code = await new Promise<string>((resolve) => {
    rl.question(chalk.green("  Paste the authorization code here: "), (a) => {
      rl.close();
      resolve(a.trim());
    });
  });

  if (!code) throw new Error("No authorization code provided");
  return exchangeOAuthCode(code, codeVerifier);
}

// ── Browser opener ──────────────────────────────────────────

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

// ── Logout ──────────────────────────────────────────────────

export function oauthLogout(): string {
  clearOAuthTokens();
  return "Logged out. OAuth tokens cleared.";
}

// ── Status ──────────────────────────────────────────────────

export function oauthStatus(): string {
  const tokens = loadOAuthTokens();

  // Load stored config for API keys display
  const configPath = path.join(os.homedir(), ".cdoing", "config.json");
  let apiKeys: Record<string, string> | undefined;
  try {
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      apiKeys = config.apiKeys;
    }
  } catch {}

  const lines: string[] = [];
  lines.push("Authentication Status");
  lines.push("");

  // OAuth status
  lines.push("OAuth (Claude):");
  if (tokens) {
    const expired = isOAuthExpired(tokens);
    lines.push(`  ${expired ? "✗ expired" : "✓ active"}`);
    if (tokens.expires_at) {
      lines.push(`  Expires: ${new Date(tokens.expires_at).toLocaleString()}`);
    }
    lines.push(`  Refresh token: ${tokens.refresh_token ? "available" : "none"}`);
  } else {
    lines.push("  Not logged in — use /setup to authenticate");
  }

  // Stored API keys
  lines.push("");
  lines.push("Stored API keys:");
  if (apiKeys && Object.keys(apiKeys).length > 0) {
    for (const [provider, key] of Object.entries(apiKeys)) {
      const masked = key.slice(0, 8) + "..." + key.slice(-4);
      lines.push(`  ✓ ${provider}: ${masked}`);
    }
  } else {
    lines.push("  None");
  }

  // Environment variables
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
