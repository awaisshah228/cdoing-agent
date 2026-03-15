/**
 * System Info Tool — gives the LLM runtime awareness of its own
 * permission mode, settings rules, sandbox config, and available tools.
 *
 * This replaces hardcoded permission docs in the system prompt with
 * a live, queryable tool the agent can call at any time.
 */

import type { BaseTool, ToolDefinition, ToolResult } from "./types";
import type { PermissionManager } from "../permissions";
import type { SandboxManager } from "../sandbox";
import type { ToolRegistry } from "./registry";

export class SystemInfoTool implements BaseTool {
  definition: ToolDefinition = {
    name: "system_info",
    description:
      "Get information about your current permissions, sandbox restrictions, available tools, and system configuration. Call this when you need to understand what you can or cannot do, or when the user asks about your access level. No arguments required — returns a full status report.",
    inputSchema: {
      type: "object",
      properties: {
        section: {
          type: "string",
          description:
            "Optional: request a specific section. Values: 'permissions', 'sandbox', 'tools', 'all'. Default: 'all'.",
        },
      },
      required: [],
    },
    requiresPermission: false,
  };

  private permissionManager: PermissionManager;
  private sandboxManager?: SandboxManager;
  private toolRegistry: ToolRegistry;

  constructor(
    permissionManager: PermissionManager,
    toolRegistry: ToolRegistry,
    sandboxManager?: SandboxManager,
  ) {
    this.permissionManager = permissionManager;
    this.toolRegistry = toolRegistry;
    this.sandboxManager = sandboxManager;
  }

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const section = (input.section as string) || "all";
    const parts: string[] = [];

    if (section === "all" || section === "permissions") {
      parts.push(this.buildPermissionsSection());
    }
    if (section === "all" || section === "sandbox") {
      parts.push(this.buildSandboxSection());
    }
    if (section === "all" || section === "tools") {
      parts.push(this.buildToolsSection());
    }

    return { success: true, output: parts.join("\n\n") };
  }

  private buildPermissionsSection(): string {
    const mode = this.permissionManager.getMode();
    const rules = this.permissionManager.getSettingsRules();
    const stored = this.permissionManager.getStoredRules();

    const lines: string[] = [
      "## Permission System Status",
      "",
      `**Current Mode:** ${mode}`,
      this.describeModeEffect(mode),
      "",
    ];

    // Settings rules
    if (rules.deny.length || rules.allow.length || rules.ask.length) {
      lines.push("### Settings Rules (from .claude/settings.json)");
      lines.push("Rules are evaluated: deny → ask → allow. Deny always wins.");
      lines.push("");
      if (rules.deny.length) {
        lines.push("**Deny (always blocked):**");
        for (const r of rules.deny) lines.push(`  - ${r}`);
      }
      if (rules.ask.length) {
        lines.push("**Ask (prompt user, even if allow matches):**");
        for (const r of rules.ask) lines.push(`  - ${r}`);
      }
      if (rules.allow.length) {
        lines.push("**Allow (auto-approved):**");
        for (const r of rules.allow) lines.push(`  - ${r}`);
      }
      lines.push("");
    } else {
      lines.push("No settings-based rules configured. All tool calls fall through to the mode-based behavior.");
      lines.push("");
    }

    // Stored rules
    const globalCount = stored.global.length;
    const projectCount = stored.project.length;
    if (globalCount || projectCount) {
      lines.push("### Previously Approved Rules");
      if (globalCount) {
        lines.push(`Global (always): ${globalCount} rule(s)`);
        for (const r of stored.global) {
          lines.push(`  - ${r.tool}${r.inputMatch ? ` (${r.inputMatch})` : ""}`);
        }
      }
      if (projectCount) {
        lines.push(`Project: ${projectCount} rule(s)`);
        for (const r of stored.project) {
          lines.push(`  - ${r.tool}${r.inputMatch ? ` (${r.inputMatch})` : ""}`);
        }
      }
      lines.push("");
    }

    // Decision flow
    lines.push("### Decision Flow");
    lines.push("When you call a tool, the system evaluates in this order:");
    lines.push("1. Bypass mode → allow all");
    lines.push("2. Tool doesn't require permission (file_read, glob_search, grep_search, system_info) → allow");
    lines.push("3. Settings deny rule matches → BLOCKED");
    lines.push("4. Settings ask rule matches → prompt user");
    lines.push("5. Settings allow rule matches → auto-approve");
    lines.push("6. Previously approved stored rule → auto-approve");
    lines.push("7. Mode fallback (plan blocks writes, acceptEdits allows edits, default prompts user)");

    return lines.join("\n");
  }

  private describeModeEffect(mode: string): string {
    switch (mode) {
      case "default":
        return "Effect: You must get user approval for every write/exec tool call. Read-only tools (file_read, glob_search, grep_search) work freely.";
      case "acceptEdits":
        return "Effect: File writes and edits are auto-approved. Shell commands and file_run still require user approval.";
      case "plan":
        return "Effect: READ-ONLY mode. file_write, file_edit, shell_exec, and file_run are completely blocked. You can only read files and search code.";
      case "dontAsk":
        return "Effect: Everything is denied unless it matches an explicit allow rule in settings. No user prompts are shown.";
      case "bypassPermissions":
        return "Effect: All tools are auto-approved without any prompts. The user has opted into this unsafe mode.";
      default:
        return `Effect: Unknown mode "${mode}" — behaves like default.`;
    }
  }

  private buildSandboxSection(): string {
    const lines: string[] = ["## Sandbox Status", ""];

    if (!this.sandboxManager || !this.sandboxManager.isEnabled()) {
      lines.push("**Sandbox: DISABLED**");
      lines.push("No filesystem or network restrictions are enforced beyond the permission system.");
      return lines.join("\n");
    }

    const config = this.sandboxManager.getConfig();
    lines.push(`**Sandbox: ENABLED (${config.mode} mode)**`);
    lines.push("");

    // Mode explanation
    if (config.mode === "auto-allow") {
      lines.push("Mode: **auto-allow** — Commands that pass sandbox checks are auto-approved without a permission prompt.");
    } else {
      lines.push("Mode: **regular** — Sandbox enforces restrictions, but permission prompts are still shown.");
    }
    lines.push("");

    // Filesystem
    lines.push("### Filesystem Restrictions");
    lines.push("Writes are allowed to: the working directory" +
      (config.filesystem.allowWrite.length ? ` + ${config.filesystem.allowWrite.join(", ")}` : " (only)"));

    if (config.filesystem.denyWrite.length) {
      lines.push("Writes DENIED to: " + config.filesystem.denyWrite.join(", "));
    }
    if (config.filesystem.denyRead.length) {
      lines.push("Reads DENIED from: " + config.filesystem.denyRead.join(", "));
    }
    if (!config.filesystem.denyWrite.length && !config.filesystem.denyRead.length) {
      lines.push("No explicit deny rules for filesystem paths.");
    }
    lines.push("");

    // Network
    lines.push("### Network Restrictions");
    if (config.network.allowedDomains.length) {
      lines.push("Allowed domains: " + config.network.allowedDomains.join(", "));
    } else {
      lines.push("No domains pre-allowed.");
    }
    if (config.network.allowManagedDomainsOnly) {
      lines.push("Policy: **strict** — non-allowed domains are blocked silently (no user prompt).");
    } else {
      lines.push("Policy: **prompt** — non-allowed domains trigger a user prompt for approval.");
    }
    lines.push("");

    // Excluded commands
    if (config.excludedCommands.length) {
      lines.push("### Excluded Commands (bypass sandbox, still need permission)");
      lines.push(config.excludedCommands.join(", "));
      lines.push("");
    }

    // Escape hatch
    lines.push(`dangerouslyDisableSandbox: ${config.allowUnsandboxedCommands ? "available (user allows)" : "DISABLED (blocked by user)"}`);

    return lines.join("\n");
  }

  private buildToolsSection(): string {
    const tools = this.toolRegistry.getAll();
    const lines: string[] = ["## Available Tools", ""];

    const permissionRequired: string[] = [];
    const noPermission: string[] = [];

    for (const tool of tools) {
      const def = tool.definition;
      const entry = `- **${def.name}**: ${def.description.split(".")[0]}.`;
      if (def.requiresPermission) {
        permissionRequired.push(entry);
      } else {
        noPermission.push(entry);
      }
    }

    if (noPermission.length) {
      lines.push("### Free to use (no permission needed):");
      lines.push(...noPermission);
      lines.push("");
    }

    if (permissionRequired.length) {
      lines.push("### Requires permission:");
      lines.push(...permissionRequired);
      lines.push("");
    }

    lines.push(`Total: ${tools.length} tools (${noPermission.length} free, ${permissionRequired.length} permission-required)`);

    return lines.join("\n");
  }
}
