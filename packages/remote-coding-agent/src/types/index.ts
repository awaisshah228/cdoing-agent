/**
 * Core type definitions for the Remote Coding Agent.
 *
 * These types define the contracts between:
 *   - Channel adapters (Telegram, Discord, WhatsApp, etc.)
 *   - Core engine (orchestration)
 *   - Agent bridge (LLM integration)
 *   - Session manager
 *   - Gateway (admin API)
 *   - TUI dashboard
 *
 * Every channel normalizes its messages into these types,
 * so the core engine is completely channel-agnostic.
 */

// ── Normalized Message ─────────────────────────────────────────────────────

/** A normalized inbound message from any channel. */
export interface IncomingMessage {
  /** Unique message ID within the channel */
  messageId: string;
  /** Channel-specific chat/conversation ID */
  chatId: string;
  /** Channel-specific user ID */
  userId: string;
  /** Display name of the sender */
  username: string;
  /** Raw message text */
  text: string;
  /** Which channel this came from */
  channel: string;
  /** Whether this is a group/multi-user conversation */
  isGroup: boolean;
  /** If replying to a message, its ID */
  replyToMessageId?: string;
  /** Unix timestamp (ms) */
  timestamp: number;
  /** Channel-specific metadata (attachments, thread ID, etc.) */
  metadata?: Record<string, unknown>;
}

// ── Agent Reply ────────────────────────────────────────────────────────────

/** A response from the agent to send back via a channel. */
export interface AgentReply {
  /** The reply text (may contain markdown) */
  text: string;
  /** Whether this is a partial/streaming update */
  isPartial?: boolean;
  /** Tool calls that were executed */
  toolCalls?: ToolCallSummary[];
  /** Token usage for this turn */
  usage?: UsageSummary;
  /** Duration of the agent run (ms) */
  durationMs?: number;
}

/** Summary of a tool call for display. */
export interface ToolCallSummary {
  name: string;
  input: Record<string, unknown>;
  output: string;
  isError: boolean;
}

/** Token usage summary. */
export interface UsageSummary {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd?: number;
}

// ── Channel System ─────────────────────────────────────────────────────────

/** Callback when a message is received from a channel. */
export type OnMessageCallback = (message: IncomingMessage) => Promise<void>;

/** Options for sending a message via a channel. */
export interface SendOptions {
  /** Format hint for the channel (markdown, html, plain) */
  format?: "markdown" | "html" | "plain";
  /** Reply to a specific message */
  replyToMessageId?: string;
  /** Disable link previews */
  disableLinkPreview?: boolean;
  /** Channel-specific extra options */
  extra?: Record<string, unknown>;
}

/**
 * Channel Adapter Interface
 *
 * Every channel (Telegram, Discord, WhatsApp, etc.) implements this
 * interface. The core engine only talks through this contract,
 * so adding a new channel requires zero changes to core code.
 */
export interface ChannelAdapter {
  /** Unique channel identifier (e.g., "telegram", "discord") */
  readonly id: string;
  /** Human-readable channel name */
  readonly name: string;
  /** Whether this channel is currently connected */
  readonly isConnected: boolean;

  /** Initialize and start receiving messages */
  start(): Promise<void>;
  /** Gracefully stop the channel */
  stop(): Promise<void>;

  /** Register a callback for incoming messages */
  onMessage(callback: OnMessageCallback): void;

  /** Send a text message to a chat */
  sendMessage(chatId: string, text: string, options?: SendOptions): Promise<string>;
  /** Edit an existing message (if supported) */
  editMessage(chatId: string, messageId: string, text: string): Promise<void>;
  /** Send a typing/processing indicator */
  sendTyping(chatId: string): Promise<void>;
}

/**
 * Channel Plugin Definition
 *
 * Channels register themselves as plugins. This allows
 * dynamic loading and configuration of channels.
 */
export interface ChannelPlugin {
  /** Unique channel identifier */
  id: string;
  /** Human-readable name */
  name: string;
  /** Description of the channel */
  description: string;
  /** Config schema for this channel (Zod or JSON Schema) */
  configSchema?: Record<string, unknown>;
  /** Factory function to create the channel adapter */
  create(config: Record<string, unknown>, logLevel: string): ChannelAdapter;
}

// ── Session ────────────────────────────────────────────────────────────────

/** Conversation session state for a user. */
export interface Session {
  /** Unique session key (channel:chatId:userId) */
  id: string;
  /** Channel this session belongs to */
  channel: string;
  /** Channel-specific chat ID */
  chatId: string;
  /** Channel-specific user ID */
  userId: string;
  /** Working directory for coding operations */
  workingDir: string;
  /** Serialized message history for agent continuity */
  history: SerializedMessage[];
  /** Session creation time */
  createdAt: Date;
  /** Last activity time */
  lastActiveAt: Date;
  /** Custom session metadata */
  metadata: Record<string, unknown>;
}

/** Serialized message for persistence. */
export interface SerializedMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  toolCallId?: string;
  timestamp: number;
}

// ── Configuration ──────────────────────────────────────────────────────────

/** Top-level configuration for the remote coding agent. */
export interface AppConfig {
  /** AI provider and model settings */
  agent: AgentConfig;
  /** Gateway server settings */
  gateway: GatewayConfig;
  /** Session management settings */
  session: SessionConfig;
  /** Security and access control */
  security: SecurityConfig;
  /** Channel configurations (keyed by channel ID) */
  channels: Record<string, ChannelConfig>;
  /** Working directory for coding operations */
  workingDir: string;
  /** Log level */
  logLevel: "debug" | "info" | "warn" | "error";
}

/** Per-channel configuration. */
export interface ChannelConfig {
  /** Whether this channel is enabled */
  enabled: boolean;
  /** Channel-specific settings (token, webhook, etc.) */
  [key: string]: unknown;
}

/** AI agent configuration. */
export interface AgentConfig {
  /** LLM provider for the personal assistant (anthropic, openai, google, ollama) */
  provider: string;
  /** Model for the personal assistant (handles routing, chat, cron, skills, config) */
  model: string;
  /** API key (overrides env var) */
  apiKey?: string;
  /** Max agentic turns per user message */
  maxTurns: number;
  /** Permission mode (ask, auto-edit, auto) */
  permissionMode: string;
  /** Custom system prompt (appended to default) */
  systemPrompt?: string;
  /** Max tokens for LLM response */
  maxTokens?: number;

  /** Provider for coding tasks (defaults to main provider if not set) */
  codingProvider?: string;
  /** Model for coding tasks — use a more capable model here (defaults to main model) */
  codingModel?: string;
  /** API key for coding provider (defaults to main apiKey) */
  codingApiKey?: string;
  /** Max tokens for coding model response */
  codingMaxTokens?: number;
}

/** Gateway server configuration. */
export interface GatewayConfig {
  /** HTTP port for admin API and webhooks */
  port: number;
  /** Auth token for admin API */
  authToken?: string;
  /** CORS origin */
  corsOrigin: string;
}

/** Session management configuration. */
export interface SessionConfig {
  /** Session TTL in milliseconds (default: 30 min) */
  ttlMs: number;
  /** Max messages to keep in session history */
  maxHistoryMessages: number;
  /** Max concurrent sessions */
  maxSessions: number;
}

/** Security and access control. */
export interface SecurityConfig {
  /** Per-channel allowlists: { telegram: { allowedUserIds: [...] } } */
  channelRules: Record<string, Record<string, unknown>>;
  /** Global rate limit: max messages per user per minute */
  rateLimitPerMinute: number;
  /** Directories the agent is allowed to access */
  allowedDirs: string[];
}

// ── Events ─────────────────────────────────────────────────────────────────

/** Which agent role is handling a message. */
export type AgentRole = "assistant" | "coding";

/** Events emitted by the engine for TUI/monitoring. */
export type EngineEvent =
  | { type: "engine:start" }
  | { type: "engine:stop" }
  | { type: "channel:connected"; channel: string }
  | { type: "channel:disconnected"; channel: string }
  | { type: "channel:error"; channel: string; error: Error }
  | { type: "message:received"; channel: string; chatId: string; userId: string; text: string }
  | { type: "agent:start"; channel: string; chatId: string; role: AgentRole }
  | { type: "agent:token"; channel: string; chatId: string; token: string }
  | { type: "agent:tool_call"; channel: string; chatId: string; name: string }
  | { type: "agent:complete"; channel: string; chatId: string; reply: AgentReply; role: AgentRole }
  | { type: "agent:error"; channel: string; chatId: string; error: Error }
  | { type: "agent:delegated"; channel: string; chatId: string; task: string }
  | { type: "session:created"; sessionId: string }
  | { type: "session:expired"; sessionId: string };

/** Event listener type. */
export type EngineEventListener = (event: EngineEvent) => void;
