# Cdoing Agent

AI-powered coding assistant — **CLI + VS Code Extension**. Multi-provider (Anthropic, OpenAI, Google), agentic tool use, real-time streaming, and full codebase awareness.

![Cdoing Agent — VS Code Extension + CLI](assets/image.png)

---

## What It Does

An intelligent coding agent that reads, writes, searches, and runs commands in your codebase — controlled through natural language. Think Claude Code, but open source and multi-provider.

**CLI** — terminal-based interactive chat with streaming, slash commands, conversation history, message queuing, plan mode, effort control, context providers (@terminal, @tree, @url, @codebase), and auto-complete.

**VS Code Extension** — sidebar chat panel, editor panel (beside code), multi-tab conversations, inline edit (Cmd+I), inline autocomplete (Tab completion), clickable file paths, inline diff preview, image support, syntax-highlighted code blocks with copy button.

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
| `Cmd+I` / `Ctrl+I` | **Inline edit** — select code, type instruction, see diff |
| Click 💬 on file title bar | Opens chat with file context pre-filled |
| Right-click selected code | Explain, Refactor, Fix, Inline Edit, Send to Chat |

### Inline Edit Mode (Cmd+I)

<!-- Learning note: Inline edit is one of the highest-impact features.
     It lets users make AI-powered changes without leaving their editor flow. -->

Select code → press `Cmd+I` (or `Ctrl+I`) → type an instruction → the AI generates
changes and shows them as a diff. Accept or reject with one click.

- Works without opening the chat panel
- Uses a focused prompt for precise edits
- Shows native VS Code diff view for review

### Inline Autocomplete (Tab Completion)

<!-- Learning note: Ghost text completion works via VS Code's
     InlineCompletionItemProvider API — the same API GitHub Copilot uses. -->

AI-powered code suggestions as you type, shown as faded "ghost text":

- **Tab** to accept, **Esc** to dismiss
- Configurable model (use a smaller/faster model for speed)
- Debounced requests (300ms) to avoid API spam
- Enable/disable with `/toggleAutocomplete` or in settings

```json
// settings.json
{
  "cdoing.autocomplete.enabled": true,
  "cdoing.autocomplete.model": "gpt-4o-mini"  // optional: faster model
}
```

### Multi-Tab Conversations
- Click `+` to create a new conversation tab
- Each tab has its own AgentRunner, history, and context
- Tab titles auto-update from your first message
- Close tabs with `×` (last tab creates a new one)
- Background processing — tabs continue working when you switch away

### Image Support

- **Attach images** — click the image button or use `cdoing.attachImage` command
- Supports PNG, JPG, GIF, WebP, SVG, BMP
- Multimodal models (Claude, GPT-4o) can analyze attached images

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
`/new`, `/clear`, `/history`, `/resume <id>`, `/model`, `/provider`, `/mode`, `/config`, `/plan`, `/effort`, `/btw`, `/rules`, `/mcp`, `/context`, `/usage`, `/cost`, `/compact`, `/permissions`, `/memory`, `/hooks`, `/queue`, `/settings`, `/help`

---

## Context Providers

<!-- Learning note: Context providers use the @ trigger pattern popularized
     by Continue.dev and Cursor. Each provider is a pluggable module that
     resolves a specific type of context. -->

Use `@` triggers in your message to attach context automatically:

| Trigger | Description | Requires Arg |
|---------|-------------|:---:|
| `@terminal` | Last terminal command output | No |
| `@tree [path] [depth]` | Workspace file tree visualization | No |
| `@url <url>` | Fetch and attach web page content | Yes |
| `@codebase <query>` | Search entire codebase for relevant code | Yes |
| `@open` | All open editor files (VS Code only) | No |
| `@problems` | Current file diagnostics/errors (VS Code only) | No |

**Examples:**
```
What's wrong? @terminal
How is the project structured? @tree src 4
Explain this API @url https://docs.example.com/api
Where is authentication handled? @codebase auth middleware
Fix all errors @problems
```

---

## Plan Mode

<!-- Learning note: Plan mode forces the agent to think before acting.
     This produces better results for complex tasks and gives the user
     a chance to course-correct before any files change. -->

Plan mode makes the agent analyze and plan before executing changes:

```
/plan                    # Toggle plan mode on/off
/plan refactor the auth  # Generate a plan for a specific request
/plan show               # Show the current plan
/plan approve            # Approve and execute the plan
/plan reject             # Reject the plan
```

When active, the agent:
1. Reads files and searches code (read-only)
2. Generates a step-by-step implementation plan
3. Waits for your approval before making any changes
4. Executes the plan with progress tracking

---

## Effort Level Control

<!-- Learning note: Effort level is a UX abstraction — instead of tweaking
     temperature, max tokens, and system prompt, users just say "try harder". -->

Control how deeply the agent analyzes your request:

```
/effort low     # Quick, minimal analysis
/effort medium  # Balanced (default)
/effort high    # Deep analysis, reads more files
/effort max     # Maximum thoroughness, extended thinking
```

| Level | Behavior |
|-------|----------|
| `low` | Shortest correct answer, fewest tools, fast |
| `medium` | Balanced analysis and speed (default) |
| `high` | Reads all relevant files, considers edge cases, verifies changes |
| `max` | Exhaustive search, multiple approaches, comprehensive testing |

---

## Side Questions (/btw)

<!-- Learning note: /btw creates a temporary agent that doesn't share
     history with the main conversation, keeping context clean. -->

Ask questions without polluting conversation history:

```
/btw what does the -p flag do in grep?
/btw how do I destructure a TypeScript generic?
```

Results are shown but not added to the conversation context — perfect for quick lookups.

---

## Project Rules

<!-- Learning note: Rules use glob-based scoping so you can have different
     coding standards for different parts of your project. -->

Define coding standards in `.cdoing/rules/` with glob-scoped markdown files:

```
.cdoing/rules/
├── typescript.md     # Rules for *.ts, *.tsx files
├── api.md            # Rules for src/api/** files
└── testing.md        # Rules for *.test.* files
```

Each rule file supports YAML frontmatter for scoping:

```markdown
---
globs: ["*.ts", "*.tsx"]
description: TypeScript coding standards
---

- Always use strict TypeScript (no `any`)
- Prefer named exports over default exports
- Use async/await instead of callbacks
```

Rule hierarchy: **path-specific** > **project** > **global** (`~/.cdoing/rules/`)

```
/rules          # View loaded rules
/rules reload   # Refresh from disk
```

---

## MCP Server Support

<!-- Learning note: MCP (Model Context Protocol) is an open protocol that
     lets AI models connect to external tools. Think of it as "USB for AI". -->

Connect to external tools via the [Model Context Protocol](https://modelcontextprotocol.io/):

Configure in `.cdoing/mcp.json`:

```json
{
  "servers": [
    {
      "name": "github",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_TOKEN": "ghp_..." }
    },
    {
      "name": "postgres",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-postgres"],
      "env": { "DATABASE_URL": "postgresql://..." }
    }
  ]
}
```

```
/mcp              # Show connected servers and tools
/mcp connect      # Connect to all configured servers
/mcp disconnect   # Disconnect all
```

MCP tools are automatically discovered and available to the agent alongside built-in tools.

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
  --print                       Print output only (non-interactive)
  -r, --resume <id>             Resume a conversation by ID
  -c, --continue                Continue most recent conversation
  --max-turns <n>               Maximum agent turns
  --output-format <format>      Output format: text, json, stream-json
  --verbose                     Enable verbose logging
  --system-prompt <prompt>      Custom system prompt
  --allowed-tools <tools>       Comma-separated allowed tools
  --disallowed-tools <tools>    Comma-separated disallowed tools
  -h, --help                    Display help for command
```

### Usage Modes

| Mode | Command | Description |
|------|---------|-------------|
| Interactive | `cdoing` | Launches a persistent chat session |
| One-shot | `cdoing "list all files"` | Runs a single prompt and exits |
| Resume | `cdoing -r <id> "follow up"` | Continue a previous conversation |
| Print | `cdoing --print "explain"` | Non-interactive, clean output |
| JSON | `cdoing --output-format json "query"` | Structured JSON output |

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

## Tools (12 Built-In)

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
| `code_verify` | Syntax and type checking for the current project. | No |

### Web Access

| Tool | Description | Permission |
|------|-------------|:---:|
| `web_fetch` | Fetch and extract content from URLs. Strips HTML, supports JSON. | Yes |
| `web_search` | Search the web via DuckDuckGo (no API key required). | Yes |

### Agent Control

| Tool | Description | Permission |
|------|-------------|:---:|
| `sub_agent` | Spawn an independent sub-agent for parallel research tasks. | No |
| `todo` | Track tasks with status (pending, in_progress, completed, blocked). | No |

### Parallel Execution

<!-- Learning note: Parallel execution is a key performance feature.
     Read-only tools run concurrently via Promise.all, while write
     tools run sequentially to avoid conflicts. -->

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

### AI Control

| Command | Description |
|---------|-------------|
| `/plan [request]` | Plan before executing (read-only analysis) |
| `/effort <level>` | Set effort level: low, medium, high, max |
| `/btw <question>` | Ask without adding to conversation history |

### Configuration

| Command | Description |
|---------|-------------|
| `/config` | Show current config |
| `/model <name>` | Switch model |
| `/provider <name>` | Switch AI provider |
| `/mode <mode>` | Change permission mode |
| `/dir <path>` | Change working directory (CLI only) |
| `/rules` | View/reload project rules |
| `/mcp` | MCP server status and management |
| `/context` | List available @ context providers |

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

<!-- Learning note: The architecture follows a layered design.
     Each package has a single responsibility:
     - core: tools, permissions, rules (no AI dependency)
     - ai: agent loop, providers, context management
     - cli: terminal UI
     - vscode-extension: VS Code UI -->

```
User Message
     │
     ▼
┌──────────────────────────────────┐
│  Agent Runner (agentic loop)      │
│                                   │
│  Context Providers → Enrich msg   │
│  Rules + Effort → System prompt   │
│                                   │
│  stream() ──► Tool Calls          │
│    ▲          │                   │
│    │    ┌─────┴──────┐            │
│    │    │ Parallel:   │           │
│    │    │  file_read  │           │
│    │    │  grep_search│           │
│    │    │  sub_agent  │           │
│    │    ├────────────┤            │
│    │    │ Sequential: │           │
│    │    │  file_edit  │           │
│    │    │  shell_exec │           │
│    │    ├────────────┤            │
│    │    │ MCP Tools:  │           │
│    │    │  jira_*     │           │
│    │    │  postgres_* │           │
│    │    └─────┬──────┘            │
│    │          │                   │
│    └──── Results ◄────────────────┘
│                                   │
│  + Retry with backoff             │
│  + Context compression            │
│  + Token tracking                 │
│  + Pre/post hooks                 │
│  + Plan mode (read-only)          │
└──────────────────────────────────┘
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

### Project Rules

Create `.cdoing/rules/*.md` for glob-scoped coding standards:

```markdown
---
globs: ["src/api/**"]
description: API endpoint conventions
---

- All endpoints must validate input with Zod
- Return proper HTTP status codes
- Log errors with structured logging
```

### MCP Servers

Configure in `.cdoing/mcp.json` or `~/.cdoing/mcp.json`:

```json
{
  "servers": [
    { "name": "github", "command": "npx", "args": ["-y", "@modelcontextprotocol/server-github"] }
  ]
}
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
| `~/.cdoing/rules/*.md` | Global | Global coding rules |
| `~/.cdoing/mcp.json` | Global | Global MCP server configs |
| `~/.cdoing/conversations/` | Global | Saved conversations |
| `.cdoing/config.md` or `CDOING.md` | Project | Project-specific instructions |
| `.cdoing/permissions.json` | Project | Per-project permissions |
| `.cdoing/hooks.json` | Project | Per-project hooks |
| `.cdoing/rules/*.md` | Project | Per-project coding rules |
| `.cdoing/mcp.json` | Project | Per-project MCP servers |

---

## Project Structure

<!-- Learning note: The monorepo is organized by responsibility.
     @cdoing/core has zero AI dependencies — it's pure tools and utilities.
     @cdoing/ai handles LLM communication via LangChain.
     The CLI and extension are thin UI layers on top. -->

```
cdoing-agent/
├── package.json                 # Monorepo root (Yarn workspaces + Turborepo)
├── turbo.json                   # Build pipeline
├── ROADMAP.md                   # Feature roadmap and comparison matrix
├── assets/                      # Screenshots and images
├── packages/
│   ├── core/                    # @cdoing/core — tools, permissions, hooks, context
│   │   └── src/
│   │       ├── tools/           # 12 built-in tools
│   │       ├── permissions/     # Permission manager with stored rules
│   │       ├── hooks/           # Pre/post tool execution hooks
│   │       ├── context-providers/ # @terminal, @open, @url, @tree, @problems, @codebase
│   │       ├── rules/           # Glob-scoped project rules system
│   │       ├── plan/            # Plan mode manager
│   │       ├── mcp/             # MCP server manager
│   │       ├── effort/          # Effort level control
│   │       ├── agents/          # Multi-agent coordinator
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
│   │       ├── chat.ts          # Interactive chat with context providers
│   │       ├── callbacks.ts     # Streaming output formatting
│   │       ├── history.ts       # Conversation save/resume
│   │       └── config.ts        # Config & API key resolution
│   └── vscode-extension/        # cdoing-vscode — VS Code extension
│       ├── src/
│       │   ├── extension.ts     # Extension entry — all commands & features
│       │   ├── chat-panel-provider.ts # Multi-tab agent bridge
│       │   ├── inline-edit.ts   # Cmd+I inline edit mode
│       │   ├── inline-autocomplete.ts # Tab completion ghost text
│       │   ├── webview-content.ts     # HTML shell with CSP
│       │   └── webview/               # React app
│       │       ├── components/        # ChatPanel, TabBar, InputArea, etc.
│       │       ├── hooks/             # useChatState, useAutoScroll, useVsCode
│       │       ├── utils/             # markdown renderer
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
| MCP | Model Context Protocol (JSON-RPC over stdio) |

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
| `Cmd+I` / `Ctrl+I` | Inline edit — AI-powered code changes in place |
| `Cmd+Shift+Enter` | Send selection to chat |
| `Tab` | Accept autocomplete suggestion |
| `Esc` | Dismiss autocomplete suggestion |

---

## License

MIT
