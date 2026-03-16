/**
 * Skill Registry — Manages skill discovery, loading, and invocation.
 *
 * Skills are loaded from:
 *   1. Built-in skills (shipped with the package)
 *   2. Project skills (.cdoing/skills/*.md)
 *   3. User skills (~/.cdoing/skills/*.md)
 *
 * Each skill is a markdown file with YAML frontmatter:
 *
 *   ---
 *   name: commit
 *   description: Create a git commit with a good message
 *   userInvocable: true
 *   ---
 *   <prompt content here>
 */

import * as fs from "fs";
import * as path from "path";
import { Logger } from "../utils/logger";
import type { Skill, SkillEntry, SkillResult } from "./types";

const SKILL_DIRS = [
  ".cdoing/skills",
  ".claude/skills",
];

export class SkillRegistry {
  private skills = new Map<string, SkillEntry>();
  private logger: Logger;

  constructor(logLevel: string = "info") {
    this.logger = new Logger("SkillRegistry", logLevel);
  }

  // ── Loading ────────────────────────────────────────────────────────────

  /** Register a skill programmatically. */
  register(skill: Skill): void {
    this.skills.set(skill.id, {
      skill,
      enabled: true,
      loadedAt: Date.now(),
    });
    this.logger.debug(`Skill registered: ${skill.name} (${skill.id})`);
  }

  /** Load skills from a directory (searches for *.md files with frontmatter). */
  loadFromDirectory(dir: string): number {
    if (!fs.existsSync(dir)) return 0;

    let count = 0;
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".md"));

    for (const file of files) {
      try {
        const filePath = path.join(dir, file);
        const content = fs.readFileSync(filePath, "utf-8");
        const skill = this.parseSkillFile(content, filePath);
        if (skill) {
          this.register(skill);
          count++;
        }
      } catch (err) {
        this.logger.warn(`Failed to load skill ${file}: ${err}`);
      }
    }

    return count;
  }

  /** Load skills from standard directories relative to a working dir. */
  loadFromWorkspace(workingDir: string): number {
    let total = 0;
    for (const rel of SKILL_DIRS) {
      total += this.loadFromDirectory(path.join(workingDir, rel));
    }

    // Also check home directory
    const home = process.env.HOME || process.env.USERPROFILE;
    if (home) {
      total += this.loadFromDirectory(path.join(home, ".cdoing", "skills"));
    }

    if (total > 0) {
      this.logger.info(`Loaded ${total} skills from workspace`);
    }
    return total;
  }

  // ── Queries ────────────────────────────────────────────────────────────

  getAll(): SkillEntry[] {
    return Array.from(this.skills.values());
  }

  get(id: string): SkillEntry | null {
    return this.skills.get(id) || null;
  }

  getByName(name: string): SkillEntry | null {
    for (const entry of this.skills.values()) {
      if (entry.skill.name.toLowerCase() === name.toLowerCase()) {
        return entry;
      }
    }
    return null;
  }

  getUserInvocable(): SkillEntry[] {
    return this.getAll().filter((e) => e.enabled && e.skill.userInvocable);
  }

  getAlwaysIncluded(): SkillEntry[] {
    return this.getAll().filter((e) => e.enabled && e.skill.always);
  }

  get size(): number {
    return this.skills.size;
  }

  // ── Invocation ─────────────────────────────────────────────────────────

  invoke(idOrName: string): SkillResult | null {
    const entry = this.get(idOrName) || this.getByName(idOrName);
    if (!entry || !entry.enabled) return null;

    return {
      skillId: entry.skill.id,
      skillName: entry.skill.name,
      content: entry.skill.content,
    };
  }

  // ── Enable/Disable ─────────────────────────────────────────────────────

  enable(id: string): boolean {
    const entry = this.skills.get(id);
    if (!entry) return false;
    entry.enabled = true;
    return true;
  }

  disable(id: string): boolean {
    const entry = this.skills.get(id);
    if (!entry) return false;
    entry.enabled = false;
    return true;
  }

  remove(id: string): boolean {
    return this.skills.delete(id);
  }

  // ── Prompt Building ────────────────────────────────────────────────────

  /** Build the skills section for the system prompt. */
  buildPromptSection(): string {
    const always = this.getAlwaysIncluded();
    const invocable = this.getUserInvocable();

    if (always.length === 0 && invocable.length === 0) return "";

    const parts: string[] = ["## Available Skills\n"];

    if (always.length > 0) {
      parts.push("### Active Skills (always loaded)\n");
      for (const e of always) {
        parts.push(`#### ${e.skill.name}\n${e.skill.content}\n`);
      }
    }

    if (invocable.length > 0) {
      parts.push("### User-Invocable Skills\n");
      parts.push("The following skills can be triggered by the user via /skill <name>:\n");
      for (const e of invocable) {
        parts.push(`- **${e.skill.name}**: ${e.skill.description}`);
      }
      parts.push("");
    }

    return parts.join("\n");
  }

  // ── Parsing ────────────────────────────────────────────────────────────

  private parseSkillFile(content: string, location: string): Skill | null {
    // Parse YAML frontmatter
    const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!match) return null;

    const frontmatter = this.parseSimpleYaml(match[1]);
    const body = match[2].trim();

    if (!frontmatter.name) return null;

    const id = frontmatter.id || path.basename(location, ".md");

    return {
      id,
      name: frontmatter.name,
      description: frontmatter.description || "",
      content: body,
      location,
      always: frontmatter.always === "true",
      userInvocable: frontmatter.userInvocable !== "false", // default true
      metadata: frontmatter,
    };
  }

  private parseSimpleYaml(yaml: string): Record<string, string> {
    const result: Record<string, string> = {};
    for (const line of yaml.split("\n")) {
      const colonIdx = line.indexOf(":");
      if (colonIdx === -1) continue;
      const key = line.substring(0, colonIdx).trim();
      const value = line.substring(colonIdx + 1).trim().replace(/^["']|["']$/g, "");
      if (key) result[key] = value;
    }
    return result;
  }
}
