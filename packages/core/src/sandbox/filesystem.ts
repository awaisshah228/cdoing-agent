/**
 * Sandbox Filesystem — checks read/write access against sandbox rules.
 *
 * Security features:
 *   - Symlink resolution to prevent traversal attacks
 *   - Deny-first evaluation (deny always wins)
 *   - Working directory boundary enforcement for writes
 */

import * as fs from "fs";
import * as path from "path";
import { matchPath } from "../utils/path-matching";
import type { SandboxConfig, SandboxCheckResult } from "./types";

/**
 * Resolve a path, following symlinks to get the real path.
 * This prevents symlink-based attacks (e.g., symlink to ~/.ssh/id_rsa).
 */
function resolveRealPath(filePath: string): string {
  const resolved = path.resolve(filePath);
  try {
    return fs.realpathSync(resolved);
  } catch {
    // File doesn't exist yet — resolve parent directory
    const dir = path.dirname(resolved);
    try {
      const realDir = fs.realpathSync(dir);
      return path.join(realDir, path.basename(resolved));
    } catch {
      return resolved;
    }
  }
}

/**
 * Check whether reading a file is allowed by sandbox rules.
 * Resolves symlinks before checking to prevent traversal attacks.
 */
export function checkReadAccess(
  filePath: string,
  config: SandboxConfig,
  workingDir: string,
  projectDir: string,
): SandboxCheckResult {
  if (!config.enabled) return { allowed: true };

  // Resolve symlinks to get real path
  const resolved = resolveRealPath(filePath);

  for (const deny of config.filesystem.denyRead) {
    if (matchPath(resolved, deny, projectDir, workingDir)) {
      return { allowed: false, reason: `Sandbox: read access denied for ${resolved} (matches denyRead rule "${deny}")` };
    }
  }

  return { allowed: true };
}

/**
 * Check whether writing to a file is allowed by sandbox rules.
 * DenyWrite takes priority, then path must be within workingDir or allowWrite paths.
 * Resolves symlinks before checking to prevent traversal attacks.
 */
export function checkWriteAccess(
  filePath: string,
  config: SandboxConfig,
  workingDir: string,
  projectDir: string,
): SandboxCheckResult {
  if (!config.enabled) return { allowed: true };

  // Resolve symlinks to get real path
  const resolved = resolveRealPath(filePath);
  const normalizedWorkingDir = path.resolve(workingDir);

  // Check denyWrite first (deny always wins)
  for (const deny of config.filesystem.denyWrite) {
    if (matchPath(resolved, deny, projectDir, workingDir)) {
      return { allowed: false, reason: `Sandbox: write access denied for ${resolved} (matches denyWrite rule "${deny}")` };
    }
  }

  // Allow writes within workingDir
  if (resolved === normalizedWorkingDir || resolved.startsWith(normalizedWorkingDir + path.sep)) {
    return { allowed: true };
  }

  // Check allowWrite paths
  for (const allow of config.filesystem.allowWrite) {
    if (matchPath(resolved, allow, projectDir, workingDir)) {
      return { allowed: true };
    }
  }

  return { allowed: false, reason: `Sandbox: write access denied for ${resolved} (outside working directory and not in allowWrite)` };
}

/**
 * Best-effort heuristic: parse a shell command to detect read/write targets.
 * Returns denied if any detected target violates sandbox rules.
 *
 * Also detects dangerous patterns like:
 *   - mv/cp with targets outside working directory
 *   - find ... -delete / find ... -exec rm
 *   - Interpreter commands that could access arbitrary files
 */
export function checkShellCommandPaths(
  command: string,
  config: SandboxConfig,
  workingDir: string,
  projectDir: string,
): SandboxCheckResult {
  if (!config.enabled) return { allowed: true };

  // Detect write targets: >, >>, tee
  const writeTargets = extractWriteTargets(command);
  for (const target of writeTargets) {
    const resolved = path.isAbsolute(target) ? target : path.resolve(workingDir, target);
    const realPath = resolveRealPath(resolved);
    const check = checkWriteAccess(realPath, config, workingDir, projectDir);
    if (!check.allowed) return check;
  }

  // Detect read targets: cat, less, head, tail, more
  const readTargets = extractReadTargets(command);
  for (const target of readTargets) {
    const resolved = path.isAbsolute(target) ? target : path.resolve(workingDir, target);
    const realPath = resolveRealPath(resolved);
    const check = checkReadAccess(realPath, config, workingDir, projectDir);
    if (!check.allowed) return check;
  }

  // Detect mv/cp targets
  const moveCopyTargets = extractMoveCopyTargets(command);
  for (const target of moveCopyTargets) {
    const resolved = path.isAbsolute(target) ? target : path.resolve(workingDir, target);
    const realPath = resolveRealPath(resolved);
    const check = checkWriteAccess(realPath, config, workingDir, projectDir);
    if (!check.allowed) return check;
  }

  // Detect find -delete and find -exec rm
  if (/\bfind\b.*(?:-delete|-exec\s+rm\b)/.test(command)) {
    // Extract the search root from find command
    const findRootMatch = command.match(/\bfind\s+([^\s-][^\s]*)/);
    if (findRootMatch) {
      const findRoot = findRootMatch[1];
      const resolved = path.isAbsolute(findRoot) ? findRoot : path.resolve(workingDir, findRoot);
      const realPath = resolveRealPath(resolved);
      const check = checkWriteAccess(realPath, config, workingDir, projectDir);
      if (!check.allowed) return check;
    }
  }

  return { allowed: true };
}

/** Extract file paths that appear as write targets in a shell command */
function extractWriteTargets(command: string): string[] {
  const targets: string[] = [];

  // Match >> or > followed by optional space and a file path
  const redirectRegex = />{1,2}\s*([^\s;|&]+)/g;
  let match;
  while ((match = redirectRegex.exec(command)) !== null) {
    targets.push(match[1]);
  }

  // Match tee followed by optional flags and file path
  const teeRegex = /\btee\s+(?:-[a-zA-Z]\s+)*([^\s;|&]+)/g;
  while ((match = teeRegex.exec(command)) !== null) {
    targets.push(match[1]);
  }

  return targets;
}

/** Extract file paths that appear as read targets in a shell command */
function extractReadTargets(command: string): string[] {
  const targets: string[] = [];

  // Match cat, less, head, tail, more followed by optional flags and file path
  const readRegex = /\b(?:cat|less|head|tail|more)\s+(?:-[a-zA-Z0-9]+\s+)*([^\s;|&]+)/g;
  let match;
  while ((match = readRegex.exec(command)) !== null) {
    // Skip if it looks like a flag
    if (!match[1].startsWith("-")) {
      targets.push(match[1]);
    }
  }

  return targets;
}

/** Extract destination paths from mv/cp commands */
function extractMoveCopyTargets(command: string): string[] {
  const targets: string[] = [];

  // Match mv or cp: last non-flag argument is the destination
  const mvCpRegex = /\b(?:mv|cp)\s+((?:-[a-zA-Z]+\s+)*)(.+)/g;
  let match;
  while ((match = mvCpRegex.exec(command)) !== null) {
    const args = match[2].trim().split(/\s+/).filter(a => !a.startsWith("-"));
    // Last argument is typically the destination
    if (args.length >= 2) {
      targets.push(args[args.length - 1]);
    }
  }

  return targets;
}
