/**
 * Built-in skills that ship with the remote coding agent.
 *
 * These are loaded by default and can be extended by adding
 * more skills in .cdoing/skills/ or ~/.cdoing/skills/.
 */

import type { Skill } from "./types";

export const builtinSkills: Skill[] = [
  {
    id: "coding-agent",
    name: "coding-agent",
    description: "Dedicated coding agent — delegates complex coding tasks to a powerful model with full file/shell access",
    userInvocable: true,
    always: false,
    location: "builtin",
    metadata: { category: "agent", requiresSetup: true },
    content: `The coding agent skill enables delegation of complex coding tasks to a dedicated, more powerful model.

When this skill is active, the personal assistant will automatically delegate tasks involving:
- File editing, creation, or deletion
- Running shell commands (build, test, install, git)
- Debugging and fixing bugs
- Refactoring or implementing features
- Code search and analysis

The coding agent uses the delegate_to_coder tool. Configure the coding model with:
- config_manager({ action: "set", key: "coding_model", value: "claude-sonnet-4-6" })
- config_manager({ action: "set", key: "coding_provider", value: "anthropic" })

If no coding model is configured, the assistant's own model is used for coding tasks.`,
  },
];
