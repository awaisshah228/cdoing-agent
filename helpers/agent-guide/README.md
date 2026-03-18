# How the VS Code Extension Renders Streaming & Tool Calls

Run `node helpers/agent-guide/run.js` first to understand the agent loop,
then read this to understand how the UI shows it all without looking broken.

---

## The Full Pipeline

```
AgentRunner (Node.js)               chat-panel-provider.ts              chatStore.ts (Zustand)           React Components
─────────────────────               ──────────────────────              ──────────────────────           ─────────────────
                                                                        entries[] = the UI state
callbacks.onToken("H")         →    postMessage({ type:"token" })   →  tokenBuffer += "H"
callbacks.onToken("e")         →    postMessage({ type:"token" })   →  tokenBuffer += "e"
callbacks.onToken("l")         →    postMessage({ type:"token" })   →  tokenBuffer += "l"
                                                                        ─── next animation frame ───
                                                                        flush "Hel" into entries[]   →  MessageBubble re-renders

callbacks.onToolCall("file_read") →
  1. postMessage({ type:"finalizeStreaming" })                      →  flush remaining tokens         →  text message is SEALED
                                                                        streamingId = null                (won't get more tokens)
  2. postMessage({ type:"toolCall", name, input })                  →  entries.push(ToolCallEntry)    →  ToolCallBubble (spinning)

callbacks.onToolProgress(chunk) → postMessage({ type:"toolProgress" }) → append to same entry          →  live shell output

callbacks.onToolResult(result)  → postMessage({ type:"toolResult" })   → update same entry             →  ToolCallBubble (done ✓)
                                                                          kind: "call" → "result"

callbacks.onToken("T")         →  postMessage({ type:"token" })    →  streamingId is null, so...
callbacks.onToken("h")                                                  create NEW assistant message   →  NEW MessageBubble
callbacks.onToken("e")                                                  (separate from text before tool)
```

---

## Why Streaming Doesn't Flicker

**Problem:** Tokens arrive one at a time ("H", "e", "l", "l", "o"). Re-rendering
on every single token = janky UI.

**Solution:** `requestAnimationFrame` batching in `chatStore.ts:313-318`

```
Token "H" arrives → buffer it (no re-render)
Token "e" arrives → buffer it (no re-render)
Token "l" arrives → buffer it (no re-render)
── animation frame fires (~16ms) ──
Flush "Hel" into store → ONE re-render
```

The buffer (`tokenBuffer`) collects tokens. On the next animation frame,
they get flushed into the entries[] array as a single update.

**Where in code:**
- `appendToken()` — buffers tokens, schedules rAF → `chatStore.ts:313-318`
- `flushTokenBufferInternal()` — writes buffer into entries[] → `chatStore.ts:168-194`

---

## Why Tool Calls Don't Break the Text

**Problem:** AI says "Let me check" then calls file_read. Without care,
the tool result could get mixed into the text, or the text after the tool
could get glued onto the text before it.

**Solution:** `finalizeStreaming` message

When `onToolCall` fires in `chat-panel-provider.ts:1197-1208`:

```js
onToolCall: (name, input) => {
    // 1. FIRST: seal the current text message
    postMessage({ type: "finalizeStreaming" });
    // 2. THEN: add the tool call as a separate entry
    postMessage({ type: "toolCall", name, input });
}
```

`finalizeStreaming` does two things in the store (`chatStore.ts:483-486`):
1. Flushes any remaining token buffer
2. Sets `streamingId = null`

So the NEXT tokens after the tool create a **new** message bubble:

```
┌───────────────────────────────┐
│ "Let me check that file"      │  ← assistant message (finalized/sealed)
├───────────────────────────────┤
│ ✓ Read  src/index.ts → 42 ln │  ← ToolCallEntry (separate entry)
├───────────────────────────────┤
│ "The file contains..."        │  ← NEW assistant message
└───────────────────────────────┘
```

---

## How a Tool Call Entry Lives in the Store

A tool call is ONE entry that transitions through states:

### State 1: Running (kind="call")
```
addToolCall("file_read", '{"file_path":"src/index.ts"}')
→ entries.push({ id:"e-5", kind:"call", name:"file_read", input:"...", output:"" })
→ toolCallMap.set("file_read", "e-5")   ← tracks name→id for matching result later
```
**UI:** spinner + shimmer animation on description

### State 2: Streaming output — shell_exec only (still kind="call")
```
updateToolProgress("shell_exec", "installing packages...")
→ find entry by toolCallMap → append chunk to output
→ { id:"e-5", kind:"call", output:"installing packages..." }
```
**UI:** live terminal output with blinking cursor

### State 3: Done (kind="result")
```
addToolResult("file_read", "const foo = 1;\n...", false)
→ find entry by toolCallMap → update kind + output
→ { id:"e-5", kind:"result", output:"const foo = 1;\n...", isError:false }
→ toolCallMap.delete("file_read")
```
**UI:** ✓ icon, collapsed summary, expandable IN/OUT

**Key insight:** It's the SAME entry mutated, not two entries. That's why
the transition from spinning → done looks smooth.

**Where in code:**
- `addToolCall()` → `chatStore.ts:260-268`
- `updateToolProgress()` → `chatStore.ts:271-281`
- `addToolResult()` → `chatStore.ts:284-303`

---

## How ToolCallBubble Renders Each State

File: `packages/vscode-extension/src/webview/components/ToolCallBubble.tsx`

```
COLLAPSED (default):
┌──────────────────────────────────────────────┐
│ ▸ ✓ Read  Read src/index.ts → 42 lines      │
└──────────────────────────────────────────────┘

RUNNING:
┌──────────────────────────────────────────────┐
│ ▸ [spinner] Read  Read src/index.ts ~~~~~~~~ │  ← shimmer on text
└──────────────────────────────────────────────┘

SHELL RUNNING (auto-expands):
┌──────────────────────────────────────────────┐
│ ▾ [spinner] Bash  npm install  [Running]     │
│  ── IN ──                                    │
│  npm install                                 │
│  ── streaming ──                             │
│  fetching packages...█                       │  ← blinking cursor
└──────────────────────────────────────────────┘

EXPANDED (click to toggle):
┌──────────────────────────────────────────────┐
│ ▾ ✓ Read  Read src/index.ts → 42 lines      │
│  ── IN ──                                    │
│  src/index.ts          (clickable → opens file)
│  ── OUT ──                                   │
│  const foo = 1;                              │
│  const bar = 2;                              │
│  … (40 more lines)                           │
└──────────────────────────────────────────────┘

ERROR:
┌──────────────────────────────────────────────┐
│ ▸ ✗ Bash  npm test → Error: test failed      │
│  ── ERROR ──                                 │
│  Command failed with exit code 1             │
└──────────────────────────────────────────────┘
```

**Per-tool rendering:** Each tool type has custom IN/OUT renderers:
- `file_read` → shows clickable file path
- `file_edit` → shows old_string/new_string diff preview
- `shell_exec` → shows command in `<pre>` block
- `grep_search` → shows "N results" count
- `todo` → shows interactive checklist

**Where in code:**
- `renderToolInput()` → `ToolCallBubble.tsx:176-300` (per-tool IN)
- `renderToolOutput()` → `ToolCallBubble.tsx:304-359` (per-tool OUT)
- `getToolDescription()` → `ToolCallBubble.tsx:63-172` (header text)
- `getOutputSummary()` → `ToolCallBubble.tsx:609-636` (collapsed hint)

---

## Performance Tricks

| Problem | Solution | Where |
|---------|----------|-------|
| Per-token re-renders | `requestAnimationFrame` batching | `chatStore.ts:313-318` |
| Tool splitting text | `finalizeStreaming` seals text, resets streamingId | `chatStore.ts:483-486` |
| Call + result = 2 events | Same entry mutated via `toolCallMap` | `chatStore.ts:260-303` |
| Shell streams live | `toolProgress` appends to running entry | `chatStore.ts:271-281` |
| Unnecessary re-renders | `React.memo` checks `id + kind + output` | `ToolCallBubble.tsx:476-480` |
| Background tabs | Messages buffered, replayed on tab switch | `chat-panel-provider.ts:104-140` |

---

## File Map

```
packages/vscode-extension/src/
  chat-panel-provider.ts          ← bridge: AgentRunner callbacks → postMessage to webview
  webview/
    types.ts                      ← IncomingMessage, ToolCallEntry, ChatMessage types
    store/chatStore.ts            ← Zustand store: token batching, tool call tracking
    components/
      MessageList.tsx             ← renders entries[] as MessageBubble or ToolCallBubble
      MessageBubble.tsx           ← renders ChatMessage (user/assistant/system text)
      ToolCallBubble.tsx          ← renders ToolCallEntry (per-tool IN/OUT, states)

packages/ai/src/
  agent-runner.ts                 ← the agentic loop that fires all the callbacks
```
