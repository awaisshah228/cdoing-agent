# Cdoing Agent

> Built by [@awaisshah228](https://github.com/awaisshah228)

Open-source, multi-provider AI coding assistant — **CLI + TUI + VS Code Extension**. Think Claude Code, but open source and multi-provider.

[![npm @cdoing/core](https://img.shields.io/npm/v/@cdoing/core?label=%40cdoing%2Fcore)](https://www.npmjs.com/package/@cdoing/core)
[![npm @cdoing/cli](https://img.shields.io/npm/v/@cdoing/cli?label=%40cdoing%2Fcli)](https://www.npmjs.com/package/@cdoing/cli)
[![npm @cdoing/opentuicli](https://img.shields.io/npm/v/@cdoing/opentuicli?label=%40cdoing%2Fopentuicli)](https://www.npmjs.com/package/@cdoing/opentuicli)
[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/awaisshah228.cdoing-vscode?label=VS%20Code%20Marketplace)](https://marketplace.visualstudio.com/items?itemName=awaisshah228.cdoing-vscode)
[![CI](https://github.com/awaisshah228/cdoing-agent/actions/workflows/ci.yml/badge.svg)](https://github.com/awaisshah228/cdoing-agent/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

### VS Code Extension

![Cdoing Agent — VS Code Extension](assets/image.png)

### Terminal UI (TUI)

![Cdoing Agent — TUI](assets/tui.png)

### CLI

![Cdoing Agent — CLI](assets/cli.png)

---

## Features

- **Multi-provider** — Anthropic, OpenAI, Google, Ollama, any OpenAI-compatible API
- **20 built-in tools** — file read/write/edit, shell exec, search, web fetch, sub-agents, and more
- **10 context providers** — `@terminal`, `@tree`, `@url`, `@codebase`, `@git`, `@diff`, `@clipboard`, `@file`, `@open`, `@problems`
- **Permission system** — 5 modes (default, acceptEdits, plan, dontAsk, bypassPermissions) with deny/allow/ask rules
- **Sandbox** — filesystem and network restrictions for safe execution
- **Real-time streaming** — token-by-token output with tool call progress
- **Codebase indexing** — SQLite FTS5 with BM25 ranking and code-aware chunking
- **MCP support** — Model Context Protocol server integration
- **OAuth** — PKCE flow with secure OS credential storage
- **Hooks** — pre/post tool execution hooks
- **Rules** — glob-scoped project rules from `.cdoing/rules/*.md`

---

## Install

### VS Code Extension

[Install from Marketplace](https://marketplace.visualstudio.com/items?itemName=awaisshah228.cdoing-vscode) or search **"Cdoing"** in the VS Code Extensions tab.

### CLI (Ink React TUI)

```bash
npm install -g @cdoing/cli
cdoing
```

### TUI (OpenTUI-powered terminal UI)

```bash
npm install -g @cdoing/opentuicli
cdoing-tui
```

### From source

```bash
git clone https://github.com/awaisshah228/cdoing-agent.git
cd cdoing-agent
yarn install && yarn build

# Run CLI
yarn start

# Run TUI
cd packages/opentuicli && node dist/index.js

# Run VS Code extension — open packages/vscode-extension in VS Code, press F5
```

On first run, the CLI launches an interactive setup wizard. Run `/setup` at any time to reconfigure.

---

## Packages

| Package | npm | Description |
|---------|-----|-------------|
| [`@cdoing/core`](packages/core/) | [![npm](https://img.shields.io/npm/v/@cdoing/core)](https://www.npmjs.com/package/@cdoing/core) | Tools, permissions, sandbox, hooks, context providers, indexing |
| [`@cdoing/ai`](packages/ai/) | [![npm](https://img.shields.io/npm/v/@cdoing/ai)](https://www.npmjs.com/package/@cdoing/ai) | Agent runner, LLM providers, context/token management |
| [`@cdoing/cli`](packages/cli/) | [![npm](https://img.shields.io/npm/v/@cdoing/cli)](https://www.npmjs.com/package/@cdoing/cli) | Terminal UI (Ink + React), slash commands, setup wizard |
| [`@cdoing/opentuicli`](packages/opentuicli/) | [![npm](https://img.shields.io/npm/v/@cdoing/opentuicli)](https://www.npmjs.com/package/@cdoing/opentuicli) | OpenTUI-powered terminal chat UI |
| [`cdoing-vscode`](packages/vscode-extension/) | [![VS Code](https://img.shields.io/visual-studio-marketplace/v/awaisshah228.cdoing-vscode)](https://marketplace.visualstudio.com/items?itemName=awaisshah228.cdoing-vscode) | VS Code sidebar chat, inline edit, inline autocomplete |
| [`@cdoing/dashboard`](packages/dashboard/) | — | Next.js monitoring dashboard |
| [`@cdoing/remote-coding-agent`](packages/remote-coding-agent/) | [![npm](https://img.shields.io/npm/v/@cdoing/remote-coding-agent)](https://www.npmjs.com/package/@cdoing/remote-coding-agent) | Headless remote agent runner |

---

## CLI

```bash
cdoing                          # Interactive chat
cdoing "explain this codebase"  # One-shot mode
cdoing --provider openai        # Use a different provider
cdoing --login                  # OAuth login (Claude Pro/Max)
```

**Slash commands:** `/setup`, `/plan`, `/compact`, `/clear`, `/help`, `/history`, `/effort`, `/btw`

---

## TUI (OpenTUI)

```bash
cdoing-tui                      # Launch OpenTUI chat
cdoing-tui --provider openai    # Use a different provider
```

The TUI provides a rich terminal UI powered by [OpenTUI](https://github.com/nichochar/opentui) with mouse support, scrollable panels, and a modern terminal experience.

---

## VS Code Extension

| Action | Shortcut |
|--------|----------|
| Open chat in sidebar | Click `</>` icon in activity bar |
| Open chat as editor panel | `Cmd+Shift+L` |
| Inline edit | `Cmd+I` / `Ctrl+I` |
| Context menu actions | Right-click selected code |

Multi-tab conversations, image support, inline autocomplete (Tab completion), clickable file paths, inline diff preview.

```bash
# Development
yarn build && code packages/vscode-extension
# Press F5 → Extension Development Host
```

---

## Tools (20 Built-In)

| Category | Tools |
|----------|-------|
| **File ops** | `file_read`, `file_write`, `file_edit`, `multi_edit`, `file_delete` |
| **Search** | `glob_search`, `grep_search`, `list_dir`, `view_diff`, `view_repo_map`, `codebase_search` |
| **Execution** | `shell_exec` (+ background mode), `file_run`, `code_verify` |
| **Web** | `web_fetch`, `web_search` |
| **Agent** | `sub_agent`, `todo`, `system_info` |

---

## AI Providers

| Provider | Models | Auth |
|----------|--------|------|
| Anthropic (default) | Claude Sonnet 4.6, Opus 4.6, Haiku 4.5 | API key or OAuth |
| OpenAI | GPT-4o, GPT-4o mini, o3-mini | API key |
| Google | Gemini 2.0 Flash, 1.5 Pro, 1.5 Flash | API key |
| Ollama | LLaMA, Mistral, CodeLlama | Not required |
| Custom | Any OpenAI-compatible API | Configurable |

---

## Authentication

```bash
# API key (environment variable)
export ANTHROPIC_API_KEY=sk-ant-...

# Or save permanently
cdoing config set api-key sk-ant-...

# OAuth (Claude Pro/Max subscription)
cdoing --login
```

**Key resolution order:** CLI flag → apiKeyHelper script → env variable → stored key → OAuth token → setup wizard

See [OAuth Guide](docs/guides/OAUTH.md) for full details.

---

## Permission & Sandbox

**5 permission modes:** `default` (prompt all) → `acceptEdits` (auto-approve edits) → `plan` (read-only) → `dontAsk` (deny unless allowed) → `bypassPermissions` (auto-approve all)

```json
// .claude/settings.json
{
  "permissions": {
    "allow": ["Bash(git *)", "Edit(src/**)"],
    "deny": ["Read(~/.ssh/**)", "Delete(.env*)"]
  }
}
```

**Evaluation order:** Deny > Ask > Allow (deny always wins)

---

## Context Providers

| Trigger | Description |
|---------|-------------|
| `@terminal` | Last terminal command output |
| `@tree` | Workspace file tree |
| `@url <url>` | Fetch web page content |
| `@codebase <query>` | FTS5 indexed codebase search |
| `@open` | All open editor files (VS Code) |
| `@problems` | File diagnostics/errors (VS Code) |
| `@clipboard` | Clipboard contents |
| `@file <path>` | Include specific file |
| `@git` | Branch, status, commits, blame |
| `@diff` | Working changes, staged, or vs branch |

---

## Architecture

```
cdoing-agent/
├── packages/
│   ├── core/              # @cdoing/core — tools, permissions, sandbox, hooks, indexing
│   ├── ai/                # @cdoing/ai — agent runner, LLM providers, context manager
│   ├── cli/               # @cdoing/cli — Ink React TUI, Commander.js CLI
│   ├── opentuicli/        # @cdoing/opentuicli — OpenTUI terminal chat
│   ├── vscode-extension/  # VS Code extension (React webview, esbuild)
│   ├── dashboard/         # Next.js monitoring dashboard
│   └── remote-coding-agent/ # Headless remote agent
├── docs/                  # Next.js documentation site
│   └── guides/            # Detailed guides (OAuth, comparison, roadmap, CLI guide)
└── .github/workflows/     # CI/CD (build + npm publish)
```

**Build orchestration:** Turbo + Yarn workspaces

**Dependency chain:** `core` ← `ai` ← `cli` / `opentuicli` / `vscode-extension` / `remote-coding-agent`

---

## Development

```bash
yarn install        # Install dependencies
yarn build          # Build all packages
yarn start          # Run CLI
yarn dev            # Watch mode
```

### Publishing

```bash
# Publish all npm packages (auto-detects version bumps)
git push origin main

# Publish VS Code extension manually
gh workflow run "VS Code Extension" -f publish=true

# Or tag-based publish
git tag ext-v0.1.5
git push origin ext-v0.1.5
```

The VS Code extension auto-publishes to the Marketplace when the version in `packages/vscode-extension/package.json` changes on push to `main`/`phase-1`.

---

## Links

| Resource | URL |
|----------|-----|
| GitHub | [github.com/awaisshah228/cdoing-agent](https://github.com/awaisshah228/cdoing-agent) |
| VS Code Extension | [marketplace.visualstudio.com](https://marketplace.visualstudio.com/items?itemName=awaisshah228.cdoing-vscode) |
| @cdoing/cli (npm) | [npmjs.com/@cdoing/cli](https://www.npmjs.com/package/@cdoing/cli) |
| @cdoing/opentuicli (npm) | [npmjs.com/@cdoing/opentuicli](https://www.npmjs.com/package/@cdoing/opentuicli) |
| @cdoing/core (npm) | [npmjs.com/@cdoing/core](https://www.npmjs.com/package/@cdoing/core) |
| @cdoing/ai (npm) | [npmjs.com/@cdoing/ai](https://www.npmjs.com/package/@cdoing/ai) |
| @cdoing/remote-coding-agent (npm) | [npmjs.com/@cdoing/remote-coding-agent](https://www.npmjs.com/package/@cdoing/remote-coding-agent) |
| Documentation | [docs/](docs/) |

---

## Documentation

| Guide | Description |
|-------|-------------|
| [OAuth Guide](docs/guides/OAUTH.md) | OAuth setup, token storage, troubleshooting |
| [Feature Comparison](docs/guides/COMPARISON.md) | vs Claude Code, Continue.dev, Cursor, Windsurf |
| [Roadmap](docs/guides/ROADMAP.md) | Feature roadmap and what's planned |
| [CLI Guide](docs/guides/INTERACTIVE-CLI-GUIDE.md) | Building interactive CLI chats (patterns & code) |
| [Feature Spec](docs/guides/FEATURE-README.md) | Full feature specification and vision |
| [Docs Site](docs/) | Next.js documentation site |

---

## License

MIT
