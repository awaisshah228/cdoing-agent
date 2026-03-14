/**
 * Path Safety — prevents path traversal attacks.
 * All file tools must validate paths through this utility.
 */

import * as path from "path";

/**
 * Resolve a user-provided path and ensure it stays within the working directory.
 * Throws if the resolved path escapes the sandbox.
 */
export function safePath(userPath: string, workingDir: string): string {
  const resolved = path.isAbsolute(userPath)
    ? path.resolve(userPath)
    : path.resolve(workingDir, userPath);

  const normalizedDir = path.resolve(workingDir);

  // Allow the working directory itself and anything inside it
  if (!resolved.startsWith(normalizedDir + path.sep) && resolved !== normalizedDir) {
    throw new Error(
      `Path "${userPath}" resolves outside the working directory. Access denied.`
    );
  }

  return resolved;
}
