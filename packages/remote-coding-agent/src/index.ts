/**
 * @cdoing/remote-coding-agent
 *
 * Multi-channel remote coding agent. Control your personal AI coding
 * assistant from Telegram, Discord, WhatsApp, or any custom channel.
 *
 * Architecture:
 *
 *   Channel (Telegram, Discord, ...)
 *        |
 *   ChannelRegistry (plugin system)
 *        |
 *   Engine (orchestration, events)
 *        |
 *   AgentBridge (commands, timeout pattern)
 *        |
 *   AgentRunner (@cdoing/ai — agentic loop)
 *        |
 *   ToolRegistry (@cdoing/core — 15+ coding tools)
 *
 * Quick Start:
 *
 *   import { Engine, loadConfig } from "@cdoing/remote-coding-agent";
 *
 *   const config = loadConfig();
 *   const engine = new Engine(config);
 *   await engine.start();
 *
 * Adding a custom channel:
 *
 *   import { Engine, loadConfig } from "@cdoing/remote-coding-agent";
 *   import type { ChannelPlugin } from "@cdoing/remote-coding-agent";
 *
 *   const myChannel: ChannelPlugin = {
 *     id: "slack",
 *     name: "Slack",
 *     description: "Slack channel via Bolt",
 *     create(config, logLevel) { return new SlackChannel(config, logLevel); },
 *   };
 *
 *   const engine = new Engine(loadConfig());
 *   engine.registerChannel(myChannel);
 *   await engine.start();
 */

// Core
export { Engine, type EngineOptions } from "./core/engine";
export { AgentBridge } from "./core/bridge";

// Channels
export { BaseChannel } from "./channels/base";
export { ChannelRegistry, createDefaultRegistry } from "./channels/registry";
export { TelegramChannel, telegramPlugin } from "./channels/telegram";
export { DiscordChannel, discordPlugin } from "./channels/discord";

// Tools (remote-agent specific)
export { ConfigManagerTool, type ConfigManagerState } from "./tools/config-manager";
export { CronTool, type CronToolState } from "./tools/cron-tool";
export { SkillTool, type SkillToolState } from "./tools/skill-tool";
export { selectToolsForTurn, compactToolDescription, compactToolSchema } from "./tools/smart-selector";

// Session
export { SessionManager } from "./session/session-manager";

// Gateway
export { Gateway } from "./gateway/server";

// Cron
export { CronService } from "./cron/service";
export type { CronJob, CronJobCreate, CronJobPatch, CronSchedule, CronPayload, CronDelivery, CronRunEntry } from "./cron/types";

// Skills
export { SkillRegistry } from "./skills/registry";
export { builtinSkills } from "./skills/builtin";
export type { Skill, SkillEntry, SkillResult } from "./skills/types";

// Auth
export { generateSecretKey, generateShortToken, validateSecretKey, secureCompare } from "./auth/secret";
export { CredentialManager } from "./auth/credentials";

// Setup Wizard
export { runSetupWizard, writeSetupConfig, printSetupSummary } from "./tui/setup-wizard";

// TUI
export { Dashboard, renderDashboard } from "./tui/app";

// Config
export { loadConfig, validateConfig, generateConfigTemplate } from "./config";

// Formatter
export {
  formatReply,
  formatHelp,
  formatStatus,
  formatError,
  formatUsage,
  formatToolSummary,
} from "./formatter";

// Middleware
export { UserRateLimiter } from "./middleware/rate-limiter";

// Utils
export { Logger } from "./utils/logger";

// Types
export type {
  // Messages
  IncomingMessage,
  AgentReply,
  ToolCallSummary,
  UsageSummary,
  SendOptions,

  // Channel system
  ChannelAdapter,
  ChannelPlugin,
  OnMessageCallback,

  // Session
  Session,
  SerializedMessage,

  // Config
  AppConfig,
  AgentConfig,
  GatewayConfig,
  SessionConfig,
  SecurityConfig,
  ChannelConfig,

  // Events
  EngineEvent,
  EngineEventListener,
} from "./types";
