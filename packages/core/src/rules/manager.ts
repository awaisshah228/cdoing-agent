/**
 * Rules Manager — Loads, caches, and resolves project rules.
 *
 * Scans rule directories in priority order and returns rules
 * that match the current file context.
 *
 * Learning note: The manager uses lazy loading — rules are only
 * read from disk when first needed, then cached until the file
 * system changes. This prevents slow startup on large projects.
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { minimatch } from "minimatch";
import type { Rule, RuleSource, RuleFrontmatter } from "./types";

export class RulesManager {
  /** Cached rules, indexed by source directory */
  private cache = new Map<string, Rule[]>();

  /** Working directory (project root) */
  private workingDir: string;

  constructor(workingDir: string) {
    this.workingDir = workingDir;
  }

  /**
   * Get all rules that apply to a given file path.
   * Rules are returned in priority order (most specific first).
   *
   * @param filePath - The file being edited/created (for glob matching)
   * @returns Array of matching rules
   */
  getRulesForFile(filePath?: string): Rule[] {
    const allRules = this.loadAllRules();

    if (!filePath) {
      // No file context — return all rules without glob restrictions
      return allRules.filter((r) => r.globs.length === 0);
    }

    // Resolve to relative path for glob matching
    const relativePath = path.isAbsolute(filePath)
      ? path.relative(this.workingDir, filePath)
      : filePath;

    return allRules.filter((rule) => {
      // Rules without globs apply to everything
      if (rule.globs.length === 0) return true;

      // Check if any glob pattern matches the file
      return rule.globs.some((glob) => this.matchGlob(relativePath, glob));
    });
  }

  /**
   * Get all rules formatted as a single string for the system prompt.
   *
   * @param filePath - Optional file context for filtering
   * @returns Formatted rules text, or empty string if no rules
   */
  formatForPrompt(filePath?: string): string {
    const rules = this.getRulesForFile(filePath);
    if (rules.length === 0) return "";

    const sections = rules.map((rule) => {
      const header = rule.description
        ? `### ${rule.description}`
        : `### Rule from ${path.basename(rule.filePath)}`;

      const scope = rule.globs.length > 0
        ? `_Applies to: ${rule.globs.join(", ")}_\n`
        : "";

      return `${header}\n${scope}\n${rule.content}`;
    });

    return `# Project Rules\n\n${sections.join("\n\n---\n\n")}`;
  }

  /**
   * Load all rules from all sources.
   * Results are cached — call invalidateCache() to refresh.
   */
  private loadAllRules(): Rule[] {
    const rules: Rule[] = [];

    // 1. Global rules (~/.cdoing/rules/)
    const globalDir = path.join(os.homedir(), ".cdoing", "rules");
    rules.push(...this.loadRulesFromDir(globalDir, "global"));

    // 2. Project rules (.cdoing/rules/)
    const projectDir = path.join(this.workingDir, ".cdoing", "rules");
    rules.push(...this.loadRulesFromDir(projectDir, "path-specific"));

    return rules;
  }

  /**
   * Load rules from a directory of markdown files.
   *
   * Learning note: Each .md file in the rules directory becomes a rule.
   * YAML frontmatter is parsed for glob patterns and descriptions.
   */
  private loadRulesFromDir(dir: string, source: RuleSource): Rule[] {
    // Check cache
    const cached = this.cache.get(dir);
    if (cached) return cached;

    const rules: Rule[] = [];

    if (!fs.existsSync(dir)) {
      this.cache.set(dir, rules);
      return rules;
    }

    let entries: string[];
    try {
      entries = fs.readdirSync(dir).filter((f) => f.endsWith(".md"));
    } catch {
      this.cache.set(dir, rules);
      return rules;
    }

    for (const file of entries) {
      const filePath = path.join(dir, file);
      try {
        const content = fs.readFileSync(filePath, "utf-8");
        const parsed = this.parseRuleFile(content);

        rules.push({
          source,
          filePath,
          globs: parsed.globs,
          description: parsed.description || file.replace(/\.md$/, ""),
          content: parsed.content,
        });
      } catch {
        // Skip unreadable files
      }
    }

    this.cache.set(dir, rules);
    return rules;
  }

  /**
   * Parse a rule markdown file, extracting frontmatter and content.
   *
   * Frontmatter format:
   *   ---
   *   globs: ["*.ts", "src/**"]
   *   description: TypeScript coding rules
   *   ---
   *
   * Learning note: We use a simple regex-based parser instead of
   * a YAML library to avoid adding dependencies. This handles
   * the common cases well enough.
   */
  private parseRuleFile(raw: string): { globs: string[]; description: string; content: string } {
    const frontmatterMatch = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);

    if (!frontmatterMatch) {
      // No frontmatter — entire file is content
      return { globs: [], description: "", content: raw.trim() };
    }

    const [, frontmatterStr, content] = frontmatterMatch;

    // Simple key-value parsing for frontmatter
    let globs: string[] = [];
    let description = "";

    for (const line of frontmatterStr.split("\n")) {
      const globMatch = line.match(/^globs:\s*\[(.+)\]$/);
      if (globMatch) {
        // Parse glob array: ["*.ts", "src/**"]
        globs = globMatch[1]
          .split(",")
          .map((g) => g.trim().replace(/^["']|["']$/g, ""))
          .filter(Boolean);
      }

      const globSingle = line.match(/^globs:\s*["'](.+)["']$/);
      if (globSingle) {
        globs = [globSingle[1]];
      }

      const descMatch = line.match(/^description:\s*(.+)$/);
      if (descMatch) {
        description = descMatch[1].trim().replace(/^["']|["']$/g, "");
      }
    }

    return { globs, description, content: content.trim() };
  }

  /**
   * Check if a file path matches a glob pattern.
   * Uses minimatch for proper glob matching.
   */
  private matchGlob(filePath: string, pattern: string): boolean {
    try {
      return minimatch(filePath, pattern, { matchBase: true });
    } catch {
      // If minimatch isn't available, fall back to simple extension matching
      if (pattern.startsWith("*.")) {
        const ext = pattern.slice(1); // e.g., ".ts"
        return filePath.endsWith(ext);
      }
      return filePath.includes(pattern);
    }
  }

  /**
   * Format rules for CLI display, showing file paths and sources.
   */
  formatForDisplay(): string {
    const allRules = this.loadAllRules();
    if (allRules.length === 0) return "No rules defined.";

    const globalDir = path.join(os.homedir(), ".cdoing", "rules");
    const projectDir = path.join(this.workingDir, ".cdoing", "rules");

    const lines: string[] = ["# Rules\n"];

    // Group by source
    const globalRules = allRules.filter((r) => r.source === "global");
    const projectRules = allRules.filter((r) => r.source === "path-specific");

    if (globalRules.length > 0) {
      lines.push(`## Global rules (${globalDir}/)`);
      for (const rule of globalRules) {
        const globs = rule.globs.length > 0 ? ` [${rule.globs.join(", ")}]` : "";
        lines.push(`  - ${rule.filePath}${globs}`);
      }
      lines.push("");
    } else {
      lines.push(`## Global rules — none found`);
      lines.push(`  Directory: ${globalDir}/`);
      lines.push("");
    }

    if (projectRules.length > 0) {
      lines.push(`## Project rules (${projectDir}/)`);
      for (const rule of projectRules) {
        const globs = rule.globs.length > 0 ? ` [${rule.globs.join(", ")}]` : "";
        lines.push(`  - ${rule.filePath}${globs}`);
      }
      lines.push("");
    } else {
      lines.push(`## Project rules — none found`);
      lines.push(`  Directory: ${projectDir}/`);
      lines.push("");
    }

    return lines.join("\n");
  }

  /**
   * Clear the rule cache (call after file changes).
   */
  invalidateCache(): void {
    this.cache.clear();
  }

  /**
   * Update the working directory.
   */
  setWorkingDir(dir: string): void {
    this.workingDir = dir;
    this.invalidateCache();
  }
}
