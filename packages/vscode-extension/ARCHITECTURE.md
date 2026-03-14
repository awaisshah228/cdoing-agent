# Cdoing VSCode Extension — Architecture

## High-Level Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        VS Code Extension                            │
│                                                                     │
│  ┌──────────────────────┐    postMessage()    ┌──────────────────┐  │
│  │   WEBVIEW (React)    │ ◄────────────────►  │  EXTENSION HOST  │  │
│  │   Browser sandbox    │   VSCode IPC        │  Node.js process │  │
│  └──────────┬───────────┘                     └────────┬─────────┘  │
│             │                                          │            │
│     No filesystem access                        Full Node.js        │
│     No Node.js                                        │            │
│     Only postMessage()                         ┌──────┴──────┐     │
│                                                │  @cdoing/ai │     │
│                                                │ AgentRunner  │     │
│                                                │  + Provider  │     │
│                                                └──────┬──────┘     │
│                                                ┌──────┴──────┐     │
│                                                │ @cdoing/core│     │
│                                                │  ToolRegistry│     │
│                                                │  6 Tools     │     │
│                                                │  Permissions │     │
│                                                └─────────────┘     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Layer 1: React Webview (browser sandbox)

The webview runs inside a VS Code webview panel. It is a **sandboxed browser**
with no access to Node.js, the filesystem, or any npm packages at runtime.
It can only communicate with the extension host via `vscode.postMessage()`.

### File Structure

```
src/webview/
├── index.tsx                    ← Entry point: mounts <ChatPanel /> into #root
├── types.ts                     ← Message protocol types (IncomingMessage, OutgoingMessage)
│
├── hooks/
│   ├── useVsCode.ts             ← acquireVsCodeApi() singleton hook
│   └── useChatState.ts          ← All chat state + extension message listener
│
├── components/
│   ├── ChatPanel.tsx            ← Root component: wires Header + MessageList + InputArea
│   ├── Header.tsx               ← Model badge, New Chat button, Settings button
│   ├── MessageList.tsx          ← Renders entries[] array (messages + tool calls)
│   ├── MessageBubble.tsx        ← Single message bubble (user / assistant / system / error)
│   ├── ToolCallBubble.tsx       ← Tool invocation and result display
│   ├── InputArea.tsx            ← Textarea with auto-resize + Send button
│   └── Welcome.tsx              ← Welcome screen with quick action buttons
│
└── styles/
    └── chat.css                 ← All CSS (extracted to dist/webview.css at build)
```

### How It Works

1. `index.tsx` calls `createRoot(document.getElementById("root"))` and renders `<ChatPanel />`
2. `ChatPanel` uses the `useChatState()` hook which:
   - Manages the `entries[]` array (messages + tool calls)
   - Tracks `isProcessing` state
   - Listens for messages from the extension host via `window.addEventListener("message")`
   - Provides `sendMessage(text)` which calls `vscode.postMessage({ type: "sendMessage", text })`
3. Components render the UI and call `sendMessage()` or `sendCommand()` on user actions

### Key Constraint

The webview **never** calls tools, reads files, or makes API calls directly.
It only sends JSON messages and renders what the extension host sends back.

---

## Layer 2: Extension Host (Node.js process)

The extension host runs in VS Code's Node.js process. It has full access to
the filesystem, npm packages, and the VS Code API.

### File Structure

```
src/
├── extension.ts                 ← activate(): registers commands, webview provider, config listener
├── chat-panel-provider.ts       ← The bridge between webview ↔ agent
└── webview-content.ts           ← Generates HTML that loads the React bundle
```

### extension.ts — Entry Point

Called by VS Code on activation. Responsibilities:

| What | How |
|---|---|
| Register sidebar webview | `registerWebviewViewProvider("cdoing.chatPanel", chatProvider)` |
| Register commands | `cdoing.newChat`, `cdoing.selectModel`, `cdoing.openSettings`, etc. |
| Editor context menu | `cdoing.sendSelection`, `cdoing.explainSelection`, etc. |
| Listen for config changes | `onDidChangeConfiguration` → `chatProvider.refreshConfig()` |

### chat-panel-provider.ts — The Bridge

This is the most important file. It connects the React webview to `@cdoing/ai` and `@cdoing/core`.

**Responsibilities:**

1. **resolveWebviewView()** — Called when the webview panel opens:
   - Sets up webview security (CSP, scripts)
   - Loads HTML via `getWebviewContent()` (which loads the React bundle)
   - Registers the `onDidReceiveMessage` handler
   - Calls `initAgent()` to set up the agent

2. **initAgent()** — Creates the agent infrastructure:
   ```
   initAgent()
   ├── Get working directory from workspace
   ├── Read config from VS Code settings
   ├── Create ToolRegistry (@cdoing/core)
   │   ├── register(FileReadTool)
   │   ├── register(FileWriteTool)
   │   ├── register(FileEditTool)
   │   ├── register(GlobSearchTool)
   │   ├── register(GrepSearchTool)
   │   └── register(ShellExecTool)
   ├── Create PermissionManager with mode (ask | auto-edit | auto)
   └── Create AgentRunner(@cdoing/ai) with modelConfig + toolRegistry + permissionManager
   ```

3. **onDidReceiveMessage()** — Routes messages from the webview:
   ```
   message.type === "sendMessage" → handleUserMessage(text)
   message.type === "command"     → handleCommand(cmd, args)
   message.type === "ready"       → sendCurrentConfig()
   ```

4. **handleUserMessage(text)** — The core message handler:
   ```
   handleUserMessage(text)
   ├── Guard: return if already processing
   ├── Guard: validate API key (config or env var)
   ├── Post { type: "startResponse" } to webview
   ├── Create AgentCallbacks:
   │   ├── onToken(token)       → post { type: "token", text: token }
   │   ├── onToolCall(name, input) → post { type: "toolCall", name, input }
   │   ├── onToolResult(...)    → post { type: "toolResult", name, result, isError }
   │   ├── onComplete()         → post { type: "endResponse" }
   │   └── onError(err)         → post { type: "error", text: err.message }
   └── Call agent.run(text, callbacks)
   ```

### webview-content.ts — HTML Generator

Generates the HTML shell that loads the React app:
- References `dist/webview.js` (React bundle) and `dist/webview.css`
- Sets Content-Security-Policy with nonce for script security
- Uses `webview.asWebviewUri()` to create VS Code-safe URIs

---

## Layer 3: @cdoing/ai (Agent Runner + Provider)

### File Structure

```
packages/ai/src/
├── provider.ts      ← createModel(): creates LangChain chat model for any provider
├── agent-runner.ts  ← AgentRunner: orchestrates the agentic loop with streaming
└── index.ts         ← Public exports
```

### provider.ts — Model Factory

```
createModel(config)
├── provider = config.provider || "anthropic"
├── Switch on provider:
│   ├── "anthropic" → new ChatAnthropic({ model, apiKey, temperature, maxTokens })
│   ├── "openai"    → new ChatOpenAI({ model, apiKey, temperature, maxTokens })
│   ├── "google"    → new ChatGoogleGenerativeAI({ model, apiKey, ... })
│   └── custom      → new ChatOpenAI({ model, apiKey, baseURL })
│                      (OpenAI-compatible format — works with Ollama, Together, Groq, etc.)
└── Return LangChain BaseChatModel instance
```

**Custom provider registration:**
```typescript
registerCustomProvider({
  name: "ollama",
  baseURL: "http://localhost:11434/v1",
  defaultModel: "llama3",
  apiKeyEnvVar: "OLLAMA_API_KEY",
});
```

### agent-runner.ts — Agentic Loop

```
AgentRunner.run(userMessage, callbacks)
│
├── Push HumanMessage to message history
├── Convert ToolRegistry tools → LangChain DynamicStructuredTool[]
│   (JSON Schema → Zod schema conversion)
├── Bind tools to model: model.bindTools(lcTools)
│
└── AGENTIC LOOP:
    │
    ├── Build messages: [SystemMessage, ...history]
    ├── Stream from model: modelWithTools.stream(allMessages)
    │
    ├── Process stream chunks:
    │   ├── Text content → callbacks.onToken(text)
    │   └── Tool calls  → collect in toolCalls[] array
    │
    ├── If no tool calls → done, break loop
    │   ├── Push AIMessage to history
    │   └── callbacks.onComplete()
    │
    └── If tool calls found:
        ├── Push AIMessage (with tool_calls) to history
        │
        ├── For each tool call:
        │   ├── callbacks.onToolCall(name, args)
        │   ├── PermissionManager.requestPermission(tool, args)
        │   │   └── Denied? → Push "Permission denied" ToolMessage, skip
        │   ├── ToolRegistry.execute(name, args)
        │   │   └── Returns { success, output } or { success: false, error }
        │   ├── Push ToolMessage (result) to history
        │   └── callbacks.onToolResult(name, result, isError)
        │
        └── Continue loop → model sees tool results → responds or calls more tools
```

---

## Layer 4: @cdoing/core (Tools + Permissions)

### File Structure

```
packages/core/src/
├── tools/
│   ├── types.ts         ← ToolDefinition, ToolResult, BaseTool interfaces
│   ├── registry.ts      ← ToolRegistry: stores and executes tools by name
│   ├── file-read.ts     ← FileReadTool: read file contents with line numbers
│   ├── file-write.ts    ← FileWriteTool: create/overwrite files
│   ├── file-edit.ts     ← FileEditTool: find-and-replace editing
│   ├── glob-search.ts   ← GlobSearchTool: file pattern matching
│   ├── grep-search.ts   ← GrepSearchTool: regex content search
│   └── shell-exec.ts    ← ShellExecTool: execute shell commands
├── permissions.ts       ← PermissionManager: gates tool execution
└── index.ts             ← Public exports
```

### Tool Registry

```typescript
interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;  // JSON Schema
  requiresPermission: boolean;
  permissionMessage?: (input) => string;
}

interface ToolResult {
  success: boolean;
  output: string;
  error?: string;
}
```

### Tools

| Tool | Name | Permission | What It Does |
|---|---|---|---|
| FileReadTool | `file_read` | No | Read file contents with line numbers, offset/limit |
| FileWriteTool | `file_write` | Yes | Create new or overwrite existing files |
| FileEditTool | `file_edit` | Yes | Find-and-replace editing (exact string match) |
| GlobSearchTool | `glob_search` | No | Find files by glob pattern (ignores node_modules, dist, .git) |
| GrepSearchTool | `grep_search` | No | Regex search in file contents (200 match limit, skips >1MB files) |
| ShellExecTool | `shell_exec` | Yes | Run shell commands (2min timeout, blocks `rm -rf /`) |

### Permission Manager

```
PermissionMode.ASK       → Prompt user for every permission-requiring tool
PermissionMode.AUTO_EDIT → Auto-approve file operations, prompt for shell commands
PermissionMode.AUTO      → Auto-approve everything
```

---

## Complete End-to-End Flow

User types **"fix this bug"** and hits Enter:

```
 REACT WEBVIEW                 EXTENSION HOST              @cdoing/ai             @cdoing/core
 ─────────────                 ──────────────              ──────────             ────────────
      │                              │                          │                       │
 1. User types + Enter               │                          │                       │
      │                              │                          │                       │
 2.   │──{ sendMessage,             │                          │                       │
      │    "fix this bug" }────────►│                          │                       │
      │                              │                          │                       │
 3.   │◄──{ startResponse }────────│                          │                       │
      │                              │                          │                       │
 4.   │                              │──agent.run(text, cbs)─►│                       │
      │                              │                          │                       │
 5.   │                              │                          │──model.stream()      │
      │                              │                          │  (calls LLM API)     │
      │                              │                          │                       │
 6.   │◄──{ token, "Let me" }──────│◄──onToken("Let me")────│                       │
      │   appendToken()              │                          │                       │
      │                              │                          │                       │
 7.   │◄──{ token, " read" }──────│◄──onToken(" read")─────│                       │
      │                              │                          │                       │
 8.   │                              │                          │  model decides to     │
      │                              │                          │  call file_read       │
      │                              │                          │                       │
 9.   │◄──{ toolCall,              │◄──onToolCall()──────────│                       │
      │     "file_read" }───────────│                          │                       │
      │   addToolCall()              │                          │                       │
      │                              │                          │                       │
10.   │                              │                          │──permissionManager   │
      │                              │                          │  .requestPermission()│
      │                              │                          │                       │
11.   │                              │                          │──registry.execute()─►│
      │                              │                          │                       │── FileReadTool
      │                              │                          │                       │   .execute(args)
      │                              │                          │                       │   reads file from disk
      │                              │                          │◄──{ success, output }│
      │                              │                          │                       │
12.   │◄──{ toolResult,            │◄──onToolResult()────────│                       │
      │     output, false }─────────│                          │                       │
      │   addToolResult()            │                          │                       │
      │                              │                          │                       │
13.   │                              │                          │──model.stream()      │
      │                              │                          │  (model sees file    │
      │                              │                          │   content, decides   │
      │                              │                          │   to call file_edit) │
      │                              │                          │                       │
14.   │◄──{ toolCall,              │◄──onToolCall()──────────│                       │
      │     "file_edit" }───────────│                          │                       │
      │                              │                          │                       │
15.   │                              │                          │──registry.execute()─►│
      │                              │                          │                       │── FileEditTool
      │                              │                          │                       │   .execute(args)
      │                              │                          │◄──{ success, output }│
      │                              │                          │                       │
16.   │◄──{ toolResult,            │◄──onToolResult()────────│                       │
      │     output, false }─────────│                          │                       │
      │                              │                          │                       │
17.   │                              │                          │──model.stream()      │
      │                              │                          │  (final response,    │
      │                              │                          │   no more tools)     │
      │                              │                          │                       │
18.   │◄──{ token, "I fixed..." }──│◄──onToken()─────────────│                       │
      │                              │                          │                       │
19.   │◄──{ endResponse }──────────│◄──onComplete()──────────│                       │
      │   setIsProcessing(false)     │                          │                       │
```

---

## Message Protocol

### Webview → Extension Host (OutgoingMessage)

| type | fields | when |
|---|---|---|
| `sendMessage` | `text: string` | User sends a chat message |
| `command` | `command: string, args?: string[]` | Slash command (/clear, /model, /help, /settings) |
| `ready` | — | Webview finished loading, requests current config |

### Extension Host → Webview (IncomingMessage)

| type | fields | when |
|---|---|---|
| `startResponse` | — | Agent starts processing user message |
| `token` | `text: string` | Each streamed token from the LLM |
| `toolCall` | `name: string, input: string` | Agent invokes a tool |
| `toolResult` | `name: string, result: string, isError: boolean` | Tool returns a result |
| `endResponse` | — | Agent finished responding |
| `error` | `text: string` | Error occurred |
| `systemMessage` | `text: string` | System notification (help text, etc.) |
| `clear` | — | Clear the chat history |
| `configUpdated` | `provider: string, model: string` | Model/provider settings changed |
| `insertMessage` | `message: string` | Right-click "Send Selection to Chat" |

---

## Configuration Flow

```
VS Code Settings UI  ──►  vscode.workspace.getConfiguration("cdoing")
                                        │
                           ┌────────────┴────────────────┐
                           │  chat-panel-provider.ts      │
                           │  getConfig() reads:          │
                           │    cdoing.provider            │
                           │    cdoing.model               │
                           │    cdoing.apiKey              │
                           │    cdoing.customBaseURL       │
                           │    cdoing.customProviderName  │
                           │    cdoing.temperature         │
                           │    cdoing.maxTokens           │
                           │    cdoing.permissionMode      │
                           └────────────┬────────────────┘
                                        │
                                        ▼
                              ModelConfig {
                                provider: "anthropic" | "openai" | "google" | string,
                                model: "claude-sonnet-4-20250514",
                                apiKey?: string,
                                baseURL?: string,
                                temperature: 0,
                                maxTokens: 8096,
                              }
                                        │
                                        ▼
                              createModel(config) → LangChain ChatModel
                                        │
                              ┌─────────┼──────────┬──────────┐
                              ▼         ▼          ▼          ▼
                         ChatAnthropic  ChatOpenAI  ChatGoogle  ChatOpenAI
                         (Claude)       (GPT)       (Gemini)    (custom baseURL)
```

---

## Build System

Two esbuild bundles are produced:

| Bundle | Entry | Output | Platform | Purpose |
|---|---|---|---|---|
| Extension host | `src/extension.ts` | `dist/extension.js` | Node.js | VS Code extension process |
| React webview | `src/webview/index.tsx` | `dist/webview.js` + `dist/webview.css` | Browser | Webview UI |

```bash
node esbuild.config.js          # Production build (minified)
node esbuild.config.js --watch  # Dev mode (watches both bundles)
```

---

## Key Architectural Decisions

1. **Webview isolation** — The React UI has zero access to Node.js or the filesystem.
   All communication goes through `postMessage()`. This is a VS Code security requirement.

2. **Callback-driven streaming** — The AgentRunner uses callbacks (`onToken`, `onToolCall`,
   `onToolResult`, `onComplete`, `onError`) so the extension host can relay each event to
   the webview in real-time. No polling.

3. **Agentic loop** — The model can call tools, see results, and call more tools in a loop
   until it decides to respond with just text. This enables multi-step reasoning.

4. **Custom providers via OpenAI-compatible API** — Any provider that speaks the OpenAI
   chat completions format (Ollama, Together, Groq, LM Studio, vLLM, etc.) can be used
   by setting a `baseURL`.

5. **Permission gating** — Tools that modify the filesystem or run shell commands require
   explicit permission. The mode (ask / auto-edit / auto) is configurable in VS Code settings.
