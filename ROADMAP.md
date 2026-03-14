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

## Missing Features (Planned)

### High Priority

#### Inline Autocomplete / Tab Completion
> **All competitors have this.** Continue.dev and Cursor both offer intelligent inline code suggestions as you type.
- [ ] Ghost text suggestions as user types
- [ ] Tab to accept, Esc to dismiss
- [ ] Configurable model for autocomplete (can be smaller/faster)
- [ ] Debounce and token limit settings

#### Inline Edit Mode (Cmd+I / Ctrl+I)
> **Continue.dev** has `Cmd+I` for inline edits. **Cursor** has Composer. Natural language → code changes in place.
- [ ] Select code → press Cmd+I → type instruction → see diff inline
- [ ] Accept/reject changes per-hunk
- [ ] Works without opening the chat panel

#### Codebase Semantic Search (@codebase)
> **Cursor** and **Continue.dev** both offer `@codebase` for semantic search across the entire repo.
- [ ] Workspace indexing (embeddings or AST-based)
- [ ] `@codebase` context provider in chat
- [ ] Automatic re-indexing on file changes
- [ ] Smart context selection (most relevant files)

### Medium Priority

#### Terminal Context (@terminal)
> **Continue.dev** has `@Terminal` to include last terminal command and output.
- [ ] `@terminal` in chat input to include recent terminal output
- [ ] Auto-suggest when user asks about errors

#### Open Files Context (@open)
> **Continue.dev** has `@Open` to include all currently open editor tabs.
- [ ] `@open` attaches all open files as context
- [ ] Smart truncation for large files

#### URL Context (@url)
> **Continue.dev** has `@URL` to fetch and convert web pages to markdown.
- [ ] `@url` in chat to fetch and attach web content
- [ ] Convert HTML to clean markdown
- [ ] Already have `web_fetch` tool — just need the `@` trigger

#### Plan Mode
> **Claude Code** has plan mode. **Cursor** generates editable markdown plans before execution.
- [ ] `/plan` command — agent analyzes but doesn't modify files
- [ ] Generates step-by-step plan as markdown
- [ ] User can approve/edit plan before execution
- [ ] Read-only tool access during planning

#### MCP Server Support
> **Claude Code** and **Continue.dev** both support Model Context Protocol for external tools.
- [ ] MCP server configuration in settings
- [ ] Dynamic tool discovery from MCP servers
- [ ] Connect to external data sources (Jira, Slack, databases)

#### Project Rules
> **Claude Code** has `CLAUDE.md` with 4-tier scoping. **Cursor** has `.cursor/rules/` with glob patterns.
- [ ] `.cdoing/rules/` directory with markdown rule files
- [ ] Glob-based path scoping (rules only for `*.ts` files, etc.)
- [ ] Rules auto-loaded into system prompt
- [ ] Hierarchy: global → project → path-specific

### Lower Priority

#### Image Support
> **Claude Code** supports `Ctrl+V` to paste images. Multimodal models can analyze them.
- [ ] Paste images in chat input
- [ ] Attach image files as context
- [ ] Screenshot analysis

#### Side Questions (/btw)
> **Claude Code** has `/btw` for questions that don't pollute conversation history.
- [ ] `/btw` command for ephemeral questions
- [ ] Results shown but not added to agent memory

#### Effort Level Control
> **Claude Code** has `--effort` (low/medium/high/max). **Cursor** has MAX mode.
- [ ] `/effort` command or setting
- [ ] Low = fast, minimal reasoning
- [ ] High/Max = deep analysis, extended thinking

#### Multi-Agent / Agent Teams
> **Claude Code** has sub-agents and coordinator pattern. **Cursor** has multi-agent Mission Control.
- [ ] Already have `sub_agent` tool
- [ ] Add coordinator pattern for complex tasks
- [ ] Parallel agent execution view

#### Workspace File Tree (@tree)
> **Continue.dev** has `@Tree` to include workspace file structure.
- [ ] `@tree` context provider
- [ ] Configurable depth and filter

#### Problems/Diagnostics (@problems)
> **Continue.dev** has `@Problems` to include current file diagnostics.
- [ ] `@problems` attaches VS Code diagnostics (errors, warnings)
- [ ] Auto-suggest when file has errors

---

## Feature Comparison Matrix

| Feature | Cdoing | Claude Code | Continue.dev | Cursor |
|---------|:------:|:-----------:|:------------:|:------:|
| Chat interface | Yes | Yes (terminal) | Yes | Yes |
| Multi-tab conversations | Yes | No | No | Yes |
| @ file autocomplete | Yes | Yes | Yes | Yes |
| @ codebase search | No | No | Yes | Yes |
| @ terminal context | No | No | Yes | No |
| @ URL context | No | No | Yes | No |
| Inline autocomplete | No | No | Yes | Yes |
| Inline edit (Cmd+I) | No | No | Yes | Yes |
| Plan mode | No | Yes | Yes | Yes |
| Agent/tool use | Yes (10 tools) | Yes | Yes | Yes |
| Diff preview | Yes | Yes | Yes | Yes |
| Multi-provider | Yes (4+) | No (Anthropic only) | Yes (any) | Yes |
| In-panel settings | Yes | No | Via config file | Yes |
| Permission system | Yes (3 modes) | Yes (5 modes) | No | Basic |
| Hooks system | Yes | Yes (20+ events) | No | No |
| Persistent memory | Yes | Yes | No | No |
| Conversation history | Yes | Yes | No | Yes |
| Project rules | Basic (CDOING.md) | Yes (4-tier) | Yes (config) | Yes (.cursor/rules/) |
| MCP servers | No | Yes | Yes | No |
| Image support | No | Yes | No | Yes |
| Sub-agents | Yes | Yes | No | Yes |
| Open source | Yes | No | Yes | No |
| CLI | Yes | Yes | No | Yes |

---

## Contributing

Pick any item from the "Missing Features" section above and submit a PR. Focus areas:
1. **Inline autocomplete** — highest impact feature
2. **@codebase semantic search** — most requested
3. **Inline edit mode** — essential for parity with Cursor/Continue.dev
