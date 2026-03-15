/**
 * Path Matching Utilities — shared by permissions and sandbox systems.
 *
 * Supports path specifier prefixes:
 *   //abs/path   → absolute from filesystem root
 *   ~/rel/path   → relative to home directory
 *   /proj/path   → relative to project root
 *   ./rel/path   → relative to current working directory
 *   rel/path     → relative to current working directory
 */

import * as path from "path";
import * as os from "os";

const HOME_DIR = os.homedir();

/**
 * Resolve a specifier to an absolute base path for matching.
 */
export function resolveSpecifierBase(specifier: string, projectDir: string, cwd: string): string {
  if (specifier.startsWith("//")) {
    return path.normalize("/" + specifier.substring(2));
  }
  if (specifier.startsWith("~/")) {
    return path.join(HOME_DIR, specifier.substring(2));
  }
  if (specifier.startsWith("/")) {
    return path.join(projectDir, specifier.substring(1));
  }
  if (specifier.startsWith("./")) {
    return path.join(cwd, specifier.substring(2));
  }
  return path.join(cwd, specifier);
}

/** Glob match: * matches single directory segment, ** matches recursively. */
export function pathGlob(filePath: string, pattern: string): boolean {
  if (!pattern.includes("*")) {
    return filePath === pattern || filePath.startsWith(pattern + path.sep);
  }
  const patParts  = pattern.split(path.sep);
  const fileParts = filePath.split(path.sep);
  return matchPathParts(fileParts, patParts, 0, 0);
}

export function matchPathParts(fp: string[], pp: string[], fi: number, pi: number): boolean {
  while (pi < pp.length) {
    if (pp[pi] === "**") {
      for (let k = fi; k <= fp.length; k++) {
        if (matchPathParts(fp, pp, k, pi + 1)) return true;
      }
      return false;
    }
    if (fi >= fp.length) return false;
    if (!matchSegment(fp[fi], pp[pi])) return false;
    fi++;
    pi++;
  }
  return fi === fp.length;
}

export function matchSegment(name: string, pat: string): boolean {
  if (!pat.includes("*")) return name === pat;
  const rx = "^" + pat.split("*").map(escapeRegex).join("[^/]*") + "$";
  return new RegExp(rx).test(name);
}

function escapeRegex(s: string): string {
  return s.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Match a file path against a specifier, resolving the specifier relative
 * to the project directory and current working directory.
 */
export function matchPath(
  filePath: string,
  specifier: string,
  projectDir: string,
  cwd: string,
): boolean {
  const base = resolveSpecifierBase(specifier, projectDir, cwd);
  return pathGlob(filePath, base);
}
