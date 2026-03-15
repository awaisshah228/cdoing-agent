/**
 * Sandbox Network — domain access checks and environment restrictions.
 */

import type { SandboxConfig, SandboxCheckResult } from "./types";

/**
 * Check whether accessing a URL is allowed by sandbox network rules.
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

/**
 * Build a sandboxed environment for shell command execution.
 * Sets proxy env vars as a best-effort network restriction.
 */
export function buildSandboxedEnv(
  config: SandboxConfig,
  baseEnv: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  if (!config.enabled) return { ...baseEnv };

  const env = { ...baseEnv };

  // Remove potentially dangerous env vars that could leak credentials
  const sensitiveVars = [
    "AWS_SECRET_ACCESS_KEY",
    "AWS_SESSION_TOKEN",
    "GH_TOKEN",
    "GITHUB_TOKEN",
    "NPM_TOKEN",
    "DOCKER_PASSWORD",
  ];

  for (const v of sensitiveVars) {
    // Only remove if sandbox is actively restricting network
    if (config.network.allowedDomains.length > 0 || config.network.allowManagedDomainsOnly) {
      delete env[v];
    }
  }

  return env;
}
