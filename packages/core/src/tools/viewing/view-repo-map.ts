/**
 * View Repo Map Tool — generate a structural overview of the repository.
 *
 * Shows the project layout: directories, key files, entry points,
 * config files, and a summary of the codebase structure.
 */

import * as fs from "fs";
import * as path from "path";
import { exec } from "child_process";
import type { BaseTool, ToolDefinition, ToolResult } from "../types";
import { loadIgnorePatterns } from "../../utils/gitignore";

const ALWAYS_IGNORE = new Set([
  "node_modules", ".git", "dist", "build", "out", ".next", ".nuxt",
  "__pycache__", ".cache", ".turbo", "coverage", "venv", ".venv",
  "target", "vendor", ".idea", ".vscode", ".DS_Store", "*.pyc",
]);

const CONFIG_FILES = new Set([
  "package.json", "tsconfig.json", "tsconfig.base.json",
  ".eslintrc.js", ".eslintrc.json", ".prettierrc",
  "jest.config.js", "jest.config.ts", "vitest.config.ts",
  "webpack.config.js", "vite.config.ts", "vite.config.js",
  "rollup.config.js", "esbuild.config.js",
  "Dockerfile", "docker-compose.yml", "docker-compose.yaml",
  "Makefile", "CMakeLists.txt",
  ".env.example", ".gitignore", ".dockerignore",
  "pyproject.toml", "setup.py", "setup.cfg", "requirements.txt",
  "Cargo.toml", "go.mod", "Gemfile", "composer.json",
  "turbo.json", "lerna.json", "nx.json",
]);

const ENTRY_PATTERNS = [
  "index.ts", "index.js", "main.ts", "main.js", "app.ts", "app.js",
  "server.ts", "server.js", "cli.ts", "cli.js",
  "index.py", "main.py", "app.py", "__main__.py",
  "main.go", "main.rs", "lib.rs",
];

interface RepoStats {
  totalFiles: number;
  totalDirs: number;
  languages: Map<string, number>;
  configFiles: string[];
  entryPoints: string[];
}

export class ViewRepoMapTool implements BaseTool {
  // ── Behavioral flags ──
  isReadOnly = () => true;
  concurrencyMode = () => "parallel" as const;
  definition: ToolDefinition = {
    name: "view_repo_map",
    description:
      `Generate a structural overview of the repository. Shows:
- Directory tree (top 2 levels)
- Detected languages and file counts
- Config files found
- Likely entry points
- Git branch and recent commits

Use this to understand a new project before diving into code.`,
    inputSchema: {
      type: "object",
      properties: {
        directory: {
          type: "string",
          description: "Subdirectory to focus on. Defaults to project root.",
        },
      },
      required: [],
    },
    requiresPermission: false,
  };

  private workingDir: string;

  constructor(workingDir: string) {
    this.workingDir = workingDir;
  }

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const subdir = (input.directory as string) || "";
    const rootDir = subdir ? path.resolve(this.workingDir, subdir) : this.workingDir;

    if (!fs.existsSync(rootDir) || !fs.statSync(rootDir).isDirectory()) {
      return { success: false, output: "", error: `Directory not found: ${rootDir}` };
    }

    const sections: string[] = [];

    // 1. Header
    sections.push(`# Repository Map: ${path.basename(rootDir)}`);
    sections.push(`Path: ${rootDir}`);

    // 2. Git info
    const gitInfo = await this.getGitInfo(rootDir);
    if (gitInfo) sections.push(gitInfo);

    // 3. Directory tree (2 levels)
    const tree = this.buildTree(rootDir, 2);
    sections.push("\n## Directory Structure\n```\n" + tree + "\n```");

    // 4. Stats
    const stats = this.collectStats(rootDir);
    sections.push(this.formatStats(stats));

    return { success: true, output: sections.join("\n") };
  }

  private buildTree(dir: string, maxDepth: number, prefix = "", depth = 0): string {
    if (depth > maxDepth) return "";

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return "";
    }

    entries = entries
      .filter((e) => !ALWAYS_IGNORE.has(e.name) && !e.name.startsWith("."))
      .sort((a, b) => {
        if (a.isDirectory() && !b.isDirectory()) return -1;
        if (!a.isDirectory() && b.isDirectory()) return 1;
        return a.name.localeCompare(b.name);
      });

    const lines: string[] = [];
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const isLast = i === entries.length - 1;
      const connector = isLast ? "└── " : "├── ";
      const childPrefix = isLast ? "    " : "│   ";

      if (entry.isDirectory()) {
        lines.push(`${prefix}${connector}${entry.name}/`);
        const subtree = this.buildTree(
          path.join(dir, entry.name),
          maxDepth,
          prefix + childPrefix,
          depth + 1,
        );
        if (subtree) lines.push(subtree);
      } else {
        lines.push(`${prefix}${connector}${entry.name}`);
      }
    }

    return lines.join("\n");
  }

  private collectStats(dir: string, stats?: RepoStats, depth = 0): RepoStats {
    if (!stats) {
      stats = { totalFiles: 0, totalDirs: 0, languages: new Map(), configFiles: [], entryPoints: [] };
    }
    if (depth > 10 || stats.totalFiles > 5000) return stats;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return stats;
    }

    for (const entry of entries) {
      if (ALWAYS_IGNORE.has(entry.name)) continue;

      if (entry.isDirectory()) {
        stats.totalDirs++;
        this.collectStats(path.join(dir, entry.name), stats, depth + 1);
      } else {
        stats.totalFiles++;

        // Track language
        const ext = path.extname(entry.name).toLowerCase();
        if (ext) {
          stats.languages.set(ext, (stats.languages.get(ext) || 0) + 1);
        }

        // Config files
        if (CONFIG_FILES.has(entry.name) && depth <= 2) {
          const rel = path.relative(this.workingDir, path.join(dir, entry.name));
          stats.configFiles.push(rel);
        }

        // Entry points
        if (ENTRY_PATTERNS.includes(entry.name) && depth <= 3) {
          const rel = path.relative(this.workingDir, path.join(dir, entry.name));
          stats.entryPoints.push(rel);
        }
      }
    }

    return stats;
  }

  private formatStats(stats: RepoStats): string {
    const lines: string[] = ["\n## Summary"];
    lines.push(`- **${stats.totalFiles}** files in **${stats.totalDirs}** directories`);

    // Languages (top 10)
    if (stats.languages.size > 0) {
      const sorted = [...stats.languages.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10);
      const langStr = sorted.map(([ext, count]) => `${ext} (${count})`).join(", ");
      lines.push(`- **Languages:** ${langStr}`);
    }

    // Config files
    if (stats.configFiles.length > 0) {
      lines.push(`\n### Config Files`);
      for (const f of stats.configFiles.slice(0, 20)) lines.push(`- ${f}`);
    }

    // Entry points
    if (stats.entryPoints.length > 0) {
      lines.push(`\n### Entry Points`);
      for (const f of stats.entryPoints.slice(0, 20)) lines.push(`- ${f}`);
    }

    return lines.join("\n");
  }

  private getGitInfo(dir: string): Promise<string | null> {
    return new Promise((resolve) => {
      exec(
        'git branch --show-current && echo "---" && git log --oneline -5 2>/dev/null',
        { cwd: dir, timeout: 5000 },
        (error, stdout) => {
          if (error || !stdout.trim()) {
            resolve(null);
            return;
          }
          const parts = stdout.split("---");
          const branch = parts[0]?.trim();
          const commits = parts[1]?.trim();
          const lines = [`Branch: **${branch}**`];
          if (commits) {
            lines.push("\nRecent commits:");
            for (const c of commits.split("\n").slice(0, 5)) {
              lines.push(`  ${c.trim()}`);
            }
          }
          resolve(lines.join("\n"));
        },
      );
    });
  }
}
