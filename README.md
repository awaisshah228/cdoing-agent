# Cdoing Agent

AI-powered coding assistant CLI — your pair programmer in the terminal.

Built as a Turborepo monorepo with LangChain for multi-model support.

---

## Prerequisites

- **Node.js** >= 18
- **npm** >= 10
- An API key for at least one provider:
  - Anthropic: `ANTHROPIC_API_KEY`
  - OpenAI: `OPENAI_API_KEY`
  - Google: `GOOGLE_API_KEY`

---

## Quick Start

```bash
# 1. Clone and install
git clone <repo-url>
cd cdoing-agent
npm install

# 2. Build all packages
npx turbo run build

# 3. Set your API key
export ANTHROPIC_API_KEY=sk-ant-...

# 4. Run the CLI
node packages/cli/dist/index.js
```

On first run, if no API key is found the CLI will interactively prompt you to enter one and optionally save it to `~/.cdoing/config.json`.

---

## CLI Usage

```
Usage: cdoing [options] [prompt]

AI-powered coding assistant CLI

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

## Tools (Agent Capabilities)

The agent has access to **11 tools** that it can invoke to assist you:

### File Operations

| Tool | Description | Permission |
|------|-------------|------------|
| `file_read` | Read file contents (text, images, PDFs). Supports offset and line limits. | No |
| `file_write` | Create or overwrite files. Auto-creates parent directories. | Yes |
| `file_edit` | Find-and-replace editing with unified diff output. | Yes |

### Search & Discovery

| Tool | Description | Permission |
|------|-------------|------------|
| `glob_search` | Find files by glob pattern (e.g., `**/*.ts`). Respects `.gitignore`. | No |
| `grep_search` | Search file contents with regex. Case-insensitive and file-filter options. | No |

### Code Execution

| Tool | Description | Permission |
|------|-------------|------------|
| `shell_exec` | Run any shell command. Blocks dangerous patterns (`rm -rf`, `mkfs`, etc.). Timeout: 120s. | Yes |
| `file_run` | Run scripts by file extension (.js, .ts, .py, .rb, .sh, .go, .swift, .lua, .php, .pl). Timeout: 30s. | Yes |
| `code_verify` | Syntax/type-check files without running them (node --check, tsc --noEmit, py_compile, ruby -c, bash -n, go vet, php -l, perl -c, swiftc -typecheck, JSON.parse). | No |

### Web Access

| Tool | Description | Permission |
|------|-------------|------------|
| `web_fetch` | Fetch and extract content from URLs. Strips HTML, supports JSON APIs. | Yes |
| `web_search` | Search the web via DuckDuckGo (no API key required). | Yes |

### Agent Control

| Tool | Description | Permission |
|------|-------------|------------|
| `sub_agent` | Spawn an independent sub-agent for parallel research tasks. Cannot recurse. | No |

---

## Permission Modes

| Mode | Behavior |
|------|----------|
| `ask` (default) | Prompts before every tool that requires permission |
| `auto-edit` | Auto-approves file writes/edits, prompts for shell commands |
| `auto` | Auto-approves all tool calls |

When prompted for permission you can respond with:

| Key | Action |
|-----|--------|
| `y` / Enter | Allow this once |
| `a` | Always allow globally (saved to `~/.cdoing/permissions.json`) |
| `p` | Allow for this project only (saved to `.cdoing/permissions.json`) |
| `n` | Deny |

---

## Slash Commands

Available inside interactive mode:

### Chat Management

| Command | Description |
|---------|-------------|
| `/new` | Start a new conversation (clears history) |
| `/history` | List saved conversations (latest 20) |
| `/resume <id>` | Resume a previously saved conversation |
| `/delete <id>` | Delete a saved conversation |
| `/clear` | Clear the current conversation history |

### Configuration

| Command | Description |
|---------|-------------|
| `/config` | Show current config (provider, model, mode, directory, etc.) |
| `/model <name>` | Switch model (e.g., `/model gpt-4o`) |
| `/provider <name>` | Switch AI provider |
| `/mode <mode>` | Change permission mode |
| `/dir <path>` | Change working directory |

### Permissions

| Command | Description |
|---------|-------------|
| `/permissions` | View all stored permission rules |
| `/permissions clear` | Remove all stored permissions |
| `/permissions clear-global` | Remove global permissions only |
| `/permissions clear-project` | Remove project permissions only |
| `/permissions <tool>` | Remove permissions for a specific tool |

### Memory

| Command | Description |
|---------|-------------|
| `/memory` | View all persistent memories |
| `/memory clear` | Clear all memories |
| `/memory forget <key>` | Forget a specific memory entry |

### Info & System

| Command | Description |
|---------|-------------|
| `/hooks` | View configured hooks for the project |
| `/usage` | Show token usage and estimated cost |
| `/help` or `?` | Show help menu |
| `/exit` or `/quit` | Exit the CLI |

### Direct Shell Access

| Syntax | Description |
|--------|-------------|
| `!<command>` | Execute a shell command directly (e.g., `!git status`, `!npm test`) |

---

## Hooks

Hooks let you run custom shell commands before or after tool execution.

**Event patterns:**
- `pre:<tool_name>` — Before a specific tool runs
- `post:<tool_name>` — After a specific tool runs
- `pre:*` / `post:*` — Before/after any tool

**Features:**
- `{{variable}}` placeholders (tool_name, file_path, command, pattern, etc.)
- Configurable timeout (default: 10s)
- Define globally (`~/.cdoing/hooks.json`) or per-project (`.cdoing/hooks.json`)

---

## Memory System

Persistent key-value storage that persists across sessions:

- **Categories:** user, project, preference, context
- **Storage:** `~/.cdoing/memory.json`
- The agent can save, recall, and forget memories
- Memories are automatically included in the system prompt

---

## Conversation History

Conversations are auto-saved to `~/.cdoing/conversations/` as JSON files. Each includes:
- Unique ID, title, timestamps
- Provider and model used
- Full message log (user, assistant, tool calls)

Use `/history`, `/resume <id>`, and `/delete <id>` to manage them.

---

## Configuration Files

| File | Scope | Purpose |
|------|-------|---------|
| `~/.cdoing/config.json` | Global | Default provider, model, API keys |
| `~/.cdoing/permissions.json` | Global | Globally allowed tool permissions |
| `~/.cdoing/hooks.json` | Global | Global hooks |
| `~/.cdoing/memory.json` | Global | Persistent memories |
| `~/.cdoing/conversations/` | Global | Saved conversations |
| `.cdoing/config.json` | Project | Per-project settings |
| `.cdoing/permissions.json` | Project | Per-project permissions |
| `.cdoing/hooks.json` | Project | Per-project hooks |
| `cdoing.config.json` | Project | Alternative project config location |

---

## Project Structure

```
cdoing-agent/
├── turbo.json                    # Turborepo pipeline config
├── package.json                  # Root workspace
├── packages/
│   ├── core/                     # @cdoing/core
│   │   └── src/
│   │       ├── tools/            # 11 tools (file, search, exec, web, agent)
│   │       ├── permissions/      # 3 modes: ask, auto-edit, auto
│   │       ├── hooks/            # Pre/post tool execution hooks
│   │       └── memory/           # Persistent key-value memory
│   ├── ai/                       # @cdoing/ai
│   │   └── src/
│   │       ├── provider.ts       # Multi-model: Anthropic, OpenAI, Google, Custom
│   │       └── agent-runner.ts   # Agentic loop with streaming
│   ├── cli/                      # @cdoing/cli
│   │   └── src/
│   │       ├── index.ts          # CLI entry point (commander)
│   │       ├── chat.ts           # Interactive terminal UI
│   │       ├── tools.ts          # Tool registry setup
│   │       ├── config.ts         # Configuration & API key resolution
│   │       ├── callbacks.ts      # Output formatting
│   │       ├── history.ts        # Conversation management
│   │       └── help.ts           # Help text
│   └── vscode-extension/         # VS Code extension (chat panel)
```

---

## Development

```bash
# Install dependencies
npm install

# Build all packages
npx turbo run build

# Dev mode (watch + run)
npm run dev --workspace=packages/cli

# Clean build artifacts
npm run clean --workspace=packages/cli
```

---

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `?` | Show help |
| `Ctrl+C` (once) | Prompt to exit |
| `Ctrl+C` (twice) | Force exit |
| `Ctrl+C` during execution | Cancel current operation |

---

## License

MIT
