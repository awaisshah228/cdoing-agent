# Cdoing Agent — VS Code Extension

AI-powered coding assistant with multi-model support. Chat, instruct, and run commands right from VS Code.

## Features

- **Chat Panel** — Sidebar chat with streaming responses, tool call visualization, and quick actions
- **Multi-Model** — Anthropic (Claude), OpenAI (GPT), Google (Gemini), or any OpenAI-compatible provider
- **Custom Models** — Use Ollama, Together, Groq, LM Studio, or any OpenAI-compatible endpoint
- **Code Actions** — Right-click to Explain, Refactor, Fix, or Send selection to chat
- **6 Built-in Tools** — File read/write/edit, glob search, grep search, shell execution
- **Permission Modes** — Ask, Auto-Edit, or Auto for tool execution control

## Development Setup

### Prerequisites

- Node.js >= 18
- VS Code >= 1.95.0

### Install & Build

```bash
# From the monorepo root
yarn install

# Build all packages (core → ai → extension)
yarn build

# Or build just the extension
cd packages/vscode-extension
yarn build
```

### Run in Development

```bash
# Watch mode (auto-rebuilds on file changes)
cd packages/vscode-extension
yarn dev
```

Then press **F5** in VS Code (or Run → Start Debugging) to launch the Extension Development Host.

### Testing the Extension

#### Option 1: F5 Debug Launch

1. Open the monorepo root in VS Code
2. Make sure all packages are built: `yarn build`
3. Open `packages/vscode-extension/src/extension.ts`
4. Press **F5** — this opens a new VS Code window with the extension loaded
5. Click the Cdoing icon in the Activity Bar (left sidebar)
6. Start chatting

#### Option 2: Install as VSIX

```bash
cd packages/vscode-extension

# Install vsce if you don't have it
yarn global add @vscode/vsce

# Package the extension
vsce package

# Install in VS Code
code --install-extension cdoing-vscode-0.1.0.vsix
```

#### Option 3: Symlink for Quick Iteration

```bash
# Link the extension into VS Code's extensions directory
ln -s $(pwd)/packages/vscode-extension ~/.vscode/extensions/cdoing-vscode

# Restart VS Code
# The extension will load from your source directory
```

### Debug Configuration

Add this to `.vscode/launch.json` in the monorepo root:

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Run Cdoing Extension",
      "type": "extensionHost",
      "request": "launch",
      "args": [
        "--extensionDevelopmentPath=${workspaceFolder}/packages/vscode-extension"
      ],
      "outFiles": [
        "${workspaceFolder}/packages/vscode-extension/dist/**/*.js"
      ],
      "preLaunchTask": "yarn: build"
    }
  ]
}
```

## Configuration

Open VS Code Settings and search for "Cdoing", or run **Cdoing: Open Settings** from the Command Palette.

| Setting | Default | Description |
|---|---|---|
| `cdoing.provider` | `anthropic` | AI provider: anthropic, openai, google, custom |
| `cdoing.model` | *(empty)* | Model name (empty = provider default) |
| `cdoing.apiKey` | *(empty)* | API key (overrides env var) |
| `cdoing.customBaseURL` | *(empty)* | Base URL for custom providers |
| `cdoing.customProviderName` | *(empty)* | Name for custom provider |
| `cdoing.temperature` | `0` | Model temperature (0–2) |
| `cdoing.maxTokens` | `8096` | Max tokens in response |
| `cdoing.permissionMode` | `ask` | Permission mode: ask, auto-edit, auto |

### API Key Setup

Set the API key for your provider as an environment variable:

```bash
# Anthropic
export ANTHROPIC_API_KEY=sk-ant-...

# OpenAI
export OPENAI_API_KEY=sk-...

# Google
export GOOGLE_API_KEY=AI...
```

Or set it directly in VS Code settings (`cdoing.apiKey`).

### Using Custom Providers

For Ollama, Together, Groq, or any OpenAI-compatible API:

1. Set `cdoing.provider` to `custom`
2. Set `cdoing.customBaseURL` to your endpoint (e.g., `http://localhost:11434/v1`)
3. Set `cdoing.model` to the model name (e.g., `llama3`)
4. Set `cdoing.apiKey` if required

## Commands

| Command | Shortcut | Description |
|---|---|---|
| Cdoing: New Chat | `Cmd+Shift+L` | Start a new chat session |
| Cdoing: Select Model | — | Pick provider and model |
| Cdoing: Open Settings | — | Open extension settings |
| Cdoing: Clear History | — | Clear chat history |
| Cdoing: Send Selection | `Cmd+Shift+Enter` | Send selected code to chat |
| Cdoing: Explain Selection | — | Explain selected code |
| Cdoing: Refactor Selection | — | Refactor selected code |
| Cdoing: Fix Selection | — | Fix issues in selected code |

## Slash Commands (in Chat)

| Command | Description |
|---|---|
| `/help` | Show available commands |
| `/clear` | Clear conversation history |
| `/model` | Change model/provider |
| `/settings` | Open extension settings |

## Project Structure

```
packages/vscode-extension/
├── package.json                 ← Extension manifest (commands, settings, views)
├── esbuild.config.js            ← Dual-bundle build (extension + webview)
├── tsconfig.json                ← TypeScript config with JSX support
├── ARCHITECTURE.md              ← Detailed architecture documentation
│
├── src/
│   ├── extension.ts             ← Activation: registers commands & webview provider
│   ├── chat-panel-provider.ts   ← Bridge: webview ↔ agent communication
│   ├── webview-content.ts       ← HTML generator that loads the React bundle
│   │
│   └── webview/                 ← React app (runs in browser sandbox)
│       ├── index.tsx            ← Entry point
│       ├── types.ts             ← Message protocol types
│       ├── hooks/
│       │   ├── useVsCode.ts     ← VS Code API singleton
│       │   └── useChatState.ts  ← Chat state + message handling
│       ├── components/
│       │   ├── ChatPanel.tsx    ← Root component
│       │   ├── Header.tsx       ← Model badge + action buttons
│       │   ├── MessageList.tsx  ← Message rendering
│       │   ├── MessageBubble.tsx← Single message
│       │   ├── ToolCallBubble.tsx← Tool call display
│       │   ├── InputArea.tsx    ← Input textarea
│       │   └── Welcome.tsx      ← Welcome screen
│       └── styles/
│           └── chat.css         ← All styles
│
├── media/
│   └── icon.svg                 ← Activity bar icon
│
└── dist/                        ← Build output
    ├── extension.js             ← Extension host bundle (Node.js)
    ├── webview.js               ← React webview bundle (browser)
    └── webview.css              ← Extracted styles
```

## How It Works

See [ARCHITECTURE.md](ARCHITECTURE.md) for a detailed technical breakdown of:
- How the React webview communicates with the extension host
- How the extension host calls into `@cdoing/ai` and `@cdoing/core`
- The complete message protocol
- The agentic loop and tool execution flow
- Configuration hierarchy
