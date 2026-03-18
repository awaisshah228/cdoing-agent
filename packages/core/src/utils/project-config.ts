/**
 * Project Config — hierarchical config loading (like Claude Code's CLAUDE.md).
 *
 * Searches for config files in this order (all found are merged):
 *   1. Working directory: .cdoing/config.md, CDOING.md, CLAUDE.md, AGENTS.md
 *   2. Parent directories: walk up to repo root (stop at .git) or filesystem root
 *   3. Global: ~/.cdoing/config.md, ~/.claude/CLAUDE.md
 *
 * All found configs are concatenated with source headers, giving a layered
 * configuration system where project-level overrides global.
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";

/** Config file names to search for at each directory level */
const CONFIG_FILES = [
  ".cdoing/config.md",
  "CDOING.md",
  "CLAUDE.md",
  "AGENTS.md",
];

/** Global config locations (checked last, lowest priority) */
const GLOBAL_CONFIGS = [
  path.join(os.homedir(), ".cdoing", "config.md"),
  path.join(os.homedir(), ".claude", "CLAUDE.md"),
];

/**
 * Find a config file in a directory.
 * Returns the first match (file path + content), or null.
 */
function findConfigInDir(dir: string): { path: string; content: string } | null {
  for (const file of CONFIG_FILES) {
    const filePath = path.join(dir, file);
    try {
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, "utf-8").trim();
        if (content) return { path: filePath, content };
      }
    } catch {
      // skip unreadable files
    }
  }
  return null;
}

/**
 * Check if a directory is a repository root (has .git).
 */
function isRepoRoot(dir: string): boolean {
  return fs.existsSync(path.join(dir, ".git"));
}

/**
 * Load project configuration with hierarchical search.
 *
 * Walks up from workingDir to the repo root (or filesystem root),
 * collecting all config files found. Then checks global configs.
 * Returns all configs concatenated with source headers, or null if none found.
 *
 * Order in the returned string (project-specific first):
 *   1. Working directory config
 *   2. Parent directory configs (nearest first)
 *   3. Global config
 */
export function loadProjectConfig(workingDir: string): string | null {
  const configs: Array<{ path: string; content: string }> = [];
  const seen = new Set<string>();

  // Walk up from working dir to repo root / filesystem root
  let dir = path.resolve(workingDir);
  const root = path.parse(dir).root;

  while (true) {
    const found = findConfigInDir(dir);
    if (found && !seen.has(found.path)) {
      configs.push(found);
      seen.add(found.path);
    }

    // Stop at repo root or filesystem root
    if (isRepoRoot(dir) && dir !== path.resolve(workingDir)) break;
    const parent = path.dirname(dir);
    if (parent === dir) break; // filesystem root
    dir = parent;
  }

  // Check global configs
  for (const globalPath of GLOBAL_CONFIGS) {
    if (seen.has(globalPath)) continue;
    try {
      if (fs.existsSync(globalPath)) {
        const content = fs.readFileSync(globalPath, "utf-8").trim();
        if (content) {
          configs.push({ path: globalPath, content });
          seen.add(globalPath);
        }
      }
    } catch {
      // skip
    }
  }

  if (configs.length === 0) return null;

  // Single config — return as-is (no header needed)
  if (configs.length === 1) return configs[0].content;

  // Multiple configs — concatenate with source headers
  return configs
    .map((c) => `<!-- Source: ${c.path} -->\n${c.content}`)
    .join("\n\n---\n\n");
}

/**
 * Get the path where project config would be stored.
 */
export function getProjectConfigPath(workingDir: string): string {
  return path.join(workingDir, ".cdoing", "config.md");
}
