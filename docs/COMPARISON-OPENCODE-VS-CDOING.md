# Comparison: OpenCode vs Cdoing Agent

This document compares the opencode project with cdoing-agent, identifying gaps and improvements to implement.

## 1. Permissions System

| Feature | OpenCode | Cdoing Agent | Gap? |
|---------|----------|-------------|------|
| Allow/Deny/Ask actions | ✅ 3-action system | ✅ 5 modes (default, acceptEdits, plan, dontAsk, bypass) | No — cdoing has MORE modes |
| Wildcard pattern matching | `Wildcard.match()` | `matchPath()` glob | No |
| Layered rulesets | Defaults → user → agent-specific | Managed → Local → Shared → User | No |
| Edit tool unification | Maps edit/write/patch/multiedit → `"edit"` | Maps individually per tool | Minor |
| **Bash command arity** | **160+ command prefix→arity map** | Basic destructive command detection | **YES — implement** |
| **Async permission deferral** | `Deferred`-based with once/always/reject | Blocking readline `askUser()` | **YES — implement** |
| **Cascade reject** | Rejects all pending calls from same session | No cascade | **YES — implement** |

### Bash Arity System
OpenCode maps ~160 command prefixes to token counts for human-readable permission prompts:
- `git checkout main` → asks "allow `git checkout`?" (arity 2)
- `npm run dev` → asks "allow `npm run dev`?" (arity 3)
- `touch file.txt` → asks "allow `touch`?" (arity 1)

This is defined in `opencode/src/permission/arity.ts`.

## 2. Provider System — BIGGEST GAP

| Feature | OpenCode | Cdoing Agent | Gap? |
|---------|----------|-------------|------|
| Core providers | Anthropic, OpenAI, Google | Anthropic, OpenAI, Google | No |
| Ollama | No | ✅ Yes | cdoing+ |
| **GitHub Copilot** | ✅ standard + enterprise | ❌ No | **YES** |
| **Azure OpenAI** | ✅ Full (resource names, regions, custom auth) | ⚠️ Basic stub | **Partial** |
| **Amazon Bedrock** | ✅ Full (region prefixing, credential chain) | ⚠️ Basic gateway stub | **Partial** |
| **Google Vertex** | ✅ Full (OAuth + GoogleAuth client) | ❌ No | **YES** |
| OAuth flow | Full (access/refresh/expires/accountId) | Basic save/load tokens | **Partial** |
| Provider-specific API modes | OpenAI `responses()`, Anthropic beta headers | Basic chat completion only | **YES** |
| Custom loaders per provider | Per-provider init logic with SDK wrappers | Generic `createCustomProvider()` | **YES** |
| OpenRouter/Mistral/etc | 10+ via `@ai-sdk/*` bundled SDK creators | 10 via OpenAI-compatible endpoints | **Partial** |

### Key Provider Gaps
1. **GitHub Copilot**: Huge user base. Needs conditional API selection (responses vs chat based on model).
2. **Google Vertex**: Needs GoogleAuth client for service account authentication.
3. **Bedrock**: Needs region prefixing, AWS credential chain (env → profile → instance metadata).
4. **Azure**: Needs full resource name + region + API version handling.

## 3. Tool System

| Feature | OpenCode | Cdoing Agent | Gap? |
|---------|----------|-------------|------|
| Schema format | **Zod** (validated before execution) | Raw JSON Schema (no validation) | **YES** |
| Tool metadata | Generic `<M>` type per tool | None | **YES** |
| Abort/cancellation | `AbortSignal` in tool context | No abort support | **YES** |
| Tool call timestamps | `time.start`/`time.end` per call | No timing | **YES** |
| Batch tool | Up to 25 parallel calls | Has batch.ts (less mature) | Partial |
| **Plugin/custom tools** | Dynamic import from config dirs | No plugin loading | **YES** |
| Output truncation | `Truncate.output()` wrapper on every tool | Per-tool in agent-runner | Partial |
| **LSP diagnostics after edits** | Shows errors from edited + related files | No LSP integration | **YES** |
| **File locking** | `FileTime.withLock()` for concurrent edits | No file locking | **YES** |
| **Line ending preservation** | Detects `\r\n` vs `\n`, normalizes/restores | No detection | **YES** |
| Image/PDF as attachments | Base64 data URLs as `FilePart[]` | Metadata only for images | **YES** |

### OpenCode's Edit Replacer Chain (9 strategies)
OpenCode uses a sophisticated cascading replacer chain in `edit.ts`:
1. **SimpleReplacer** — exact string match
2. **LineTrimmedReplacer** — line-by-line trimmed comparison
3. **BlockAnchorReplacer** — first/last line anchors + Levenshtein similarity for middle
4. **WhitespaceNormalizedReplacer** — collapse all whitespace
5. **IndentationFlexibleReplacer** — normalize indentation levels
6. **EscapeNormalizedReplacer** — handle escaped characters (`\n`, `\t`, etc.)
7. **TrimmedBoundaryReplacer** — trim boundaries only
8. **ContextAwareReplacer** — context anchor matching (50% middle-line threshold)
9. **MultiOccurrenceReplacer** — yield all exact matches

### Cdoing's Current Match Chain (5 strategies)
1. Exact match
2. Trimmed match
3. Case-insensitive match
4. Whitespace-ignored match
5. Jaro-Winkler fuzzy match (90% threshold)

### Missing Strategies to Add
- **BlockAnchorReplacer** (Levenshtein-based anchor matching)
- **IndentationFlexibleReplacer** (normalize indentation)
- **EscapeNormalizedReplacer** (handle escape sequences)
- **ContextAwareReplacer** (context anchor matching)
- **Line ending preservation** (`\r\n` vs `\n`)

## 4. Tool Passing to LLM

| Feature | OpenCode | Cdoing Agent | Gap? |
|---------|----------|-------------|------|
| **Pre-filter by permissions** | Removes disabled tools before LLM sees them | Passes all, checks at execution | **YES** |
| **Model-specific tool selection** | `apply_patch` for GPT-4, `edit/write` for others | Same tools for all models | **YES** |
| AI SDK tool wrapper | `tool()` with `jsonSchema()` + `execute()` | LangChain tool binding | Different approach |
| User tool enable/disable | `user.tools[toolId] === false` | `--allowed-tools`/`--disallowed-tools` | Partial |

## 5. Agent Runner

| Feature | OpenCode | Cdoing Agent | Gap? |
|---------|----------|-------------|------|
| Doom loop detection | ✅ 3 identical calls → break | ✅ Same | No |
| **Tool definition compaction** | Strips to first sentence, removes IMPORTANT blocks | ✅ Already implemented | No |
| **Prompt caching (Anthropic)** | `cache_control: ephemeral` on last tool | ✅ Already implemented | No |
| Keyword-based tool selection | First turn only | ✅ Already implemented | No |
| Smart parallelism | Sequential by default, batch tool for parallel | ✅ Smart categorization (parallel reads, sequential writes) | cdoing+ |

## 6. File Operations

| Feature | OpenCode | Cdoing Agent | Gap? |
|---------|----------|-------------|------|
| **File read max bytes** | 50KB limit per read | No limit | **YES** |
| **Max line length** | 2000 chars (truncates with notice) | No truncation | **YES** |
| **Directory listing** | Alphabetical sort, offset/limit pagination | No directory listing in file_read | **YES** |
| File write diagnostics | LSP errors after write | No diagnostics | **YES** |
| **File events/bus** | Publishes File.Event.Edited, FileWatcher.Event.Updated | No event system | **YES** |

## 7. Other Gaps

| Feature | OpenCode | Cdoing Agent | Gap? |
|---------|----------|-------------|------|
| Tree-sitter bash parsing | WASM parser for command extraction | Regex-based detection | YES |
| File watcher events | Publishes events after writes | No file events | YES |
| Snapshot/undo system | `Snapshot.FileDiff` tracking | No snapshot | YES |
| External directory assertion | `assertExternalDirectory()` per tool | `safePath()` only | Partial |

---

## Implementation Priority

### P0 — High Impact, Do First
1. **FileTime utility** — file locking for concurrent edits
2. **Upgrade edit replacers** — add opencode's 9-strategy chain with line-ending preservation
3. **Pre-filter tools by permissions** — don't send denied tools to LLM
4. **Model-specific tool selection** — `apply_patch` for GPT, `edit/write` for Claude

### P1 — Medium Impact
5. **File read improvements** — max bytes, line truncation, directory listing
6. **File write diagnostics** — LSP error reporting after writes
7. **GitHub Copilot + Google Vertex providers**
8. **Bash arity system** — human-readable permission prompts

### P2 — Nice to Have
9. **Plugin/custom tool loading** — extensibility
10. **AbortSignal in tool context**
11. **Tool call timestamps**
12. **Image/PDF as attachments** (base64)
13. **Tree-sitter bash parsing**
