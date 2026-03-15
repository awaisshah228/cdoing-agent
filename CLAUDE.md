# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Cdoing Agent is an open-source, multi-provider AI coding assistant (similar to Claude Code). It's a TypeScript monorepo with 4 packages providing a CLI, VS Code extension, agent runner, and core tool system.

## Build & Run Commands

```bash
yarn install          # Install all dependencies
yarn build            # Build all packages via Turbo
yarn dev              # Watch mode for all packages
yarn start            # Build core → ai → cli, then run CLI
```

Individual package builds:
```bash
cd packages/<package> && yarn build   # Build single package
cd packages/<package> && yarn dev     # Watch mode for single package
```

VS Code extension: open `packages/vscode-extension` in VS Code, press F5 for Extension Development Host.

There is no test suite configured in the main packages. TypeScript compiler (`tsc`) is the primary validation tool — run `yarn build` to type-check.

## Monorepo Architecture

**Build orchestration:** Turbo (`turbo.json`) with Yarn workspaces.

### Packages & Dependencies

```
@cdoing/core  ← no internal deps (tools, permissions, sandbox, hooks, context providers)
@cdoing/ai    ← depends on @cdoing/core (agent runner, LLM providers, context/token mgmt)
@cdoing/cli   ← depends on @cdoing/ai + @cdoing/core (Ink React TUI, Commander.js CLI)
vscode-extension ← depends on @cdoing/ai + @cdoing/core (React webview, esbuild bundled)
```

### Core Package (`packages/core/`)

The foundation layer. Key subsystems:

- **`src/tools/`** — 20 tool implementations (file_read, file_write, file_edit, shell_exec, glob_search, grep_search, web_fetch, sub_agent, etc.). Each tool exports a definition with name, description, schema, and execute function. Central registry in `registry.ts`.
- **`src/permissions/`** — 5 permission modes (default, acceptEdits, plan, dontAsk, bypassPermissions). Settings-based rules from `.claude/settings.json` with deny → allow → ask precedence.
- **`src/sandbox/`** — Filesystem (allowWrite/denyWrite/denyRead) and network (allowedDomains) sandboxing. Destructive command detection.
- **`src/context-providers/`** — 10 `@mention` providers (terminal, url, tree, codebase, git, diff, clipboard, etc.). Pluggable via ContextProviderRegistry.
- **`src/hooks/`** — Pre/post tool execution hooks configured in `.cdoing/hooks.json`.
- **`src/rules/`** — Glob-scoped project rules from `.cdoing/rules/*.md` (YAML frontmatter with globs).
- **`src/indexing/`** — SQLite FTS5 codebase indexing with better-sqlite3.
- **`src/mcp/`** — Model Context Protocol server support (JSON-RPC 2.0 over stdio).

### AI Package (`packages/ai/`)

- **`agent-runner.ts`** — Main agentic loop: stream LLM → extract tool calls → check permissions → execute → feed results back. Supports parallel tool execution, retry with backoff, context compression.
- **`provider.ts`** — Multi-provider LLM factory using LangChain (Anthropic, OpenAI, Google, Ollama, custom).
- **`context-manager.ts`** — Token counting (tiktoken for OpenAI, ~3.5 chars/token for Claude) and FIFO context compression at 75% capacity.
- **`system-prompt.ts`** — Layered prompt builder: core instructions → environment → project config → rules → effort level.

### CLI Package (`packages/cli/`)

- **`src/index.ts`** — Commander.js entry point with all CLI flags.
- **`src/chat.ts`** — Ink-based React TUI entry. Components in `src/ui/` (App, MessageList, InputArea, StatusBar).
- **`src/ui/hooks/`** — `useChat()` manages agent state + slash commands; `useAgent()` coordinates AgentRunner.
- **`src/config.ts`** — Config loader, permission mode parser, interactive setup wizard.

### VS Code Extension (`packages/vscode-extension/`)

- **`src/extension.ts`** — Lifecycle, registers commands and webview providers.
- **`src/chat-panel-provider.ts`** — Sidebar webview provider.
- **`src/inline-edit.ts`** — Cmd+I inline editing.
- **`src/webview/`** — React webview with ChatPanel, MessageList, InputArea. Multi-tab via `useChatState` hook.
- Bundled with esbuild (`esbuild.config.js`).

## Key Patterns

- **Tool definitions** use raw JSON Schema (no Zod). Each tool in `packages/core/src/tools/` exports `{ name, description, parameters, execute }`.
- **Parallel vs sequential tools**: file reads/searches run in parallel; shell_exec/file_run run sequentially due to side effects.
- **Configuration layers**: `~/.claude/settings.json` (global) → `.claude/settings.json` (project) → `.claude/settings.local.json` (local override, not in git).
- **Permission rules** use pattern syntax: `Bash(cmd)`, `Read(path)`, `Edit(path)`, `Delete(path)`, `WebFetch(domain:x)`.
- **Streaming**: token-by-token callbacks (`onToken`, `onToolCall`, `onToolResult`, `onComplete`, `onError`, `onUsage`).
- **Multi-strategy edit matching** in `src/utils/search-match.ts`: exact → trimmed → case-insensitive → whitespace-ignored.

## Key Dependencies

- **LangChain** (`@langchain/core`, `@langchain/anthropic`, `@langchain/openai`, `@langchain/google-genai`) — LLM abstraction
- **better-sqlite3** — SQLite for FTS5 indexing
- **Ink + React** — Terminal UI
- **Commander.js** — CLI argument parsing
- **esbuild** — VS Code extension bundling
