# @cdoing/core

Core foundation layer for [Cdoing Agent](https://github.com/awaisshah228/cdoing-agent) — an open-source, multi-provider AI coding assistant.

## Installation

```bash
npm install @cdoing/core
# or
yarn add @cdoing/core
```

## What's Included

### Tools (20 Built-In)

A complete tool system for AI coding agents:

- **File Operations** — `file_read`, `file_write`, `file_edit`, `multi_edit`, `file_delete`
- **Search & Discovery** — `glob_search`, `grep_search`, `list_dir`, `view_diff`, `view_repo_map`, `codebase_search`
- **Code Execution** — `shell_exec` (with background mode), `file_run`, `code_verify`
- **Web Access** — `web_fetch`, `web_search`
- **Agent Control** — `sub_agent`, `todo`, `system_info`
- **AST Editing** — `ast_edit` for structured code transformations

Each tool exports `{ name, description, parameters, execute }` with raw JSON Schema definitions.

### Permission System

5 permission modes with settings-based rules:

| Mode | Behavior |
|------|----------|
| `default` | Prompts before every tool that requires permission |
| `acceptEdits` | Auto-approves file writes/edits, prompts for shell |
| `plan` | Read-only — all write/exec/delete tools blocked |
| `dontAsk` | Deny all unless explicitly allowed in settings |
| `bypassPermissions` | Auto-approve everything |

Rules use pattern syntax: `Bash(cmd)`, `Read(path)`, `Edit(path)`, `Delete(path)`, `WebFetch(domain:x)`.

Evaluation order: **Deny > Ask > Allow** (deny always wins).

### Sandbox

Filesystem and network sandboxing:

- **Filesystem** — `allowWrite` / `denyWrite` / `denyRead` path rules
- **Network** — domain allowlisting with `allowedDomains`
- **Shell** — destructive command detection and path extraction

### Context Providers (10)

Pluggable `@mention` providers via `ContextProviderRegistry`:

`@terminal`, `@tree`, `@url`, `@codebase`, `@open`, `@problems`, `@clipboard`, `@file`, `@git`, `@diff`

### Codebase Indexing

SQLite FTS5 full-text search with BM25 ranking:

- Code-aware chunking (function/class boundaries for 7+ languages)
- Incremental updates
- Recent edits cache

### Additional Systems

- **Hooks** — Pre/post tool execution hooks via `.cdoing/hooks.json`
- **Rules** — Glob-scoped project rules from `.cdoing/rules/*.md` (YAML frontmatter)
- **MCP** — Model Context Protocol server support (JSON-RPC 2.0 over stdio)
- **OAuth** — PKCE flow with platform-specific secure storage

## Usage

```typescript
import {
  ToolRegistry,
  PermissionManager,
  SandboxManager,
  ContextProviderRegistry,
  HookManager,
} from '@cdoing/core';

// Get all available tools
const tools = ToolRegistry.getAllTools();

// Check permissions
const permissionManager = new PermissionManager({ mode: 'default' });
const allowed = await permissionManager.check('file_write', { path: 'src/index.ts' });

// Execute a tool
const result = await tools.file_read.execute({ path: 'src/index.ts' });
```

## Key Patterns

- Tool definitions use **raw JSON Schema** (no Zod)
- **Parallel** tools: file reads, searches, web fetch, sub_agent
- **Sequential** tools: shell_exec, file_run (due to side effects)
- **Multi-strategy edit matching**: exact > trimmed > case-insensitive > whitespace-ignored
- Config layers: `~/.claude/settings.json` (global) > `.claude/settings.json` (project) > `.claude/settings.local.json` (local)

## License

MIT
