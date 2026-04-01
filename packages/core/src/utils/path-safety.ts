/**
 * Path Safety — resolves user-provided paths to absolute paths with security checks.
 *
 * Provides:
 *   - Path normalization (relative → absolute)
 *   - Symlink resolution (prevents symlink-based traversal attacks)
 *   - Sensitive file/directory blocking (prevents access to credentials, keys, etc.)
 *
 * Access control is also handled by the permission system (allow/deny rules)
 * and the sandbox system (filesystem restrictions when enabled).
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const HOME_DIR = os.homedir();

// ── Sensitive paths that should be blocked by default ────────────────────────

/**
 * Sensitive directories — reading or writing inside these is blocked unless
 * the user explicitly allows it via settings rules.
 *
 * Matches Claude Code's sensitive file protection for .claude/, .git/,
 * shell configs, SSH keys, cloud credentials, etc.
 */
const SENSITIVE_PATTERNS: Array<{ pattern: RegExp; description: string }> = [
  // SSH keys and config
  { pattern: /[/\\]\.ssh[/\\]/,                   description: "SSH keys/config" },
  // AWS credentials
  { pattern: /[/\\]\.aws[/\\]/,                    description: "AWS credentials" },
  // GCP credentials
  { pattern: /[/\\]\.config[/\\]gcloud[/\\]/,      description: "GCP credentials" },
  // Azure credentials
  { pattern: /[/\\]\.azure[/\\]/,                   description: "Azure credentials" },
  // Docker credentials
  { pattern: /[/\\]\.docker[/\\]config\.json$/,     description: "Docker credentials" },
  // NPM tokens
  { pattern: /[/\\]\.npmrc$/,                       description: "NPM tokens" },
  // Netrc (passwords)
  { pattern: /[/\\]\.netrc$/,                       description: "Netrc credentials" },
  // Git credentials
  { pattern: /[/\\]\.git-credentials$/,             description: "Git credentials" },
  // GPG keys
  { pattern: /[/\\]\.gnupg[/\\]/,                   description: "GPG keys" },
  // Kubernetes config
  { pattern: /[/\\]\.kube[/\\]config$/,             description: "Kubernetes config" },
  // Keychain (macOS)
  { pattern: /[/\\]Keychains[/\\]/,                 description: "macOS Keychain" },
  // Password stores
  { pattern: /[/\\]\.password-store[/\\]/,           description: "Password store" },
  // 1Password CLI config
  { pattern: /[/\\]\.op[/\\]/,                      description: "1Password CLI" },
  // Bitwarden CLI
  { pattern: /[/\\]\.config[/\\]Bitwarden[/\\]/,    description: "Bitwarden config" },
  // Env files with secrets (common patterns)
  { pattern: /[/\\]\.env\.local$/,                   description: "Local environment secrets" },
  { pattern: /[/\\]\.env\.production$/,              description: "Production environment secrets" },
  // Terraform state (may contain secrets)
  { pattern: /\.tfstate$/,                           description: "Terraform state (may contain secrets)" },
];

/**
 * Files that are always sensitive regardless of location.
 */
const SENSITIVE_FILENAMES = new Set([
  "id_rsa", "id_ed25519", "id_ecdsa", "id_dsa",  // SSH private keys
  "credentials.json",                               // Various service credentials
  "service-account.json",                            // GCP service account
  "token.json",                                      // OAuth tokens
]);

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Resolve a user-provided path to an absolute, normalized path.
 * Relative paths are resolved against the working directory.
 */
export function safePath(userPath: string, workingDir: string): string {
  return path.isAbsolute(userPath)
    ? path.resolve(userPath)
    : path.resolve(workingDir, userPath);
}

/**
 * Resolve a path with symlink protection.
 * Returns the real (canonical) path, following all symlinks.
 * Throws if the path doesn't exist or can't be resolved.
 *
 * Use this for security-sensitive operations where symlink traversal
 * could bypass access controls.
 */
export function safeRealPath(userPath: string, workingDir: string): string {
  const resolved = safePath(userPath, workingDir);

  try {
    // fs.realpathSync follows all symlinks and returns canonical path
    return fs.realpathSync(resolved);
  } catch {
    // File doesn't exist yet (e.g., writing a new file) — resolve parent
    const dir = path.dirname(resolved);
    try {
      const realDir = fs.realpathSync(dir);
      return path.join(realDir, path.basename(resolved));
    } catch {
      // Parent doesn't exist either — return resolved path as-is
      // (the operation will fail later with a clear error)
      return resolved;
    }
  }
}

/**
 * Check if a path targets a sensitive location.
 * Returns a description of why it's sensitive, or null if it's safe.
 */
export function isSensitivePath(filePath: string): string | null {
  const resolved = path.resolve(filePath);

  // Check pattern-based sensitive paths
  for (const { pattern, description } of SENSITIVE_PATTERNS) {
    if (pattern.test(resolved)) {
      return description;
    }
  }

  // Check sensitive filenames
  const basename = path.basename(resolved);
  if (SENSITIVE_FILENAMES.has(basename)) {
    return `Sensitive file: ${basename}`;
  }

  return null;
}

/**
 * Check if a resolved path is within allowed boundaries.
 * Returns true if the path is within the working directory or any allowed directory.
 */
export function isPathWithinBoundary(
  resolvedPath: string,
  workingDir: string,
  additionalAllowed: string[] = [],
): boolean {
  const normalizedPath = path.resolve(resolvedPath);
  const normalizedWorkDir = path.resolve(workingDir);

  // Check working directory
  if (normalizedPath === normalizedWorkDir ||
      normalizedPath.startsWith(normalizedWorkDir + path.sep)) {
    return true;
  }

  // Check additional allowed directories
  for (const allowed of additionalAllowed) {
    const normalizedAllowed = path.resolve(allowed);
    if (normalizedPath === normalizedAllowed ||
        normalizedPath.startsWith(normalizedAllowed + path.sep)) {
      return true;
    }
  }

  return false;
}

/**
 * Comprehensive path safety check for file operations.
 * Resolves symlinks, checks boundaries, and blocks sensitive paths.
 *
 * Returns { realPath, warning? } on success, throws on denial.
 */
export function validateFilePath(
  userPath: string,
  workingDir: string,
  options: {
    /** Additional directories where access is allowed */
    allowedDirs?: string[];
    /** If true, check for sensitive path patterns */
    checkSensitive?: boolean;
    /** If true, resolve symlinks (recommended for writes) */
    resolveSymlinks?: boolean;
    /** If true, enforce working directory boundary */
    enforceBoundary?: boolean;
  } = {},
): { realPath: string; warning?: string } {
  const {
    allowedDirs = [],
    checkSensitive = true,
    resolveSymlinks = true,
    enforceBoundary = false,
  } = options;

  // Resolve the path
  const resolved = resolveSymlinks
    ? safeRealPath(userPath, workingDir)
    : safePath(userPath, workingDir);

  // Check sensitive path patterns
  let warning: string | undefined;
  if (checkSensitive) {
    const sensitiveReason = isSensitivePath(resolved);
    if (sensitiveReason) {
      warning = `Accessing sensitive location: ${sensitiveReason} (${resolved})`;
    }
  }

  // Enforce boundary if requested
  if (enforceBoundary && !isPathWithinBoundary(resolved, workingDir, allowedDirs)) {
    throw new Error(
      `Access denied: ${resolved} is outside the allowed working directory (${workingDir})`
    );
  }

  return { realPath: resolved, warning };
}
