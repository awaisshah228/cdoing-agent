/**
 * Sandbox Network — domain access checks, SSRF protection, and environment restrictions.
 *
 * Security features:
 *   - Private/internal IP blocking (SSRF protection)
 *   - Domain allowlisting with subdomain matching
 *   - Sensitive environment variable stripping (always, not just when network rules set)
 */

import * as net from "net";
import type { SandboxConfig, SandboxCheckResult } from "./types";

// ── SSRF Protection ──────────────────────────────────────────────────────────

/**
 * Private/internal IPv4 ranges that should NEVER be accessed.
 * Matches Claude Code's ssrfGuard.ts implementation.
 */
const BLOCKED_IPV4_RANGES: Array<{ base: number; mask: number; name: string }> = [
  // 10.0.0.0/8 — private
  { base: 0x0A000000, mask: 0xFF000000, name: "10.0.0.0/8 (private)" },
  // 172.16.0.0/12 — private
  { base: 0xAC100000, mask: 0xFFF00000, name: "172.16.0.0/12 (private)" },
  // 192.168.0.0/16 — private
  { base: 0xC0A80000, mask: 0xFFFF0000, name: "192.168.0.0/16 (private)" },
  // 169.254.0.0/16 — link-local / cloud metadata (AWS, GCP, Azure)
  { base: 0xA9FE0000, mask: 0xFFFF0000, name: "169.254.0.0/16 (link-local/cloud metadata)" },
  // 0.0.0.0/8 — current network
  { base: 0x00000000, mask: 0xFF000000, name: "0.0.0.0/8 (current network)" },
  // 127.0.0.0/8 — loopback (allowed for local dev but flagged)
  // NOTE: We allow loopback for local dev servers - only block in strict mode
];

/**
 * Convert an IPv4 address string to a 32-bit integer.
 */
function ipv4ToInt(ip: string): number {
  const parts = ip.split(".").map(Number);
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

/**
 * Check if an IPv4 address falls within a blocked range.
 */
function isBlockedIPv4(ip: string): string | null {
  const ipInt = ipv4ToInt(ip);
  for (const range of BLOCKED_IPV4_RANGES) {
    if ((ipInt & range.mask) === range.base) {
      return range.name;
    }
  }
  return null;
}

/**
 * Check if an IPv6 address is in a blocked range.
 */
function isBlockedIPv6(ip: string): string | null {
  const lower = ip.toLowerCase();

  // ::1 — loopback (allow for local dev)
  // We skip blocking loopback to support local dev servers

  // fc00::/7 — Unique Local Address (ULA)
  if (lower.startsWith("fc") || lower.startsWith("fd")) {
    return "fc00::/7 (unique local)";
  }

  // fe80::/10 — Link-local
  if (lower.startsWith("fe80")) {
    return "fe80::/10 (link-local)";
  }

  // ::ffff:x.x.x.x — IPv4-mapped IPv6
  const v4MappedMatch = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (v4MappedMatch) {
    return isBlockedIPv4(v4MappedMatch[1]);
  }

  return null;
}

/**
 * Check if a hostname resolves to a blocked IP address.
 * Returns the block reason, or null if the address is safe.
 */
export function isBlockedAddress(hostname: string): string | null {
  // Direct IP address check
  if (net.isIPv4(hostname)) {
    return isBlockedIPv4(hostname);
  }
  if (net.isIPv6(hostname)) {
    return isBlockedIPv6(hostname);
  }

  // For hostnames, we can't resolve DNS here (sync limitation).
  // The actual DNS resolution check should happen at fetch time.
  // Block known dangerous hostnames.
  const dangerousHosts = [
    "metadata.google.internal",      // GCP metadata
    "metadata.google.com",           // GCP metadata alt
    "169.254.169.254",               // AWS/Azure metadata IP
  ];
  if (dangerousHosts.includes(hostname.toLowerCase())) {
    return "Cloud metadata endpoint";
  }

  return null;
}

// ── Domain Access ────────────────────────────────────────────────────────────

/**
 * Check whether accessing a URL is allowed by sandbox network rules.
 * Includes SSRF protection against private/internal IPs.
 */
export function checkDomainAccess(
  url: string,
  config: SandboxConfig,
  sessionApprovedDomains: Set<string>,
): SandboxCheckResult {
  if (!config.enabled) return { allowed: true };

  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return { allowed: false, reason: `Sandbox: invalid URL "${url}"` };
  }

  // SSRF protection: block private/internal IPs
  const blockedReason = isBlockedAddress(hostname);
  if (blockedReason) {
    return {
      allowed: false,
      reason: `Sandbox: SSRF protection — blocked access to ${hostname} (${blockedReason}). This address is in a private/internal network range.`,
    };
  }

  // Check against allowed domains (exact or subdomain match)
  if (isDomainAllowed(hostname, config.network.allowedDomains)) {
    return { allowed: true };
  }

  // Check session-approved domains
  if (sessionApprovedDomains.has(hostname)) {
    return { allowed: true };
  }

  // Check if any parent domain was session-approved
  for (const approved of sessionApprovedDomains) {
    if (hostname.endsWith("." + approved)) {
      return { allowed: true };
    }
  }

  // Domain not allowed
  if (config.network.allowManagedDomainsOnly) {
    return {
      allowed: false,
      reason: `Sandbox: network access denied for domain "${hostname}" (not in allowedDomains and allowManagedDomainsOnly is enabled)`,
    };
  }

  // Prompt user for approval
  return {
    allowed: false,
    promptUser: true,
    domain: hostname,
    reason: `Sandbox: domain "${hostname}" is not in the allowed list`,
  };
}

/**
 * Check if a hostname matches any of the allowed domains.
 * Supports exact match and subdomain match (e.g., "github.com" matches "api.github.com").
 */
function isDomainAllowed(hostname: string, allowedDomains: string[]): boolean {
  for (const domain of allowedDomains) {
    if (hostname === domain || hostname.endsWith("." + domain)) {
      return true;
    }
  }
  return false;
}

// ── Environment Sandboxing ───────────────────────────────────────────────────

/**
 * Sensitive environment variables that should be stripped from subprocesses.
 * These can contain credentials that should not leak to child processes.
 *
 * Extended list matching Claude Code's approach — always strip these,
 * not just when network restrictions are active.
 */
const SENSITIVE_ENV_VARS = [
  // AWS
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
  "AWS_ACCESS_KEY_ID",
  // GitHub
  "GH_TOKEN",
  "GITHUB_TOKEN",
  "GITHUB_APP_PRIVATE_KEY",
  // NPM
  "NPM_TOKEN",
  "NPM_AUTH_TOKEN",
  // Docker
  "DOCKER_PASSWORD",
  "DOCKER_AUTH_CONFIG",
  // Cloud providers
  "GOOGLE_APPLICATION_CREDENTIALS",
  "AZURE_CLIENT_SECRET",
  "AZURE_TENANT_ID",
  // Database
  "DATABASE_URL",
  "DB_PASSWORD",
  "REDIS_PASSWORD",
  "MONGO_PASSWORD",
  // Generic
  "SECRET_KEY",
  "PRIVATE_KEY",
  "API_SECRET",
  "ENCRYPTION_KEY",
  // CI/CD
  "CI_JOB_TOKEN",
  "CIRCLE_TOKEN",
  "TRAVIS_TOKEN",
  // Vercel
  "VERCEL_TOKEN",
  // Slack
  "SLACK_TOKEN",
  "SLACK_WEBHOOK_URL",
  // Stripe
  "STRIPE_SECRET_KEY",
  // Twilio
  "TWILIO_AUTH_TOKEN",
  // SendGrid
  "SENDGRID_API_KEY",
];

/**
 * Build a sandboxed environment for shell command execution.
 * ALWAYS strips sensitive env vars (not just when network rules are configured).
 */
export function buildSandboxedEnv(
  config: SandboxConfig,
  baseEnv: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const env = { ...baseEnv };

  if (!config.enabled) return env;

  // Always strip sensitive env vars when sandbox is enabled
  for (const v of SENSITIVE_ENV_VARS) {
    delete env[v];
  }

  // Also strip any env var whose name contains common secret patterns
  for (const key of Object.keys(env)) {
    const upper = key.toUpperCase();
    if (
      upper.includes("SECRET") ||
      upper.includes("PRIVATE_KEY") ||
      upper.includes("_TOKEN") && !upper.includes("COLOR") ||
      upper.includes("_PASSWORD") ||
      upper.includes("_CREDENTIALS")
    ) {
      // Don't strip known safe vars
      const safePatterns = ["COLORTERM", "FORCE_COLOR", "COLOR_TOKEN"];
      if (!safePatterns.some(safe => upper.includes(safe))) {
        delete env[key];
      }
    }
  }

  return env;
}
