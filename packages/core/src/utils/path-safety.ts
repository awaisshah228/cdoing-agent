/**
 * Path Safety — resolves user-provided paths to absolute paths.
 *
 * Access control is handled by the permission system (allow/deny rules)
 * and the sandbox system (filesystem restrictions when enabled).
 * This utility only normalizes paths — it does NOT restrict access.
 */

import * as path from "path";

/**
 * Resolve a user-provided path to an absolute, normalized path.
 * Relative paths are resolved against the working directory.
 */
export function safePath(userPath: string, workingDir: string): string {
  return path.isAbsolute(userPath)
    ? path.resolve(userPath)
    : path.resolve(workingDir, userPath);
}
