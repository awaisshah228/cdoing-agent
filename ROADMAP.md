# Cdoing Agent — Feature Roadmap

Comparison with **Claude Code CLI**, **Continue.dev**, and **Cursor** — what we have, what's missing, and what's planned.

---

## Current Features (Done)

### Chat & Conversations
- [x] Multi-tab conversations with independent agent per tab
- [x] Auto-save conversations to `~/.cdoing/conversations/`
- [x] Conversation history panel (resume/delete past chats)
- [x] Message queue (send while agent is busy)
- [x] Streaming tokens with batched rendering (requestAnimationFrame)
- [x] Welcome screen with quick actions
- [x] Slash commands: `/new`, `/clear`, `/history`, `/resume`, `/compact`, `/help`, etc.

### Context Attachment
- [x] `@` autocomplete — search and attach files/folders by typing `@filename`
- [x] File picker (`+` button) and folder picker
- [x] Right-click selection → Send / Explain / Refactor / Fix
- [x] Click file header button → attach file as context + open chat
- [x] Context chips — visual tags showing attached files/selections with remove button
- [x] Auto-attach active editor file on new tab

### Tools (10 Built-In)
- [x] `file_read` — Read files (text, images, PDFs)
- [x] `file_write` — Create/overwrite files
- [x] `file_edit` — Find-and-replace editing with diff output
- [x] `glob_search` — File pattern matching
- [x] `grep_search` — Regex content search
- [x] `shell_exec` — Shell commands (120s timeout, blocks dangerous patterns)
- [x] `file_run` — Run scripts by extension (30s timeout)
- [x] `web_fetch` — Fetch and extract web content
- [x] `web_search` — DuckDuckGo search (no API key needed)
- [x] `sub_agent` — Spawn independent sub-agents for parallel tasks

### Model & Provider Support
- [x] Anthropic (Claude) — default
- [x] OpenAI (GPT)
- [x] Google (Gemini)
- [x] Custom OpenAI-compatible providers (Ollama, Together, Groq, LM Studio, vLLM)
- [x] In-panel settings UI — change provider, model, API key, permissions without leaving chat
- [x] VS Code settings integration

### Permissions & Safety
- [x] Three permission modes: Ask / Auto-Edit / Auto
- [x] Per-tool permission prompts via VS Code notification
- [x] Store permissions globally (`~/.cdoing/permissions.json`) or per-project (`.cdoing/permissions.json`)
- [x] View/clear permissions via `/permissions`

### UI & UX
- [x] Sidebar panel (left activity bar)
- [x] Editor panel (beside code, Cmd+Shift+L)
- [x] Tool call steps — collapsible accordion with status icons
- [x] Inline diff preview for file edits
- [x] Clickable file paths in responses
- [x] Markdown rendering with syntax highlighting (15+ languages)
- [x] Code blocks with copy button and language label
- [x] Tab bar with auto-title from first message
- [x] Context menu code actions (Explain, Fix, Refactor, Add to Chat)

### CLI
- [x] Interactive chat with streaming
- [x] One-shot mode (`cdoing "prompt"`)
- [x] Slash commands
- [x] Conversation history save/resume
- [x] Direct shell access (`!command`)
- [x] Auto-complete for commands
- [x] Message queuing

### Configuration & Persistence
- [x] Project config via `.cdoing/config.md` or `CDOING.md`
- [x] Hooks system (pre/post tool execution)
- [x] Persistent memory (`/memory`)
- [x] Token usage tracking (`/usage`, `/cost`)
- [x] Context compression (`/compact`)

---

## Missing Features (Planned) → ✅ Implemented

### High Priority

#### Inline Autocomplete / Tab Completion ✅
> **All competitors have this.** Continue.dev and Cursor both offer intelligent inline code suggestions as you type.
- [x] Ghost text suggestions as user types
- [x] Tab to accept, Esc to dismiss
- [x] Configurable model for autocomplete (can be smaller/faster)
- [x] Debounce and token limit settings

#### Inline Edit Mode (Cmd+I / Ctrl+I) ✅
> **Continue.dev** has `Cmd+I` for inline edits. **Cursor** has Composer. Natural language → code changes in place.
- [x] Select code → press Cmd+I → type instruction → see diff inline
- [x] Accept/reject changes per-hunk
- [x] Works without opening the chat panel

#### Codebase Semantic Search (@codebase) ✅
> **Cursor** and **Continue.dev** both offer `@codebase` for semantic search across the entire repo.
- [x] Text-based search with smart ranking (ripgrep + fallback)
- [x] `@codebase` context provider in chat
- [ ] Automatic re-indexing on file changes (future: embedding-based)
- [x] Smart context selection (most relevant files)

### Medium Priority

#### Terminal Context (@terminal) ✅
> **Continue.dev** has `@Terminal` to include last terminal command and output.
- [x] `@terminal` in chat input to include recent terminal output
- [ ] Auto-suggest when user asks about errors

#### Open Files Context (@open) ✅
> **Continue.dev** has `@Open` to include all currently open editor tabs.
- [x] `@open` attaches all open files as context
- [x] Smart truncation for large files

#### URL Context (@url) ✅
> **Continue.dev** has `@URL` to fetch and convert web pages to markdown.
- [x] `@url` in chat to fetch and attach web content
- [x] Convert HTML to clean markdown
- [x] Reuses `web_fetch` logic with `@` trigger

#### Plan Mode ✅
> **Claude Code** has plan mode. **Cursor** generates editable markdown plans before execution.
- [x] `/plan` command — agent analyzes but doesn't modify files
- [x] Generates step-by-step plan as markdown
- [x] User can approve/edit plan before execution
- [x] Read-only tool access during planning

#### MCP Server Support ✅
> **Claude Code** and **Continue.dev** both support Model Context Protocol for external tools.
- [x] MCP server configuration in `.cdoing/mcp.json`
- [x] Dynamic tool discovery from MCP servers
- [x] Connect to external data sources (Jira, Slack, databases)

#### Project Rules ✅
> **Claude Code** has `CLAUDE.md` with 4-tier scoping. **Cursor** has `.cursor/rules/` with glob patterns.
- [x] `.cdoing/rules/` directory with markdown rule files
- [x] Glob-based path scoping (rules only for `*.ts` files, etc.)
- [x] Rules auto-loaded into system prompt
- [x] Hierarchy: global → project → path-specific

### Lower Priority

#### Image Support ✅
> **Claude Code** supports `Ctrl+V` to paste images. Multimodal models can analyze them.
- [x] Attach image files as context (via command)
- [x] Image file picker in VS Code
- [ ] Clipboard paste support (browser limitation in webview)

#### Side Questions (/btw) ✅
> **Claude Code** has `/btw` for questions that don't pollute conversation history.
- [x] `/btw` command for ephemeral questions
- [x] Results shown but not added to agent memory

#### Effort Level Control ✅
> **Claude Code** has `--effort` (low/medium/high/max). **Cursor** has MAX mode.
- [x] `/effort` command or setting
- [x] Low = fast, minimal reasoning
- [x] High/Max = deep analysis, extended thinking

#### Multi-Agent / Agent Teams ✅
> **Claude Code** has sub-agents and coordinator pattern. **Cursor** has multi-agent Mission Control.
- [x] Already have `sub_agent` tool
- [x] Add coordinator pattern for complex tasks
- [x] Parallel agent execution view

#### Workspace File Tree (@tree) ✅
> **Continue.dev** has `@Tree` to include workspace file structure.
- [x] `@tree` context provider
- [x] Configurable depth and filter

#### Problems/Diagnostics (@problems) ✅
> **Continue.dev** has `@Problems` to include current file diagnostics.
- [x] `@problems` attaches VS Code diagnostics (errors, warnings)
- [ ] Auto-suggest when file has errors

---

## Feature Comparison Matrix

> For a full detailed comparison, see [COMPARISON.md](COMPARISON.md).

| Feature | Cdoing | Claude Code | Continue.dev | Cursor | Windsurf |
|---------|:------:|:-----------:|:------------:|:------:|:--------:|
| Chat interface | Yes | Yes (terminal) | Yes | Yes | Yes |
| Multi-tab conversations | Yes | No | No | Yes | Yes |
| @ file autocomplete | Yes | Yes | Yes | Yes | Yes |
| @ codebase search | **Yes** (FTS5) | No | Yes (RAG) | Yes | Yes |
| @ terminal context | **Yes** | No | Yes | No | No |
| @ URL context | **Yes** | Yes | Yes | Yes | No |
| @ git / @ diff | **Yes** | No | Yes | Yes | No |
| Inline autocomplete | **Yes** | No | Yes | Yes | Yes |
| Inline edit (Cmd+I) | **Yes** | No | Yes | Yes | Yes |
| Plan mode | **Yes** | Yes | Yes | Yes | No |
| Agent/tool use | Yes (20 tools) | Yes (~15) | Yes (19) | Yes (~12) | Yes (~10) |
| Diff preview | Yes | Yes | Yes | Yes | Yes |
| Multi-provider | Yes (5+) | No (Anthropic only) | Yes (any) | Yes (limited) | No |
| In-panel settings | Yes | No | Via config file | Yes | Yes |
| Permission system | Yes (5 modes) | Yes (5 modes) | Tool policies | Basic | Basic |
| Hooks system | Yes | Yes (20+ events) | No | No | No |
| Persistent memory | Yes | Yes | No | No | No |
| Conversation history | Yes | Yes | No | Yes | Yes |
| Project rules | **Yes (glob-scoped)** | Yes (4-tier) | Yes (config) | Yes (.cursor/rules/) | Yes (.windsurfrules) |
| MCP servers | **Yes** | Yes | Yes | No | No |
| Image support | **Yes** | Yes | No | Yes | No |
| Sub-agents | Yes | Yes | No | Yes | Yes |
| Effort control | **Yes** | Yes | No | Yes | No |
| Side questions (/btw) | **Yes** | Yes | No | No | No |
| Open source | Yes | No | Yes | No | No |
| CLI | Yes | Yes | No | No | No |

---

## Contributing

Pick any item from the "Missing Features" section above and submit a PR. Focus areas:
1. **Inline autocomplete** — highest impact feature
2. **@codebase semantic search** — most requested
3. **Inline edit mode** — essential for parity with Cursor/Continue.dev
