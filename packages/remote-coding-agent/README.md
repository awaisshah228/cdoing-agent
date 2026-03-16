# Remote Coding Agent

A multi-channel remote coding agent that lets you control your personal AI coding assistant from **Telegram, Discord, or any chat platform** — and manage it all from a **web dashboard**.

Think of it as a self-hosted AI coding bot. You message it on Telegram, it reads your code, edits files, runs commands, and replies — all from your phone.

---

## How It Works (The Big Picture)

```
You (Telegram / Discord / Slack / Browser)
     │
     ▼
┌─────────────────────────────────────────────────────┐
│  Remote Coding Agent                                │
│                                                     │
│  ┌──────────┐    ┌──────────┐    ┌──────────────┐  │
│  │ Channels │───▶│  Engine   │───▶│ Agent Bridge │  │
│  │ Telegram │    │ (wiring) │    │ (commands,   │  │
│  │ Discord  │    │          │    │  security,   │  │
│  │ Custom   │    │          │    │  timeouts)   │  │
│  └──────────┘    └────┬─────┘    └──────┬───────┘  │
│                       │                  │          │
│  ┌──────────┐    ┌────┴─────┐    ┌──────┴───────┐  │
│  │ Gateway  │    │ Sessions │    │ AgentRunner  │  │
│  │ REST API │    │ per-user │    │ (@cdoing/ai) │  │
│  │ Dashboard│    │ history  │    │ LLM + Tools  │  │
│  └──────────┘    └──────────┘    └──────────────┘  │
│                                                     │
│  ┌──────────┐    ┌──────────┐    ┌──────────────┐  │
│  │  Cron    │    │  Skills  │    │  15+ Tools   │  │
│  │ Scheduler│    │ Registry │    │ files, shell │  │
│  └──────────┘    └──────────┘    │ git, web...  │  │
│                                  └──────────────┘  │
└─────────────────────────────────────────────────────┘
```

**In plain English:**

1. You send a message on Telegram (or Discord, or any channel)
2. The **Channel** normalizes it into a standard format
3. The **Engine** routes it through security checks and rate limiting
4. The **Agent Bridge** runs your AI coding assistant (Claude, GPT, etc.)
5. The agent uses **15+ tools** to read files, edit code, run commands, search, etc.
6. The response flows back to you on the same channel
7. Everything is visible in the **Web Dashboard** or **TUI**

---

## Quick Start

### 1. Install

```bash
# Clone the cdoing-agent monorepo
git clone <repo-url>
cd cdoing-agent

# Install everything
yarn install

# Build all packages (core → ai → remote-coding-agent)
yarn build
```

### 2. Setup (Interactive Wizard — Recommended)

```bash
cd packages/remote-coding-agent
npx ts-node src/cli.ts setup
```

The interactive wizard walks you through:
1. **AI Provider** — Anthropic, OpenAI, Google, or Ollama (arrow keys to select)
2. **Model** — Pick from provider-specific options
3. **API Key** — Enter or use from environment
4. **Channels** — Enable Telegram/Discord and enter bot tokens
5. **Security** — Auto-generates a secure auth token for API + dashboard
6. **Permission Mode** — How much freedom the agent has
7. **Working Directory** — Where the agent operates
8. **Gateway Port** — HTTP port (default 4567)

At the end, it saves a config file and prints your **auth token** — save it, you'll need it to access the dashboard.

### 2b. Alternative: Non-Interactive Config

```bash
# Generate a config template with auto-generated auth token
npx ts-node src/cli.ts init

# Edit the config manually
vim remote-coding-agent.config.json
```

Or use environment variables:

```bash
export TELEGRAM_BOT_TOKEN="your-telegram-bot-token"
export ANTHROPIC_API_KEY="your-api-key"
export GATEWAY_AUTH_TOKEN="your-secret-token"
```

### 3. Run

```bash
# Headless mode (just channels + API)
npx ts-node src/cli.ts start

# With terminal dashboard (TUI)
npx ts-node src/cli.ts tui

# With web dashboard (browser UI)
npx ts-node src/cli.ts dashboard
# → Opens http://localhost:4567/dashboard/

# Headless + web dashboard
npx ts-node src/cli.ts start --dashboard
```

### 4. Build the Dashboard (first time only)

```bash
cd packages/dashboard
yarn build
```

The dashboard static files are served directly by the gateway — no separate server needed.

---

## Architecture — Module by Module

Here's what each module does, with code references so you can dive in.

### Engine (`src/core/engine.ts`)

**What it does:** The main orchestrator. Creates and wires all subsystems together.

**In layman terms:** Think of it as the "main" function that boots everything up. It creates the channel registry, session manager, agent bridge, gateway, cron service, and skill registry — then connects them all.

```typescript
// How it all starts:
const engine = new Engine(config, { enableDashboard: true });
await engine.start();
// → starts session cleanup, cron scheduler, gateway, and all channels
```

**Key responsibilities:**
- Wires channels → rate limiter → bridge (message routing)
- Forwards events to TUI and SSE dashboard clients
- Applies config patches from the dashboard
- Graceful shutdown of everything

### Agent Bridge (`src/core/bridge.ts`)

**What it does:** The brain that handles every incoming message.

**In layman terms:** When a message arrives from any channel, the bridge decides what to do: Is it a slash command? Is the user authorized? Is there already a request in progress? If it's a regular message, it runs the AI agent and sends back the response.

**The 8-second timeout pattern:**
```
User sends message
     │
     ▼
Agent starts working...
     │
     ├─── Finishes in < 8 seconds? → Reply directly
     │
     └─── Takes > 8 seconds? → Send "Working..." message
                                 → Edit it with the result when done
```

**Slash commands:** `/start`, `/help`, `/clear`, `/status`, `/dir`, `/model`, `/provider`, `/whoami`

### Channels (`src/channels/`)

**What they do:** Connect to chat platforms and normalize messages.

**In layman terms:** Each channel is a "plugin" that knows how to talk to a specific platform. Telegram channel polls for new messages, Discord channel uses the Discord API, etc. All channels convert platform-specific messages into a common format so the rest of the system doesn't care which platform you're using.

```
ChannelAdapter (interface)          ← contract every channel implements
     ▲
BaseChannel (abstract)              ← shared helpers (message chunking, etc.)
     ▲
TelegramChannel, DiscordChannel     ← actual implementations
```

**Adding a new channel** requires just ONE file:
```typescript
// src/channels/slack/index.ts
export class SlackChannel extends BaseChannel {
  readonly id = "slack";
  readonly name = "Slack";
  async start() { /* connect to Slack */ }
  async stop() { /* disconnect */ }
  async sendMessage(chatId, text) { /* send via Slack API */ }
  async editMessage(chatId, msgId, text) { /* edit message */ }
  async sendTyping(chatId) { /* show typing indicator */ }
}
```

### Session Manager (`src/session/session-manager.ts`)

**What it does:** Keeps conversation history per user per channel.

**In layman terms:** When you send 5 messages in a row, the agent remembers your earlier messages. Sessions are keyed by `channel:chatId:userId` — so the same user on Telegram and Discord gets separate conversations.

- **TTL:** Sessions expire after 30 minutes of inactivity (configurable)
- **History:** Stores the last 50 messages per session
- **Max sessions:** Caps at 100 concurrent sessions with LRU eviction

### Gateway (`src/gateway/server.ts` + `src/gateway/routes/`)

**What it does:** Express HTTP server providing REST API, webhooks, SSE events, and the web dashboard.

**In layman terms:** The gateway is the web server that powers everything. The dashboard talks to it, external services send webhooks through it, and monitoring tools poll it for health checks.

**Routes are split into separate files** for scalability:

| Route File | Endpoints | Purpose |
|------------|-----------|---------|
| `routes/health.ts` | `GET /health` | Health check for monitoring |
| `routes/sessions.ts` | `GET/DELETE /api/sessions` | Session CRUD + message history |
| `routes/channels.ts` | `GET /api/channels` | Channel status |
| `routes/stats.ts` | `GET /api/stats` | System stats (memory, uptime) |
| `routes/config.ts` | `GET/PUT /api/config` | Read/update configuration |
| `routes/events.ts` | `GET /api/events` | SSE real-time event stream |
| `routes/webhooks.ts` | `POST /webhook/:id`, `POST /api/send` | Webhook receiver + send API |
| `routes/cron.ts` | `GET/POST/PATCH/DELETE /api/cron/*` | Cron job management |
| `routes/skills.ts` | `GET/POST /api/skills/*` | Skills management |
| `routes/dashboard.ts` | `GET /dashboard/*` | Serve web dashboard UI |

### Cron Service (`src/cron/service.ts`)

**What it does:** Runs scheduled and recurring tasks.

**In layman terms:** Like a cron job on your server, but for your AI agent. You can schedule tasks like "every hour, check for new issues" or "at 9am, summarize yesterday's commits".

**Schedule types:**
- `"at"` — One-shot at a specific time (ISO-8601)
- `"every"` — Recurring interval (e.g., every 60000ms)
- `"cron"` — Standard cron expressions (e.g., `"0 9 * * *"`)

**Payload types:**
- `"systemEvent"` — Internal event with custom text
- `"agentTurn"` — Run the AI agent with a specific message

```typescript
// Example: Check for issues every hour
cronService.add({
  name: "hourly-issue-check",
  enabled: true,
  schedule: { kind: "every", everyMs: 3600000 },
  payload: { kind: "agentTurn", message: "Check for new GitHub issues and summarize them" },
});
```

### Skill Registry (`src/skills/registry.ts`)

**What it does:** Manages extensible prompt-based capabilities.

**In layman terms:** Skills are reusable "recipes" that teach the agent how to do specific tasks well. Instead of writing "please commit with conventional commit format and check for staged files first" every time, you just say `/skill commit` and the skill's pre-written instructions take over.

**Skill discovery:**
1. Built-in skills (6 shipped by default — `src/skills/builtin.ts`)
2. Project skills in `.cdoing/skills/*.md`
3. User skills in `~/.cdoing/skills/*.md`

**Skill file format** (Markdown with YAML frontmatter):
```markdown
---
name: my-skill
description: What this skill does
userInvocable: true
always: false
---

Your prompt instructions here. The agent will follow
these instructions when this skill is invoked.
```

**Built-in skills:** `commit`, `review`, `explain`, `test`, `deploy-check`, `summarize`

### Web Dashboard (`packages/dashboard/`)

**What it does:** Browser-based admin panel served at `/dashboard/` on the gateway.

| Page | What it shows |
|------|---------------|
| **Overview** | Stats cards, memory usage, channel status |
| **Sessions** | List sessions, view message history, destroy sessions |
| **Channels** | Connection status, send test messages |
| **Cron Jobs** | Create/edit/delete scheduled tasks, run history |
| **Skills** | View/enable/disable skills, see prompt content |
| **Configuration** | Edit all settings (agent, gateway, session, security) |
| **Live Feed** | Real-time SSE event stream with filtering |

**Tech stack:** Next.js 14 (static export) + Tailwind CSS + Lucide icons

---

## Message Flow — Step by Step

Here's exactly what happens when you send "fix the login bug" on Telegram:

```
1. TelegramChannel.poll()
   → Fetches new messages from Telegram Bot API
   → Normalizes to: { channel:"telegram", chatId:"123", userId:"456",
                       text:"fix the login bug", timestamp:1710000000 }

2. Engine.wireChannel() routes to AgentBridge.handleMessage()
   → Rate limiter check: is user under 20 req/min? ✓
   → Security check: is userId in allowedUserIds? ✓
   → Concurrent check: is another request running for this user? No ✓

3. AgentBridge detects it's not a slash command → processWithAgent()
   → Gets/creates session for "telegram:123:456"
   → Gets/creates AgentRunner for this session
   → Sends typing indicator to Telegram
   → Starts 8-second race timer

4. AgentRunner (@cdoing/ai) does its thing:
   → Builds system prompt + conversation history from session
   → Calls LLM (Claude/GPT/Gemini/Ollama)
   → LLM responds: "I'll look at the login code..."
   → LLM makes tool calls: file_read("src/auth/login.ts")
   → Tool executes → returns file contents
   → LLM analyzes → makes tool call: file_edit(...)
   → Tool executes → file modified
   → LLM: "I've fixed the bug by..."

5. Response flows back:
   → If < 8 seconds: reply directly to the Telegram message
   → If > 8 seconds: edit the "Working..." message with the result
   → Session updated with the conversation
   → Events emitted to SSE clients (dashboard sees it in real-time)
```

---

## Configuration

Three layers, merged in order (later wins):

```
Config file (remote-coding-agent.config.json or .cdoing/remote.json)
  ↓ overridden by
Environment variables (.env or shell)
  ↓ overridden by
CLI arguments (--model, --provider, etc.)
```

### Config File Structure

```json
{
  "agent": {
    "provider": "anthropic",
    "model": "claude-sonnet-4-6",
    "maxTurns": 25,
    "permissionMode": "auto"
  },
  "gateway": { "port": 4567 },
  "session": {
    "ttlMs": 1800000,
    "maxHistoryMessages": 50,
    "maxSessions": 100
  },
  "security": {
    "channelRules": {
      "telegram": { "allowedUserIds": ["123456"] }
    },
    "rateLimitPerMinute": 20,
    "allowedDirs": ["/home/user/projects"]
  },
  "channels": {
    "telegram": { "enabled": true, "botToken": "BOT_TOKEN" }
  },
  "workingDir": "/home/user/projects/my-app",
  "logLevel": "info"
}
```

### Environment Variables

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

---

## CLI Commands

```bash
remote-coding-agent setup             # Interactive setup wizard (recommended first run)
remote-coding-agent init              # Generate config template (non-interactive)
remote-coding-agent start             # Headless (channels + API)
remote-coding-agent start --dashboard # Headless + web dashboard
remote-coding-agent dashboard         # Dedicated dashboard mode
remote-coding-agent tui               # Terminal UI dashboard
remote-coding-agent status            # Check channel connections

# Common flags (all commands)
--config <path>           Config file path
--dir <directory>         Working directory
--provider <name>         AI provider (anthropic, openai, google, ollama)
--model <name>            Model name
--api-key <key>           Provider API key
--telegram-token <token>  Telegram bot token
--discord-token <token>   Discord bot token
--port <port>             Gateway port (default: 4567)
--log-level <level>       debug | info | warn | error
```

---

## Authentication & Security

### Auth Token (`src/auth/secret.ts`)

**How it works:** On first setup (via `setup` or `init`), a **256-bit cryptographically secure token** is auto-generated and saved in the config file at `gateway.authToken`.

This token protects:
- **All `/api/*` endpoints** — requires `Authorization: Bearer <token>` header
- **Web dashboard** — requires `?token=<token>` in the URL (sets a 24h session cookie)
- **Webhook endpoints** — validated against the auth token

**Without the token, no one can:**
- Access the dashboard
- Read or modify configuration
- View sessions or send messages
- Create or manage cron jobs

**How the dashboard auth flow works:**
```
1. User visits /dashboard/
2. No token → shows login page (enter token)
3. Token provided via ?token=xxx → validates
4. Sets httpOnly cookie → no need to include token on every page
5. Cookie expires after 24 hours → re-auth required
```

**Generating a new token:**
```bash
# Re-run setup (generates new token)
remote-coding-agent setup

# Or manually in code
import { generateSecretKey } from "@cdoing/remote-coding-agent";
const token = generateSecretKey(); // 64-char hex string
```

### Security Model

| Layer | What it does | Where |
|-------|-------------|-------|
| **Auth token** | Protects API + dashboard access | `auth/secret.ts`, `gateway.authToken` |
| **Dashboard auth** | Token + cookie session for browser access | `routes/dashboard.ts` |
| **User access** | Per-channel allowlists | `security.channelRules` |
| **Rate limiting** | Sliding window per user | `middleware/rate-limiter.ts` |
| **Directory sandbox** | Restricts which dirs the agent can access | `security.allowedDirs` |
| **File sandbox** | Allow/deny write to specific paths | SandboxManager from @cdoing/core |
| **HTTP security** | Helmet headers (XSS, clickjacking, MIME) | `gateway/server.ts` |
| **Timing-safe compare** | Prevents timing attacks on token validation | `auth/secret.ts` |

---

## Directory Structure

```
src/
├── index.ts                    # Public API — all exports
├── cli.ts                      # CLI entry: start, tui, dashboard, init, status
│
├── types/index.ts              # All type definitions (channel-agnostic)
├── config/index.ts             # Config loader (file + env + CLI, Zod validation)
│
├── auth/
│   └── secret.ts               # Auth token generation, validation, timing-safe compare
│
├── core/
│   ├── engine.ts               # Main orchestrator — wires everything together
│   └── bridge.ts               # Agent bridge — channels → AgentRunner
│
├── channels/
│   ├── base.ts                 # BaseChannel abstract class
│   ├── registry.ts             # Channel plugin registry
│   ├── telegram/index.ts       # Telegram channel (Bot API polling + webhook)
│   └── discord/index.ts        # Discord channel (stub — ready to implement)
│
├── cron/
│   ├── types.ts                # CronJob, CronSchedule, CronPayload types
│   └── service.ts              # CronService — scheduler, CRUD, run history
│
├── skills/
│   ├── types.ts                # Skill, SkillEntry, SkillResult types
│   ├── registry.ts             # SkillRegistry — discovery, loading, invocation
│   └── builtin.ts              # 6 built-in skills (commit, review, explain, etc.)
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
│       ├── health.ts           # GET /health
│       ├── sessions.ts         # Sessions CRUD + history
│       ├── channels.ts         # Channel listing
│       ├── stats.ts            # System stats
│       ├── config.ts           # Config read/update
│       ├── events.ts           # SSE event stream
│       ├── webhooks.ts         # Webhooks + send API
│       ├── cron.ts             # Cron job management
│       ├── skills.ts           # Skills management
│       └── dashboard.ts        # Serve web dashboard
│
├── tui/
│   ├── app.ts                  # Ink TUI dashboard (live monitoring)
│   └── setup-wizard.ts         # Interactive setup wizard (first-run config)
│
├── formatter/index.ts          # Channel-agnostic message formatting
├── middleware/rate-limiter.ts   # Per-user sliding window rate limiter
└── utils/logger.ts             # Structured logger with levels
```

---

## Adding New Channels

1. Create `src/channels/<name>/index.ts`
2. Extend `BaseChannel` or implement `ChannelAdapter`
3. Export a `ChannelPlugin` object
4. Register in `channels/registry.ts` or call `engine.registerChannel()`

Everything else (sessions, agent, tools, security, dashboard, cron, skills) works automatically.

---

## Adding New Skills

Create a `.md` file in `.cdoing/skills/` with YAML frontmatter:

```markdown
---
name: my-skill
description: What this skill does
userInvocable: true
---

Instructions for the agent when this skill is invoked.
The agent will follow these instructions precisely.
```

Skills are loaded on startup from:
- `.cdoing/skills/` (project-level)
- `~/.cdoing/skills/` (user-level)
- Built-in skills (always available)

---

## Package Dependencies

```
@cdoing/core  (tools, permissions, sandbox)
     ▲
@cdoing/ai    (AgentRunner, LLM providers, context management)
     ▲
@cdoing/remote-coding-agent  (this package — channels, engine, gateway, cron, skills)

@cdoing/dashboard  (Next.js admin UI — served as static files by the gateway)
```

---

## API Reference

Full REST API documentation is in the [ARCHITECTURE.md](./ARCHITECTURE.md) file.

Quick reference:

```bash
# Health check
curl http://localhost:4567/health

# List sessions
curl http://localhost:4567/api/sessions

# Get system stats
curl http://localhost:4567/api/stats

# List channels
curl http://localhost:4567/api/channels

# Read config (sensitive fields redacted)
curl http://localhost:4567/api/config

# Update config
curl -X PUT http://localhost:4567/api/config -H "Content-Type: application/json" \
  -d '{"agent":{"model":"gpt-4o"}}'

# Send a message via API
curl -X POST http://localhost:4567/api/send -H "Content-Type: application/json" \
  -d '{"channel":"telegram","chatId":"123","text":"hello"}'

# Stream events (SSE)
curl http://localhost:4567/api/events

# List cron jobs
curl http://localhost:4567/api/cron/jobs

# List skills
curl http://localhost:4567/api/skills

# Open dashboard
open http://localhost:4567/dashboard/
```

---

## License

MIT
