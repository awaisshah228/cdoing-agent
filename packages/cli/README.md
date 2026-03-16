# @cdoing/cli

[![npm version](https://img.shields.io/npm/v/@cdoing/cli.svg)](https://www.npmjs.com/package/@cdoing/cli)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](https://github.com/awaisshah228/cdoing-agent/blob/main/LICENSE)

Terminal-based AI coding assistant from [Cdoing Agent](https://github.com/awaisshah228/cdoing-agent) — an open-source, multi-provider alternative to Claude Code, Cursor, and GitHub Copilot.

![CLI Screenshot](https://raw.githubusercontent.com/awaisshah228/cdoing-agent/main/assets/cli-screenshot.png)

## Installation

```bash
npm install -g @cdoing/cli
# or
yarn global add @cdoing/cli
```

## Quick Start

```bash
# Run the CLI — launches setup wizard on first run
cdoing

# Or with a direct prompt
cdoing "explain this codebase"

# With specific provider and model
cdoing --provider openai --model gpt-4o
cdoing --provider openrouter --model anthropic/claude-sonnet-4
cdoing --provider ollama --model llama3.1
```

On first run with no API key configured, an interactive setup wizard guides you through provider, model, and authentication setup. Run `/setup` at any time to reconfigure.

## Features

- **Multi-provider** — Anthropic, OpenAI, Google, Ollama, OpenRouter, Groq, Mistral, xAI, DeepInfra, Together, and any OpenAI-compatible API
- **20 built-in tools** — file read/write/edit, shell exec (with real-time streaming), search, web fetch, sub-agents, and more
- **Real-time streaming** — token-by-token output with live tool call progress
- **Context providers** — `@terminal`, `@tree`, `@url`, `@codebase`, `@git`, `@diff`, `@clipboard`, `@file`
- **Permission system** — 5 modes from full prompting to auto-approve, with deny/allow/ask rules
- **Sandbox** — filesystem and network restrictions for safe execution
- **Background processes** — run servers, watchers, dev tools in background with status tracking
- **Smart output** — auto-truncates verbose output (npm install, builds) to save tokens
- **Slash commands** — `/setup`, `/compact`, `/clear`, `/plan`, `/help`, and more
- **Conversation history** — persistent across sessions
- **Plan mode** — read-only exploration without modifications
- **OAuth** — sign in with your Claude Pro/Max account (free tier)
- **MCP support** — connect to Model Context Protocol servers

## Authentication

### Interactive Setup

```bash
cdoing        # First run triggers setup wizard
# or
/setup        # Run inside the CLI at any time
```

### API Key

```bash
# Environment variable
export ANTHROPIC_API_KEY=sk-ant-...
export OPENAI_API_KEY=sk-...
export OPENROUTER_API_KEY=sk-or-...
export GOOGLE_API_KEY=...

# Or save permanently
cdoing config set api-key sk-ant-...
```

### OAuth (Claude Pro/Max)

```bash
cdoing --login     # Opens browser for OAuth flow
cdoing --logout    # Clear stored tokens
```

## CLI Flags

| Flag | Description |
|------|-------------|
| `--provider <name>` | LLM provider (anthropic, openai, google, ollama, openrouter, groq, etc.) |
| `--model <name>` | Model to use |
| `--api-key <key>` | API key (overrides stored/env) |
| `--permission-mode <mode>` | Permission mode (default, acceptEdits, plan, dontAsk, bypassPermissions) |
| `--login` | Start OAuth login flow |
| `--logout` | Clear OAuth tokens |
| `--verbose` | Show debug output |

## Supported Providers

| Provider | Models | Auth |
|----------|--------|------|
| Anthropic (default) | Claude Sonnet 4.6, Opus 4.6, Haiku 4.5 | API key or OAuth |
| OpenAI | GPT-4o, GPT-4o mini, o3-mini | API key |
| Google | Gemini 2.0 Flash, 1.5 Pro | API key |
| OpenRouter | Any model (Claude, GPT, Llama, Qwen, etc.) | API key |
| Ollama | LLaMA, Mistral, CodeLlama, Qwen | Not required |
| Groq | LLaMA 3.3 70B, Mixtral | API key |
| Mistral | Mistral Large, Codestral | API key |
| xAI | Grok 3 | API key |
| GitHub Copilot | GPT-4o, Claude | GitHub token |
| Custom | Any OpenAI-compatible API | Configurable |

## Related Packages

- **[@cdoing/opentuicli](https://www.npmjs.com/package/@cdoing/opentuicli)** — Lightweight OpenTUI-based terminal interface
- **[VS Code Extension](https://marketplace.visualstudio.com/items?itemName=awaisshah228.cdoing-vscode)** — AI sidebar for VS Code
- **[@cdoing/core](https://www.npmjs.com/package/@cdoing/core)** — Core tools, permissions, sandbox
- **[@cdoing/ai](https://www.npmjs.com/package/@cdoing/ai)** — Agent runner, LLM providers
- **[GitHub](https://github.com/awaisshah228/cdoing-agent)** — Full monorepo

## Architecture

Built with:

- **Ink + React** — terminal UI with real-time rendering
- **Commander.js** — CLI argument parsing
- **@cdoing/core** — tools, permissions, sandbox, hooks, context providers
- **@cdoing/ai** — agent runner, LLM providers, context/token management

## License

Apache-2.0
