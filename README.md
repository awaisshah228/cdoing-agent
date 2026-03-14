# Cdoing Agent

AI-powered coding assistant CLI — your pair programmer in the terminal.

Built as a Turborepo monorepo with LangChain for multi-model support.

---

## Prerequisites

- **Node.js** >= 18
- **npm** >= 10
- An API key for at least one provider:
  - Anthropic: `ANTHROPIC_API_KEY`
  - OpenAI: `OPENAI_API_KEY`
  - Google: `GOOGLE_API_KEY`

---

## Quick Start

```bash
# 1. Clone and install
git clone <repo-url>
cd cdoing-agent
npm install

# 2. Build all packages
npx turbo run build

# 3. Set your API key
export ANTHROPIC_API_KEY=sk-ant-...

# 4. Run the CLI
node packages/cli/dist/index.js
```

---

## Testing Phase 1

Phase 1 covers the MVP core loop. Follow these steps to verify each feature works.

### 1. Build

```bash
npm install
npx turbo run build
```

All 3 packages should build with **0 errors**:
- `@cdoing/core` — tools and permissions
- `@cdoing/ai` — LangChain multi-model provider
- `@cdoing/cli` — interactive chat interface

### 2. Start Interactive Chat

```bash
export ANTHROPIC_API_KEY=sk-ant-...
node packages/cli/dist/index.js
```

You should see the welcome banner:

```
  ╔══════════════════════════════════════╗
  ║       Cdoing Agent v0.1.0            ║
  ║   AI-Powered Coding Assistant        ║
  ╚══════════════════════════════════════╝
```

### 3. Test File Read

```
❯ read the package.json file
```

The agent should call `file_read` and display the contents of `package.json` with line numbers.

### 4. Test File Write

```
❯ create a file called test-output.txt with "hello from cdoing agent"
```

The agent should call `file_write` and ask for permission (in `ask` mode). After approving, check that `test-output.txt` was created.

### 5. Test File Edit

```
❯ change "hello from cdoing agent" to "hello world" in test-output.txt
```

The agent should call `file_edit` with find-and-replace.

### 6. Test Glob Search

```
❯ find all TypeScript files in the project
```

The agent should call `glob_search` with `**/*.ts` and list all `.ts` files.

### 7. Test Grep Search

```
❯ search for "ToolRegistry" across the codebase
```

The agent should call `grep_search` and show all files/lines containing `ToolRegistry`.

### 8. Test Shell Execution

```
❯ run git status
```

The agent should call `shell_exec` and ask for permission before running the command.

### 9. Test Permission Modes

```bash
# Auto-approve file edits, ask for shell commands
node packages/cli/dist/index.js --mode auto-edit

# Auto-approve everything (use with caution)
node packages/cli/dist/index.js --mode auto
```

### 10. Test Model Switching

```bash
# Use OpenAI GPT-4o
export OPENAI_API_KEY=sk-...
node packages/cli/dist/index.js --provider openai

# Use Google Gemini
export GOOGLE_API_KEY=...
node packages/cli/dist/index.js --provider google

# Specify exact model
node packages/cli/dist/index.js --provider anthropic --model claude-sonnet-4-20250514
```

### 11. Test One-Shot Mode

```bash
node packages/cli/dist/index.js "list all files in the current directory"
```

The agent should respond and exit immediately without entering interactive mode.

### 12. Test Slash Commands

Inside the interactive chat:

```
❯ /help       # shows available commands
❯ /clear      # clears conversation history
❯ /model      # shows current model info
❯ /exit       # exits the agent
```

### 13. Cleanup

```bash
rm -f test-output.txt
```

---

## Project Structure

```
cdoing-agent/
├── turbo.json                 # Turborepo pipeline config
├── package.json               # Root workspace
├── packages/
│   ├── core/                  # @cdoing/core
│   │   └── src/
│   │       ├── tools/         # 6 tools: file-read, file-write, file-edit,
│   │       │                  #           glob-search, grep-search, shell-exec
│   │       └── permissions/   # 3 modes: ask, auto-edit, auto
│   ├── ai/                    # @cdoing/ai
│   │   └── src/
│   │       ├── provider.ts    # Multi-model: Anthropic, OpenAI, Google
│   │       └── agent-runner.ts# Agentic loop with streaming
│   └── cli/                   # @cdoing/cli
│       └── src/
│           ├── index.ts       # CLI entry point (commander)
│           └── chat.ts        # Interactive terminal UI
```

---

## CLI Usage

```
Usage: cdoing [options] [prompt]

AI-powered coding assistant CLI

Arguments:
  prompt                      One-shot prompt (skips interactive mode)

Options:
  -V, --version               output the version number
  -m, --model <model>         Model to use (e.g., claude-sonnet-4-20250514, gpt-4o)
  -p, --provider <provider>   AI provider: anthropic, openai, google (default: "anthropic")
  --mode <mode>               Permission mode: ask, auto-edit, auto (default: "ask")
  -d, --dir <directory>       Working directory (default: current directory)
  -h, --help                  display help for command
```

---

## License

MIT
