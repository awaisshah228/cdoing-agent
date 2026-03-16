/**
 * Config Manager Tool
 *
 * Gives the LLM agent the ability to read and change the remote coding
 * agent's runtime configuration via chat. Users can ask:
 *
 *   "Switch to GPT-4o"          → set provider=openai, model=gpt-4o
 *   "What model am I using?"    → get model
 *   "Change working dir to X"   → set working_dir=/path
 *   "Show all config"           → list
 *   "Enable auto mode"          → set permission_mode=auto
 *   "Show connected channels"   → get channels
 *
 * This tool lives in remote-coding-agent (not core) because it manages
 * runtime state specific to the remote agent — sessions, channels, etc.
 */

import type { BaseTool, ToolDefinition, ToolResult } from "@cdoing/core";
import type { AgentConfig, SecurityConfig, AppConfig } from "../types";
import * as fs from "fs";

/** Mutable runtime state that the tool can read/write. */
export interface ConfigManagerState {
  /** Current agent config (mutable — changes take effect on next agent creation) */
  agentConfig: AgentConfig;
  /** Security config */
  securityConfig: SecurityConfig;
  /** Current working directory */
  workingDir: string;
  /** Full app config (read-only reference) */
  appConfig: AppConfig;
  /** Callback to invalidate cached agents (forces re-creation with new config) */
  onConfigChanged: (key: string, value: string) => void;
}

export class ConfigManagerTool implements BaseTool {
  definition: ToolDefinition = {
    name: "config_manager",
    description:
      "Read or change the remote coding agent's runtime configuration. " +
      "Use this to switch AI models, change providers, update the working directory, " +
      "adjust permissions, or inspect the current setup. Changes take effect immediately.",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["get", "set", "list"],
          description: "get: read a config value, set: change a value, list: show all config",
        },
        key: {
          type: "string",
          enum: [
            "model",
            "provider",
            "api_key",
            "working_dir",
            "permission_mode",
            "max_turns",
            "max_tokens",
            "system_prompt",
            "log_level",
            "rate_limit",
            "allowed_dirs",
            "channels",
            "sessions",
          ],
          description: "Configuration key to read or write",
        },
        value: {
          type: "string",
          description: "New value for the key (required for 'set' action)",
        },
      },
      required: ["action"],
    },
    requiresPermission: true,
    permissionMessage: (input) => {
      if (input.action === "set") {
        return `Change config: ${input.key} = ${input.value}`;
      }
      return `Read config: ${input.key || "all"}`;
    },
  };

  private state: ConfigManagerState;

  constructor(state: ConfigManagerState) {
    this.state = state;
  }

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const action = input.action as string;
    const key = input.key as string | undefined;
    const value = input.value as string | undefined;

    switch (action) {
      case "list":
        return this.listConfig();
      case "get":
        if (!key) return { success: false, output: "", error: "key is required for 'get' action" };
        return this.getConfig(key);
      case "set":
        if (!key) return { success: false, output: "", error: "key is required for 'set' action" };
        if (value === undefined) return { success: false, output: "", error: "value is required for 'set' action" };
        return this.setConfig(key, value);
      default:
        return { success: false, output: "", error: `Unknown action: ${action}. Use get, set, or list.` };
    }
  }

  // ── List all config ────────────────────────────────────────────────────

  private listConfig(): ToolResult {
    const { agentConfig, securityConfig, workingDir, appConfig } = this.state;

    const lines = [
      "=== Remote Coding Agent Configuration ===",
      "",
      "-- Agent --",
      `  provider: ${agentConfig.provider}`,
      `  model: ${agentConfig.model}`,
      `  api_key: ${agentConfig.apiKey ? "***" + agentConfig.apiKey.slice(-4) : "(from env)"}`,
      `  max_turns: ${agentConfig.maxTurns}`,
      `  max_tokens: ${agentConfig.maxTokens || "default"}`,
      `  permission_mode: ${agentConfig.permissionMode}`,
      `  system_prompt: ${agentConfig.systemPrompt ? agentConfig.systemPrompt.substring(0, 80) + "..." : "(default)"}`,
      "",
      "-- Environment --",
      `  working_dir: ${workingDir}`,
      `  log_level: ${appConfig.logLevel}`,
      "",
      "-- Security --",
      `  rate_limit: ${securityConfig.rateLimitPerMinute}/min`,
      `  allowed_dirs: ${securityConfig.allowedDirs.length > 0 ? securityConfig.allowedDirs.join(", ") : "(unrestricted)"}`,
      "",
      "-- Channels --",
      ...Object.entries(appConfig.channels).map(
        ([id, ch]) => `  ${id}: ${ch.enabled ? "enabled" : "disabled"}`
      ),
      "",
      "-- Sessions --",
      `  ttl: ${appConfig.session.ttlMs / 1000}s`,
      `  max_history: ${appConfig.session.maxHistoryMessages}`,
      `  max_sessions: ${appConfig.session.maxSessions}`,
    ];

    return { success: true, output: lines.join("\n") };
  }

  // ── Get a single config value ──────────────────────────────────────────

  private getConfig(key: string): ToolResult {
    const { agentConfig, securityConfig, workingDir, appConfig } = this.state;

    switch (key) {
      case "model":
        return { success: true, output: `model: ${agentConfig.model}` };
      case "provider":
        return { success: true, output: `provider: ${agentConfig.provider}` };
      case "api_key":
        return { success: true, output: `api_key: ${agentConfig.apiKey ? "***" + agentConfig.apiKey.slice(-4) : "(from env)"}` };
      case "working_dir":
        return { success: true, output: `working_dir: ${workingDir}` };
      case "permission_mode":
        return { success: true, output: `permission_mode: ${agentConfig.permissionMode}` };
      case "max_turns":
        return { success: true, output: `max_turns: ${agentConfig.maxTurns}` };
      case "max_tokens":
        return { success: true, output: `max_tokens: ${agentConfig.maxTokens || "default"}` };
      case "system_prompt":
        return { success: true, output: `system_prompt: ${agentConfig.systemPrompt || "(default)"}` };
      case "log_level":
        return { success: true, output: `log_level: ${appConfig.logLevel}` };
      case "rate_limit":
        return { success: true, output: `rate_limit: ${securityConfig.rateLimitPerMinute}/min` };
      case "allowed_dirs":
        return { success: true, output: `allowed_dirs: ${securityConfig.allowedDirs.length > 0 ? securityConfig.allowedDirs.join(", ") : "(unrestricted)"}` };
      case "channels":
        const channelLines = Object.entries(appConfig.channels)
          .map(([id, ch]) => `  ${id}: ${ch.enabled ? "enabled" : "disabled"}`);
        return { success: true, output: `channels:\n${channelLines.join("\n")}` };
      case "sessions":
        return { success: true, output: `sessions: ttl=${appConfig.session.ttlMs / 1000}s, max_history=${appConfig.session.maxHistoryMessages}, max_sessions=${appConfig.session.maxSessions}` };
      default:
        return { success: false, output: "", error: `Unknown config key: ${key}` };
    }
  }

  // ── Set a config value ─────────────────────────────────────────────────

  private setConfig(key: string, value: string): ToolResult {
    const { agentConfig, securityConfig } = this.state;

    switch (key) {
      case "model": {
        const old = agentConfig.model;
        agentConfig.model = value;
        this.state.onConfigChanged("model", value);
        return { success: true, output: `model changed: ${old} -> ${value}\nNew agent instances will use this model.` };
      }

      case "provider": {
        const validProviders = ["anthropic", "openai", "google", "ollama", "custom"];
        if (!validProviders.includes(value)) {
          return { success: false, output: "", error: `Invalid provider: ${value}. Valid: ${validProviders.join(", ")}` };
        }
        const old = agentConfig.provider;
        agentConfig.provider = value;
        this.state.onConfigChanged("provider", value);
        return { success: true, output: `provider changed: ${old} -> ${value}` };
      }

      case "api_key": {
        agentConfig.apiKey = value;
        this.state.onConfigChanged("api_key", "***");
        return { success: true, output: "api_key updated (new agents will use it)" };
      }

      case "working_dir": {
        if (!fs.existsSync(value)) {
          return { success: false, output: "", error: `Directory not found: ${value}` };
        }
        const stat = fs.statSync(value);
        if (!stat.isDirectory()) {
          return { success: false, output: "", error: `Not a directory: ${value}` };
        }
        if (securityConfig.allowedDirs.length > 0) {
          const allowed = securityConfig.allowedDirs.some((d) => value.startsWith(d));
          if (!allowed) {
            return { success: false, output: "", error: `Directory not in allowed list: ${value}` };
          }
        }
        const old = this.state.workingDir;
        this.state.workingDir = value;
        this.state.onConfigChanged("working_dir", value);
        return { success: true, output: `working_dir changed: ${old} -> ${value}\nNew agent instances will use this directory.` };
      }

      case "permission_mode": {
        const validModes = ["ask", "auto-edit", "auto"];
        if (!validModes.includes(value)) {
          return { success: false, output: "", error: `Invalid mode: ${value}. Valid: ${validModes.join(", ")}` };
        }
        const old = agentConfig.permissionMode;
        agentConfig.permissionMode = value;
        this.state.onConfigChanged("permission_mode", value);
        return { success: true, output: `permission_mode changed: ${old} -> ${value}` };
      }

      case "max_turns": {
        const n = parseInt(value, 10);
        if (isNaN(n) || n < 1) {
          return { success: false, output: "", error: "max_turns must be a positive integer" };
        }
        agentConfig.maxTurns = n;
        this.state.onConfigChanged("max_turns", value);
        return { success: true, output: `max_turns changed to ${n}` };
      }

      case "max_tokens": {
        const n = parseInt(value, 10);
        if (isNaN(n) || n < 1) {
          return { success: false, output: "", error: "max_tokens must be a positive integer" };
        }
        agentConfig.maxTokens = n;
        this.state.onConfigChanged("max_tokens", value);
        return { success: true, output: `max_tokens changed to ${n}` };
      }

      case "system_prompt": {
        agentConfig.systemPrompt = value;
        this.state.onConfigChanged("system_prompt", value.substring(0, 40));
        return { success: true, output: `system_prompt updated (${value.length} chars)` };
      }

      case "rate_limit": {
        const n = parseInt(value, 10);
        if (isNaN(n) || n < 1) {
          return { success: false, output: "", error: "rate_limit must be a positive integer" };
        }
        securityConfig.rateLimitPerMinute = n;
        this.state.onConfigChanged("rate_limit", value);
        return { success: true, output: `rate_limit changed to ${n}/min` };
      }

      case "allowed_dirs": {
        const dirs = value.split(",").map((d) => d.trim()).filter(Boolean);
        for (const d of dirs) {
          if (!fs.existsSync(d)) {
            return { success: false, output: "", error: `Directory not found: ${d}` };
          }
        }
        securityConfig.allowedDirs = dirs;
        this.state.onConfigChanged("allowed_dirs", value);
        return { success: true, output: `allowed_dirs set to: ${dirs.join(", ")}` };
      }

      case "log_level":
        return { success: false, output: "", error: "log_level cannot be changed at runtime (restart required)" };

      case "channels":
        return { success: false, output: "", error: "channels cannot be changed at runtime (restart required)" };

      case "sessions":
        return { success: false, output: "", error: "session config cannot be changed at runtime (restart required)" };

      default:
        return { success: false, output: "", error: `Unknown or read-only key: ${key}` };
    }
  }
}
