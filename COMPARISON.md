# Cdoing Agent — Comparison with AI Coding Assistants

A detailed feature-by-feature comparison of Cdoing Agent with **Claude Code**, **Continue.dev**, **Cursor**, and **Windsurf (Codeium)**.

---

## Overview

| | Cdoing Agent | Claude Code | Continue.dev | Cursor | Windsurf |
|---|:---:|:---:|:---:|:---:|:---:|
| **Open Source** | Yes | No | Yes | No | No |
| **CLI** | Yes | Yes | No | No | No |
| **VS Code Extension** | Yes | Yes (via CLI) | Yes | N/A (own editor) | N/A (own editor) |
| **JetBrains** | No | No | Yes | No | No |
| **Multi-Provider** | Yes (5+) | No (Anthropic only) | Yes (any) | Yes (limited) | No (Codeium only) |
| **Pricing** | Free | Pro/Max subscription | Free + paid | $20/mo | $10/mo |

---

## Chat & Conversation

| Feature | Cdoing Agent | Claude Code | Continue.dev | Cursor | Windsurf |
|---------|:---:|:---:|:---:|:---:|:---:|
| Interactive chat | Yes | Yes (terminal) | Yes | Yes | Yes |
| Multi-tab conversations | Yes | No | No | Yes | Yes |
| Conversation history | Yes | Yes | No | Yes | Yes |
| Streaming responses | Yes | Yes | Yes | Yes | Yes |
| Message queue (send while busy) | Yes | No | No | No | No |
| Slash commands | Yes | Yes | Yes | Yes | Yes |
| Side questions (/btw) | Yes | Yes | No | No | No |
| One-shot mode | Yes | Yes | No | No | No |

---

## Tools

| Tool | Cdoing Agent | Claude Code | Continue.dev | Cursor | Windsurf |
|------|:---:|:---:|:---:|:---:|:---:|
| File read | `file_read` | Read | `read_file` + `read_file_range` | Yes | Yes |
| File write | `file_write` | Write | `create_new_file` | Yes | Yes |
| File edit | `file_edit` (4-strategy match) | Edit | `single_find_and_replace` | Yes | Yes |
| Multi edit | `multi_edit` (atomic batch) | Yes | `multi_edit` | Yes | Yes |
| File delete | `file_delete` | Yes | Via shell | Via shell | Via shell |
| Glob search | `glob_search` | Glob | `file_glob_search` | Yes | Yes |
| Grep search | `grep_search` | Grep | `grep_search` | Yes | Yes |
| Shell exec | `shell_exec` (background mode) | Bash | `run_terminal_command` | Yes | Yes |
| File run | `file_run` (14 languages) | No | No | No | No |
| Code verify | `code_verify` | No | No | No | No |
| Web fetch | `web_fetch` | WebFetch | `fetch_url_content` | No | No |
| Web search | `web_search` | WebSearch | `search_web` | No | No |
| Sub-agent | `sub_agent` | Agent | No | Yes (background agents) | Yes (Cascade) |
| Todo tracking | `todo` | TodoWrite | No | No | No |
| System introspection | `system_info` | No | No | No | No |
| List directory | `list_dir` | Yes | `ls` | Yes | Yes |
| View diff | `view_diff` | Yes | `view_diff` | Yes | Yes |
| Repo map | `view_repo_map` | No | `view_repo_map` | No | No |
| Codebase search | `codebase_search` (FTS5) | No | `codebase` (vector RAG) | Yes (embeddings) | Yes (embeddings) |
| Notebook edit | No | NotebookEdit | No | Yes | No |
| **Total** | **20** | **~15** | **19** | **~12** | **~10** |

---

## Edit Tool Sophistication

| Feature | Cdoing Agent | Claude Code | Continue.dev | Cursor | Windsurf |
|---------|:---:|:---:|:---:|:---:|:---:|
| Exact match | Yes | Yes | Yes | Yes | Yes |
| Trimmed match | Yes | Yes | Yes | N/A | N/A |
| Case-insensitive match | Yes | Yes | Yes | N/A | N/A |
| Whitespace-ignored match | Yes | Yes | Yes | N/A | N/A |
| Fuzzy match (Jaro-Winkler) | No | No | Yes (disabled) | N/A | N/A |
| Multi-edit atomic batch | Yes | Yes | Yes | Yes | Yes |
| Unified diff patches | No | No | Yes | Yes | Yes |
| Streaming diff | No | No | Yes | Yes | Yes |
| Lazy apply (placeholders) | No | No | Yes | Yes | Yes |
| Tree-sitter AST editing | No | No | Yes | Yes | No |

---

## Permission & Security

| Feature | Cdoing Agent | Claude Code | Continue.dev | Cursor | Windsurf |
|---------|:---:|:---:|:---:|:---:|:---:|
| Permission modes | 5 modes | 5 modes | Tool policies | Basic (allow/deny) | Basic |
| Settings-based rules | Yes (allow/ask/deny) | Yes | Yes | No | No |
| Sandbox (filesystem) | Yes (path prefixes) | Yes (Seatbelt/bubblewrap) | Yes (OS-level) | No | No |
| Sandbox (network) | Yes (domain allowlist) | Yes | Yes | No | No |
| Shell path checking | Yes | Yes | No | No | No |
| Destructive command detection | Yes | Yes | No | No | No |
| System introspection | Yes (`system_info`) | No | No | No | No |
| Plan mode (read-only) | Yes | Yes | Yes | Yes | No |

---

## Context Providers (@mentions)

| Provider | Cdoing Agent | Claude Code | Continue.dev | Cursor | Windsurf |
|----------|:---:|:---:|:---:|:---:|:---:|
| `@file` | Yes | Yes | Yes | Yes | Yes |
| `@codebase` | Yes (FTS5) | No | Yes (vector RAG) | Yes (embeddings) | Yes |
| `@terminal` | Yes | No | Yes | No | No |
| `@tree` | Yes | No | Yes | No | No |
| `@url` | Yes | Yes | Yes | Yes | No |
| `@open` (open files) | Yes | No | Yes | No | No |
| `@problems` (diagnostics) | Yes | No | Yes | No | No |
| `@clipboard` | Yes | No | Yes | No | No |
| `@git` | Yes | No | Yes | Yes | No |
| `@diff` | Yes | No | Yes | No | No |
| `@docs` (documentation) | No | No | Yes | Yes | No |
| `@jira` / `@discord` | No | No | Yes (via plugins) | No | No |
| `@database` | No | No | Yes (via plugins) | No | No |
| **Total** | **10** | **2** | **13+** | **4** | **2** |

---

## Indexing & Retrieval

| Feature | Cdoing Agent | Claude Code | Continue.dev | Cursor | Windsurf |
|---------|:---:|:---:|:---:|:---:|:---:|
| Full-text search | FTS5 + BM25 + trigrams | No (runtime grep) | FTS5 + BM25 + trigrams | Proprietary | Proprietary |
| Code chunking | Code-aware (7+ langs) | No | Code-aware (384 tokens) | Yes | Yes |
| Incremental indexing | SHA-256 hashing | No | Yes | Yes | Yes |
| Vector embeddings | Interface only (not wired) | No | LanceDB + models | Yes | Yes |
| Code structure parsing | Regex heuristics | No | Tree-sitter (15+ langs) | Tree-sitter | Proprietary |
| Cross-branch cache | No | No | Content-addressed dedup | No | No |
| Recently edited cache | No | No | LRU cache | Yes | Yes |

---

## IDE Features

| Feature | Cdoing Agent | Claude Code | Continue.dev | Cursor | Windsurf |
|---------|:---:|:---:|:---:|:---:|:---:|
| Inline autocomplete (Tab) | Yes | No | Yes | Yes | Yes |
| Inline edit (Cmd+I) | Yes | No | Yes | Yes (Composer) | Yes (Cascade) |
| Diff preview | Yes | Yes (terminal) | Yes | Yes | Yes |
| Clickable file paths | Yes | Yes | Yes | Yes | Yes |
| Syntax highlighting | Yes (15+ langs) | Yes | Yes | Yes | Yes |
| Image support | Yes | Yes | No | Yes | No |
| Code actions (right-click) | Yes | No | Yes | Yes | Yes |
| Editor panel (beside code) | Yes (Cmd+Shift+L) | No | No | Yes | Yes |
| Activity bar icon | Yes | No | Yes | N/A | N/A |

---

## Agent Architecture

| Feature | Cdoing Agent | Claude Code | Continue.dev | Cursor | Windsurf |
|---------|:---:|:---:|:---:|:---:|:---:|
| Agentic loop | Yes | Yes | Yes | Yes | Yes (Cascade) |
| Parallel tool execution | Yes | Yes | No | Yes | Yes |
| Retry with backoff | Yes | Yes | No | Unknown | Unknown |
| Context compression | Yes (FIFO at 75%) | Yes | Yes (FIFO) | Yes | Yes |
| Token tracking & cost | Yes | Yes | Yes | No (subscription) | No (subscription) |
| Pre/post hooks | Yes | Yes (20+ events) | No | No | No |
| Sub-agents | Yes | Yes | No | Yes | Yes |
| MCP server support | Yes | Yes | Yes | No | No |
| Max turns limit | Yes | Yes | No | Yes | Yes |
| Effort level control | Yes | Yes | No | Yes (MAX mode) | No |

---

## Configuration & Rules

| Feature | Cdoing Agent | Claude Code | Continue.dev | Cursor | Windsurf |
|---------|:---:|:---:|:---:|:---:|:---:|
| Project rules | `.cdoing/rules/*.md` (glob-scoped) | `CLAUDE.md` (4-tier) | `.continuerules` | `.cursor/rules/` | `.windsurfrules` |
| Global settings | `~/.cdoing/settings.json` | `~/.claude/settings.json` | `config.json` | Via app settings | Via app settings |
| Local overrides | `.claude/settings.local.json` | Yes | No | No | No |
| Hooks system | Yes | Yes (20+ events) | No | No | No |
| MCP config | `.cdoing/mcp.json` | `.claude/mcp.json` | Via config | No | No |
| Persistent memory | Yes | Yes | No | No | No |

---

## Authentication

| Feature | Cdoing Agent | Claude Code | Continue.dev | Cursor | Windsurf |
|---------|:---:|:---:|:---:|:---:|:---:|
| API key | Yes | Yes | Yes | Yes (own key) | N/A |
| OAuth (PKCE) | Yes | Yes | No | No | No |
| OS Keychain storage | Yes | Yes | No | No | No |
| API key helper scripts | Yes | Yes | No | No | No |
| Multi-provider keys | Yes | No | Yes | Limited | No |

---

## Summary — Where Cdoing Agent Wins

| Advantage | Details |
|-----------|---------|
| **Open source + multi-provider** | Unlike Claude Code (Anthropic-only) and Cursor/Windsurf (proprietary) |
| **20 tools** | More built-in tools than any competitor |
| **Permission system** | 5 modes + settings rules + shell path checking — most granular of all |
| **CLI + VS Code** | Both interfaces, unlike Cursor/Windsurf (editor only) or Continue (VS Code only) |
| **10 context providers** | More than Claude Code (2) and Cursor (4) |
| **Self-hostable** | Full control, no cloud dependency when using Ollama |
| **Hooks system** | Pre/post tool execution hooks with templating |
| **Background shell mode** | Run servers/watchers with PID tracking |

## Summary — Where Competitors Win

| Gap | Who Does It Better |
|-----|-------------------|
| **Vector embeddings (RAG)** | Cursor, Continue.dev, Windsurf — all have production embedding pipelines |
| **Tree-sitter AST** | Continue.dev, Cursor — structural code understanding |
| **Streaming diff / lazy apply** | Continue.dev, Cursor — advanced edit strategies |
| **Accurate token counting** | Continue.dev — tiktoken/llama tokenizers vs our ~4 chars/token estimate |
| **Tests** | All competitors have test suites; Cdoing Agent has none |
| **JetBrains support** | Continue.dev only |
| **Docs/database providers** | Continue.dev — `@docs`, `@jira`, `@database` via plugins |
