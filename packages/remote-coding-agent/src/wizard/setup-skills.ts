/**
 * Skills Setup Module — Configure which skills are enabled.
 *
 * Uses a multiSelect checklist with space-toggle (like openclaw's dialog-select).
 * Navigate with Up/Down, toggle with Space, confirm with Enter.
 * Ctrl+A selects all, Ctrl+D deselects all.
 */

import type { WizardPrompter } from "./prompts";
import type { SkillOption, WizardFlow } from "./setup-types";

// ── Skill Catalog ────────────────────────────────────────────────────────

export const SKILL_OPTIONS: SkillOption[] = [
  { id: "coding-agent", name: "Coding Agent", desc: "Delegate coding tasks to a powerful model", defaultOn: true },
];

// ── Setup ────────────────────────────────────────────────────────────────

export async function setupSkills(
  prompter: WizardPrompter,
  opts: { flow: WizardFlow; skipSkills?: boolean },
): Promise<string[]> {
  if (opts.skipSkills) {
    await prompter.note("Skipping skills setup. Using defaults.", "Skills");
    return SKILL_OPTIONS.filter((s) => s.defaultOn).map((s) => s.id);
  }

  // QuickStart: use defaults without prompting
  if (opts.flow === "quickstart") {
    const defaults = SKILL_OPTIONS.filter((s) => s.defaultOn).map((s) => s.id);
    await prompter.note(
      `Enabled by default: ${defaults.join(", ")}\nYou can change these later via the dashboard.`,
      "Skills (QuickStart)",
    );
    return defaults;
  }

  // Advanced: multiSelect checklist with space-toggle
  return prompter.multiSelect({
    message: "Skills",
    options: SKILL_OPTIONS.map((s) => ({
      value: s.id,
      label: s.name,
      hint: s.desc,
      selected: s.defaultOn,
    })),
  });
}
