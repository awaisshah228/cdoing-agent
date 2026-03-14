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

import * as http from "http";
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { execSync } from "child_process";
import chalk from "chalk";

const CONFIG_DIR = path.join(os.homedir(), ".cdoing");
const KEYCHAIN_SERVICE = "cdoing-agent";
const KEYCHAIN_ACCOUNT = "oauth-tokens";

// Claude OAuth endpoints (same as Claude Code)
const CLAUDE_AUTH_URL = "https://claude.ai/oauth/authorize";
const CLAUDE_TOKEN_URL = "https://claude.ai/oauth/token";
const CLAUDE_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const SCOPES = "org:create_api_key user:profile user:inference user:sessions:claude_code user:mcp_servers";

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

function generateState(): string {
  return crypto.randomBytes(32).toString("base64url");
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

export async function oauthLogin(): Promise<OAuthTokens> {
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  const state = generateState();

  return new Promise((resolve, reject) => {
    const server = http.createServer();

    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as { port: number };
      const port = address.port;
      const redirectUri = `http://localhost:${port}/callback`;

      const authParams = new URLSearchParams({
        code: "true",
        client_id: CLAUDE_CLIENT_ID,
        response_type: "code",
        redirect_uri: redirectUri,
        scope: SCOPES,
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
        state,
      });

      const authUrl = `${CLAUDE_AUTH_URL}?${authParams.toString()}`;

      console.log();
      console.log(chalk.bold.cyan("  Claude OAuth Login"));
      console.log(chalk.dim("  Opening browser for authentication...\n"));
      console.log(chalk.white("  If the browser doesn't open, visit:"));
      console.log(chalk.dim(`  ${authUrl}\n`));
      console.log(chalk.dim("  Waiting for authorization...\n"));

      // Open browser
      openBrowser(authUrl);

      // Handle callback
      server.on("request", async (req, res) => {
        const parsedUrl = new URL(req.url || "", `http://localhost:${port}`);

        if (parsedUrl.pathname !== "/callback") {
          res.writeHead(404);
          res.end("Not found");
          return;
        }

        const query = Object.fromEntries(parsedUrl.searchParams);

        // Verify state
        if (query.state !== state) {
          res.writeHead(400);
          res.end("Invalid state parameter. Please try again.");
          server.close();
          reject(new Error("OAuth state mismatch"));
          return;
        }

        if (query.error) {
          const errorMsg = `${query.error}: ${query.error_description || "Authorization denied"}`;
          res.writeHead(400);
          res.end(`Authorization failed: ${errorMsg}`);
          server.close();
          reject(new Error(errorMsg));
          return;
        }

        const code = query.code;
        if (!code) {
          res.writeHead(400);
          res.end("No authorization code received.");
          server.close();
          reject(new Error("No authorization code"));
          return;
        }

        // Exchange code for tokens (server-side with browser-like headers)
        try {
          const tokenBody = new URLSearchParams({
            grant_type: "authorization_code",
            code,
            redirect_uri: redirectUri,
            client_id: CLAUDE_CLIENT_ID,
            code_verifier: codeVerifier,
          });

          const tokenResponse = await fetch(CLAUDE_TOKEN_URL, {
            method: "POST",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
              "Accept": "application/json",
              "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
              "Origin": "https://claude.ai",
              "Referer": "https://claude.ai/",
            },
            body: tokenBody.toString(),
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

          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(`<!DOCTYPE html>
<html><body style="font-family:system-ui;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#1a1a2e;color:#e0e0e0">
<div style="text-align:center"><h1 style="color:#00d4aa">✓ Logged in to Cdoing Agent</h1>
<p style="color:#888;margin-top:.5rem">You can close this tab and return to your terminal.</p></div>
</body></html>`);

          server.close();
          resolve(tokens);
        } catch (err) {
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(`<!DOCTYPE html>
<html><body style="font-family:system-ui;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#1a1a2e;color:#e0e0e0">
<div style="text-align:center"><h1 style="color:#ff6b6b">✗ Login failed</h1>
<p style="color:#888;margin-top:.5rem">${(err as Error).message}</p>
<p style="color:#666;margin-top:1rem">Try again with <code>--login</code></p></div>
</body></html>`);
          server.close();
          reject(err);
        }
      });

      // Timeout after 2 minutes
      setTimeout(() => {
        server.close();
        reject(new Error("OAuth login timed out after 2 minutes"));
      }, 120_000);
    });
  });
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

export function oauthLogout(): void {
  clearOAuthTokens();
  console.log(chalk.green("\n  Logged out. OAuth tokens cleared.\n"));
}

// ── Status ──────────────────────────────────────────────────

export function oauthStatus(): void {
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

  console.log(chalk.bold("\n  Authentication Status\n"));

  // Show OAuth status
  console.log(chalk.cyan("  OAuth (Claude):"));
  if (tokens) {
    const expired = isOAuthExpired(tokens);
    const statusIcon = expired ? chalk.red("✗") : chalk.green("✓");
    const statusText = expired ? chalk.red("expired") : chalk.green("active");

    console.log(`    ${statusIcon} Token: ${statusText}`);
    if (tokens.expires_at) {
      const expiresAt = new Date(tokens.expires_at).toLocaleString();
      console.log(chalk.dim(`    Expires: ${expiresAt}`));
    }
    console.log(chalk.dim(`    Refresh: ${tokens.refresh_token ? "available" : "none"}`));
  } else {
    console.log(chalk.dim("    Not logged in"));
    console.log(chalk.dim("    Run /login to authenticate"));
  }

  // Show stored API keys
  console.log();
  console.log(chalk.cyan("  API Keys (stored):"));
  if (apiKeys && Object.keys(apiKeys).length > 0) {
    for (const [provider, key] of Object.entries(apiKeys)) {
      const masked = key.slice(0, 8) + "..." + key.slice(-4);
      console.log(`    ${chalk.green("✓")} ${provider}: ${chalk.dim(masked)}`);
    }
  } else {
    console.log(chalk.dim("    No stored API keys"));
  }

  // Show environment variables
  console.log();
  console.log(chalk.cyan("  Environment variables:"));
  const envVars = [
    ["ANTHROPIC_API_KEY", process.env.ANTHROPIC_API_KEY],
    ["OPENAI_API_KEY", process.env.OPENAI_API_KEY],
    ["GOOGLE_API_KEY", process.env.GOOGLE_API_KEY],
  ];
  let hasEnvKey = false;
  for (const [name, value] of envVars) {
    if (value) {
      hasEnvKey = true;
      const masked = value.slice(0, 8) + "..." + value.slice(-4);
      console.log(`    ${chalk.green("✓")} ${name}: ${chalk.dim(masked)}`);
    }
  }
  if (!hasEnvKey) {
    console.log(chalk.dim("    No API keys in environment"));
  }

  console.log();
}
