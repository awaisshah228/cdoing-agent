/**
 * OAuth 2.0 (PKCE) — Multi-Provider Shared Core Module
 *
 * Supports OAuth for multiple providers:
 *   - Anthropic (Claude) — PKCE flow with claude.ai
 *   - GitHub Copilot — Device flow with github.com
 *   - Google — OAuth2 with accounts.google.com
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

// ── Provider OAuth Configs ────────────────────────────────

/** OAuth provider configuration */
export interface OAuthProviderConfig {
  id: string;
  name: string;
  authUrl: string;
  tokenUrl: string;
  redirectUri: string;
  clientId: string;
  scopes: string;
  /** Whether to use PKCE (S256). Default: true */
  usePkce?: boolean;
  /** Additional auth URL parameters */
  extraParams?: Record<string, string>;
  /** Default model to use with OAuth for this provider */
  defaultModel?: string;
  /** All models available via OAuth for this provider (first is default) */
  models?: Array<{ id: string; name: string; hint?: string }>;
}

/** Built-in OAuth provider configs */
const OAUTH_PROVIDERS: Record<string, OAuthProviderConfig> = {
  anthropic: {
    id: "anthropic",
    name: "Anthropic (Claude)",
    authUrl: "https://claude.ai/oauth/authorize",
    tokenUrl: "https://console.anthropic.com/v1/oauth/token",
    redirectUri: "https://console.anthropic.com/oauth/code/callback",
    clientId: "9d1c250a-e61b-44d9-88ed-5944d1962f5e",
    scopes: "org:create_api_key user:profile user:inference",
    usePkce: true,
    extraParams: { code: "true" },
    defaultModel: "claude-haiku-4-5-20251001",
    models: [
      { id: "claude-haiku-4-5-20251001", name: "Claude Haiku 4.5", hint: "fastest · free tier" },
    ],
  },
  "openai-codex": {
    id: "openai-codex",
    name: "OpenAI Codex (ChatGPT)",
    authUrl: "https://auth.openai.com/oauth/authorize",
    tokenUrl: "https://auth.openai.com/oauth/token",
    redirectUri: "https://console.anthropic.com/oauth/code/callback",
    clientId: "app_EMoamEEZ73f0CkXaXp7hrann",
    scopes: "openid profile email offline_access",
    usePkce: true,
    defaultModel: "gpt-5.1-codex",
    models: [
      { id: "gpt-5.1-codex", name: "GPT-5.1 Codex", hint: "recommended" },
      { id: "gpt-5.1-codex-mini", name: "GPT-5.1 Codex Mini", hint: "fast" },
      { id: "gpt-5.1-codex-max", name: "GPT-5.1 Codex Max", hint: "most capable" },
      { id: "gpt-5.2-codex", name: "GPT-5.2 Codex", hint: "latest" },
      { id: "gpt-5.3-codex", name: "GPT-5.3 Codex", hint: "latest" },
      { id: "gpt-5.2", name: "GPT-5.2", hint: "general" },
      { id: "gpt-5.4", name: "GPT-5.4", hint: "newest" },
    ],
  },
  "github-copilot": {
    id: "github-copilot",
    name: "GitHub Copilot",
    authUrl: "https://github.com/login/device/code",
    tokenUrl: "https://github.com/login/oauth/access_token",
    redirectUri: "",
    clientId: "Iv1.b507a08c87ecfe98",
    scopes: "read:user",
    usePkce: false,
    defaultModel: "claude-sonnet-4",
    models: [
      { id: "claude-sonnet-4", name: "Claude Sonnet 4", hint: "Anthropic · recommended" },
      { id: "claude-sonnet-4.5", name: "Claude Sonnet 4.5", hint: "Anthropic · latest" },
      { id: "claude-haiku-4.5", name: "Claude Haiku 4.5", hint: "Anthropic · fast" },
      { id: "gpt-4o", name: "GPT-4o", hint: "OpenAI · vision" },
      { id: "gpt-4.1", name: "GPT-4.1", hint: "OpenAI · latest" },
      { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro", hint: "Google · capable" },
      { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash", hint: "Google · fast" },
      { id: "o3-mini", name: "o3 Mini", hint: "OpenAI · reasoning" },
    ],
  },
  google: {
    id: "google",
    name: "Google",
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    redirectUri: "urn:ietf:wg:oauth:2.0:oob",
    clientId: "",
    scopes: "https://www.googleapis.com/auth/cloud-platform",
    usePkce: true,
    defaultModel: "gemini-2.5-flash",
    models: [
      { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash", hint: "recommended · fast" },
      { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro", hint: "most capable" },
      { id: "gemini-2.0-flash", name: "Gemini 2.0 Flash", hint: "stable" },
      { id: "gemini-1.5-pro", name: "Gemini 1.5 Pro", hint: "1M context" },
      { id: "gemini-1.5-flash", name: "Gemini 1.5 Flash", hint: "fast" },
    ],
  },
};

/**
 * Get OAuth config for a provider. Returns null if provider doesn't support OAuth.
 */
export function getOAuthProvider(provider: string): OAuthProviderConfig | null {
  return OAUTH_PROVIDERS[provider.toLowerCase()] || null;
}

/**
 * Get all providers that support OAuth.
 */
export function getOAuthProviders(): OAuthProviderConfig[] {
  return Object.values(OAUTH_PROVIDERS);
}

/**
 * Check if a provider supports OAuth.
 */
export function supportsOAuth(provider: string): boolean {
  return provider.toLowerCase() in OAUTH_PROVIDERS;
}

// ── Types ────────────────────────────────────────────────

export interface OAuthTokens {
  access_token: string;
  refresh_token?: string;
  expires_at?: number;
  token_type: string;
  /** Which provider these tokens belong to */
  provider?: string;
}

/** Multi-provider token store — maps provider → tokens */
interface TokenStore {
  [provider: string]: OAuthTokens & { saved_at: number };
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

// ── Multi-provider token store ────────────────────────────

function loadTokenStore(): TokenStore {
  const raw = loadSecret();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    // Migration: if old single-token format, wrap as "anthropic"
    if (parsed.access_token && !parsed.anthropic) {
      return { anthropic: { ...parsed, provider: "anthropic", saved_at: parsed.saved_at || Date.now() } };
    }
    return parsed as TokenStore;
  } catch {
    return {};
  }
}

function saveTokenStore(store: TokenStore): void {
  storeSecret(JSON.stringify(store));
}

// ── Token storage (provider-aware) ────────────────────────

export function saveOAuthTokens(tokens: OAuthTokens, provider: string = "anthropic"): void {
  const store = loadTokenStore();
  store[provider] = { ...tokens, provider, saved_at: Date.now() };
  saveTokenStore(store);
}

export function loadOAuthTokens(provider: string = "anthropic"): OAuthTokens | null {
  const store = loadTokenStore();
  const entry = store[provider];
  if (!entry?.access_token) return null;
  return entry;
}

export function clearOAuthTokens(provider?: string): void {
  if (!provider) {
    // Clear all
    deleteSecret();
    return;
  }
  const store = loadTokenStore();
  delete store[provider];
  if (Object.keys(store).length === 0) {
    deleteSecret();
  } else {
    saveTokenStore(store);
  }
}

/**
 * Full logout — clears OAuth tokens and stored API keys for a provider (or all).
 * Returns a summary message. Both CLI and TUI should call this for /logout.
 */
export function fullLogout(provider?: string): string {
  // Clear OAuth tokens
  clearOAuthTokens(provider);

  // Clear stored API keys from ~/.cdoing/config.json
  try {
    const configPath = path.join(os.homedir(), ".cdoing", "config.json");
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      if (config.apiKeys) {
        if (provider) {
          delete config.apiKeys[provider];
        } else {
          delete config.apiKeys;
        }
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
      }
    }
  } catch { /* ignore config errors */ }

  const target = provider || "all providers";
  return `Logged out (${target}). OAuth tokens and stored API keys cleared.\nRun /setup to configure a new API key or log in again.`;
}

export function isOAuthExpired(tokens: OAuthTokens): boolean {
  if (!tokens.expires_at) return false;
  return Date.now() >= tokens.expires_at;
}

// ── Token refresh (provider-aware) ────────────────────────

export async function refreshAccessToken(
  refreshToken: string,
  provider: string = "anthropic",
): Promise<OAuthTokens | null> {
  const config = OAUTH_PROVIDERS[provider];
  if (!config) return null;

  try {
    const response = await fetch(config.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: config.clientId,
      }).toString(),
    });

    if (!response.ok) return null;

    const data = (await response.json()) as Record<string, unknown>;
    const tokens: OAuthTokens = {
      access_token: data.access_token as string,
      refresh_token: (data.refresh_token as string) || refreshToken,
      expires_at: data.expires_in ? Date.now() + (data.expires_in as number) * 1000 : undefined,
      token_type: (data.token_type as string) || "Bearer",
      provider,
    };

    saveOAuthTokens(tokens, provider);
    return tokens;
  } catch {
    return null;
  }
}

// ── Resolve token (with auto-refresh) ────────────────────

export async function resolveOAuthToken(provider: string = "anthropic"): Promise<string | null> {
  const tokens = loadOAuthTokens(provider);
  if (!tokens) return null;

  if (isOAuthExpired(tokens) && tokens.refresh_token) {
    const refreshed = await refreshAccessToken(tokens.refresh_token, provider);
    return refreshed ? refreshed.access_token : null;
  }

  return tokens.access_token;
}

// ── OAuth URL generation (provider-aware) ─────────────────

export function generateOAuthUrl(provider: string = "anthropic"): { url: string; codeVerifier: string } {
  const config = OAUTH_PROVIDERS[provider];
  if (!config) throw new Error(`Provider "${provider}" does not support OAuth`);

  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);

  const params = new URLSearchParams({
    client_id: config.clientId,
    response_type: "code",
    redirect_uri: config.redirectUri,
    scope: config.scopes,
    ...(config.usePkce !== false ? {
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
    } : {}),
    state: codeVerifier,
    ...(config.extraParams || {}),
  });

  return { url: `${config.authUrl}?${params.toString()}`, codeVerifier };
}

// ── Code exchange (provider-aware) ────────────────────────

export async function exchangeOAuthCode(
  code: string,
  codeVerifier: string,
  provider: string = "anthropic",
): Promise<OAuthTokens> {
  const config = OAUTH_PROVIDERS[provider];
  if (!config) throw new Error(`Provider "${provider}" does not support OAuth`);

  const splits = code.split("#");
  const body: Record<string, string> = {
    code: splits[0],
    grant_type: "authorization_code",
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
  };

  // PKCE providers include code_verifier
  if (config.usePkce !== false) {
    body.code_verifier = codeVerifier;
  }

  // Anthropic uses state differently
  if (provider === "anthropic") {
    body.state = splits[1] || codeVerifier;
  }

  const response = await fetch(config.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
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
    provider,
  };

  saveOAuthTokens(tokens, provider);
  return tokens;
}

// ── Status helper (provider-aware) ────────────────────────

export function getOAuthStatus(provider: string = "anthropic"): {
  status: "none" | "active" | "expired";
  expiresAt?: number;
  provider: string;
} {
  const tokens = loadOAuthTokens(provider);
  if (!tokens) return { status: "none", provider };
  if (isOAuthExpired(tokens)) return { status: "expired", expiresAt: tokens.expires_at, provider };
  return { status: "active", expiresAt: tokens.expires_at, provider };
}

/**
 * Get OAuth status for all configured providers.
 */
export function getAllOAuthStatuses(): Array<{
  provider: string;
  name: string;
  status: "none" | "active" | "expired";
  expiresAt?: number;
}> {
  return Object.values(OAUTH_PROVIDERS).map((config) => {
    const status = getOAuthStatus(config.id);
    return { ...status, name: config.name };
  });
}
