/**
 * Project Config — reads .cdoing/config.md for project-specific instructions.
 * Similar to Claude Code's CLAUDE.md system.
 *
 * Looks for config in these locations (in order):
 *   1. .cdoing/config.md  (project-specific)
 *   2. CDOING.md           (project root alternative)
 */

import * as fs from "fs";
import * as path from "path";

const CONFIG_FILES = [
  ".cdoing/config.md",
  "CDOING.md",
];

/**
 * Load project configuration from the working directory.
 * Returns the content of the first config file found, or null.
 */
export function loadProjectConfig(workingDir: string): string | null {
  for (const file of CONFIG_FILES) {
    const filePath = path.join(workingDir, file);
    try {
      if (fs.existsSync(filePath)) {
        return fs.readFileSync(filePath, "utf-8").trim();
      }
    } catch {
      // skip unreadable files
    }
  }
  return null;
}

/**
 * Get the path where project config would be stored.
 */
export function getProjectConfigPath(workingDir: string): string {
  return path.join(workingDir, ".cdoing", "config.md");
}
