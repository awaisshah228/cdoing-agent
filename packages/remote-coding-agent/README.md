# Remote Coding Agent

Personal AI coding assistant accessible via Telegram, Discord, and web dashboard. Built on `@cdoing/core` and `@cdoing/ai`, the remote coding agent runs as a persistent server that receives messages from multiple channels and executes coding tasks on your behalf.

## Architecture

The remote coding agent uses a **dual-agent architecture** that separates conversational interaction from heavy coding work:

```
User (Telegram / Discord / Web Dashboard)
    |
    v
Personal Assistant (fast model: Haiku / GPT-4o-mini)
+-- Chat, Q&A -----------> responds directly
+-- Config / Cron / Skills -> uses management tools
+-- Coding tasks ---------> delegate_to_coder tool
                                |
                                v
                          Coding Agent (powerful model: Opus / Sonnet)
                          Full tool access: file_edit, shell_exec, git, grep...
                                |
                                v
                          Result -> Assistant summarizes for chat
```

The personal assistant handles lightweight interactions instantly using a fast, inexpensive model. When it detects a coding task, it delegates to a dedicated coding agent running a more powerful model with full tool access. This keeps costs low for casual conversation while maintaining high quality for coding work.

## Features

- **Dual-model architecture** -- Fast assistant model for chat, powerful model for coding tasks
- **Smart tool selection** -- Tools are organized into categories and selected per-message, achieving 40-60% token savings by only including relevant tool definitions
- **Telegram and Discord channels** -- Long-polling Telegram bot and Discord integration with an 8-second timeout pattern for responsive interaction
- **Scheduled tasks (cron)** -- Define recurring tasks that the agent runs on a schedule (e.g., daily test runs, periodic code reviews)
- **Reusable skills** -- Predefined task templates for common workflows: commit, review, test, deploy-check
- **Web dashboard** -- Real-time server-sent events (SSE) for streaming agent output to a browser UI
- **Per-user session isolation** -- Each user gets an independent conversation history and working context
- **Rate limiting and access control** -- Configurable per-user rate limits and allowlisted user IDs

## Quick Start

```bash
# Install dependencies
yarn install && yarn build

# Configure
cd packages/remote-coding-agent
cp remote-coding-agent.config.example.json remote-coding-agent.config.json
# Edit the config with your API keys and channel tokens

# Run
yarn start

# Or use the interactive setup wizard:
npx remote-coding-agent setup
```

## Configuration

The configuration file (`remote-coding-agent.config.json`) controls all aspects of the agent:

```json
{
  "agent": {
    "provider": "anthropic",          // LLM provider for the personal assistant
    "model": "claude-haiku-4-5",      // Fast model for chat / Q&A
    "codingProvider": "anthropic",     // LLM provider for the coding agent
    "codingModel": "claude-sonnet-4-6", // Powerful model for coding tasks
    "apiKey": "",                      // API key (or use env vars)
    "codingApiKey": "",                // Separate key for coding agent (optional)
    "maxTurns": 30,                   // Max agent turns per request
    "maxTokens": 8192,                // Max tokens per response
    "permissionMode": "auto",         // auto | auto-edit | ask
    "systemPrompt": ""                // Custom system prompt override
  },
  "channels": {
    "telegram": {
      "enabled": true,
      "token": "YOUR_TELEGRAM_BOT_TOKEN",
      "allowedUsers": [123456789]
    },
    "discord": {
      "enabled": false,
      "token": "YOUR_DISCORD_BOT_TOKEN",
      "allowedUsers": ["user-id"]
    },
    "web": {
      "enabled": true,
      "port": 3456,
      "authToken": "your-secret-token"
    }
  },
  "session": {
    "ttlMs": 3600000,                 // Session timeout (1 hour)
    "maxHistoryMessages": 100,        // Messages kept per session
    "maxSessions": 10                 // Max concurrent sessions
  },
  "security": {
    "rateLimitPerMinute": 20,         // Per-user rate limit
    "allowedDirs": ["/home/user/projects"]  // Restrict file access
  },
  "cron": {
    "tasks": []                       // Scheduled tasks
  },
  "logLevel": "info"
}
```

### Key configuration fields

| Field | Description |
|-------|-------------|
| `agent.provider` | LLM provider for the personal assistant (`anthropic`, `openai`, `google`, `ollama`) |
| `agent.model` | Model for the personal assistant (fast, cheap model recommended) |
| `agent.codingProvider` | LLM provider for the coding agent |
| `agent.codingModel` | Model for the coding agent (powerful model recommended) |
| `agent.permissionMode` | `ask`, `auto-edit`, or `auto` -- controls tool permission prompts |
| `security.allowedDirs` | Restrict file access to these directories only |

## Dual-Model Setup

The dual-model architecture is the core design pattern. The **personal assistant** and **coding agent** serve different roles:

### Personal Assistant (fast model)

- Handles greetings, questions, status checks, configuration changes
- Runs with a small set of management tools (config_manager, cron, skills)
- Uses a fast, inexpensive model like `claude-haiku-4-5` or `gpt-4o-mini`
- Responds in under a second for most queries

### Coding Agent (powerful model)

- Activated via the `delegate_to_coder` tool when the assistant detects coding work
- Has full access to all `@cdoing/core` tools: file_read, file_write, file_edit, shell_exec, grep_search, glob_search, etc.
- Uses a powerful model like `claude-sonnet-4-6` or `claude-opus-4-6`
- Runs in a separate AgentRunner instance with its own context window
- Has a 5-minute timeout to prevent runaway tasks

### How delegation works

1. User sends a message: "Fix the failing tests in src/utils"
2. The personal assistant recognizes this as a coding task
3. It calls `delegate_to_coder` with a refined task description and relevant context
4. The coding agent runs with full tool access, reads files, runs tests, makes edits
5. The coding agent returns its result
6. The personal assistant summarizes the outcome for the chat channel

You can configure different providers for each role:

```json
{
  "agent": {
    "provider": "openai",
    "model": "gpt-4o-mini",
    "codingProvider": "anthropic",
    "codingModel": "claude-sonnet-4-6"
  }
}
```

## Smart Tool Selection

Tools are organized into categories to avoid sending all tool definitions with every request. The smart selector analyzes each incoming message and includes only relevant tool categories:

- **File tools** -- file_read, file_write, file_edit, glob_search, grep_search
- **Shell tools** -- shell_exec, file_run
- **Git tools** -- git operations
- **Web tools** -- web_fetch, web_search
- **Management tools** -- config_manager, cron, skills (always included for the assistant)

This reduces prompt size by 40-60%, lowering costs and improving response quality by reducing noise in the tool list.

## Roadmap

- [x] Telegram channel with long polling
- [x] Web dashboard with SSE
- [x] Smart tool selection
- [x] Cron scheduling
- [x] Skills system
- [x] Dual-model support (assistant + coder)
- [x] delegate_to_coder tool
- [ ] Discord channel
- [ ] WhatsApp channel
- [ ] Docker sandbox backend
- [ ] SSH sandbox backend
- [ ] Topic-based agent routing (Telegram groups)
- [ ] Per-agent workspace isolation
- [ ] Multi-account channel support
- [ ] Browser sandbox (Puppeteer/Playwright)

## File Structure

```
src/
+-- index.ts                    # Entry point, starts the gateway server
+-- cli.ts                      # CLI argument parsing and setup wizard
+-- auth/                       # Authentication and access control
+-- channels/                   # Channel adapters (Telegram, Discord, Web)
+-- config/                     # Configuration loading and validation
+-- core/                       # Agent bridge, agent factory, event bus
+-- cron/                       # Scheduled task runner
+-- formatter/                  # Output formatting per channel (Markdown, HTML, plain)
+-- gateway/                    # Core server and message routing
+-- middleware/                  # Rate limiting, logging, error handling
+-- session/                    # Per-user session management and history
+-- skills/                     # Reusable task templates (commit, review, test, etc.)
+-- tools/                      # Remote-agent-specific tools
|   +-- config-manager.ts       # Runtime configuration management
|   +-- cron-tool.ts            # Cron task management via chat
|   +-- delegate-to-coder.ts    # Delegates coding tasks to the coding agent
|   +-- skill-tool.ts           # Skill execution via chat
|   +-- smart-selector.ts       # Per-message tool category selection
+-- tui/                        # Terminal UI for local monitoring
+-- types/                      # TypeScript type definitions
+-- utils/                      # Shared utilities
```
