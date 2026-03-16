# @cdoing/cli

Terminal-based AI coding assistant from [Cdoing Agent](https://github.com/awaisshah228/cdoing-agent) — an open-source, multi-provider alternative to Claude Code.

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
```

On first run with no API key configured, an interactive setup wizard guides you through provider, model, and authentication setup. Run `/setup` at any time to reconfigure.

## Features

- **Multi-provider** — Anthropic, OpenAI, Google, Ollama, custom OpenAI-compatible
- **20 built-in tools** — file read/write/edit, shell exec, search, web fetch, sub-agents, and more
- **Real-time streaming** — token-by-token output with tool call progress
- **Context providers** — `@terminal`, `@tree`, `@url`, `@codebase`, `@git`, `@diff`, `@clipboard`, `@file`
- **Permission system** — 5 modes from full prompting to auto-approve, with deny/allow/ask rules
- **Sandbox** — filesystem and network restrictions for safe execution
- **Slash commands** — `/setup`, `/compact`, `/clear`, `/plan`, `/help`, and more
- **Conversation history** — persistent across sessions
- **Plan mode** — read-only exploration without modifications
- **Effort control** — adjust response depth

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
| `--provider <name>` | LLM provider (anthropic, openai, google, ollama, custom) |
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
| Google | Gemini 2.0 Flash, 1.5 Pro, 1.5 Flash | API key |
| Ollama | LLaMA, Mistral, CodeLlama | Not required |
| Custom | Any OpenAI-compatible API | Configurable |

## Architecture

Built with:

- **Ink + React** — terminal UI with real-time rendering
- **Commander.js** — CLI argument parsing
- **@cdoing/core** — tools, permissions, sandbox, hooks, context providers
- **@cdoing/ai** — agent runner, LLM providers, context/token management

## License

MIT
