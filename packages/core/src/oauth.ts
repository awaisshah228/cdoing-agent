/**
 * OAuth 2.0 (PKCE) for Claude — Shared Core Module
 *
 * All credential storage, token management, and OAuth flow logic lives here.
 * Both CLI and VS Code extension import from this module.
 *
 * Credential storage:
 *  - macOS: encrypted Keychain via `security` CLI
 *  - Linux: libsecret via `secret-tool` if available, else file fallback
 *  - Windows: Windows Credential Manager via `cmdkey`, else file fallback
 */

import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { execSync } from "child_process";

const CONFIG_DIR = path.join(os.homedir(), ".cdoing");
const KEYCHAIN_SERVICE = "cdoing-agent";
const KEYCHAIN_ACCOUNT = "oauth-tokens";

// Claude OAuth endpoints (matching Claude Code CLI)
const CLAUDE_AUTH_URL = "https://claude.ai/oauth/authorize";
const CLAUDE_TOKEN_URL = "https://console.anthropic.com/v1/oauth/token";
const CLAUDE_REDIRECT_URI = "https://console.anthropic.com/oauth/code/callback";
const CLAUDE_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const SCOPES = "org:create_api_key user:profile user:inference";

// ── Types ────────────────────────────────────────────────

export interface OAuthTokens {
  access_token: string;
  refresh_token?: string;
  expires_at?: number;
  token_type: string;
}

// ── PKCE helpers ─────────────────────────────────────────

function generateCodeVerifier(): string {
  return crypto.randomBytes(32).toString("base64url");
}

function generateCodeChallenge(verifier: string): string {
  return crypto.createHash("sha256").update(verifier).digest("base64url");
}

// ── Secure credential storage ────────────────────────────

function storeSecret(value: string): void {
  const platform = process.platform;

  try {
    if (platform === "darwin") {
      try {
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
      try {
        execSync(
          `echo -n "${value.replace(/"/g, '\\"')}" | secret-tool store --label="Cdoing Agent OAuth" service "${KEYCHAIN_SERVICE}" account "${KEYCHAIN_ACCOUNT}"`,
          { stdio: "ignore" },
        );
        return;
      } catch {}
    }

    if (platform === "win32") {
      try {
        execSync(
          `cmdkey /generic:"${KEYCHAIN_SERVICE}" /user:"${KEYCHAIN_ACCOUNT}" /pass:"${value.replace(/"/g, '""')}"`,
          { stdio: "ignore" },
        );
        return;
      } catch {}
    }
  } catch {}

  storeSecretToFile(value);
}

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
          return loadSecretFromFile();
        }
      } catch {}
    }
  } catch {}

  return loadSecretFromFile();
}

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

  deleteSecretFile();
}

// ── File-based fallback (AES-256-CBC) ────────────────────

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
  fs.writeFileSync(getSecretFilePath(), iv.toString("hex") + ":" + encrypted, { mode: 0o600 });
}

function loadSecretFromFile(): string | null {
  try {
    const filePath = getSecretFilePath();
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, "utf-8");
    const [ivHex, encrypted] = raw.split(":");
    if (!ivHex || !encrypted) return null;
    const key = deriveFileKey();
    const decipher = crypto.createDecipheriv("aes-256-cbc", key, Buffer.from(ivHex, "hex"));
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

// ── Token storage ────────────────────────────────────────

export function saveOAuthTokens(tokens: OAuthTokens): void {
  storeSecret(JSON.stringify({ ...tokens, saved_at: Date.now() }));
}

export function loadOAuthTokens(): OAuthTokens | null {
  const raw = loadSecret();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as OAuthTokens;
    return parsed.access_token ? parsed : null;
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

// ── Token refresh ────────────────────────────────────────

export async function refreshAccessToken(refreshToken: string): Promise<OAuthTokens | null> {
  try {
    const response = await fetch(CLAUDE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: CLAUDE_CLIENT_ID,
      }).toString(),
    });

    if (!response.ok) return null;

    const data = (await response.json()) as Record<string, unknown>;
    const tokens: OAuthTokens = {
      access_token: data.access_token as string,
      refresh_token: (data.refresh_token as string) || refreshToken,
      expires_at: data.expires_in ? Date.now() + (data.expires_in as number) * 1000 : undefined,
      token_type: (data.token_type as string) || "Bearer",
    };

    saveOAuthTokens(tokens);
    return tokens;
  } catch {
    return null;
  }
}

// ── Resolve token (with auto-refresh) ────────────────────

export async function resolveOAuthToken(): Promise<string | null> {
  const tokens = loadOAuthTokens();
  if (!tokens) return null;

  if (isOAuthExpired(tokens) && tokens.refresh_token) {
    const refreshed = await refreshAccessToken(tokens.refresh_token);
    return refreshed ? refreshed.access_token : null;
  }

  return tokens.access_token;
}

// ── OAuth URL generation ─────────────────────────────────

export function generateOAuthUrl(): { url: string; codeVerifier: string } {
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);

  const params = new URLSearchParams({
    code: "true",
    client_id: CLAUDE_CLIENT_ID,
    response_type: "code",
    redirect_uri: CLAUDE_REDIRECT_URI,
    scope: SCOPES,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    state: codeVerifier,
  });

  return { url: `${CLAUDE_AUTH_URL}?${params.toString()}`, codeVerifier };
}

// ── Code exchange ────────────────────────────────────────

export async function exchangeOAuthCode(code: string, codeVerifier: string): Promise<OAuthTokens> {
  const splits = code.split("#");
  const response = await fetch(CLAUDE_TOKEN_URL, {
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

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Token exchange failed (${response.status}): ${errText.substring(0, 200)}`);
  }

  const data = (await response.json()) as Record<string, unknown>;
  const tokens: OAuthTokens = {
    access_token: data.access_token as string,
    refresh_token: data.refresh_token as string | undefined,
    expires_at: data.expires_in ? Date.now() + (data.expires_in as number) * 1000 : undefined,
    token_type: (data.token_type as string) || "Bearer",
  };

  saveOAuthTokens(tokens);
  return tokens;
}

// ── Status helper ────────────────────────────────────────

export function getOAuthStatus(): { status: "none" | "active" | "expired"; expiresAt?: number } {
  const tokens = loadOAuthTokens();
  if (!tokens) return { status: "none" };
  if (isOAuthExpired(tokens)) return { status: "expired", expiresAt: tokens.expires_at };
  return { status: "active", expiresAt: tokens.expires_at };
}
