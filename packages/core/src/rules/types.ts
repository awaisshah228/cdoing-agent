/**
 * Rule Types — Shared type definitions for the rules system.
 *
 * Learning note: Separating types from implementation keeps
 * the codebase clean and prevents circular imports.
 */

/**
 * A single rule definition loaded from a .md file.
 */
export interface Rule {
  /** Where the rule was loaded from */
  source: RuleSource;

  /** Absolute path to the rule file */
  filePath: string;

  /** Glob patterns this rule applies to (empty = applies to all files) */
  globs: string[];

  /** Human-readable description of what the rule enforces */
  description: string;

  /** The actual rule content (markdown text) */
  content: string;
}

/**
 * Where a rule was loaded from — determines priority.
 * path-specific > project > global
 */
export type RuleSource = "global" | "project" | "path-specific";

/**
 * Frontmatter parsed from a rule markdown file.
 */
export interface RuleFrontmatter {
  globs?: string | string[];
  description?: string;
}
