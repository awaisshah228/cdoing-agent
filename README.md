# Cdoing Agent

AI-powered coding assistant — **CLI + VS Code Extension**. Multi-provider (Anthropic, OpenAI, Google), agentic tool use, real-time streaming, and full codebase awareness.

![Cdoing Agent — VS Code Extension + CLI](assets/image.png)

---

## What It Does

An intelligent coding agent that reads, writes, searches, and runs commands in your codebase — controlled through natural language. Think Claude Code, but open source and multi-provider.

**CLI** — terminal-based interactive chat with streaming, slash commands, conversation history, message queuing, and auto-complete.

**VS Code Extension** — sidebar chat panel, editor panel (beside code), multi-tab conversations, clickable file paths, inline diff preview, syntax-highlighted code blocks with copy button.

---

## Quick Start

```bash
# 1. Clone and install
git clone <repo-url>
cd cdoing-agent
yarn install

# 2. Build all packages
yarn build

# 3. Set your API key
export ANTHROPIC_API_KEY=sk-ant-...

# 4. Run the CLI
yarn start

# Or run directly
node packages/cli/dist/index.js
```

On first run, if no API key is found the CLI will interactively prompt you to enter one and save it to `~/.cdoing/config.json`.

---

## VS Code Extension

### Setup

```bash
# Build everything first
yarn build

# Open extension in VS Code
code packages/vscode-extension

# Press F5 → launches Extension Development Host
# Or launch directly:
code --extensionDevelopmentPath=packages/vscode-extension
```

### Chat Panel

| Action | What Happens |
|--------|-------------|
| Click `</>` icon in activity bar | Opens chat in sidebar |
| `Cmd+Shift+L` | Opens chat as editor panel **beside your code** |
| Click 💬 on file title bar | Opens chat with file context pre-filled |
| Right-click selected code | Explain, Refactor, Fix, Send to Chat |

### Multi-Tab Conversations
- Click `+` to create a new conversation tab
- Each tab has its own AgentRunner, history, and context
- Tab titles auto-update from your first message
- Close tabs with `×` (last tab creates a new one)
- Background processing — tabs continue working when you switch away

### Performance (inspired by Continue.dev)
- **Batched streaming** — `requestAnimationFrame` groups tokens (not per-token re-renders)
- **ResizeObserver scroll** — efficient auto-scroll, pauses when user scrolls up
- **React.memo** — memoized message and tool call components
- **Syntax highlighting** — `marked` + `highlight.js` (15+ languages)
- **Code blocks** — copy button, language label, proper highlighting

### Tool Call Steps (Claude Code style)
- Collapsible accordion rows with status icons (⏳ running, ✓ success, ✗ error)
- Specialized summaries: file tools → clickable path, shell → `$ command`, search → result count
- Expand to see structured input (key-value) or formatted output
- Click file paths to open in editor

### All Slash Commands
`/new`, `/clear`, `/history`, `/resume <id>`, `/model`, `/provider`, `/mode`, `/config`, `/usage`, `/cost`, `/compact`, `/permissions`, `/memory`, `/hooks`, `/queue`, `/settings`, `/help`

---

## CLI Usage

```
Usage: cdoing [options] [prompt]

Arguments:
  prompt                        One-shot prompt (skips interactive mode)

Options:
  -V, --version                 Output the version number
  -m, --model <model>           Model to use (e.g., claude-sonnet-4-20250514, gpt-4o)
  -p, --provider <provider>     AI provider: anthropic, openai, google, custom (default: "anthropic")
  --base-url <url>              Base URL for custom providers
  --api-key <key>               API key (overrides environment variable)
  --mode <mode>                 Permission mode: ask, auto-edit, auto (default: "ask")
  -d, --dir <directory>         Working directory (default: current directory)
  -h, --help                    Display help for command
```

### Usage Modes

| Mode | Command | Description |
|------|---------|-------------|
| Interactive | `cdoing` | Launches a persistent chat session |
| One-shot | `cdoing "list all files"` | Runs a single prompt and exits |

---

## AI Providers

| Provider | Flag | Env Variable | Models |
|----------|------|-------------|--------|
| Anthropic (default) | `--provider anthropic` | `ANTHROPIC_API_KEY` | Claude family |
| OpenAI | `--provider openai` | `OPENAI_API_KEY` | GPT family |
| Google | `--provider google` | `GOOGLE_API_KEY` | Gemini family |
| Custom | `--provider custom --base-url <url>` | `--api-key <key>` | Any compatible API |

**API key resolution order:** `--api-key` flag → environment variable → `~/.cdoing/config.json` → interactive prompt.

---

## Tools (10 Built-In)

### File Operations

| Tool | Description | Permission |
|------|-------------|:---:|
| `file_read` | Read file contents (text, images, PDFs). Supports offset and line limits. | No |
| `file_write` | Create or overwrite files. Auto-creates parent directories. | Yes |
| `file_edit` | Find-and-replace editing with unified diff output. | Yes |

### Search & Discovery

| Tool | Description | Permission |
|------|-------------|:---:|
| `glob_search` | Find files by glob pattern (e.g., `**/*.ts`). Respects `.gitignore`. | No |
| `grep_search` | Search file contents with regex. Case-insensitive and file-filter options. | No |

### Code Execution

| Tool | Description | Permission |
|------|-------------|:---:|
| `shell_exec` | Run any shell command. Blocks dangerous patterns. Timeout: 120s. | Yes |
| `file_run` | Run scripts by extension (.js, .ts, .py, .rb, .sh, .go, etc.). Timeout: 30s. | Yes |

### Web Access

| Tool | Description | Permission |
|------|-------------|:---:|
| `web_fetch` | Fetch and extract content from URLs. Strips HTML, supports JSON. | Yes |
| `web_search` | Search the web via DuckDuckGo (no API key required). | Yes |

### Agent Control

| Tool | Description | Permission |
|------|-------------|:---:|
| `sub_agent` | Spawn an independent sub-agent for parallel research tasks. | No |

### Parallel Execution
Read-only tools (`file_read`, `glob_search`, `grep_search`, `web_fetch`, `web_search`, `sub_agent`) run in parallel via `Promise.all`. Mutating tools (`file_write`, `file_edit`, `shell_exec`) run sequentially. Results matched by `tool_call_id`.

---

## Permission Modes

| Mode | Behavior |
|------|----------|
| `ask` (default) | Prompts before every tool that requires permission |
| `auto-edit` | Auto-approves file writes/edits, prompts for shell commands |
| `auto` | Auto-approves all tool calls |

When prompted for permission:

| Key | Action |
|-----|--------|
| `y` / Enter | Allow this once |
| `a` | Always allow globally (saved to `~/.cdoing/permissions.json`) |
| `p` | Allow for this project only (saved to `.cdoing/permissions.json`) |
| `n` | Deny |

---

## Slash Commands

### Chat Management

| Command | Description |
|---------|-------------|
| `/new` | Start a new conversation (new tab in VS Code) |
| `/clear` | Clear the current conversation history |
| `/history` | List saved conversations |
| `/resume <id>` | Resume a previously saved conversation |
| `/delete <id>` | Delete a saved conversation |
| `/queue` | View/clear message queue |
| `/compact` | Compress context window |

### Configuration

| Command | Description |
|---------|-------------|
| `/config` | Show current config |
| `/model <name>` | Switch model |
| `/provider <name>` | Switch AI provider |
| `/mode <mode>` | Change permission mode |
| `/dir <path>` | Change working directory (CLI only) |

### Info & System

| Command | Description |
|---------|-------------|
| `/permissions` | View/clear stored permissions |
| `/memory` | View/manage persistent memory |
| `/hooks` | View configured hooks |
| `/usage` | Token usage stats |
| `/cost` | Cost breakdown |
| `/tasks` | View task list |
| `/doctor` | System health check (CLI only) |
| `/help` or `?` | Show help |

### Direct Shell Access (CLI)

| Syntax | Description |
|--------|-------------|
| `!<command>` | Execute a shell command directly (e.g., `!git status`) |

---

## Agent Architecture

```
User Message
     │
     ▼
┌─────────────────────────────┐
│  Agent Runner (agentic loop) │
│                             │
│  stream() ──► Tool Calls    │
│    ▲          │             │
│    │    ┌─────┴──────┐      │
│    │    │ Parallel:   │     │
│    │    │  file_read  │     │
│    │    │  grep_search│     │
│    │    │  sub_agent  │     │
│    │    ├────────────┤      │
│    │    │ Sequential: │     │
│    │    │  file_edit  │     │
│    │    │  shell_exec │     │
│    │    └─────┬──────┘      │
│    │          │             │
│    └──── Results ◄──────────┘
│                             │
│  + Retry with backoff       │
│  + Context compression      │
│  + Token tracking           │
│  + Pre/post hooks           │
└─────────────────────────────┘
```

---

## Configuration

### Project Config

Create `.cdoing/config.md` or `CDOING.md` in your project root:

```markdown
# Project Instructions
This is a Node.js + TypeScript project.
- Use ESM imports
- Run `npm test` after changes
```

### Hooks

`~/.cdoing/hooks.json` or `.cdoing/hooks.json`:

```json
{
  "hooks": [
    { "event": "post:file_write", "command": "prettier --write {{file_path}}" },
    { "event": "post:file_edit", "command": "eslint --fix {{file_path}}" }
  ]
}
```

### Configuration Files

| File | Scope | Purpose |
|------|-------|---------|
| `~/.cdoing/config.json` | Global | Default provider, model, API keys |
| `~/.cdoing/permissions.json` | Global | Globally allowed tool permissions |
| `~/.cdoing/hooks.json` | Global | Global hooks |
| `~/.cdoing/memory.json` | Global | Persistent memories |
| `~/.cdoing/conversations/` | Global | Saved conversations |
| `.cdoing/config.md` or `CDOING.md` | Project | Project-specific instructions |
| `.cdoing/permissions.json` | Project | Per-project permissions |
| `.cdoing/hooks.json` | Project | Per-project hooks |

---

## Project Structure

```
cdoing-agent/
├── package.json                 # Monorepo root (Yarn workspaces + Turborepo)
├── turbo.json                   # Build pipeline
├── assets/                      # Screenshots and images
│   └── image.png
├── packages/
│   ├── core/                    # @cdoing/core — tools, permissions, hooks, memory
│   │   └── src/
│   │       ├── tools/           # 10 tools
│   │       ├── permissions/     # Permission manager with stored rules
│   │       ├── hooks/           # Pre/post tool execution hooks
│   │       └── utils/           # Memory, project config, path safety
│   ├── ai/                      # @cdoing/ai — agent runner, providers
│   │   └── src/
│   │       ├── agent-runner.ts  # Agentic loop with parallel tool execution
│   │       ├── provider.ts      # LangChain: Anthropic, OpenAI, Google, custom
│   │       ├── context-manager.ts # Token tracking, compression
│   │       └── system-prompt.ts # System prompt builder
│   ├── cli/                     # @cdoing/cli — terminal interface
│   │   └── src/
│   │       ├── index.ts         # CLI entry (commander)
│   │       ├── chat.ts          # Interactive chat with message queuing
│   │       ├── callbacks.ts     # Streaming output formatting
│   │       ├── history.ts       # Conversation save/resume
│   │       └── config.ts        # Config & API key resolution
│   └── vscode-extension/        # cdoing-vscode — VS Code extension
│       ├── src/
│       │   ├── extension.ts     # Extension entry — commands, editor panel, diff
│       │   ├── chat-panel-provider.ts # Multi-tab agent bridge
│       │   ├── webview-content.ts     # HTML shell with CSP
│       │   └── webview/               # React app
│       │       ├── index.tsx          # Mount point
│       │       ├── components/        # ChatPanel, TabBar, MessageBubble, ToolCallBubble, etc.
│       │       ├── hooks/             # useChatState, useAutoScroll, useVsCode
│       │       ├── utils/             # markdown renderer (marked + highlight.js)
│       │       └── styles/            # CSS (VS Code theme vars)
│       └── esbuild.config.js   # Builds extension host + webview bundles
```

---

## Development

```bash
# Install dependencies
yarn install

# Build all packages
yarn build

# Run CLI
yarn start

# Dev mode — watch + run CLI
yarn dev

# VS Code extension
cd packages/vscode-extension
yarn dev          # Watch mode
# Press F5 in VS Code

# Type check
npx tsc --noEmit  # from any package directory
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 18+, TypeScript |
| AI | LangChain (Anthropic, OpenAI, Google providers) |
| CLI | readline, chalk, ora, commander |
| VS Code Extension | React 19, esbuild, WebviewView + WebviewPanel |
| Markdown | marked + highlight.js (extension), custom renderer (CLI) |
| Build | Turborepo + Yarn workspaces |
| Storage | Local filesystem (`~/.cdoing/`) |

---

## Keyboard Shortcuts

### CLI

| Key | Action |
|-----|--------|
| `?` | Show help |
| `ESC` | Cancel current operation |
| `Ctrl+C` (once) | Prompt to exit |
| `Ctrl+C` (twice) | Force exit |
| `Tab` / `↑↓` | Navigate slash command suggestions |

### VS Code Extension

| Key | Action |
|-----|--------|
| `Cmd+Shift+L` | Open chat panel beside editor |
| `Cmd+Shift+Enter` | Send selection to chat |

---

## License

MIT
