/**
 * Credential Manager — Isolated credential store for the remote agent.
 *
 * IMPORTANT: This is completely SEPARATE from the coding agent CLI/VS Code.
 * The remote agent stores credentials in its own directory:
 *
 *   ~/.cdoing/remote/credentials.enc  — API keys (AES-256-CBC encrypted)
 *   ~/.cdoing/remote/oauth-tokens.enc — OAuth tokens (separate from CLI)
 *
 * Why separate?
 *   - The remote agent runs as a persistent daemon, not interactively.
 *   - The personal assistant and coding agent may use different providers/keys.
 *   - Logging out of the CLI should NOT affect the remote agent (and vice versa).
 *   - Security isolation: a compromise of one doesn't affect the other.
 *
 * Supports:
 *   - Claude OAuth (via @cdoing/core's PKCE flow, stored locally)
 *   - Manual API keys (Anthropic, OpenAI, Google, Ollama)
 *   - Separate keys for assistant model vs coding model
 *   - Auto-resolution chain: stored key → local OAuth → env var
 *
 * Usage:
 *   const creds = new CredentialManager();
 *   creds.saveApiKey("anthropic", "sk-...");
 *   creds.saveApiKey("openai", "sk-...", "coding");  // for coding model
 *   const key = await creds.resolveApiKey("anthropic");
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as crypto from "crypto";

// ── Paths (isolated from CLI/VS Code) ────────────────────────────────────

const REMOTE_DIR = path.join(os.homedir(), ".cdoing", "remote");
const CREDS_FILE = path.join(REMOTE_DIR, "credentials.enc");
const OAUTH_FILE = path.join(REMOTE_DIR, "oauth-tokens.enc");

// ── Types ───────────────────────────────────────────────────────────────

/** Stored credentials structure. */
interface StoredCredentials {
  /** API keys keyed by "provider" or "provider:role" (e.g., "anthropic", "openai:coding") */
  apiKeys: Record<string, string>;
  /** OAuth status per provider */
  oauth: Record<string, { enabled: boolean; provider: string }>;
  /** When credentials were last updated */
  updatedAt: string;
}

// ── Encryption Helpers ──────────────────────────────────────────────────

/** Derive an encryption key from machine-specific info (different salt from CLI). */
function deriveKey(): Buffer {
  const seed = os.hostname() + os.userInfo().username + "cdoing-remote-agent";
  return crypto.createHash("sha256").update(seed).digest();
}

/** Encrypt a string with AES-256-CBC. */
function encrypt(text: string): string {
  const key = deriveKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
  let encrypted = cipher.update(text, "utf-8", "hex");
  encrypted += cipher.final("hex");
  return iv.toString("hex") + ":" + encrypted;
}

/** Decrypt an AES-256-CBC encrypted string. */
function decrypt(data: string): string {
  const [ivHex, encrypted] = data.split(":");
  if (!ivHex || !encrypted) throw new Error("Invalid encrypted data");
  const key = deriveKey();
  const decipher = crypto.createDecipheriv("aes-256-cbc", key, Buffer.from(ivHex, "hex"));
  let decrypted = decipher.update(encrypted, "hex", "utf-8");
  decrypted += decipher.final("utf-8");
  return decrypted;
}

// ── Credential Manager ──────────────────────────────────────────────────

export class CredentialManager {
  private creds: StoredCredentials;

  constructor() {
    this.creds = this.load();
  }

  // ── API Keys ────────────────────────────────────────────────────────

  /**
   * Save an API key for a provider.
   * @param provider - Provider name (anthropic, openai, google)
   * @param key      - The API key
   * @param role     - "assistant" (default) or "coding" for the coding model
   */
  saveApiKey(provider: string, key: string, role: "assistant" | "coding" = "assistant"): void {
    const storageKey = role === "coding" ? `${provider}:coding` : provider;
    this.creds.apiKeys[storageKey] = key;
    this.save();
  }

  /**
   * Get a stored API key.
   * @param provider - Provider name
   * @param role     - "assistant" or "coding"
   */
  getApiKey(provider: string, role: "assistant" | "coding" = "assistant"): string | null {
    // Try role-specific key first, then fall back to general key
    if (role === "coding") {
      return this.creds.apiKeys[`${provider}:coding`] || this.creds.apiKeys[provider] || null;
    }
    return this.creds.apiKeys[provider] || null;
  }

  /**
   * Remove an API key.
   */
  removeApiKey(provider: string, role?: "assistant" | "coding"): void {
    const storageKey = role === "coding" ? `${provider}:coding` : provider;
    delete this.creds.apiKeys[storageKey];
    this.save();
  }

  /**
   * Resolve the API key for a provider with fallback chain:
   *   1. Stored key (role-specific)
   *   2. Stored key (general)
   *   3. OAuth token (if available via @cdoing/core)
   *   4. Environment variable
   */
  async resolveApiKey(provider: string, role: "assistant" | "coding" = "assistant"): Promise<string | null> {
    // 1. Stored role-specific key
    const stored = this.getApiKey(provider, role);
    if (stored) return stored;

    // 2. Try local OAuth token (remote agent's own store, NOT shared with CLI)
    const oauthToken = await this.resolveOAuthToken(provider);
    if (oauthToken) return oauthToken;

    // 3. Environment variable
    const envMap: Record<string, string> = {
      anthropic: "ANTHROPIC_API_KEY",
      openai: "OPENAI_API_KEY",
      google: "GOOGLE_API_KEY",
    };
    const envVar = envMap[provider];
    if (envVar && process.env[envVar]) return process.env[envVar]!;

    return null;
  }

  // ── OAuth (stored locally, NOT shared with CLI/VS Code) ─────────────

  /**
   * Run the OAuth login flow via @cdoing/core's PKCE helpers,
   * but store the tokens in the remote agent's own encrypted file.
   */
  async oauthLogin(provider: string = "anthropic"): Promise<{ accessToken: string; expiresAt?: number }> {
    const { startLocalOAuthServer, exchangeOAuthCode } = await import("@cdoing/core");

    const { url, codeVerifier, state, port, codePromise, close } = await startLocalOAuthServer(provider);

    // Open browser
    const { exec } = await import("child_process");
    const platform = process.platform;
    const cmd = platform === "darwin" ? `open "${url}"`
      : platform === "win32" ? `start "" "${url}"`
      : `xdg-open "${url}"`;

    exec(cmd, () => {}); // best effort

    console.log("\n  Opening browser for OAuth login...");
    console.log(`  If it doesn't open, visit:\n  ${url}\n`);

    let code: string;
    let usedLocalRedirect = true;

    try {
      code = await codePromise;
    } catch {
      close();
      usedLocalRedirect = false;
      // Fallback: manual code paste
      const readline = await import("readline");
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      code = await new Promise<string>((resolve) => {
        rl.question("  Paste the authorization code here: ", (a) => {
          rl.close();
          resolve(a.trim());
        });
      });
    }

    if (!code) throw new Error("No authorization code provided");

    const tokens = await exchangeOAuthCode(
      code,
      codeVerifier,
      provider,
      usedLocalRedirect ? `http://localhost:${port}/callback` : undefined,
      usedLocalRedirect ? state : undefined,
    );

    // Store tokens in the remote agent's own file (NOT the shared Keychain)
    this.saveOAuthTokens(provider, {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: tokens.expires_at,
      token_type: tokens.token_type || "Bearer",
    });

    this.creds.oauth[provider] = { enabled: true, provider };
    this.save();

    return {
      accessToken: tokens.access_token,
      expiresAt: tokens.expires_at,
    };
  }

  /**
   * Start an OAuth flow — returns the URL and helpers.
   * The TUI calls this, opens the browser itself, then calls completeOAuth().
   */
  async startOAuth(provider: string = "anthropic"): Promise<{
    url: string;
    codeVerifier: string;
    state: string;
    port: number;
    codePromise: Promise<string>;
    close: () => void;
  }> {
    const { startLocalOAuthServer } = await import("@cdoing/core");
    return startLocalOAuthServer(provider);
  }

  /**
   * Complete an OAuth flow — exchanges the code for tokens and stores
   * them in the remote agent's own encrypted file (NOT the CLI's store).
   */
  async completeOAuth(
    provider: string,
    code: string,
    codeVerifier: string,
    redirectUri?: string,
    state?: string,
  ): Promise<{ accessToken: string; expiresAt?: number }> {
    const { exchangeOAuthCode } = await import("@cdoing/core");

    const tokens = await exchangeOAuthCode(code, codeVerifier, provider, redirectUri, state);

    // Store in the remote agent's own file (NOT the CLI Keychain)
    this.saveOAuthTokens(provider, {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: tokens.expires_at,
      token_type: tokens.token_type || "Bearer",
    });

    this.creds.oauth[provider] = { enabled: true, provider };
    this.save();

    return {
      accessToken: tokens.access_token,
      expiresAt: tokens.expires_at,
    };
  }

  /**
   * Get OAuth status from the remote agent's own token store.
   */
  async getOAuthStatus(provider: string = "anthropic"): Promise<{ status: "none" | "active" | "expired"; expiresAt?: number }> {
    const tokens = this.loadOAuthTokens(provider);
    if (!tokens) return { status: "none" };
    if (tokens.expires_at && Date.now() >= tokens.expires_at) {
      return { status: "expired", expiresAt: tokens.expires_at };
    }
    return { status: "active", expiresAt: tokens.expires_at };
  }

  /**
   * Resolve an OAuth token for a provider, with auto-refresh.
   */
  async resolveOAuthToken(provider: string = "anthropic"): Promise<string | null> {
    const tokens = this.loadOAuthTokens(provider);
    if (!tokens) return null;

    // If expired and has refresh token, try refreshing
    if (tokens.expires_at && Date.now() >= tokens.expires_at && tokens.refresh_token) {
      try {
        const { refreshAccessToken } = await import("@cdoing/core");
        const refreshed = await refreshAccessToken(tokens.refresh_token, provider);
        if (refreshed) {
          this.saveOAuthTokens(provider, {
            access_token: refreshed.access_token,
            refresh_token: refreshed.refresh_token || tokens.refresh_token,
            expires_at: refreshed.expires_at,
            token_type: refreshed.token_type || "Bearer",
          });
          return refreshed.access_token;
        }
      } catch { /* refresh failed */ }
      return null;
    }

    return tokens.access_token;
  }

  /**
   * Logout from OAuth for the remote agent.
   */
  async oauthLogout(provider?: string): Promise<void> {
    if (provider) {
      delete this.creds.oauth[provider];
      this.deleteOAuthTokens(provider);
    } else {
      this.creds.oauth = {};
      // Delete the whole OAuth file
      try { if (fs.existsSync(OAUTH_FILE)) fs.unlinkSync(OAUTH_FILE); } catch {}
    }
    this.save();
  }

  // ── OAuth Token Storage (separate encrypted file) ──────────────────

  private saveOAuthTokens(provider: string, tokens: { access_token: string; refresh_token?: string; expires_at?: number; token_type: string }): void {
    const store = this.loadOAuthStore();
    store[provider] = { ...tokens, saved_at: Date.now() };
    this.saveOAuthStore(store);
  }

  private loadOAuthTokens(provider: string): { access_token: string; refresh_token?: string; expires_at?: number; token_type: string } | null {
    const store = this.loadOAuthStore();
    return store[provider] || null;
  }

  private deleteOAuthTokens(provider: string): void {
    const store = this.loadOAuthStore();
    delete store[provider];
    if (Object.keys(store).length === 0) {
      try { if (fs.existsSync(OAUTH_FILE)) fs.unlinkSync(OAUTH_FILE); } catch {}
    } else {
      this.saveOAuthStore(store);
    }
  }

  private loadOAuthStore(): Record<string, any> {
    if (!fs.existsSync(OAUTH_FILE)) return {};
    try {
      return JSON.parse(decrypt(fs.readFileSync(OAUTH_FILE, "utf-8")));
    } catch {
      return {};
    }
  }

  private saveOAuthStore(store: Record<string, any>): void {
    if (!fs.existsSync(REMOTE_DIR)) fs.mkdirSync(REMOTE_DIR, { recursive: true });
    fs.writeFileSync(OAUTH_FILE, encrypt(JSON.stringify(store)), { mode: 0o600 });
  }

  // ── Status ────────────────────────────────────────────────────────────

  /**
   * Get a summary of all stored credentials (keys are masked).
   */
  getStatus(): { apiKeys: Array<{ provider: string; role: string; masked: string }>; oauth: Record<string, unknown> } {
    const keys = Object.entries(this.creds.apiKeys).map(([k, v]) => {
      const [provider, role] = k.includes(":") ? k.split(":") : [k, "assistant"];
      const masked = v.length > 12 ? v.slice(0, 8) + "..." + v.slice(-4) : "****";
      return { provider, role, masked };
    });
    return { apiKeys: keys, oauth: this.creds.oauth };
  }

  // ── Persistence ───────────────────────────────────────────────────────

  private load(): StoredCredentials {
    if (!fs.existsSync(CREDS_FILE)) {
      return { apiKeys: {}, oauth: {}, updatedAt: new Date().toISOString() };
    }
    try {
      const raw = fs.readFileSync(CREDS_FILE, "utf-8");
      const decrypted = decrypt(raw);
      return JSON.parse(decrypted);
    } catch {
      return { apiKeys: {}, oauth: {}, updatedAt: new Date().toISOString() };
    }
  }

  private save(): void {
    if (!fs.existsSync(REMOTE_DIR)) {
      fs.mkdirSync(REMOTE_DIR, { recursive: true });
    }
    this.creds.updatedAt = new Date().toISOString();
    const encrypted = encrypt(JSON.stringify(this.creds));
    fs.writeFileSync(CREDS_FILE, encrypted, { mode: 0o600 });
  }
}
