# Cdoing Agent vs Continue.dev — Detailed Comparison

## Tools

| Area | Cdoing Agent (20 tools) | Continue (19 tools) | Status |
|---|---|---|---|
| File read | `file_read` (full file + offset/limit + images + PDFs) | `read_file` + `read_file_range` | Done |
| File write | `file_write` (create/overwrite) | `create_new_file` | Done |
| File edit | `file_edit` (multi-strategy match: exact → trimmed → case-insensitive → whitespace-ignored) | `single_find_and_replace` | Done |
| Multi edit | `multi_edit` (atomic batch edits) | `multi_edit` | Done |
| File delete | `file_delete` (permission-controlled, safe deletion) | *(via shell)* | Extra |
| Glob search | `glob_search` (.gitignore aware) | `file_glob_search` | Done |
| Grep search | `grep_search` (regex, .gitignore aware) | `grep_search` (ripgrep + trigrams) | Done |
| Shell exec | `shell_exec` (path permission checks, destructive detection, background mode) | `run_terminal_command` | Done |
| File run | `file_run` (auto-detect 14 languages) | — | Extra |
| Code verify | `code_verify` (syntax/type check) | — | Extra |
| Web fetch | `web_fetch` (HTML → text, JSON) | `fetch_url_content` | Done |
| Web search | `web_search` (DuckDuckGo) | `search_web` | Done |
| Sub-agent | `sub_agent` (parallel research) | — | Extra |
| Todo | `todo` (task tracking) | — | Extra |
| System info | `system_info` (live permission/sandbox state) | — | Extra |
| List dir | `list_dir` (.gitignore aware, recursive, depth control) | `ls` | Done |
| View diff | `view_diff` (working, staged, between commits/branches) | `view_diff` | Done |
| View repo map | `view_repo_map` (structural overview, language detection) | `view_repo_map` | Done |
| Codebase search | `codebase_search` (FTS5 indexed + optional embeddings) | `codebase` (vector RAG) | Done |
| — | — | `read_currently_open_file` | Not needed (handled by `@open` context) |

## Permission & Security

| Feature | Cdoing Agent | Continue |
|---|---|---|
| Permission modes | 5 modes (default, acceptEdits, plan, dontAsk, bypass) | Tool policies (allow, deny, allowWithPermission) |
| Settings-based rules | Allow/Ask/Deny with path/command matching | Similar |
| Sandbox (filesystem) | allowWrite/denyWrite/denyRead with path prefixes | OS-level (Seatbelt/bubblewrap) |
| Sandbox (network) | Domain allowlist + session approval | Similar |
| Shell path checking | Extracts paths from commands, checks Read/Edit/Delete rules | Not implemented |
| Delete protection | Dedicated `file_delete` tool with `Delete` permission category | Via shell only |
| System introspection | `system_info` tool — LLM queries own permissions live | Not available |

## Indexing & Retrieval

| Feature | Cdoing Agent | Continue |
|---|---|---|
| **Full-text search** | SQLite FTS5 + BM25 + trigram tokenizer | SQLite FTS5 + BM25 + trigrams |
| **Code chunking** | Code-aware (function/class boundaries for 7+ languages) + markdown + basic | Adaptive code-aware (384 tokens) |
| **Incremental indexing** | SHA-256 content hashing, only re-indexes changed files | Similar |
| **Vector embeddings** | Pluggable interface + SQLite storage (not wired to config yet) | LanceDB + configurable models |
| **Code structure** | Regex heuristics | Tree-sitter AST (15+ languages) |
| **Cross-branch cache** | Not implemented | Content-addressed dedup |
| **Recently edited** | Not implemented | LRU cache feeds into retrieval |

## Context Providers

| Provider | Cdoing Agent | Continue |
|---|---|---|
| Terminal | `@terminal` | Terminal |
| Open files | `@open` | OpenFiles |
| URL | `@url` | URL |
| Tree | `@tree` | FileTree |
| Problems | `@problems` | Problems |
| Codebase | `@codebase` (FTS5 indexed search) | Codebase (vector RAG) |
| Clipboard | `@clipboard` | Clipboard |
| File include | `@file` | File |
| Git | `@git` (branch, status, commits, blame, log) | Git |
| Diff | `@diff` (working, staged, vs branch) | DiffContext |
| **Missing** | — | Jira, Discord, Database |
| **Missing** | — | Docs (HTTP), Greptile |
| **Missing** | — | DebugLocals |

## Context Management

| Feature | Cdoing Agent | Continue |
|---|---|---|
| Token counting | ~4 chars/token estimate | Tiktoken (OpenAI) / Llama tokenizer |
| Context pruning | Summarize old messages at 75% limit | FIFO prune from top, preserve system + last turn |
| Output budgeting | Dynamic per-tool char budget | Similar |
| Cost tracking | Per-turn with model pricing tables | Similar |
| Tool output truncation | 30k chars, preserve tail | Similar |

## Edit Tool Sophistication

| Feature | Cdoing Agent | Continue |
|---|---|---|
| Exact match | Done | Done |
| Trimmed match | Done | Done |
| Case-insensitive match | Done | Done |
| Whitespace-ignored match | Done (position mapping back to original) | Done |
| Fuzzy match (Jaro-Winkler) | Not implemented | Implemented (disabled) |
| Multi-edit atomic batch | Done | Done |
| Reverse-order replacement | Done (preserves positions) | Done |
| Lazy apply (LLM-assisted) | Not implemented | 3 strategies: deterministic, unified diff, streaming |
| Tree-sitter AST editing | Not implemented | Done |
| Streaming diff | Not implemented | Done |
