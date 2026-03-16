# Remote Coding Agent — Architecture

## Overview

A multi-channel remote coding agent gateway. Users interact with their personal AI coding assistant through Telegram, Discord, or any custom channel. The agent reads/edits files, runs commands, searches code, and reports back — all from a chat message.

```
 User (Telegram / Discord / Slack / ...)
       |
  ChannelAdapter (normalizes messages)
       |
  ChannelRegistry (plugin system)
       |
  Engine (orchestration, events, lifecycle)
       |
  AgentBridge (slash commands, timeout pattern, security)
       |
  AgentRunner (@cdoing/ai — agentic loop with streaming)
       |
  ToolRegistry (@cdoing/core — 15+ coding tools + config_manager)
       |
  Files, Shell, Git, Web, etc.
```

## Package Dependencies

```
@cdoing/core  (tools, permissions, sandbox)
     ^
@cdoing/ai    (AgentRunner, LLM providers, context management)
     ^
@cdoing/remote-coding-agent  (this package)
```

## Directory Structure

```
src/
├── index.ts                    # Public API — all exports
├── cli.ts                      # CLI entry: start, tui, init, status
│
├── types/index.ts              # All type definitions (channel-agnostic)
├── config/index.ts             # Config loader (file + env + CLI, Zod validation)
│
├── core/
│   ├── engine.ts               # Main orchestrator — wires everything together
│   └── bridge.ts               # Agent bridge — connects channels to AgentRunner
│
├── channels/
│   ├── base.ts                 # BaseChannel abstract class
│   ├── registry.ts             # Channel plugin registry (discover, create, manage)
│   ├── telegram/index.ts       # Telegram channel (Bot API, polling + webhook)
│   └── discord/index.ts        # Discord channel (stub — ready to implement)
│
├── tools/
│   └── config-manager.ts       # config_manager tool — change config via chat
│
├── session/
│   └── session-manager.ts      # Per-user sessions with TTL + history
│
├── gateway/
│   ├── server.ts               # Express server setup + middleware
│   └── routes/                 # Modular route handlers
│       ├── index.ts            # Route exports
│       ├── health.ts           # GET /health
│       ├── sessions.ts         # Sessions CRUD + history
│       ├── channels.ts         # Channel listing
│       ├── stats.ts            # System stats
│       ├── config.ts           # Config read/update
│       ├── events.ts           # SSE event stream
│       └── webhooks.ts         # Webhooks + send API
│
├── tui/
│   └── app.ts                  # Ink TUI dashboard (channels, sessions, events)
│
├── formatter/index.ts          # Channel-agnostic message formatting
├── middleware/rate-limiter.ts   # Per-user sliding window rate limiter
└── utils/logger.ts             # Structured logger with levels + child loggers
```

## Core Components

### Engine (`core/engine.ts`)

The top-level orchestrator. Owns the lifecycle of every subsystem:

1. Creates the ChannelRegistry, SessionManager, AgentBridge, Gateway
2. Registers built-in channels (Telegram, Discord)
3. Accepts external channel plugins via `registerChannel()`
4. Starts all enabled channels and wires their messages to the bridge
5. Emits events for TUI/monitoring
6. Handles graceful shutdown

```typescript
const engine = new Engine(config);
engine.registerChannel(slackPlugin); // optional: add custom channels
await engine.start();
```

### AgentBridge (`core/bridge.ts`)

The channel-agnostic message handler:

1. **Security check** — is this user allowed?
2. **Slash commands** — /start, /help, /clear, /status, /dir, /model, /provider, /whoami
3. **Concurrency guard** — one agent run per user at a time
4. **8-second timeout pattern**:
   - If agent finishes within 8s → reply directly
   - If it takes longer → send "Working..." → follow up when done
5. **Agent factory** — creates AgentRunner instances per session
6. **Tool registry** — 15 core tools + config_manager

### Channel System (`channels/`)

```
ChannelAdapter (interface)
     ^
BaseChannel (abstract — common helpers)
     ^
TelegramChannel, DiscordChannel, ...
```

**Adding a new channel** requires ONE file:

```typescript
// channels/slack/index.ts
export class SlackChannel extends BaseChannel {
  readonly id = "slack";
  readonly name = "Slack";
  // implement: start(), stop(), sendMessage(), editMessage(), sendTyping()
}

export const slackPlugin: ChannelPlugin = {
  id: "slack",
  name: "Slack",
  description: "Slack via Bolt",
  create(config, logLevel) { return new SlackChannel(config, logLevel); },
};
```

Then register it:
```typescript
engine.registerChannel(slackPlugin);
```

Or auto-register by adding a `require()` line in `channels/registry.ts`.

### ConfigManagerTool (`tools/config-manager.ts`)

A tool registered in the agent's ToolRegistry that lets the LLM change runtime config via chat:

| Action | Key | Example |
|--------|-----|---------|
| `set` | `model` | "Switch to gpt-4o" → `set model gpt-4o` |
| `set` | `provider` | "Use OpenAI" → `set provider openai` |
| `set` | `working_dir` | "Work in /tmp/project" → `set working_dir /tmp/project` |
| `set` | `permission_mode` | "Enable auto mode" → `set permission_mode auto` |
| `set` | `max_turns` | "Allow more turns" → `set max_turns 50` |
| `get` | any | "What model am I using?" → `get model` |
| `list` | — | "Show all config" → `list` |

Changes invalidate cached agents so new requests pick up the new config immediately.

### Session Manager (`session/session-manager.ts`)

- Keyed by `channel:chatId:userId` — each user on each channel gets a separate session
- TTL-based expiration (default 30 min)
- Stores conversation history for agent continuity
- Auto-cleanup of stale sessions
- Max session limit with LRU eviction

### Gateway (`gateway/server.ts` + `gateway/routes/`)

Express HTTP server with modular route handlers:

| Endpoint | Method | Description | Route File |
|----------|--------|-------------|------------|
| `/health` | GET | Health check (status, uptime, channels, sessions) | `routes/health.ts` |
| `/api/sessions` | GET | List all sessions with stats | `routes/sessions.ts` |
| `/api/sessions` | DELETE | Destroy all sessions | `routes/sessions.ts` |
| `/api/sessions/:id` | DELETE | Destroy a specific session | `routes/sessions.ts` |
| `/api/sessions/:id/history` | GET | Get message history for a session | `routes/sessions.ts` |
| `/api/channels` | GET | List all channels with status | `routes/channels.ts` |
| `/api/stats` | GET | Full stats (memory, uptime, sessions, agents) | `routes/stats.ts` |
| `/api/config` | GET | Read config (sensitive fields redacted) | `routes/config.ts` |
| `/api/config` | PUT | Update config at runtime | `routes/config.ts` |
| `/api/events` | GET | SSE event stream for real-time dashboard | `routes/events.ts` |
| `/api/send` | POST | Send a message via API (programmatic access) | `routes/webhooks.ts` |
| `/webhook/:channelId` | POST | Webhook receiver for any channel | `routes/webhooks.ts` |

Protected by: Helmet, CORS, rate limiting, Bearer auth token.

### Web Dashboard (`packages/dashboard/`)

Next.js admin dashboard (runs on port 3456) providing browser-based administration:

| Page | Route | Description |
|------|-------|-------------|
| Overview | `/` | System stats, uptime, memory usage, channel status |
| Sessions | `/sessions` | List/destroy sessions, view message history |
| Channels | `/channels` | Channel status, send test messages via API |
| Configuration | `/config` | Edit agent, gateway, session, and security settings |
| Live Feed | `/live-feed` | Real-time SSE event stream with filtering |

```bash
# Start the dashboard
cd packages/dashboard
yarn dev          # Development mode on port 3456
yarn build        # Production build
yarn start        # Start production server

# Configure gateway connection
cp .env.example .env.local
# Edit NEXT_PUBLIC_GATEWAY_URL and NEXT_PUBLIC_GATEWAY_TOKEN
```

### TUI Dashboard (`tui/app.ts`)

Ink (React for CLI) dashboard showing:
- Live channel status (connected/disconnected)
- Active sessions with message counts
- Real-time event log (messages, tool calls, completions)
- System stats (uptime, memory, agent count)

```bash
remote-coding-agent tui
```

## Message Flow

```
1. User sends "fix the login bug" on Telegram

2. TelegramChannel.poll()
   → Normalizes to IncomingMessage { channel:"telegram", chatId:"123", text:"fix the login bug" }

3. Engine routes to AgentBridge.handleMessage()
   → Security check (allowed user?)
   → Not a slash command → process with agent

4. AgentBridge.processWithAgent()
   → Get/create session for telegram:123:456
   → Get/create AgentRunner for this session
   → Start typing indicator
   → Race: agent.run() vs 8-second timeout

5. AgentRunner (from @cdoing/ai)
   → Builds system prompt + conversation history
   → Calls LLM (Claude/GPT/etc.)
   → LLM responds with tool calls (file_read, grep_search, file_edit, shell_exec)
   → Executes tools → feeds results back → loops until done

6. Response flows back:
   - Fast (<8s): reply directly to the Telegram message
   - Slow (>8s): edit "Working..." message with the result
```

## Configuration

Three layers, merged in order (later wins):

```
Config file (remote-coding-agent.config.json)
  ↓ overridden by
Environment variables (.env / shell)
  ↓ overridden by
CLI arguments (--model, --provider, etc.)
```

All validated by Zod schemas.

### Key Environment Variables

| Variable | Maps to |
|----------|---------|
| `TELEGRAM_BOT_TOKEN` | `channels.telegram.botToken` |
| `DISCORD_BOT_TOKEN` | `channels.discord.botToken` |
| `ANTHROPIC_API_KEY` | `agent.apiKey` |
| `OPENAI_API_KEY` | `agent.apiKey` |
| `CDOING_PROVIDER` | `agent.provider` |
| `CDOING_MODEL` | `agent.model` |
| `PORT` | `gateway.port` |
| `GATEWAY_AUTH_TOKEN` | `gateway.authToken` |
| `ALLOWED_DIRS` | `security.allowedDirs` |

## Security Model

| Layer | Mechanism |
|-------|-----------|
| User access | Per-channel allowlists (`security.channelRules`) |
| Rate limiting | Sliding window per user (middleware) |
| Directory sandbox | `allowedDirs` checked before dir changes |
| File sandbox | SandboxManager from @cdoing/core (allowWrite/denyWrite) |
| API auth | Bearer token on `/api/*` routes |
| HTTP security | Helmet headers (XSS, clickjacking, MIME) |
| Config changes | `config_manager` tool requires permission approval |

## CLI Commands

```bash
# Generate config template
remote-coding-agent init

# Start headless (all enabled channels)
remote-coding-agent start

# Start headless + web dashboard
remote-coding-agent start --dashboard
# or use the dedicated command:
remote-coding-agent dashboard

# Start with TUI dashboard (terminal UI)
remote-coding-agent tui

# Check channel connections
remote-coding-agent status

# Common flags (shared across start/tui/dashboard)
--config <path>           Config file path
--dir <directory>         Working directory
--provider <name>         AI provider (anthropic, openai, google, ollama)
--model <name>            AI model
--api-key <key>           Provider API key
--telegram-token <token>  Telegram bot token
--discord-token <token>   Discord bot token
--port <port>             Gateway port (default: 4567)
--log-level <level>       debug | info | warn | error
```

When running with `--dashboard` or `dashboard` command, the web UI is served at `http://localhost:PORT/dashboard/` on the same gateway port. No separate server needed.

Before first use, build the dashboard:
```bash
cd packages/dashboard && yarn build
```

## Adding New Channels

1. Create `src/channels/<name>/index.ts`
2. Implement `ChannelAdapter` (or extend `BaseChannel`)
3. Export a `ChannelPlugin` object
4. Register in `channels/registry.ts` (auto-load) or call `engine.registerChannel()`

The channel only needs to:
- Receive messages and normalize to `IncomingMessage`
- Send text messages back
- Optionally: edit messages, send typing indicators

Everything else (sessions, agent, tools, security, TUI) works automatically.
