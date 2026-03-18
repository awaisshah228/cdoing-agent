# @cdoing/opentuicli

[![npm version](https://img.shields.io/npm/v/@cdoing/opentuicli.svg)](https://www.npmjs.com/package/@cdoing/opentuicli)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](https://github.com/awaisshah228/cdoing-agent/blob/main/LICENSE)

Lightweight terminal interface for [Cdoing Agent](https://github.com/awaisshah228/cdoing-agent) — built on the OpenTUI framework. An open-source, multi-provider AI coding assistant.

## Installation

```bash
# Install globally (no Bun required — standalone binary with embedded runtime)
npm install -g @cdoing/opentuicli

# Or with other package managers
yarn global add @cdoing/opentuicli
pnpm add -g @cdoing/opentuicli
bun install -g @cdoing/opentuicli
```

## Quick Start

```bash
# Launch the TUI
cdoing-tui

# With a direct prompt
cdoing-tui "refactor this function to use async/await"

# With specific provider
cdoing-tui --provider openrouter --model anthropic/claude-sonnet-4
```

## How It Works

The published package includes a **standalone compiled binary** with the Bun runtime embedded — no Bun, Node.js, or any runtime needed to run it. This is the same approach used by [opencode](https://github.com/opencode-ai/opencode).

For development, you need [Bun](https://bun.sh) to build from source:

```bash
# Build for current platform
bun run build

# Build for all platforms (linux, macOS, windows × arm64/x64)
bun run build:all
```

## Why OpenTUI?

This is the **lightweight alternative** to `@cdoing/cli`. While the main CLI uses Ink + React for a rich terminal UI, this package uses the OpenTUI framework for a minimal, fast, keyboard-driven experience.

| | `@cdoing/cli` | `@cdoing/opentuicli` |
|---|---|---|
| **Runtime** | Node.js | **Standalone binary** |
| **UI Framework** | Ink + React | OpenTUI + React |
| **Startup time** | ~1s | ~0.5s |
| **Features** | Full (tabs, history) | Essential |
| **Best for** | Daily use | Quick tasks, low-resource |

Both share the same **@cdoing/core** (20 tools, permissions, sandbox) and **@cdoing/ai** (multi-provider agent runner).

## Features

- **Multi-provider** — Anthropic, OpenAI, Google, Ollama, OpenRouter, Groq, Mistral, xAI, and any OpenAI-compatible API
- **20 built-in tools** — file read/write/edit, shell exec, search, web fetch, sub-agents
- **Real-time streaming** — token-by-token output
- **Context providers** — `@terminal`, `@tree`, `@url`, `@codebase`, `@git`, `@diff`
- **Permission system** — 5 modes with deny/allow/ask rules
- **Sandbox** — filesystem and network restrictions
- **Background processes** — run servers/watchers with status tracking
- **Smart output** — auto-truncates verbose output to save tokens
- **OAuth** — sign in with Claude Pro/Max account
- **Keyboard-driven** — fast, minimal interface

## Authentication

```bash
# Environment variable
export ANTHROPIC_API_KEY=sk-ant-...
export OPENROUTER_API_KEY=sk-or-...

# Or use the setup wizard
cdoing-tui    # Triggers setup on first run
```

## Supported Providers

| Provider | Default Model | Auth |
|----------|--------------|------|
| Anthropic | claude-sonnet-4-6 | API key / OAuth |
| OpenAI | gpt-4o | API key |
| Google | gemini-2.0-flash | API key |
| OpenRouter | anthropic/claude-sonnet-4 | API key |
| Ollama | llama3.1 | Not required |
| Groq | llama-3.3-70b-versatile | API key |
| Mistral | mistral-large-latest | API key |
| xAI | grok-3 | API key |
| Custom | — | Configurable |

## Related Packages

- **[@cdoing/cli](https://www.npmjs.com/package/@cdoing/cli)** — Full-featured Ink + React CLI
- **[VS Code Extension](https://marketplace.visualstudio.com/items?itemName=awaisshah228.cdoing-vscode)** — AI sidebar for VS Code
- **[@cdoing/core](https://www.npmjs.com/package/@cdoing/core)** — Core tools, permissions, sandbox
- **[@cdoing/ai](https://www.npmjs.com/package/@cdoing/ai)** — Agent runner, LLM providers
- **[GitHub](https://github.com/awaisshah228/cdoing-agent)** — Full monorepo

## License

Apache-2.0
