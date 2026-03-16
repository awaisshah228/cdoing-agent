/**
 * Credential Manager — Stores API keys and OAuth tokens for the remote agent.
 *
 * Credentials are stored separately from the coding agent (@cdoing/core) to
 * allow different auth for the personal assistant vs coding agent:
 *
 *   ~/.cdoing/remote-credentials.json  — API keys (encrypted at rest)
 *   ~/.cdoing/remote-oauth.json        — OAuth tokens
 *
 * Supports:
 *   - Claude OAuth (via @cdoing/core's PKCE flow)
 *   - Manual API keys (Anthropic, OpenAI, Google)
 *   - Separate keys for assistant model vs coding model
 *   - Auto-resolution: OAuth → config file → env var
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

// ── Paths ───────────────────────────────────────────────────────────────

const CONFIG_DIR = path.join(os.homedir(), ".cdoing");
const CREDS_FILE = path.join(CONFIG_DIR, "remote-credentials.json");

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

/** Derive an encryption key from machine-specific info. */
function deriveKey(): Buffer {
  const seed = os.hostname() + os.userInfo().username + "remote-agent";
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

    // 2. Try OAuth for Anthropic
    if (provider === "anthropic") {
      try {
        const { resolveOAuthToken } = await import("@cdoing/core");
        const token = await resolveOAuthToken();
        if (token) return token;
      } catch {
        // @cdoing/core may not have OAuth configured
      }
    }

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

  // ── OAuth ─────────────────────────────────────────────────────────────

  /**
   * Run the Claude OAuth login flow.
   * Opens a browser for authentication and returns the tokens.
   */
  async oauthLogin(): Promise<{ accessToken: string; expiresAt?: number }> {
    const { generateOAuthUrl, exchangeOAuthCode } = await import("@cdoing/core");
    const { url, codeVerifier } = generateOAuthUrl();

    // Open browser
    const { exec } = await import("child_process");
    const platform = process.platform;
    const cmd = platform === "darwin" ? `open "${url}"`
      : platform === "win32" ? `start "" "${url}"`
      : `xdg-open "${url}"`;

    exec(cmd, () => {}); // best effort

    console.log("\n  Opening browser for Claude OAuth login...");
    console.log(`  If it doesn't open, visit:\n  ${url}\n`);

    // Prompt for code
    const readline = await import("readline");
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const code = await new Promise<string>((resolve) => {
      rl.question("  Paste the authorization code here: ", (a) => {
        rl.close();
        resolve(a.trim());
      });
    });

    if (!code) throw new Error("No authorization code provided");
    const tokens = await exchangeOAuthCode(code, codeVerifier);

    // Mark OAuth as enabled
    this.creds.oauth.anthropic = { enabled: true, provider: "anthropic" };
    this.save();

    return {
      accessToken: tokens.access_token,
      expiresAt: tokens.expires_at,
    };
  }

  /**
   * Get OAuth status.
   */
  async getOAuthStatus(): Promise<{ status: "none" | "active" | "expired"; expiresAt?: number }> {
    try {
      const { getOAuthStatus } = await import("@cdoing/core");
      return getOAuthStatus();
    } catch {
      return { status: "none" };
    }
  }

  /**
   * Logout from OAuth.
   */
  async oauthLogout(): Promise<void> {
    try {
      const { clearOAuthTokens } = await import("@cdoing/core");
      clearOAuthTokens();
    } catch {}
    delete this.creds.oauth.anthropic;
    this.save();
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
    if (!fs.existsSync(CONFIG_DIR)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
    }
    this.creds.updatedAt = new Date().toISOString();
    const encrypted = encrypt(JSON.stringify(this.creds));
    fs.writeFileSync(CREDS_FILE, encrypted, { mode: 0o600 });
  }
}
