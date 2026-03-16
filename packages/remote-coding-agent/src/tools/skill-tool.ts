/**
 * Skill Tool — Lets the LLM invoke skills via chat.
 *
 * When a user says "/skill commit" or "use the review skill",
 * the LLM uses this tool to look up and invoke a registered skill.
 * The skill's prompt content is returned to the LLM, which then
 * follows those instructions.
 *
 * Actions:
 *   - list:   Show all available skills
 *   - invoke: Invoke a skill by name (returns its prompt content)
 *   - info:   Get details about a specific skill
 */

import type { BaseTool, ToolDefinition, ToolResult } from "@cdoing/core";
import type { SkillRegistry } from "../skills/registry";

/** Mutable state injected from the engine. */
export interface SkillToolState {
  skillRegistry: SkillRegistry;
}

export class SkillTool implements BaseTool {
  definition: ToolDefinition = {
    name: "skill_manager",
    description:
      "Invoke or list available skills. Skills are reusable prompt-based " +
      "capabilities (commit, review, explain, test, etc.). Use 'invoke' to " +
      "activate a skill's instructions.",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["list", "invoke", "info"],
          description: "The action to perform",
        },
        skill_name: {
          type: "string",
          description: "Skill name or ID (for invoke/info)",
        },
      },
      required: ["action"],
    },
    requiresPermission: false,
  };

  constructor(private state: SkillToolState) {}

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    try {
      const output = await this.run(input);
      return { success: true, output };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, output: "", error: msg };
    }
  }

  private async run(input: Record<string, unknown>): Promise<string> {
    const { action, skill_name } = input as { action: string; skill_name?: string };

    switch (action) {
      case "list": {
        const skills = this.state.skillRegistry.getAll();
        if (skills.length === 0) return "No skills loaded.";
        return skills.map((e) => {
          const flags = [
            e.enabled ? "enabled" : "disabled",
            e.skill.always ? "always-on" : "",
            e.skill.userInvocable ? "invocable" : "",
          ].filter(Boolean).join(", ");
          return `[${e.skill.id}] ${e.skill.name} — ${e.skill.description} (${flags})`;
        }).join("\n");
      }

      case "invoke": {
        if (!skill_name) return "Error: skill_name is required.";
        const result = this.state.skillRegistry.invoke(skill_name);
        if (!result) return `Skill "${skill_name}" not found or disabled. Use action "list" to see available skills.`;
        return `Skill "${result.skillName}" activated. Follow these instructions:\n\n${result.content}`;
      }

      case "info": {
        if (!skill_name) return "Error: skill_name is required.";
        const entry = this.state.skillRegistry.get(skill_name) || this.state.skillRegistry.getByName(skill_name);
        if (!entry) return `Skill "${skill_name}" not found.`;
        const s = entry.skill;
        return [
          `Name: ${s.name}`,
          `ID: ${s.id}`,
          `Description: ${s.description}`,
          `Enabled: ${entry.enabled}`,
          `Always-on: ${s.always || false}`,
          `User-invocable: ${s.userInvocable !== false}`,
          `Source: ${s.location}`,
          `\nContent:\n${s.content}`,
        ].join("\n");
      }

      default:
        return `Unknown action: ${action}. Use: list, invoke, info`;
    }
  }
}
