# Cdoing Agent

> Built by [@awaisshah228](https://github.com/awaisshah228)

AI-powered coding assistant — **CLI + VS Code Extension**. Multi-provider (Anthropic, OpenAI, Google), agentic tool use, real-time streaming, permission-controlled sandboxing, and full codebase awareness.

[![npm @cdoing/core](https://img.shields.io/npm/v/@cdoing/core?label=%40cdoing%2Fcore)](https://www.npmjs.com/package/@cdoing/core)
[![npm @cdoing/cli](https://img.shields.io/npm/v/@cdoing/cli?label=%40cdoing%2Fcli)](https://www.npmjs.com/package/@cdoing/cli)

![Cdoing Agent — VS Code Extension](assets/image.png)

![Cdoing Agent — CLI](assets/cli.png)

---

## What It Does

An intelligent coding agent that reads, writes, searches, and runs commands in your codebase — controlled through natural language. Think Claude Code, but open source and multi-provider.

**CLI** — terminal-based interactive chat with streaming, slash commands, conversation history, message queuing, plan mode, effort control, context providers (@terminal, @tree, @url, @codebase, @git, @diff, @clipboard, @file), and auto-complete.

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

# 3. Run the CLI — it will guide you through setup on first run
yarn start
```

On first run with no API key configured, the CLI launches an interactive setup wizard (or run `/setup` at any time to reconfigure).

---

## Implementation Status

### What's Implemented

| Component | Status | Details |
|-----------|--------|---------|
| **Tools** | 20/20 | All tools fully implemented including background shell mode |
| **Permissions** | Complete | 5 modes, settings rules, path checking |
| **Sandbox** | Complete | Filesystem + network + shell environment sandboxing |
| **Context Providers** | 10/10 | terminal, tree, url, codebase, open, problems, clipboard, file, git, diff |
| **Hooks** | Complete | Pre/post tool execution, templating, timeouts |
| **Rules** | Complete | Glob-scoped rules from `.cdoing/rules/*.md` |
| **Indexing** | Complete | SQLite FTS5 with BM25 ranking, code-aware chunking |
| **MCP Support** | Complete | Server discovery, JSON-RPC 2.0 over stdio, tool routing |
| **OAuth** | Complete | PKCE flow, platform-specific secure storage (Keychain/libsecret/Credential Manager) |
| **Agent Runner** | Complete | Full agentic loop, streaming, parallel tool execution, retry with backoff |
| **LLM Providers** | Complete | Anthropic, OpenAI, Google, Ollama, custom OpenAI-compatible |
| **Context Manager** | Complete | Token counting, FIFO pruning at 75%, cost tracking |
| **System Prompt** | Complete | Layered builder with rules + permission awareness |
| **CLI** | Complete | Ink React TUI, streaming, history, setup wizard, slash commands |
| **VS Code Extension** | Complete | Chat panel, inline edit, inline autocomplete, React webview |
| **Docs Site** | Complete | Next.js with 11 pages, responsive, interactive architecture diagrams |

### What's Missing / In Progress

| Feature | Status | Notes |
|---------|--------|-------|
| **Tests** | Not started | TypeScript compiler (`tsc`) used for validation; no test suite |
| **Accurate token counting** | Not started | Currently uses ~4 chars/token estimate; needs tiktoken/llama tokenizer |
| **Embedding model wiring** | Partial | Interface + storage implemented, not wired to CLI/extension config |
| **Advanced edit strategies** | Not started | Jaro-Winkler fuzzy matching, unified diff patches, streaming diff, lazy apply |
| **Tree-sitter AST** | Not started | Using regex heuristics for code chunking; tree-sitter would improve accuracy |
| **Docs context provider** | Not started | `@docs <url>` for documentation retrieval |
| **Database context provider** | Not started | `@db` for schema/query context |

---

> For a detailed feature-by-feature comparison with Continue.dev, see [COMPARISON.md](COMPARISON.md).

---

## Roadmap — What's Left

### Phase 1: Missing Tools (Quick Wins) — DONE

- [x] **`list_dir` tool** — directory listing with recursive mode and depth control
- [x] **`view_diff` tool** — git diff (working, staged, between commits/branches)
- [x] **`view_repo_map` tool** — structural overview with language detection
- [x] **Background shell mode** — `shell_exec` with `background: true` for servers/watchers

### Phase 2: Codebase Indexing — DONE

- [x] **SQLite FTS5 index** — full-text search with BM25 ranking + trigram tokenization
- [x] **Code chunking** — code-aware chunking (function/class boundaries for 7+ languages)
- [x] **Upgrade `@codebase` provider** — uses FTS index with incremental updates

### Phase 3: Vector Embeddings & RAG — PARTIAL

- [x] **Embedding provider interface** — pluggable with any embedding model
- [x] **Vector storage** — SQLite with JSON vectors + cosine similarity
- [ ] **Wire to CLI/extension config** — let users configure embedding model via setup wizard
- [ ] **Content-addressed caching** — hash-based dedup across branches

### Phase 4: Advanced Edit Strategies

- [ ] **Jaro-Winkler fuzzy matching** — for when LLM output doesn't match exactly
- [ ] **Unified diff application** — accept `@@ -n,m +n,m @@` format patches
- [ ] **Streaming diff** — real-time diff generation as LLM streams code
- [ ] **Lazy apply** — LLM uses `// ... existing code ...` placeholders, system fills in

### Phase 5: More Context Providers — PARTIAL

- [x] **Git context** — `@git` for commit history, blame, branch info
- [x] **Diff context** — `@diff` for current working changes
- [ ] **Docs context** — `@docs <url>` for documentation retrieval
- [ ] **Database context** — `@db` for schema/query context

### Phase 6: Accurate Token Counting

- [ ] **Tiktoken integration** — accurate token counting for OpenAI models
- [ ] **Llama tokenizer** — for Anthropic and local models
- [ ] **Image token counting** — proper estimation for multimodal inputs
- [ ] **Tool definition tokens** — count tokens used by tool schemas

---

## Authentication

### Interactive Setup Wizard

Run `/setup` inside the CLI at any time to configure provider, model, and authentication:

```
/setup
```

The wizard walks through:
1. **Provider** — Anthropic, OpenAI, Google, Ollama
2. **Auth method** (Anthropic only) — API key or OAuth
3. **Model** — filtered by auth method (OAuth supports Haiku only)
4. **API key or OAuth code** — paste key or complete browser OAuth flow

### API Key

```bash
# Environment variable (recommended for CI/scripts)
export ANTHROPIC_API_KEY=sk-ant-...

# Or save permanently
cdoing config set api-key sk-ant-...
```

### OAuth (Claude Pro/Max subscription) — [full guide](OAUTH.md)

```bash
cdoing --login        # Opens browser → paste code → done
cdoing --logout       # Clear stored OAuth tokens
```

### API Key Helper (Proxy / Dynamic Keys)

```bash
cdoing config set api-key-helper ~/.cdoing/api-key-helper.sh
cdoing config set base-url http://127.0.0.1:8045
```

### Key Resolution Order

```
1. --api-key flag (CLI argument)
2. apiKeyHelper script (from config.json)
3. Environment variable (ANTHROPIC_API_KEY, OPENAI_API_KEY, etc.)
4. Stored key in ~/.cdoing/config.json
5. OAuth token (Anthropic only — auto-refreshed if expired)
6. Interactive setup wizard
```

---

## VS Code Extension

### Setup

```bash
yarn build
code packages/vscode-extension
# Press F5 → launches Extension Development Host
```

### Features

| Action | What Happens |
|--------|-------------|
| Click `</>` icon in activity bar | Opens chat in sidebar |
| `Cmd+Shift+L` | Opens chat as editor panel beside your code |
| `Cmd+I` / `Ctrl+I` | Inline edit — select code, type instruction, see diff |
| Click chat on file title bar | Opens chat with file context pre-filled |
| Right-click selected code | Explain, Refactor, Fix, Inline Edit, Send to Chat |

### Multi-Tab, Image Support, Inline Autocomplete

- Multiple conversation tabs with independent state
- Attach images (PNG, JPG, GIF, WebP, SVG)
- Tab completion with configurable model

---

## Tools (20 Built-In)

### File Operations

| Tool | Description | Permission |
|------|-------------|:---:|
| `file_read` | Read file contents (text, images, PDFs). Supports offset and line limits. | No |
| `file_write` | Create new files or complete rewrites. Auto-creates parent directories. | Yes |
| `file_edit` | Multi-strategy find-and-replace (exact → trimmed → case-insensitive → whitespace-ignored). | Yes |
| `multi_edit` | Batch multiple edits to one file atomically. Sequential application, reverse-order replacement. | Yes |
| `file_delete` | Permission-controlled file/directory deletion. Configurable via `Delete` rules in settings. | Yes |

### Search & Discovery

| Tool | Description | Permission |
|------|-------------|:---:|
| `glob_search` | Find files by glob pattern (e.g., `**/*.ts`). Respects `.gitignore`. | No |
| `grep_search` | Search file contents with regex. Case-insensitive and file-filter options. | No |
| `list_dir` | List directory contents with .gitignore respect, recursive mode, depth control. | No |
| `view_diff` | Show git diff — working changes, staged, or between commits/branches. | No |
| `view_repo_map` | Structural overview: languages, config files, entry points, git info. | No |
| `codebase_search` | FTS5 indexed search with BM25 ranking. Lazy index on first use, incremental updates. | No |

### Code Execution

| Tool | Description | Permission |
|------|-------------|:---:|
| `shell_exec` | Run shell commands. Extracts paths and checks Read/Edit/Delete permissions. Background mode for servers/watchers. | Yes |
| `file_run` | Run scripts by extension (.js, .ts, .py, .rb, .sh, .go, etc.). Timeout: 30s. | Yes |
| `code_verify` | Syntax and type checking for the current project. | No |

### Web Access

| Tool | Description | Permission |
|------|-------------|:---:|
| `web_fetch` | Fetch and extract content from URLs. Domain-restricted by sandbox. | Yes |
| `web_search` | Search the web via DuckDuckGo (no API key required). | Yes |

### Agent Control & Introspection

| Tool | Description | Permission |
|------|-------------|:---:|
| `sub_agent` | Spawn an independent sub-agent for parallel research tasks. | No |
| `todo` | Track tasks with status (pending, in_progress, completed, blocked). | No |
| `system_info` | LLM queries its own permissions, sandbox state, and available tools live. | No |

---

## Permission System

### Permission Modes

| Mode | Behavior |
|------|----------|
| `default` | Prompts before every tool that requires permission |
| `acceptEdits` | Auto-approves file writes/edits, prompts for shell commands |
| `plan` | Read-only — all write/exec/delete tools blocked |
| `dontAsk` | Deny all unless explicitly allowed in settings |
| `bypassPermissions` | Auto-approve everything (unsafe, user-opted-in) |

### Settings-Based Rules

Configure in `.claude/settings.json`:

```json
{
  "permissions": {
    "allow": ["Bash(git *)", "Bash(npm *)", "Edit(src/**)"],
    "ask": ["Bash(git push *)", "Delete"],
    "deny": ["Read(~/.ssh/**)", "Delete(.env*)", "Edit(//etc/**)"]
  }
}
```

**Rule categories:** `Bash(command)`, `Read(path)`, `Edit(path)`, `Delete(path)`, `WebFetch(domain:x)`, `Agent(name)`

**Evaluation order:** Deny → Ask → Allow (deny always wins)

**Settings precedence:** `.claude/settings.local.json` → `.claude/settings.json` → `~/.claude/settings.json`

### Shell Command Permission Checks

`shell_exec` extracts file paths from commands and checks them:

| Command type | Examples | Permission check |
|---|---|---|
| Read commands | `cat`, `less`, `head`, `tail`, `grep`, `diff`, `sort` | Read deny rules |
| Write commands | `cp`, `mv`, `chmod`, `sed -i`, `>`, `>>`, `tee` | Edit deny rules |
| Delete commands | `rm`, `rmdir`, `unlink`, `shred`, `git clean` | Delete deny rules |

### Sandbox

Enable in `.claude/settings.json`:

```json
{
  "sandbox": {
    "enabled": true,
    "mode": "auto-allow",
    "filesystem": {
      "allowWrite": ["~/Downloads", "//tmp"],
      "denyWrite": ["//etc"],
      "denyRead": ["~/.ssh", "~/.aws"]
    },
    "network": {
      "allowedDomains": ["api.github.com", "registry.npmjs.org"],
      "allowManagedDomainsOnly": false
    },
    "excludedCommands": ["docker"],
    "allowUnsandboxedCommands": false
  }
}
```

---

## Context Providers

Use `@` triggers to attach context:

| Trigger | Description |
|---------|-------------|
| `@terminal` | Last terminal command output |
| `@tree [path] [depth]` | Workspace file tree |
| `@url <url>` | Fetch and attach web page content |
| `@codebase <query>` | FTS5 indexed codebase search |
| `@open` | All open editor files (VS Code only) |
| `@problems` | Current file diagnostics/errors (VS Code only) |
| `@clipboard` | Clipboard contents |
| `@file <path>` | Include specific file |
| `@git` | Branch, status, commits, blame, log |
| `@diff` | Working changes, staged, or vs branch |

---

## Agent Architecture

```
User Message
     │
     ▼
┌──────────────────────────────────────────┐
│  Agent Runner (agentic loop)              │
│                                           │
│  Context Providers → Enrich message       │
│  Rules + Effort → System prompt           │
│                                           │
│  stream() ──► Tool Calls                  │
│    ▲          │                           │
│    │    ┌─────┴──────────────────┐        │
│    │    │ Permission Manager     │        │
│    │    │  ├─ Settings rules     │        │
│    │    │  ├─ Mode check         │        │
│    │    │  └─ User prompt        │        │
│    │    ├────────────────────────┤        │
│    │    │ Sandbox Manager        │        │
│    │    │  ├─ Filesystem checks  │        │
│    │    │  ├─ Network checks     │        │
│    │    │  └─ Shell path checks  │        │
│    │    ├────────────────────────┤        │
│    │    │ Tool Execution         │        │
│    │    │  Parallel: file_read,  │        │
│    │    │    grep, glob, web,    │        │
│    │    │    sub_agent           │        │
│    │    │  Sequential: shell,    │        │
│    │    │    file_run            │        │
│    │    │  Smart: file_edit/     │        │
│    │    │    write (parallel if  │        │
│    │    │    different files)    │        │
│    │    └─────┬──────────────────┘        │
│    │          │                           │
│    └──── Results ◄────────────────────────┘
│                                           │
│  + Retry with backoff                     │
│  + Context compression                    │
│  + Token tracking & cost                  │
│  + Pre/post hooks                         │
│  + Plan mode (read-only)                  │
└──────────────────────────────────────────┘
```

---

## Project Structure

```
cdoing-agent/
├── packages/
│   ├── core/                    # @cdoing/core — tools, permissions, sandbox, hooks
│   │   └── src/
│   │       ├── tools/           # 20 built-in tools
│   │       ├── permissions/     # Permission manager (5 modes, settings rules)
│   │       ├── sandbox/         # Filesystem & network sandboxing
│   │       ├── hooks/           # Pre/post tool execution hooks
│   │       ├── context-providers/ # 10 @ mention providers
│   │       ├── indexing/        # SQLite FTS5 codebase indexing
│   │       ├── rules/           # Glob-scoped project rules
│   │       ├── plan/            # Plan mode manager
│   │       ├── mcp/             # MCP server manager
│   │       ├── effort/          # Effort level control
│   │       └── utils/           # Path safety, search matching, memory
│   ├── ai/                      # @cdoing/ai — agent runner, providers
│   │   └── src/
│   │       ├── agent-runner.ts  # Agentic loop with parallel execution
│   │       ├── provider.ts      # Multi-provider LLM support
│   │       ├── context-manager.ts # Token tracking, compression, cost
│   │       └── system-prompt.ts # System prompt with permission awareness
│   ├── cli/                     # @cdoing/cli — terminal interface
│   └── vscode-extension/        # VS Code extension (React webview)
├── docs/                        # Next.js documentation site
```

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

## Development

```bash
yarn install        # Install dependencies
yarn build          # Build all packages
yarn start          # Run CLI
yarn dev            # Dev mode (watch + run)
```

---

## License

MIT
