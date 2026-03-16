# Cdoing Agent — AI-Powered Coding Assistant (CLI)

## Vision

An intelligent, terminal-based coding agent that helps developers write, debug, refactor, and ship code faster — right from their command line. Think of it as a pair programmer that lives in your terminal.

---

## Target Users

- Individual developers who want AI-assisted coding without leaving the terminal
- Teams looking for a self-hostable coding assistant
- Power users who prefer CLI workflows over GUI-based tools

---

## Core Features

### 1. Interactive Chat Interface (CLI)

- Terminal-based conversational UI with streaming responses
- Markdown rendering in the terminal (syntax highlighting, tables, lists)
- Conversation history within a session
- Multi-turn context — the agent remembers what you discussed earlier in the session
- Input support for multi-line code snippets and prompts

### 2. File Operations

- **Read files** — Agent can read any file in the project to understand context
- **Edit files** — Apply precise, targeted edits to existing files (find-and-replace style)
- **Create files** — Generate new files from scratch based on user instructions
- **Delete files** — Remove files when requested (with confirmation)
- **Glob search** — Find files by name patterns (e.g., `**/*.ts`, `src/**/*.py`)

### 3. Code Search & Navigation

- **Content search** — Search across the entire codebase for patterns, function names, variables
- **Regex support** — Full regex-powered search for advanced queries
- **File type filtering** — Narrow searches to specific languages or file types
- **Context-aware results** — Show surrounding lines for each match

### 4. Shell Command Execution

- Run shell commands directly from the chat (build, test, lint, deploy)
- Stream command output in real time
- Automatic timeout handling for long-running processes
- Background task execution with notifications on completion

### 5. Codebase Understanding

- Automatically infer project structure, language, and framework
- Read and respect project configuration files (package.json, pyproject.toml, Cargo.toml, etc.)
- Understand monorepo structures
- Parse and use existing documentation (README, docs/, inline comments)

### 6. Code Generation & Editing

- Generate new functions, classes, modules, and entire files
- Refactor existing code (rename variables, extract functions, simplify logic)
- Add types, interfaces, and type annotations
- Convert between patterns (callbacks to async/await, class to functional, etc.)
- Respect existing code style and conventions automatically

### 7. Debugging & Error Resolution

- Paste an error message — agent identifies the root cause and suggests a fix
- Read stack traces and navigate to the relevant source code
- Suggest and apply fixes directly
- Run tests to verify the fix works

### 8. Git Integration

- View status, diff, and log
- Stage changes, create commits with meaningful messages
- Create and switch branches
- Generate pull request titles and descriptions
- Resolve merge conflicts with AI assistance

---

## Advanced Features

### 9. Context Management

- **Project context** — Automatically loads relevant files based on the task
- **Conversation compression** — Handles long conversations without losing important context
- **Smart file selection** — Only reads files that are relevant to the current task
- **Token budget awareness** — Manages context window efficiently

### 10. Permission & Safety System

- **Approval modes:**
  - `ask` — Confirm every tool call (safest)
  - `auto-edit` — Auto-approve file reads/edits, confirm shell commands
  - `auto` — Auto-approve everything (fastest, for trusted environments)
- Dangerous operation warnings (force push, delete, overwrite)
- Never commit secrets or credentials
- Sandbox mode for shell commands

### 11. Task Planning & Tracking

- Break complex tasks into subtasks automatically
- Track progress with a built-in todo/checklist system
- Plan mode — discuss and align on approach before writing code
- Show progress updates at natural milestones

### 12. Multi-Agent Architecture

- Spawn sub-agents for parallel, independent tasks
- Specialized agents for different jobs:
  - **Explorer agent** — Fast codebase search and navigation
  - **Planner agent** — Architecture and design decisions
  - **Test runner agent** — Run and validate tests
  - **General-purpose agent** — Research and multi-step tasks
- Agents run in isolation (optional git worktrees) to avoid conflicts

### 13. Memory & Persistence

- Remember user preferences across sessions
- Store project-specific context (conventions, architecture decisions)
- Save feedback so mistakes aren't repeated
- Memory types: user profile, feedback, project context, external references
- File-based storage — no external database required

### 14. Configuration System

- **Project-level config** — `CLAUDE.md` file in the repo root for project-specific instructions
- **User-level config** — Global settings and preferences
- **Model selection** — Choose between different AI models per task
- **Custom slash commands** — Define reusable prompt templates
- **Hooks** — Run custom scripts on specific events (pre-commit, post-edit, etc.)

---

## User Experience Features

### 15. Slash Commands

Built-in shortcuts for common workflows:

| Command | Description |
|---------|-------------|
| `/help` | Show available commands and usage |
| `/clear` | Clear conversation history |
| `/commit` | Stage and commit changes with a generated message |
| `/review` | Review code changes before committing |
| `/plan` | Enter planning mode to discuss approach |
| `/test` | Run the project's test suite |
| `/lint` | Run linters and auto-fix issues |
| `/explain` | Explain selected code or a file |

### 16. IDE / Editor Integration

- VSCode extension support
- JetBrains plugin support
- Vim/Neovim integration
- Open files and navigate to specific lines from the CLI

### 16a. VSCode Extension (First-Class Plugin)

A dedicated VSCode extension so any developer can use Cdoing Agent without touching the terminal.

**Chat Panel:**
- Sidebar chat panel embedded in VSCode (like GitHub Copilot Chat)
- Streaming responses with full markdown and syntax-highlighted code blocks
- Inline diff previews — see proposed changes before accepting
- One-click "Apply" button to accept code edits directly into the editor

**Inline Assistance:**
- Inline code suggestions as you type (ghost text / autocomplete)
- Right-click context menu: "Explain this code", "Refactor", "Add tests", "Fix bug"
- Hover actions on errors/warnings — "Fix with Cdoing Agent"
- Selection-based actions — highlight code and ask the agent to modify it

**Editor Integration:**
- Automatic file context — agent sees the file you're editing and your cursor position
- Terminal panel integration — run agent commands in VSCode's built-in terminal
- Problem panel integration — agent can read and fix diagnostics (ESLint, TypeScript errors, etc.)
- Navigate to files and lines referenced in agent responses (clickable links)

**Diff & Review Workflow:**
- Side-by-side diff view before applying any edit
- Accept / Reject / Edit buttons per change
- Batch apply — accept all suggested changes at once
- Undo integration — revert agent changes with a single Ctrl+Z

**Git Workflow (from VSCode):**
- Source Control panel integration
- One-click commit with AI-generated messages
- PR creation and review from within the editor
- Inline blame annotations with agent-powered explanations

**Project Awareness:**
- Reads workspace settings, `.vscode/` configs, and `launch.json`
- Respects `.gitignore` and workspace excludes
- Multi-root workspace support
- Workspace-level memory — remembers preferences per project

**Settings & Configuration:**
- VSCode settings UI for all agent preferences (model, permissions, keybindings)
- Custom keybindings for common actions (e.g., `Ctrl+Shift+A` to open chat)
- Status bar indicator showing agent status (idle, thinking, editing)
- Notification toasts for background task completions

**Distribution:**
- Published on the VSCode Marketplace and Open VSX Registry
- One-click install from the marketplace
- Auto-update support
- Works with VSCode, VSCodium, and Cursor

### 17. Streaming & Real-Time Output

- Token-by-token streaming for fast perceived response times
- Progress indicators for long operations
- Inline diffs shown before applying edits
- Color-coded terminal output (diffs, errors, warnings, success)

---

## Technical Requirements

### 18. Architecture

- **Runtime:** Node.js (TypeScript)
- **AI Backend:** Pluggable LLM provider (OpenAI, Anthropic, local models)
- **Storage:** Local filesystem (no cloud dependency)
- **Auth:** API key-based (user provides their own key)
- **Distribution:** npm package (`npm install -g cdoing-agent`)

### 19. Security

- No data leaves the machine except API calls to the LLM provider
- API keys stored securely (environment variables or encrypted config)
- File access restricted to the working directory by default
- Audit log of all actions taken by the agent
- Input sanitization to prevent prompt injection

### 20. Performance

- Sub-second response for file reads and searches
- Efficient context management to minimize API token usage
- Caching for repeated file reads within a session
- Parallel tool execution where possible

---

## Release Phases

### Phase 1 — MVP (Core Loop)

- [ ] Interactive CLI chat with streaming
- [ ] File read / write / edit
- [ ] Codebase search (glob + grep)
- [ ] Shell command execution
- [ ] Single-model support (Anthropic Claude)
- [ ] Basic permission system (ask before destructive actions)

### Phase 2 — Smart Context

- [ ] Auto-detect project type and structure
- [ ] Smart context loading (only relevant files)
- [ ] Conversation history and compression
- [ ] Git integration (status, diff, commit)
- [ ] Slash commands
- [ ] Task tracking (todos)

### Phase 3 — Advanced Agent

- [ ] Multi-agent architecture (sub-agents for parallel work)
- [ ] Planning mode
- [ ] Memory and persistence across sessions
- [ ] Configuration system (CLAUDE.md equivalent)
- [ ] Hooks and custom commands

### Phase 4 — VSCode Extension

- [ ] Basic VSCode sidebar chat panel with streaming responses
- [ ] File context awareness (current file, cursor position, selection)
- [ ] Inline diff preview with Accept / Reject buttons
- [ ] Right-click context menu actions (Explain, Refactor, Fix, Add Tests)
- [ ] Inline autocomplete / ghost text suggestions
- [ ] Problem panel integration (auto-fix diagnostics)
- [ ] Git integration in Source Control panel (AI commit messages, PR creation)
- [ ] Settings UI, keybindings, and status bar indicator
- [ ] Publish to VSCode Marketplace and Open VSX Registry

### Phase 5 — Ecosystem

- [ ] JetBrains and Neovim plugins
- [ ] Plugin system for community extensions
- [ ] Multi-model support (OpenAI, local models, etc.)
- [ ] Team/shared memory and project configs
- [ ] Web dashboard for session history and analytics

---

## Success Metrics

| Metric | Target |
|--------|--------|
| Time to first useful response | < 3 seconds |
| Task completion rate (user doesn't need to manually fix) | > 80% |
| Daily active usage per developer | 10+ interactions/day |
| User retention (weekly) | > 60% |
| Error rate (agent breaks something) | < 2% |

---

## Competitive Landscape

| Feature | Cdoing Agent | GitHub Copilot CLI | Cursor | Aider |
|---------|-------------|-------------------|--------|-------|
| Terminal-native | Yes | Yes | No | Yes |
| VSCode extension | Yes | Yes | N/A (is an IDE) | No |
| Inline autocomplete | Yes | Yes | Yes | No |
| Inline diff review | Yes | Yes | Yes | No |
| File editing | Yes | No | Yes | Yes |
| Multi-agent | Yes | No | No | No |
| Memory/persistence | Yes | No | No | No |
| Self-hostable | Yes | No | No | Yes |
| Multi-model | Yes | No | No | Yes |
| Git integration | Yes | No | Yes | Yes |

---

## Getting Started (Target UX)

```bash
# Install
npm install -g cdoing-agent

# Set up API key
export ANTHROPIC_API_KEY=sk-...

# Start coding
cd my-project
cdoing

# Or run a one-shot command
cdoing "add input validation to the signup form"
```

---

*This document is the north star for product development. Each feature should be validated against real developer workflows before implementation. Ship small, ship often, get feedback.*
