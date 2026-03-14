/**
 * Project Rules — Hierarchical rule system for project-specific AI behavior.
 *
 * Similar to Cursor's .cursor/rules/ and Claude Code's CLAUDE.md,
 * but with glob-based path scoping.
 *
 * Rule hierarchy (highest priority first):
 *   1. Path-specific rules (.cdoing/rules/*.md with glob patterns)
 *   2. Project rules (.cdoing/config.md or CDOING.md)
 *   3. Global rules (~/.cdoing/rules/*.md)
 *
 * Each rule file is a markdown file with optional frontmatter:
 *
 *   ---
 *   globs: ["*.ts", "src/api/**"]
 *   description: Rules for TypeScript API files
 *   ---
 *
 *   Always use async/await instead of callbacks.
 *   Prefer named exports over default exports.
 *
 * Learning note: Glob-based scoping lets you have different coding
 * standards for different parts of your project. For example, strict
 * type rules for API code but relaxed rules for scripts.
 */

export { RulesManager } from "./manager";
export type { Rule, RuleSource } from "./types";
