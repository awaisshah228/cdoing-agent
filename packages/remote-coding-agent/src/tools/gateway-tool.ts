/**
 * Gateway Tool — Safe version of OpenClaw's gateway tool for the personal agent.
 *
 * Allows the personal assistant to read, inspect, and patch the running
 * gateway/engine configuration through chat — with safety guardrails:
 *
 *   1. `config.get`           — Read current config (returns snapshot + hash)
 *   2. `config.schema`        — Describe valid values for a config path
 *   3. `config.patch`         — Safe partial update (merge, not replace)
 *   4. `status`               — Show gateway/channel health
 *   5. `restart`              — Restart the engine gracefully
 *
 * Safety:
 *   - config.patch uses optimistic concurrency: you must pass the baseHash
 *     from config.get so stale writes are rejected.
 *   - Sensitive keys (api_key, auth tokens) are masked in reads.
 *   - Dangerous keys (security.channelRules, gateway.authToken) require
 *     explicit confirmation via the `confirm` flag.
 *   - No config.apply (full replace) — only safe partial patches.
 *
 * This tool lives on the ASSISTANT side (not coding agent) because
 * gateway management is a control-plane concern, not a coding task.
 */

import type { BaseTool, ToolDefinition, ToolResult } from "@cdoing/core";
import * as crypto from "crypto";
import type { AppConfig, ChannelAdapter } from "../types";

// ── Types ─────────────────────────────────────────────────────────────────

export interface GatewayToolState {
  /** Live reference to the current app config (mutable). */
  appConfig: AppConfig;
  /** Connected channel adapters (for status). */
  channels: Map<string, ChannelAdapter>;
  /** Callback when config changes (so engine can react). */
  onConfigChanged: (patch: Record<string, unknown>) => void;
  /** Optional: callback to trigger a graceful engine restart. */
  onRestart?: (reason?: string) => Promise<void>;
}

type GatewayAction = "config.get" | "config.schema" | "config.patch" | "status" | "restart";

// ── Helpers ───────────────────────────────────────────────────────────────

/** Keys that are never shown in plaintext. */
const SENSITIVE_KEYS = new Set([
  "apiKey",
  "codingApiKey",
  "authToken",
  "token",
  "secret",
  "password",
]);

/** Keys that require explicit confirmation to change. */
const DANGEROUS_KEYS = new Set([
  "security",
  "security.channelRules",
  "security.allowedDirs",
  "gateway.authToken",
]);

/** Compute a short hash of a config snapshot for concurrency control. */
function hashConfig(config: AppConfig): string {
  const json = JSON.stringify(config);
  return crypto.createHash("sha256").update(json).digest("hex").slice(0, 12);
}

/** Mask sensitive values in a config object (shallow clone). */
function maskSensitive(obj: Record<string, unknown>, depth = 0): Record<string, unknown> {
  if (depth > 5) return obj;
  const masked: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (SENSITIVE_KEYS.has(key)) {
      masked[key] = typeof value === "string" && value.length > 4
        ? "***" + value.slice(-4)
        : value
          ? "***"
          : "(not set)";
    } else if (value && typeof value === "object" && !Array.isArray(value)) {
      masked[key] = maskSensitive(value as Record<string, unknown>, depth + 1);
    } else {
      masked[key] = value;
    }
  }
  return masked;
}

/** Resolve a dot-path to a value in a nested object. */
function getByPath(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/** Set a value at a dot-path in a nested object (mutates). */
function setByPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(".");
  let current: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (current[part] === undefined || typeof current[part] !== "object") {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }
  current[parts[parts.length - 1]] = value;
}

// ── Config Schema Descriptions ────────────────────────────────────────────

const CONFIG_SCHEMA: Record<string, { type: string; description: string; values?: string[] }> = {
  "agent.provider":       { type: "string", description: "LLM provider", values: ["anthropic", "openai", "google", "ollama", "custom"] },
  "agent.model":          { type: "string", description: "Model ID for the personal assistant" },
  "agent.maxTurns":       { type: "number", description: "Max agentic turns per user message (1-100)" },
  "agent.maxTokens":      { type: "number", description: "Max tokens for LLM response" },
  "agent.permissionMode": { type: "string", description: "Permission mode", values: ["ask", "auto-edit", "auto"] },
  "agent.systemPrompt":   { type: "string", description: "Custom system prompt (appended to default)" },
  "agent.codingProvider":  { type: "string", description: "Provider for coding tasks", values: ["anthropic", "openai", "google", "ollama", "custom"] },
  "agent.codingModel":     { type: "string", description: "Model for coding tasks" },
  "agent.codingMaxTokens": { type: "number", description: "Max tokens for coding model" },
  "gateway.port":          { type: "number", description: "HTTP port for admin API (1024-65535)" },
  "gateway.corsOrigin":    { type: "string", description: "CORS origin for admin API" },
  "session.ttlMs":         { type: "number", description: "Session TTL in milliseconds" },
  "session.maxHistoryMessages": { type: "number", description: "Max messages per session" },
  "session.maxSessions":   { type: "number", description: "Max concurrent sessions" },
  "security.rateLimitPerMinute": { type: "number", description: "Rate limit per user per minute" },
  "security.allowedDirs":  { type: "string[]", description: "Directories the agent can access (comma-separated)" },
  "workingDir":            { type: "string", description: "Default working directory for coding" },
  "logLevel":              { type: "string", description: "Log level", values: ["debug", "info", "warn", "error"] },
};

// ── Tool Implementation ───────────────────────────────────────────────────

export class GatewayTool implements BaseTool {
  definition: ToolDefinition = {
    name: "gateway",
    description:
      "Inspect and safely patch the running gateway/engine configuration. " +
      "Use config.schema to check valid values before making changes. " +
      "Use config.patch for safe partial updates (requires baseHash from config.get " +
      "to prevent stale writes). Use status to check channel health. " +
      "Actions: config.get, config.schema, config.patch, status, restart.",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["config.get", "config.schema", "config.patch", "status", "restart"],
          description:
            "config.get: read current config + hash. " +
            "config.schema: describe valid values for a path. " +
            "config.patch: safe partial update (needs baseHash). " +
            "status: show channel/gateway health. " +
            "restart: graceful engine restart.",
        },
        path: {
          type: "string",
          description:
            "Dot-separated config path (e.g. 'agent.model', 'session.ttlMs'). " +
            "Used by config.schema and optionally by config.get to read a single value.",
        },
        patches: {
          type: "array",
          items: {
            type: "object",
            properties: {
              path: { type: "string", description: "Dot-separated config path" },
              value: { description: "New value (type must match schema)" },
            },
            required: ["path", "value"],
          },
          description: "Array of { path, value } patches to apply (for config.patch).",
        },
        baseHash: {
          type: "string",
          description: "Hash from config.get — required for config.patch (prevents stale writes).",
        },
        confirm: {
          type: "boolean",
          description: "Required when patching dangerous keys (security, auth tokens).",
        },
        reason: {
          type: "string",
          description: "Human-readable reason for the change or restart.",
        },
      },
      required: ["action"],
    },
    requiresPermission: true,
    permissionMessage: (input) => {
      switch (input.action) {
        case "config.patch":
          return `Patch gateway config: ${(input.patches as Array<{ path: string }>)?.map((p) => p.path).join(", ") || "unknown"}`;
        case "restart":
          return `Restart the engine${input.reason ? `: ${input.reason}` : ""}`;
        default:
          return `Read gateway ${input.action === "status" ? "status" : "config"}`;
      }
    },
  };

  private state: GatewayToolState;

  constructor(state: GatewayToolState) {
    this.state = state;
  }

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const action = input.action as GatewayAction;

    switch (action) {
      case "config.get":
        return this.handleConfigGet(input.path as string | undefined);
      case "config.schema":
        return this.handleConfigSchema(input.path as string | undefined);
      case "config.patch":
        return this.handleConfigPatch(
          input.patches as Array<{ path: string; value: unknown }> | undefined,
          input.baseHash as string | undefined,
          input.confirm as boolean | undefined,
          input.reason as string | undefined,
        );
      case "status":
        return this.handleStatus();
      case "restart":
        return this.handleRestart(input.reason as string | undefined);
      default:
        return {
          success: false,
          output: "",
          error: `Unknown action: ${action}. Use config.get, config.schema, config.patch, status, or restart.`,
        };
    }
  }

  // ── config.get ────────────────────────────────────────────────────────

  private handleConfigGet(path?: string): ToolResult {
    const config = this.state.appConfig;
    const hash = hashConfig(config);

    if (path) {
      const value = getByPath(config as unknown as Record<string, unknown>, path);
      if (value === undefined) {
        return { success: false, output: "", error: `Config path not found: ${path}` };
      }
      const display = SENSITIVE_KEYS.has(path.split(".").pop() || "")
        ? (typeof value === "string" && value.length > 4 ? "***" + value.slice(-4) : "***")
        : value;
      return {
        success: true,
        output: JSON.stringify({ path, value: display, baseHash: hash }, null, 2),
      };
    }

    const masked = maskSensitive(config as unknown as Record<string, unknown>);
    return {
      success: true,
      output: JSON.stringify({ config: masked, baseHash: hash }, null, 2),
    };
  }

  // ── config.schema ─────────────────────────────────────────────────────

  private handleConfigSchema(path?: string): ToolResult {
    if (!path) {
      // List all known paths
      const lines = ["Available config paths:\n"];
      for (const [p, schema] of Object.entries(CONFIG_SCHEMA)) {
        const valuesHint = schema.values ? ` [${schema.values.join(", ")}]` : "";
        lines.push(`  ${p} (${schema.type})${valuesHint} — ${schema.description}`);
      }
      return { success: true, output: lines.join("\n") };
    }

    const schema = CONFIG_SCHEMA[path];
    if (!schema) {
      // Check if it's a valid prefix
      const children = Object.keys(CONFIG_SCHEMA).filter((k) => k.startsWith(path + "."));
      if (children.length > 0) {
        return {
          success: true,
          output: `"${path}" is a config section. Child paths:\n${children.map((c) => `  ${c}`).join("\n")}`,
        };
      }
      return { success: false, output: "", error: `Unknown config path: ${path}` };
    }

    const info: Record<string, unknown> = {
      path,
      type: schema.type,
      description: schema.description,
    };
    if (schema.values) info.validValues = schema.values;

    const current = getByPath(this.state.appConfig as unknown as Record<string, unknown>, path);
    const lastKey = path.split(".").pop() || "";
    info.currentValue = SENSITIVE_KEYS.has(lastKey) ? "***" : current;

    return { success: true, output: JSON.stringify(info, null, 2) };
  }

  // ── config.patch ──────────────────────────────────────────────────────

  private handleConfigPatch(
    patches?: Array<{ path: string; value: unknown }>,
    baseHash?: string,
    confirm?: boolean,
    reason?: string,
  ): ToolResult {
    if (!patches || patches.length === 0) {
      return { success: false, output: "", error: "patches array is required and must not be empty." };
    }
    if (!baseHash) {
      return {
        success: false,
        output: "",
        error: "baseHash is required. Call config.get first to get the current hash.",
      };
    }

    // Optimistic concurrency check
    const currentHash = hashConfig(this.state.appConfig);
    if (baseHash !== currentHash) {
      return {
        success: false,
        output: "",
        error:
          `Config has changed since you last read it (expected hash ${baseHash}, current ${currentHash}). ` +
          `Call config.get again to get the latest config and hash, then retry.`,
      };
    }

    // Validate all patches before applying any
    const errors: string[] = [];
    const needsConfirm: string[] = [];

    for (const patch of patches) {
      // Check if path is known
      const schema = CONFIG_SCHEMA[patch.path];
      if (!schema) {
        errors.push(`Unknown config path: ${patch.path}`);
        continue;
      }

      // Check if path requires confirmation
      if (DANGEROUS_KEYS.has(patch.path) || DANGEROUS_KEYS.has(patch.path.split(".")[0])) {
        needsConfirm.push(patch.path);
      }

      // Type validation
      if (schema.type === "number" && typeof patch.value !== "number") {
        errors.push(`${patch.path}: expected number, got ${typeof patch.value}`);
      }
      if (schema.type === "string" && typeof patch.value !== "string") {
        errors.push(`${patch.path}: expected string, got ${typeof patch.value}`);
      }
      if (schema.values && !schema.values.includes(patch.value as string)) {
        errors.push(`${patch.path}: invalid value "${patch.value}". Valid: ${schema.values.join(", ")}`);
      }
    }

    if (errors.length > 0) {
      return { success: false, output: "", error: `Validation failed:\n${errors.join("\n")}` };
    }

    if (needsConfirm.length > 0 && !confirm) {
      return {
        success: false,
        output: "",
        error:
          `These paths require explicit confirmation (confirm: true):\n` +
          needsConfirm.map((p) => `  - ${p}`).join("\n") +
          `\nThis is a safety check for sensitive settings.`,
      };
    }

    // Apply patches
    const config = this.state.appConfig as unknown as Record<string, unknown>;
    const applied: string[] = [];

    for (const patch of patches) {
      const old = getByPath(config, patch.path);
      setByPath(config, patch.path, patch.value);
      const display = SENSITIVE_KEYS.has(patch.path.split(".").pop() || "") ? "***" : patch.value;
      applied.push(`${patch.path}: ${old} -> ${display}`);
    }

    // Notify engine
    const patchMap: Record<string, unknown> = {};
    for (const patch of patches) {
      patchMap[patch.path] = patch.value;
    }
    this.state.onConfigChanged(patchMap);

    const newHash = hashConfig(this.state.appConfig);

    const lines = [
      `Config patched successfully (${applied.length} change${applied.length > 1 ? "s" : ""}).`,
      ...(reason ? [`Reason: ${reason}`] : []),
      "",
      "Changes:",
      ...applied.map((a) => `  ${a}`),
      "",
      `New baseHash: ${newHash}`,
    ];

    return { success: true, output: lines.join("\n") };
  }

  // ── status ────────────────────────────────────────────────────────────

  private handleStatus(): ToolResult {
    const { appConfig, channels } = this.state;

    const lines = [
      "=== Gateway Status ===",
      "",
      `Port: ${appConfig.gateway.port}`,
      `Auth: ${appConfig.gateway.authToken ? "configured" : "none"}`,
      `Working dir: ${appConfig.workingDir}`,
      "",
      "-- Channels --",
    ];

    if (channels.size === 0) {
      lines.push("  (no channels registered)");
    } else {
      for (const [id, adapter] of channels) {
        const icon = adapter.isConnected ? "✅" : "❌";
        lines.push(`  ${icon} ${id} (${adapter.name}) — ${adapter.isConnected ? "connected" : "disconnected"}`);
      }
    }

    lines.push("");
    lines.push("-- Sessions --");
    lines.push(`  TTL: ${appConfig.session.ttlMs / 1000}s`);
    lines.push(`  Max history: ${appConfig.session.maxHistoryMessages}`);
    lines.push(`  Max concurrent: ${appConfig.session.maxSessions}`);

    lines.push("");
    lines.push("-- Agent --");
    lines.push(`  Provider: ${appConfig.agent.provider}`);
    lines.push(`  Model: ${appConfig.agent.model}`);
    lines.push(`  Coding: ${appConfig.agent.codingProvider || appConfig.agent.provider} / ${appConfig.agent.codingModel || appConfig.agent.model}`);
    lines.push(`  Permission: ${appConfig.agent.permissionMode}`);

    return { success: true, output: lines.join("\n") };
  }

  // ── restart ───────────────────────────────────────────────────────────

  private async handleRestart(reason?: string): Promise<ToolResult> {
    if (!this.state.onRestart) {
      return {
        success: false,
        output: "",
        error: "Restart is not supported (no onRestart callback configured).",
      };
    }

    try {
      await this.state.onRestart(reason);
      return {
        success: true,
        output: `Engine restart initiated${reason ? ` (reason: ${reason})` : ""}.`,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, output: "", error: `Restart failed: ${msg}` };
    }
  }
}
