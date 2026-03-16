/**
 * Secret Key / Auth Token Management
 *
 * Generates, stores, and validates secret keys for:
 *   - Gateway API authentication (Bearer token)
 *   - Dashboard access (URL token parameter)
 *   - Webhook signature verification
 *
 * Keys are stored in the config file or generated on first run.
 * Without a valid key, the API and dashboard are inaccessible.
 *
 * Usage:
 *   const key = generateSecretKey();       // Create new 256-bit key
 *   const ok = validateSecretKey(key);      // Check format
 *   saveSecretToConfig(key, configPath);    // Persist to config file
 */

import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";

// ── Key Generation ──────────────────────────────────────────────────────

/**
 * Generate a cryptographically secure random secret key.
 * Returns a 64-character hex string (256 bits of entropy).
 */
export function generateSecretKey(): string {
  return crypto.randomBytes(32).toString("hex");
}

/**
 * Generate a shorter, human-friendly token (32 chars).
 * Suitable for URL parameters and quick sharing.
 */
export function generateShortToken(): string {
  return crypto.randomBytes(16).toString("hex");
}

// ── Validation ──────────────────────────────────────────────────────────

/**
 * Validate that a string looks like a valid secret key.
 * Must be at least 16 hex characters.
 */
export function validateSecretKey(key: string): boolean {
  return /^[a-f0-9]{16,}$/i.test(key);
}

// ── Config Persistence ──────────────────────────────────────────────────

/**
 * Save a generated secret key into the config file.
 * Creates the file if it doesn't exist.
 */
export function saveSecretToConfig(secret: string, configPath: string): void {
  let config: Record<string, unknown> = {};

  if (fs.existsSync(configPath)) {
    try {
      config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    } catch {
      // Start fresh if config is corrupt
    }
  }

  // Ensure gateway section exists
  if (!config.gateway || typeof config.gateway !== "object") {
    config.gateway = {};
  }
  (config.gateway as Record<string, unknown>).authToken = secret;

  // Ensure parent directory exists
  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
}

/**
 * Read the auth token from a config file (if present).
 */
export function readSecretFromConfig(configPath: string): string | null {
  if (!fs.existsSync(configPath)) return null;
  try {
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    return config?.gateway?.authToken || null;
  } catch {
    return null;
  }
}

// ── Timing-Safe Comparison ──────────────────────────────────────────────

/**
 * Compare two tokens in constant time to prevent timing attacks.
 */
export function secureCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
