/**
 * Config Update Tool — lets the LLM update user config (model, provider, mode, etc.)
 * at the user's request. Writes to ~/.cdoing/config.json and optionally notifies
 * the running agent via a callback so changes can take effect immediately.
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import type { BaseTool, ToolDefinition, ToolResult } from "../types";

const CONFIG_DIR = path.join(os.homedir(), ".cdoing");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");

export interface ConfigUpdateCallback {
  (key: string, value: string): void;
}

const VALID_KEYS = ["model", "provider", "mode", "base-url", "api-key-helper"] as const;
type ConfigKey = typeof VALID_KEYS[number];

const VALID_MODES = ["default", "acceptEdits", "plan", "dontAsk", "bypassPermissions"];

function loadConfig(): Record<string, unknown> {
  try {
    if (fs.existsSync(CONFIG_FILE))
      return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
  } catch {}
  return {};
}

function saveConfig(config: Record<string, unknown>): void {
  if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), "utf-8");
}

export class ConfigUpdateTool implements BaseTool {
  // ── Behavioral flags ──
  // Sequential: modifies global configuration file
  definition: ToolDefinition = {
    name: "config_update",
    description:
      "Update the user's Cdoing Agent configuration (model, provider, mode, base-url, api-key-helper). " +
      "Use this when the user asks to change the model (e.g. 'use gpt-4o', 'switch to claude-opus'), " +
      "change the provider, or update other config settings. " +
      "Changes are saved to ~/.cdoing/config.json immediately. " +
      "Model/provider changes take effect on next session restart.",
    inputSchema: {
      type: "object",
      properties: {
        key: {
          type: "string",
          description: `Config key to update. Valid keys: ${VALID_KEYS.join(", ")}`,
          enum: [...VALID_KEYS],
        },
        value: {
          type: "string",
          description:
            "New value. For 'model': model ID (e.g. 'claude-sonnet-4-6', 'gpt-4o', 'gemini-2.0-flash'). " +
            "For 'provider': provider ID (e.g. 'anthropic', 'openai', 'google', 'ollama'). " +
            `For 'mode': one of ${VALID_MODES.join(", ")}.`,
        },
      },
      required: ["key", "value"],
    },
    requiresPermission: false,
  };

  constructor(private onConfigUpdate?: ConfigUpdateCallback) {}

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const key = input.key as string;
    const value = input.value as string;

    if (!key || !value) {
      return { success: false, output: "Both 'key' and 'value' are required." };
    }

    if (!VALID_KEYS.includes(key as ConfigKey)) {
      return {
        success: false,
        output: `Unknown config key "${key}". Valid keys: ${VALID_KEYS.join(", ")}`,
      };
    }

    // Validate mode values
    if (key === "mode" && !VALID_MODES.includes(value)) {
      return {
        success: false,
        output: `Invalid mode "${value}". Valid modes: ${VALID_MODES.join(", ")}`,
      };
    }

    const config = loadConfig();
    const previousValue = config[key === "base-url" ? "baseUrl" : key === "api-key-helper" ? "apiKeyHelper" : key];

    // Apply update
    switch (key) {
      case "model":
        config.model = value;
        break;
      case "provider":
        config.provider = value;
        break;
      case "mode":
        config.mode = value;
        break;
      case "base-url":
        config.baseUrl = value;
        break;
      case "api-key-helper":
        config.apiKeyHelper = value;
        break;
    }

    saveConfig(config);

    // Notify running agent if callback provided
    this.onConfigUpdate?.(key, value);

    const needsRestart = key === "model" || key === "provider" || key === "base-url";
    const lines = [
      `✓ Config updated: ${key} = ${value}`,
      previousValue !== undefined ? `  (was: ${previousValue})` : "",
      needsRestart ? "  Note: restart the session for this change to take effect." : "",
    ].filter(Boolean);

    return { success: true, output: lines.join("\n") };
  }
}
