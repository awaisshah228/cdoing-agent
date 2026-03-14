/**
 * Tree Context Provider — @tree
 *
 * Generates a file tree visualization of the workspace.
 * Helps the AI understand the project structure at a glance.
 *
 * Usage:
 *   @tree          → full tree (default depth 3)
 *   @tree src      → tree of a subdirectory
 *   @tree 5        → custom depth
 *
 * How it works:
 *   1. Walks the directory recursively up to the configured depth
 *   2. Respects .gitignore patterns
 *   3. Formats as an ASCII tree (like the `tree` command)
 *
 * Learning note: We use recursion with a depth limit to prevent
 * scanning massive directories. The .gitignore filtering ensures
 * we don't include node_modules, dist, etc.
 */

import * as fs from "fs";
import * as path from "path";
import type { ContextProvider, ContextResult, ContextResolveOptions } from "./types";

/** Default max depth for tree traversal */
const DEFAULT_DEPTH = 3;

/** Max items to include in the tree output */
const MAX_ITEMS = 500;

/** Directories to always skip (even without .gitignore) */
const ALWAYS_SKIP = new Set([
  "node_modules", ".git", ".next", ".nuxt", "__pycache__",
  ".cache", ".turbo", "dist", "build", ".DS_Store",
  "coverage", ".nyc_output", ".pytest_cache", "venv",
  ".venv", "env", ".env", ".tox",
]);

export class TreeContextProvider implements ContextProvider {
  id = "tree";
  trigger = "@tree";
  description = "Show workspace file tree structure";
  requiresArg = false;

  async resolve(arg?: string, options?: ContextResolveOptions): Promise<ContextResult> {
    const workingDir = options?.workingDir || process.cwd();

    // Parse argument: could be a path, a depth number, or "path depth"
    let targetDir = workingDir;
    let maxDepth = DEFAULT_DEPTH;

    if (arg) {
      const parts = arg.trim().split(/\s+/);
      for (const part of parts) {
        const num = parseInt(part, 10);
        if (!isNaN(num) && num > 0 && num <= 10) {
          maxDepth = num;
        } else {
          // Treat as a subdirectory path
          const resolved = path.resolve(workingDir, part);
          if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
            targetDir = resolved;
          }
        }
      }
    }

    // Build the tree
    let itemCount = 0;
    const lines: string[] = [];
    const rootName = path.basename(targetDir);
    lines.push(rootName + "/");

    buildTree(targetDir, "", maxDepth, 0, lines, { count: 0, max: MAX_ITEMS });
    itemCount = lines.length - 1; // Subtract the root line

    const treeOutput = lines.join("\n");
    const relativePath = path.relative(workingDir, targetDir) || ".";

    return {
      label: `File Tree: ${relativePath}`,
      content: `## File Tree: ${relativePath} (depth: ${maxDepth})\n\n\`\`\`\n${treeOutput}\n\`\`\``,
      metadata: {
        source: targetDir,
        truncated: itemCount >= MAX_ITEMS,
        itemCount,
      },
    };
  }
}

/**
 * Recursively build an ASCII tree representation.
 *
 * Uses box-drawing characters for a clean visual:
 *   ├── file.ts
 *   ├── src/
 *   │   ├── index.ts
 *   │   └── utils/
 *   └── package.json
 *
 * Learning note: The `prefix` parameter builds up as we recurse deeper,
 * adding "│   " or "    " to maintain the visual tree structure.
 */
function buildTree(
  dir: string,
  prefix: string,
  maxDepth: number,
  currentDepth: number,
  lines: string[],
  counter: { count: number; max: number },
): void {
  if (currentDepth >= maxDepth || counter.count >= counter.max) return;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // Permission denied or other read errors
  }

  // Filter out hidden/ignored directories and sort (dirs first, then files)
  const filtered = entries
    .filter((e) => !e.name.startsWith(".") || e.name === ".cdoing")
    .filter((e) => !ALWAYS_SKIP.has(e.name))
    .sort((a, b) => {
      // Directories first, then alphabetical
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name);
    });

  for (let i = 0; i < filtered.length; i++) {
    if (counter.count >= counter.max) {
      lines.push(`${prefix}... [truncated at ${counter.max} items]`);
      return;
    }

    const entry = filtered[i];
    const isLast = i === filtered.length - 1;
    const connector = isLast ? "└── " : "├── ";
    const childPrefix = isLast ? "    " : "│   ";

    if (entry.isDirectory()) {
      lines.push(`${prefix}${connector}${entry.name}/`);
      counter.count++;
      buildTree(
        path.join(dir, entry.name),
        prefix + childPrefix,
        maxDepth,
        currentDepth + 1,
        lines,
        counter,
      );
    } else {
      lines.push(`${prefix}${connector}${entry.name}`);
      counter.count++;
    }
  }
}
