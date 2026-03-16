/**
 * Skills type definitions.
 *
 * Skills are reusable prompt-based capabilities that extend the agent.
 * They are loaded from SKILL.md files with YAML frontmatter.
 *
 * Inspired by OpenClaw's skills system.
 */

/** Parsed skill definition. */
export interface Skill {
  /** Unique skill identifier (derived from filename or frontmatter). */
  id: string;
  /** Human-readable name. */
  name: string;
  /** Short description of what the skill does. */
  description: string;
  /** The full skill prompt/instructions content. */
  content: string;
  /** Source file location. */
  location: string;
  /** Whether the skill is always included in the system prompt. */
  always?: boolean;
  /** Whether users can invoke this skill via /skill command. */
  userInvocable?: boolean;
  /** Custom metadata from frontmatter. */
  metadata?: Record<string, unknown>;
}

/** Skill registry entry with runtime state. */
export interface SkillEntry {
  skill: Skill;
  /** Whether the skill is currently enabled. */
  enabled: boolean;
  /** Load timestamp. */
  loadedAt: number;
}

/** Skill invocation result. */
export interface SkillResult {
  skillId: string;
  skillName: string;
  content: string;
}
