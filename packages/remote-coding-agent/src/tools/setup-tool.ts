/**
 * Setup Tool — Lets the personal assistant check, install, and configure
 * CLI tools on the owner's PC.
 *
 * When the coding agent reports "gh is not installed" or a user asks
 * "set up GitHub CLI", the assistant uses this tool to:
 *
 *   1. `check` — Scan which tools are installed / missing
 *   2. `install` — Run the install command for a specific tool
 *   3. `setup` — Run post-install config (e.g., `gh auth login`)
 *   4. `list` — Show all known tools and their status
 *   5. `info` — Get install/setup instructions for a tool
 *
 * This tool lives on the ASSISTANT side (not coding agent) because
 * installing tools is a management/config concern, not a coding task.
 *
 * Security: install commands run in a shell — they are pre-defined in
 * KNOWN_TOOLS, not user-supplied. The assistant cannot run arbitrary commands.
 */

import type { BaseTool, ToolDefinition, ToolResult } from "@cdoing/core";
import { execSync } from "child_process";
import {
  KNOWN_TOOLS,
  scanAllTools,
  scanTools,
  checkToolById,
  getInstallInstructions,
  type ToolReport,
} from "./tool-checker";

/** Cached tool report — refreshed on each `check` or `list` action. */
export interface SetupToolState {
  /** Last scan report (cached so prompts can reference it). */
  lastReport: ToolReport | null;
  /** Callback when a tool is installed (so engine can refresh prompts). */
  onToolInstalled?: (toolId: string) => void;
}

export class SetupToolTool implements BaseTool {
  definition: ToolDefinition = {
    name: "setup_tool",
    description:
      "Check, install, and configure CLI tools on the owner's PC. " +
      "Use this when the coding agent reports a missing tool, or when the owner " +
      "asks to set up something like GitHub CLI, Vercel, Docker, etc. " +
      "Actions: check (scan tools), install (install a tool), setup (post-install config), " +
      "list (show all known tools), info (get instructions for a tool).",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["check", "install", "setup", "list", "info"],
          description:
            "check: scan if tools are installed. " +
            "install: install a specific tool. " +
            "setup: run post-install config for a tool (e.g. gh auth login). " +
            "list: show all known tools with status. " +
            "info: get install/setup instructions without running them.",
        },
        tool_id: {
          type: "string",
          description:
            "The tool to act on (e.g. 'gh', 'git', 'vercel', 'docker'). " +
            "Required for install, setup, and info actions. " +
            "Optional for check (if omitted, scans all tools).",
        },
        tool_ids: {
          type: "array",
          items: { type: "string" },
          description: "Check multiple specific tools at once (for 'check' action only).",
        },
      },
      required: ["action"],
    },
    requiresPermission: true,
    permissionMessage: (input) => {
      switch (input.action) {
        case "install":
          return `Install CLI tool: ${input.tool_id}`;
        case "setup":
          return `Run post-install setup for: ${input.tool_id}`;
        default:
          return `Check tool status: ${input.tool_id || "all"}`;
      }
    },
  };

  private state: SetupToolState;

  constructor(state: SetupToolState) {
    this.state = state;
  }

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const action = input.action as string;
    const toolId = input.tool_id as string | undefined;
    const toolIds = input.tool_ids as string[] | undefined;

    switch (action) {
      case "check":
        return this.handleCheck(toolId, toolIds);
      case "install":
        if (!toolId) return { success: false, output: "", error: "tool_id is required for install action" };
        return this.handleInstall(toolId);
      case "setup":
        if (!toolId) return { success: false, output: "", error: "tool_id is required for setup action" };
        return this.handleSetup(toolId);
      case "list":
        return this.handleList();
      case "info":
        if (!toolId) return { success: false, output: "", error: "tool_id is required for info action" };
        return this.handleInfo(toolId);
      default:
        return { success: false, output: "", error: `Unknown action: ${action}. Use check, install, setup, list, or info.` };
    }
  }

  // ── Check ─────────────────────────────────────────────────────────────────

  private handleCheck(toolId?: string, toolIds?: string[]): ToolResult {
    let report: ToolReport;

    if (toolId) {
      report = scanTools([toolId]);
    } else if (toolIds && toolIds.length > 0) {
      report = scanTools(toolIds);
    } else {
      report = scanAllTools();
    }

    this.state.lastReport = report;

    const installed = report.tools.filter((t) => t.installed);
    const missing = report.tools.filter((t) => !t.installed);

    const lines: string[] = [`Tool scan complete (${report.tools.length} tools checked)\n`];

    const notAuthed = installed.filter((t) => t.authenticated === false);

    if (installed.length > 0) {
      lines.push("✅ Installed:");
      for (const t of installed) {
        let authTag = "";
        if (t.authenticated === true) authTag = " ✅ authenticated";
        else if (t.authenticated === false) authTag = " ⚠️ NOT authenticated";
        lines.push(`  ${t.id} (${t.name}) — ${t.version || "installed"}${authTag}`);
      }
    }

    if (notAuthed.length > 0) {
      lines.push("\n⚠️ Installed but NOT authenticated (commands requiring auth will fail):");
      for (const t of notAuthed) {
        lines.push(`  ${t.id}: ${t.authDescription || "credentials not configured"}`);
      }
      lines.push(
        "\nTo set up credentials: setup_tool({ action: 'setup', tool_id: '<id>' })"
      );
    }

    if (missing.length > 0) {
      lines.push("\n❌ Not installed:");
      for (const t of missing) {
        lines.push(`  ${t.id} (${t.name}) — ${t.description}`);
      }
      lines.push(
        "\nTo install a missing tool, use: setup_tool({ action: 'install', tool_id: '<id>' })"
      );
    }

    if (missing.length === 0 && notAuthed.length === 0 && installed.length > 0) {
      lines.push("\nAll checked tools are installed and authenticated! 🎉");
    }

    return { success: true, output: lines.join("\n") };
  }

  // ── Install ───────────────────────────────────────────────────────────────

  private handleInstall(toolId: string): ToolResult {
    const tool = KNOWN_TOOLS.find((t) => t.id === toolId);
    if (!tool) {
      // Check if it's a custom/unknown tool
      const knownIds = KNOWN_TOOLS.map((t) => t.id).join(", ");
      return {
        success: false,
        output: "",
        error: `Unknown tool: "${toolId}". Known tools: ${knownIds}`,
      };
    }

    // Check if already installed
    const status = checkToolById(toolId);
    if (status?.installed) {
      return {
        success: true,
        output: `${tool.name} is already installed: ${status.version || "installed"}\n\nNo action needed.`,
      };
    }

    // Get the install command for this platform
    const platform = process.platform as "darwin" | "linux" | "win32";
    const installCmd = tool.install[platform] || tool.install.universal;

    if (!installCmd) {
      return {
        success: false,
        output: "",
        error: `No install command available for ${tool.name} on ${platform}. Visit: ${tool.install.universal}`,
      };
    }

    // If it's a URL, don't try to run it
    if (installCmd.startsWith("http")) {
      return {
        success: true,
        output:
          `${tool.name} needs to be downloaded manually.\n\n` +
          `Download from: ${installCmd}\n\n` +
          `After installing, run: setup_tool({ action: 'check', tool_id: '${toolId}' }) to verify.`,
      };
    }

    // Run the install command
    try {
      const output = execSync(installCmd, {
        stdio: "pipe",
        encoding: "utf-8",
        timeout: 120_000, // 2 min timeout for installs
      });

      // Verify installation
      const verifyStatus = checkToolById(toolId);
      const verified = verifyStatus?.installed;

      if (this.state.onToolInstalled) {
        this.state.onToolInstalled(toolId);
      }

      const lines: string[] = [
        `Ran: ${installCmd}`,
        "",
        output ? `Output:\n${output.substring(0, 500)}` : "(no output)",
        "",
        verified
          ? `✅ ${tool.name} is now installed: ${verifyStatus?.version || "installed"}`
          : `⚠️ Install command ran, but ${tool.name} may not be in PATH yet. Try opening a new terminal.`,
      ];

      if (tool.setupSteps && tool.setupSteps.length > 0) {
        lines.push(
          `\n📋 Next steps — run setup_tool({ action: 'setup', tool_id: '${toolId}' }) to configure it.`
        );
      }

      return { success: true, output: lines.join("\n") };
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      const stderr = (err as any)?.stderr?.toString?.() || "";

      return {
        success: false,
        output: "",
        error:
          `Failed to install ${tool.name}.\n\n` +
          `Command: ${installCmd}\n` +
          `Error: ${error.message}\n` +
          (stderr ? `Stderr: ${stderr.substring(0, 500)}\n` : "") +
          `\nYou may need to install it manually: ${tool.install.universal}`,
      };
    }
  }

  // ── Setup (post-install config) ───────────────────────────────────────────

  private handleSetup(toolId: string): ToolResult {
    const tool = KNOWN_TOOLS.find((t) => t.id === toolId);
    if (!tool) {
      return { success: false, output: "", error: `Unknown tool: "${toolId}"` };
    }

    // Check if installed first
    const status = checkToolById(toolId);
    if (!status?.installed) {
      return {
        success: false,
        output: "",
        error:
          `${tool.name} is not installed yet. Install it first:\n` +
          `setup_tool({ action: 'install', tool_id: '${toolId}' })`,
      };
    }

    if (!tool.setupSteps || tool.setupSteps.length === 0) {
      return {
        success: true,
        output: `${tool.name} is installed and doesn't require additional setup. Ready to use!`,
      };
    }

    // For interactive commands (like gh auth login), we can't run them
    // non-interactively in most cases. Report them as instructions.
    const interactiveKeywords = ["login", "auth", "init", "configure"];
    const isInteractive = tool.setupSteps.some((step) =>
      interactiveKeywords.some((kw) => step.includes(kw))
    );

    if (isInteractive) {
      const lines: string[] = [
        `${tool.name} is installed but needs interactive setup.\n`,
        `The owner needs to run these commands in a terminal:\n`,
      ];
      for (const step of tool.setupSteps) {
        lines.push(`  ${step}`);
      }
      lines.push(
        `\nThese commands require interactive input (browser auth, credentials, etc.) ` +
        `and cannot be run automatically.\n\n` +
        `Tell the owner to open a terminal and run the commands above, then try again.`
      );
      return { success: true, output: lines.join("\n") };
    }

    // Non-interactive setup steps — run them
    const results: string[] = [];
    for (const step of tool.setupSteps) {
      try {
        const output = execSync(step, {
          stdio: "pipe",
          encoding: "utf-8",
          timeout: 30_000,
        });
        results.push(`✅ ${step}\n${output || "(ok)"}`);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        results.push(`❌ ${step}\n${error.message}`);
      }
    }

    return { success: true, output: results.join("\n\n") };
  }

  // ── List ──────────────────────────────────────────────────────────────────

  private handleList(): ToolResult {
    const report = scanAllTools();
    this.state.lastReport = report;

    const byCategory = new Map<string, typeof report.tools>();
    for (const t of report.tools) {
      const list = byCategory.get(t.category) || [];
      list.push(t);
      byCategory.set(t.category, list);
    }

    const categoryNames: Record<string, string> = {
      vcs: "Version Control",
      deploy: "Deploy / Hosting",
      runtime: "Runtimes",
      package: "Package Managers",
      container: "Containers",
      cloud: "Cloud CLIs",
      database: "Databases",
      utility: "Utilities",
    };

    const lines: string[] = ["=== CLI Tools on This Machine ===\n"];

    for (const [cat, tools] of byCategory) {
      lines.push(`── ${categoryNames[cat] || cat} ──`);
      for (const t of tools) {
        const icon = t.installed ? "✅" : "❌";
        const ver = t.installed ? (t.version || "installed") : "not installed";
        let authTag = "";
        if (t.installed && t.authenticated === true) authTag = " [auth ✅]";
        else if (t.installed && t.authenticated === false) authTag = " [auth ❌]";
        lines.push(`  ${icon} ${t.id} (${t.name}) — ${ver}${authTag}`);
      }
      lines.push("");
    }

    const installed = report.tools.filter((t) => t.installed).length;
    const authed = report.tools.filter((t) => t.authenticated === true).length;
    const needsAuth = report.tools.filter((t) => t.authenticated === false).length;
    lines.push(`Total: ${installed}/${report.tools.length} installed`);
    if (authed > 0 || needsAuth > 0) {
      lines.push(`Auth: ${authed} authenticated, ${needsAuth} need credentials`);
    }

    return { success: true, output: lines.join("\n") };
  }

  // ── Info ──────────────────────────────────────────────────────────────────

  private handleInfo(toolId: string): ToolResult {
    const instructions = getInstallInstructions(toolId);
    if (!instructions) {
      const knownIds = KNOWN_TOOLS.map((t) => t.id).join(", ");
      return {
        success: false,
        output: "",
        error: `Unknown tool: "${toolId}". Known tools: ${knownIds}`,
      };
    }

    const status = checkToolById(toolId);
    const statusLine = status?.installed
      ? `\n**Current status:** ✅ Installed (${status.version || "unknown version"})`
      : `\n**Current status:** ❌ Not installed`;

    return { success: true, output: instructions + statusLine };
  }
}
