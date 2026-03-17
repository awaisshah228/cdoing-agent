/**
 * Skill Tool — Lets the LLM invoke, enable/disable, and list skills via chat.
 *
 * When a user says "/skill commit" or "use the review skill",
 * the LLM uses this tool to look up and invoke a registered skill.
 * The skill's prompt content is returned to the LLM, which then
 * follows those instructions.
 *
 * Actions:
 *   - list:    Show all available skills (enabled + disabled)
 *   - invoke:  Invoke a skill by name (returns its prompt content)
 *   - info:    Get details about a specific skill
 *   - enable:  Enable a disabled skill
 *   - disable: Disable an enabled skill
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
      "Invoke, enable, disable, or list available skills. Skills are reusable prompt-based " +
      "capabilities (commit, review, lint, deploy, etc.). " +
      "Use 'enable' to activate a disabled skill, 'disable' to deactivate one, " +
      "'invoke' to run a skill's instructions, 'list' to see all, 'info' for details.",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["list", "invoke", "info", "enable", "disable"],
          description: "The action to perform",
        },
        skill_name: {
          type: "string",
          description: "Skill name or ID (for invoke/info/enable/disable)",
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

        const enabled = skills.filter((e) => e.enabled);
        const disabled = skills.filter((e) => !e.enabled);
        const lines: string[] = [];

        if (enabled.length > 0) {
          lines.push("✅ Enabled skills:");
          for (const e of enabled) {
            const flags = [
              e.skill.always ? "always-on" : "",
              e.skill.userInvocable ? "invocable" : "",
            ].filter(Boolean).join(", ");
            lines.push(`  [${e.skill.id}] ${e.skill.name} — ${e.skill.description}${flags ? ` (${flags})` : ""}`);
          }
        }

        if (disabled.length > 0) {
          lines.push("\n❌ Disabled skills (enable with skill_manager({ action: 'enable', skill_name: '<id>' })):");
          for (const e of disabled) {
            const tools = e.skill.requiredTools?.length ? ` [requires: ${e.skill.requiredTools.join(", ")}]` : "";
            lines.push(`  [${e.skill.id}] ${e.skill.name} — ${e.skill.description}${tools}`);
          }
        }

        lines.push(`\nTotal: ${enabled.length} enabled, ${disabled.length} disabled`);
        return lines.join("\n");
      }

      case "invoke": {
        if (!skill_name) return "Error: skill_name is required.";
        const entry = this.state.skillRegistry.get(skill_name) || this.state.skillRegistry.getByName(skill_name);

        if (!entry) return `Skill "${skill_name}" not found. Use action "list" to see available skills.`;

        if (!entry.enabled) {
          const tools = entry.skill.requiredTools?.length
            ? `\nThis skill requires: ${entry.skill.requiredTools.join(", ")}`
            : "";
          return (
            `Skill "${entry.skill.name}" is DISABLED. ` +
            `Ask the owner if they'd like to enable it.\n\n` +
            `To enable: skill_manager({ action: "enable", skill_name: "${entry.skill.id}" })` +
            tools
          );
        }

        const result = this.state.skillRegistry.invoke(skill_name);
        if (!result) return `Skill "${skill_name}" not found or disabled.`;
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
          `Required tools: ${s.requiredTools?.join(", ") || "none"}`,
          `Source: ${s.location}`,
          `\nContent:\n${s.content}`,
        ].join("\n");
      }

      case "enable": {
        if (!skill_name) return "Error: skill_name is required.";
        const entry = this.state.skillRegistry.get(skill_name) || this.state.skillRegistry.getByName(skill_name);
        if (!entry) return `Skill "${skill_name}" not found. Use "list" to see all skills.`;
        if (entry.enabled) return `Skill "${entry.skill.name}" is already enabled.`;
        this.state.skillRegistry.enable(entry.skill.id);
        return `✅ Skill "${entry.skill.name}" is now enabled.\n\n${entry.skill.description}`;
      }

      case "disable": {
        if (!skill_name) return "Error: skill_name is required.";
        const entry = this.state.skillRegistry.get(skill_name) || this.state.skillRegistry.getByName(skill_name);
        if (!entry) return `Skill "${skill_name}" not found.`;
        if (!entry.enabled) return `Skill "${entry.skill.name}" is already disabled.`;
        this.state.skillRegistry.disable(entry.skill.id);
        return `❌ Skill "${entry.skill.name}" is now disabled.`;
      }

      default:
        return `Unknown action: ${action}. Use: list, invoke, info, enable, disable`;
    }
  }
}
