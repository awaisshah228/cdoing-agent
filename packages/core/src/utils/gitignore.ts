/**
 * Gitignore-aware file filtering.
 * Reads .gitignore and applies patterns to glob/grep searches.
 */

import * as fs from "fs";
import * as path from "path";

/** Default patterns to always ignore */
const DEFAULT_IGNORE = [
  "**/node_modules/**",
  "**/dist/**",
  "**/.git/**",
  "**/*.lock",
  "**/build/**",
  "**/.next/**",
  "**/.nuxt/**",
  "**/coverage/**",
  "**/__pycache__/**",
  "**/.venv/**",
  "**/venv/**",
  "**/.env",
  "**/.DS_Store",
];

/**
 * Load ignore patterns from .gitignore + defaults.
 * Converts .gitignore patterns to glob-compatible patterns.
 */
export function loadIgnorePatterns(workingDir: string): string[] {
  const patterns = [...DEFAULT_IGNORE];
  const gitignorePath = path.join(workingDir, ".gitignore");

  try {
    if (fs.existsSync(gitignorePath)) {
      const content = fs.readFileSync(gitignorePath, "utf-8");
      const lines = content.split("\n");

      for (let line of lines) {
        line = line.trim();
        // Skip empty lines and comments
        if (!line || line.startsWith("#")) continue;
        // Skip negation patterns (complex to handle)
        if (line.startsWith("!")) continue;

        // Convert to glob pattern
        let pattern = line;

        // If it ends with /, it's a directory — add **
        if (pattern.endsWith("/")) {
          pattern = `**/${pattern}**`;
        }
        // If it doesn't contain a slash, it can match anywhere
        else if (!pattern.includes("/")) {
          pattern = `**/${pattern}`;
        }
        // If it starts with /, it's relative to root
        else if (pattern.startsWith("/")) {
          pattern = pattern.substring(1);
        }

        // Avoid duplicates
        if (!patterns.includes(pattern)) {
          patterns.push(pattern);
        }
      }
    }
  } catch {
    // Silently ignore read errors
  }

  return patterns;
}
