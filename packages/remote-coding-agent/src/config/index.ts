/**
 * Configuration Loader
 *
 * Loads and validates config from:
 *   1. Config file (remote-coding-agent.config.json / .cdoing/remote.json)
 *   2. Environment variables (.env)
 *   3. CLI arguments (overrides)
 *
 * Priority: CLI args > env vars > config file > defaults.
 */

import { z } from "zod";
import * as fs from "fs";
import * as path from "path";
import type { AppConfig } from "../types";

// ── Zod Schemas ────────────────────────────────────────────────────────────

const AgentConfigSchema = z.object({
  /** Provider for personal assistant (routing, chat, cron, skills) */
  provider: z.string().default("anthropic"),
  /** Model for personal assistant */
  model: z.string().default("claude-sonnet-4-6"),
  apiKey: z.string().optional(),
  maxTurns: z.number().int().positive().default(25),
  permissionMode: z.enum(["ask", "auto-edit", "auto"]).default("auto"),
  systemPrompt: z.string().optional(),
  maxTokens: z.number().int().positive().optional(),
  /** Provider for coding tasks (defaults to main provider) */
  codingProvider: z.string().optional(),
  /** Model for coding tasks — use a more capable model (defaults to main model) */
  codingModel: z.string().optional(),
  /** API key for coding provider (defaults to main apiKey) */
  codingApiKey: z.string().optional(),
  /** Max tokens for coding model */
  codingMaxTokens: z.number().int().positive().optional(),
});

const GatewayConfigSchema = z.object({
  port: z.number().int().positive().default(4567),
  authToken: z.string().optional(),
  corsOrigin: z.string().default("*"),
});

const SessionConfigSchema = z.object({
  ttlMs: z.number().int().positive().default(30 * 60 * 1000),
  maxHistoryMessages: z.number().int().positive().default(50),
  maxSessions: z.number().int().positive().default(100),
});

const SecurityConfigSchema = z.object({
  channelRules: z.record(z.record(z.unknown())).default({}),
  rateLimitPerMinute: z.number().int().positive().default(20),
  allowedDirs: z.array(z.string()).default([]),
});

const ChannelConfigSchema = z.object({
  enabled: z.boolean().default(true),
}).passthrough();

const AppConfigSchema = z.object({
  agent: AgentConfigSchema.default({}),
  gateway: GatewayConfigSchema.default({}),
  session: SessionConfigSchema.default({}),
  security: SecurityConfigSchema.default({}),
  channels: z.record(ChannelConfigSchema).default({}),
  workingDir: z.string().default(process.cwd()),
  logLevel: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

// ── Config File Discovery ──────────────────────────────────────────────────

const CONFIG_NAMES = [
  "remote-coding-agent.config.json",
  ".cdoing/remote.json",
];

function findConfigFile(startDir: string): string | null {
  let dir = path.resolve(startDir);
  const root = path.parse(dir).root;
  while (dir !== root) {
    for (const name of CONFIG_NAMES) {
      const p = path.join(dir, name);
      if (fs.existsSync(p)) return p;
    }
    dir = path.dirname(dir);
  }
  return null;
}

// ── Env Overrides ──────────────────────────────────────────────────────────

function loadEnvOverrides(): Record<string, unknown> {
  const o: Record<string, unknown> = {};

  if (process.env.CDOING_WORKING_DIR) o.workingDir = process.env.CDOING_WORKING_DIR;
  if (process.env.LOG_LEVEL) o.logLevel = process.env.LOG_LEVEL;

  // Agent
  const agent: Record<string, unknown> = {};
  if (process.env.ANTHROPIC_API_KEY) agent.apiKey = process.env.ANTHROPIC_API_KEY;
  if (process.env.OPENAI_API_KEY) agent.apiKey = process.env.OPENAI_API_KEY;
  if (process.env.CDOING_PROVIDER) agent.provider = process.env.CDOING_PROVIDER;
  if (process.env.CDOING_MODEL) agent.model = process.env.CDOING_MODEL;
  if (Object.keys(agent).length > 0) o.agent = agent;

  // Gateway
  const gw: Record<string, unknown> = {};
  if (process.env.PORT) gw.port = parseInt(process.env.PORT, 10);
  if (process.env.GATEWAY_AUTH_TOKEN) gw.authToken = process.env.GATEWAY_AUTH_TOKEN;
  if (Object.keys(gw).length > 0) o.gateway = gw;

  // Channels
  const channels: Record<string, Record<string, unknown>> = {};
  if (process.env.TELEGRAM_BOT_TOKEN) {
    channels.telegram = { enabled: true, botToken: process.env.TELEGRAM_BOT_TOKEN };
  }
  if (Object.keys(channels).length > 0) o.channels = channels;

  // Security
  const sec: Record<string, unknown> = {};
  if (process.env.ALLOWED_DIRS) sec.allowedDirs = process.env.ALLOWED_DIRS.split(",");
  if (Object.keys(sec).length > 0) o.security = sec;

  return o;
}

// ── Deep Merge ─────────────────────────────────────────────────────────────

function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const result = { ...target };
  for (const [k, v] of Object.entries(source)) {
    if (v !== undefined && v !== null) {
      if (typeof v === "object" && !Array.isArray(v) && typeof result[k] === "object" && !Array.isArray(result[k])) {
        result[k] = deepMerge(result[k] as Record<string, unknown>, v as Record<string, unknown>);
      } else {
        result[k] = v;
      }
    }
  }
  return result;
}

// ── Public API ─────────────────────────────────────────────────────────────

export interface LoadConfigOptions {
  configFile?: string;
  cliOverrides?: Record<string, unknown>;
}

export function loadConfig(options: LoadConfigOptions = {}): AppConfig {
  try { require("dotenv").config(); } catch { /* optional */ }

  let fileConfig: Record<string, unknown> = {};
  const configPath = options.configFile || findConfigFile(process.cwd());
  if (configPath) {
    fileConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  }

  const envConfig = loadEnvOverrides();
  const cliConfig = options.cliOverrides || {};

  let merged = deepMerge(fileConfig, envConfig);
  merged = deepMerge(merged, cliConfig);

  return AppConfigSchema.parse(merged);
}

export function validateConfig(config: unknown): AppConfig {
  return AppConfigSchema.parse(config);
}

export function generateConfigTemplate(): string {
  return JSON.stringify({
    agent: {
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      maxTurns: 25,
      permissionMode: "auto",
    },
    gateway: { port: 4567 },
    session: { ttlMs: 1800000, maxHistoryMessages: 50 },
    security: {
      channelRules: {
        telegram: { allowedUserIds: [] },
      },
      rateLimitPerMinute: 20,
      allowedDirs: [process.cwd()],
    },
    channels: {
      telegram: { enabled: true, botToken: "YOUR_TELEGRAM_BOT_TOKEN" },
    },
    workingDir: process.cwd(),
    logLevel: "info",
  }, null, 2);
}
