/**
 * Effort Level Control — Adjusts how deeply the agent analyzes requests.
 *
 * Inspired by Claude Code's --effort flag and Cursor's MAX mode.
 *
 * Effort levels:
 *   - low:    Quick responses, minimal analysis. Good for simple questions.
 *   - medium: Default. Balanced analysis and speed.
 *   - high:   Deep analysis, reads more files, considers edge cases.
 *   - max:    Extended thinking, comprehensive analysis, multiple passes.
 *
 * How it affects behavior:
 *   - System prompt instructions change based on level
 *   - Temperature may be adjusted
 *   - Token limits are scaled
 *   - The agent is instructed to use more/fewer tools
 *
 * Learning note: This is essentially a UX abstraction over multiple
 * model parameters. Instead of asking users to tweak temperature,
 * max tokens, and system prompt, they just say "try harder" or
 * "be quick about it".
 */

/**
 * Available effort levels, from quickest to most thorough.
 */
export type EffortLevel = "low" | "medium" | "high" | "max";

/**
 * Configuration values for each effort level.
 */
export interface EffortConfig {
  /** How this level affects the system prompt */
  systemPromptAddition: string;

  /** Temperature override (null = use default) */
  temperature: number | null;

  /** Max tokens multiplier (1.0 = default) */
  maxTokensMultiplier: number;

  /** Max agent turns multiplier */
  maxTurnsMultiplier: number;

  /** Human-readable description */
  description: string;
}

/**
 * Predefined configurations for each effort level.
 *
 * Learning note: These are tuned to balance speed vs thoroughness.
 * Lower effort = faster, cheaper, more concise.
 * Higher effort = slower, more expensive, more comprehensive.
 */
const EFFORT_CONFIGS: Record<EffortLevel, EffortConfig> = {
  low: {
    systemPromptAddition: [
      "# Effort: Low",
      "Be very concise. Give the shortest correct answer.",
      "- Skip detailed explanations unless asked",
      "- Use the fewest tools possible",
      "- Don't read files you don't need",
      "- One-sentence summaries are fine",
      "- Prefer quick fixes over comprehensive solutions",
    ].join("\n"),
    temperature: null,
    maxTokensMultiplier: 0.5,
    maxTurnsMultiplier: 0.5,
    description: "Quick, minimal analysis",
  },

  medium: {
    systemPromptAddition: "",  // Default behavior, no additions needed
    temperature: null,
    maxTokensMultiplier: 1.0,
    maxTurnsMultiplier: 1.0,
    description: "Balanced (default)",
  },

  high: {
    systemPromptAddition: [
      "# Effort: High",
      "Take extra care with this task. Be thorough.",
      "- Read all relevant files before making changes",
      "- Consider edge cases and error scenarios",
      "- Verify your changes compile/run correctly",
      "- Explain your reasoning for non-obvious decisions",
      "- Search for related code that might need updating",
    ].join("\n"),
    temperature: null,
    maxTokensMultiplier: 1.5,
    maxTurnsMultiplier: 2.0,
    description: "Deep analysis, thorough",
  },

  max: {
    systemPromptAddition: [
      "# Effort: Maximum",
      "This is a critical task. Use maximum thoroughness.",
      "- Exhaustively search the codebase for context",
      "- Read ALL related files, tests, and documentation",
      "- Consider architectural implications",
      "- Check for breaking changes across the project",
      "- Run tests and verify everything works",
      "- Think step-by-step before making changes",
      "- Consider multiple approaches and pick the best one",
      "- Add proper error handling and edge case coverage",
    ].join("\n"),
    temperature: null,
    maxTokensMultiplier: 2.0,
    maxTurnsMultiplier: 3.0,
    description: "Maximum thoroughness, extended thinking",
  },
};

/**
 * Manages the current effort level and provides configuration.
 */
export class EffortManager {
  private level: EffortLevel = "medium";

  /**
   * Set the effort level.
   */
  setLevel(level: EffortLevel): void {
    if (!EFFORT_CONFIGS[level]) {
      throw new Error(`Invalid effort level: ${level}. Use: low, medium, high, max`);
    }
    this.level = level;
  }

  /**
   * Get the current effort level.
   */
  getLevel(): EffortLevel {
    return this.level;
  }

  /**
   * Get the configuration for the current effort level.
   */
  getConfig(): EffortConfig {
    return EFFORT_CONFIGS[this.level];
  }

  /**
   * Get the system prompt addition for the current level.
   * Returns empty string for medium (default) level.
   */
  getSystemPromptAddition(): string {
    return EFFORT_CONFIGS[this.level].systemPromptAddition;
  }

  /**
   * Get all available levels with descriptions.
   * Useful for displaying in help or settings UI.
   */
  static getAllLevels(): Array<{ level: EffortLevel; description: string }> {
    return Object.entries(EFFORT_CONFIGS).map(([level, config]) => ({
      level: level as EffortLevel,
      description: config.description,
    }));
  }

  /**
   * Parse an effort level from a string (case-insensitive).
   * Returns null if the string is not a valid level.
   */
  static parse(input: string): EffortLevel | null {
    const normalized = input.toLowerCase().trim();
    if (normalized in EFFORT_CONFIGS) {
      return normalized as EffortLevel;
    }
    return null;
  }
}
