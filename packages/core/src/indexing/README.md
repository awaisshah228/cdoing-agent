# Codebase Indexing & Agent Integration Architecture

## Overview

The indexing system provides fast, ranked code search across the entire codebase. It powers both the `codebase_search` tool (called by the agent) and the `@codebase` context provider (used by the user).

Three retrieval sources are combined in a hybrid pipeline:

| Source | Weight | What it does |
|---|---|---|
| Recently edited files | 25% | LRU cache of files the agent/user just touched |
| Full-text search (FTS5) | 25% | SQLite trigram index with BM25 ranking |
| Embeddings | 50% | Cosine similarity on vector embeddings (optional) |

If embeddings are not configured, FTS and recent files split the results.

---

## Full Wiring Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│ CLI (packages/cli/src/index.ts)                                        │
│                                                                         │
│  1. Parse args, resolve workingDir                                     │
│  2. createToolRegistry(workingDir, { managers... })                     │
│         ↓                                                               │
│  3. registerAllTools(registry, groupOpts)                               │
│         ↓                                                               │
│  4. new AgentRunner(modelConfig, toolRegistry, permMgr, hookMgr, opts) │
│         ↓                                                               │
│  5. Agent loop: stream LLM → extract tool calls → execute → feed back │
└─────────────────────────────────────────────────────────────────────────┘
         │                                    │
         ▼                                    ▼
┌─────────────────────┐          ┌───────────────────────────┐
│ ToolRegistry         │          │ Context Providers          │
│ (core/tools/)        │          │ (core/context-providers/)  │
│                      │          │                            │
│ ┌──────────────────┐ │          │ ┌────────────────────────┐ │
│ │ codebase_search  │ │          │ │ @codebase provider     │ │
│ │                  │ │          │ │                        │ │
│ │ Lazy-inits       │ │          │ │ Lazy-inits             │ │
│ │ CodebaseIndexer  │ │          │ │ CodebaseIndexer        │ │
│ │ on first call    │ │          │ │ on first use           │ │
│ └────────┬─────────┘ │          │ └────────┬───────────────┘ │
└──────────┼───────────┘          └──────────┼─────────────────┘
           │                                  │
           ▼                                  ▼
   ┌───────────────────────────────────────────────────┐
   │              CodebaseIndexer                       │
   │              (core/indexing/indexer.ts)             │
   │                                                    │
   │  ┌──────────────┐ ┌──────────┐ ┌───────────────┐  │
   │  │RecentEdits   │ │ FTS5     │ │  Embeddings   │  │
   │  │Cache (LRU)   │ │ (BM25)   │ │  (Vectors)    │  │
   │  │ 25% weight   │ │ 25%      │ │  50%          │  │
   │  └──────┬───────┘ └────┬─────┘ └──────┬────────┘  │
   │         └──────────────┼──────────────┘            │
   │                        ▼                           │
   │              search(query, limit)                  │
   │              → deduplicate by path:line             │
   │              → return top-k SearchResult[]         │
   └────────────────────────┬──────────────────────────┘
                            │
                            ▼
   ┌────────────────────────────────────────────────────┐
   │           IndexDatabase (SQLite)                   │
   │           (core/indexing/database.ts)               │
   │                                                    │
   │  ~/.cdoing/index.sqlite                            │
   │                                                    │
   │  Tables: chunks, fts, fts_metadata,                │
   │          embeddings, index_catalog                  │
   └────────────────────────────────────────────────────┘
```

---

## Component Details

### 1. Tool Registration (CLI → Tools)

**File:** `packages/cli/src/tools.ts`

```
createToolRegistry(workingDir)
  → registerAllTools(registry, { workingDir, ... })
    → registerSearchTools(registry, opts)
      → new CodebaseSearchTool(workingDir)   // ← indexer lives here
      → new GlobSearchTool(workingDir)
      → new GrepSearchTool(workingDir)
```

Key point: **workingDir flows from CLI → tool factory → tool constructor**. Each tool stores its own `workingDir`. The AgentRunner never touches the indexer directly.

**File:** `packages/core/src/tools/groups.ts` — `registerSearchTools()`

### 2. Agent Runner (LLM ↔ Tools)

**File:** `packages/ai/src/agent-runner.ts`

```
AgentRunner receives:
  - modelConfig (which LLM to use)
  - toolRegistry (fully initialized, has all tools)
  - permissionManager
  - hookManager
  - options { workingDir }  ← only used for system prompt, NOT passed to tools

Loop:
  1. Stream LLM response
  2. Extract tool_use blocks
  3. Check permissions (permissionManager)
  4. Execute: toolRegistry.execute(toolName, input)
  5. Feed tool result back to LLM
  6. Repeat until LLM stops calling tools
```

The AgentRunner is **tool-agnostic** — it doesn't know about indexing. It just calls `toolRegistry.execute()` and the CodebaseSearchTool handles the rest internally.

### 3. codebase_search Tool

**File:** `packages/core/src/tools/search/codebase-search.ts`

This is what the LLM calls when it needs to find code:

```
Agent says: codebase_search({ query: "authentication", directory: "src/" })
                    │
                    ▼
           ensureIndex()
              │
              ├── First call? → new CodebaseIndexer(workingDir)
              │                 → indexer.index()  (scan, chunk, insert)
              │
              ├── Index stale (>1hr)? → re-index
              │
              └── Index ready? → skip
                    │
                    ▼
           indexer.search(query, limit, directory)
              │
              ├── searchRecent()     → 25% of results
              ├── searchFts()        → 25% of results
              └── searchSemantic()   → 50% of results
                    │
                    ▼
           Deduplicate + return formatted output
```

### 4. @codebase Context Provider

**File:** `packages/core/src/context-providers/codebase.ts`

This is what runs when the user types `@codebase auth middleware` in the chat:

```
User types: @codebase authentication flow
                    │
                    ▼
           searchWithIndex(query, workingDir)
              │
              ├── Lazy-init CodebaseIndexer (same pattern as tool)
              ├── indexer.search(query, MAX_RESULTS)
              └── Format as markdown code blocks
                    │
                    ▼ (if index fails)
           searchWithRipgrep(query, workingDir)
              │
              └── rg --ignore-case --context=3 ...
                    │
                    ▼
           Return ContextResult { label, content, metadata }
```

**Important:** Both the tool and the context provider create their **own** CodebaseIndexer instances. They share the same SQLite database file (`~/.cdoing/index.sqlite`), so indexing done by one benefits the other.

### 5. Indexing Pipeline

**File:** `packages/core/src/indexing/indexer.ts`

```
indexer.index()
  │
  ├── 1. scanFiles()
  │      glob("**/*") → filter by extension, size, skip dirs
  │      respects .gitignore
  │
  ├── 2. Compute SHA-256 cache keys
  │      crypto.createHash("sha256").update(content)
  │
  ├── 3. Diff against catalog
  │      Compare current files vs index_catalog table
  │      → toAdd[], toUpdate[], toDelete[]
  │
  ├── 4. Delete removed/modified chunks
  │      DELETE FROM chunks/fts/embeddings WHERE path = ?
  │
  ├── 5. Process new + modified files (batch size: 200)
  │      For each file:
  │        ├── chunkDocument(filePath, content)  → Chunk[]
  │        ├── db.insertChunks(chunks)           → chunk IDs
  │        ├── db.insertFts(chunkId, path, content, cacheKey)
  │        └── db.updateCatalog(filePath, cacheKey, dir)
  │
  └── 6. Optional: computeEmbeddings()
         Batch embed chunks → db.insertEmbedding()
```

### 6. Chunking (How Files Become Chunks)

**File:** `packages/core/src/indexing/chunker.ts`

Three strategies, chosen by file extension:

```
chunkDocument(filePath, content)
  │
  ├── Code files (.ts, .py, .go, .rs, ...) → codeChunker()
  │     Split on function/class boundaries (regex patterns)
  │     If a section > 2x token target → sub-split with basicChunker
  │     Merge tiny chunks (<100 chars) with neighbors
  │
  ├── Markdown (.md, .mdx) → markdownChunker()
  │     Split on # headers
  │     Merge tiny sections
  │
  └── Everything else → basicChunker()
        Accumulate lines until token limit (384 tokens)
        3-line overlap between chunks
```

**Token-based sizing:** Chunks target 384 tokens using `estimateTokens()` (~3.5 chars/token). This matches embedding model sweet spots and ensures consistent LLM context usage.

### 7. Search Pipeline (3-Source Hybrid)

**File:** `packages/core/src/indexing/indexer.ts` — `search()`

```
search(query, limit=25, directory?)
  │
  │  Allocate slots:
  │    recentLimit = ceil(25 * 0.25) = 7
  │    ftsLimit    = ceil(25 * 0.25) = 7
  │    embLimit    = ceil(25 * 0.50) = 13
  │
  ├── searchRecent(query, 7)       ← RecentEditsCache
  │     Path match: +5 score
  │     Content matches: +1 each (max +5)
  │     Recency boost: +2 if <30min ago
  │
  ├── searchFts(query, 7)          ← SQLite FTS5
  │     trigram MATCH
  │     BM25 ranking, path 10x boost
  │     Threshold: -2.5 (drop low quality)
  │
  └── searchSemantic(query, 13)    ← Embeddings (if configured)
        Embed query → cosine similarity vs all chunk vectors
        Sort by similarity descending
  │
  ▼
  Deduplicate by "path:startLine"
  Priority order: recent > embeddings > FTS
  Return top-k
```

### 8. RecentEditsCache

**File:** `packages/core/src/indexing/recent-edits-cache.ts`

An LRU cache (max 50 files) that tracks files the agent recently edited:

```
RecentEditsCache
  │
  ├── put(filePath, content, summary)   ← Called when agent edits a file
  │     Moves file to front of LRU
  │     Tracks editCount and editedAt
  │
  ├── getRecent(limit)                  ← Used by searchRecent()
  │     Returns most recently edited files
  │
  └── searchContent(pattern)            ← Content-level search
        Regex match against cached file contents
```

**Current wiring status:** The cache class exists and the indexer accepts it via `setRecentEditsCache()`, but **it is not yet populated by file_write/file_edit tools**. This is a TODO — see "What's Missing" below.

---

## Database Schema

**Location:** `~/.cdoing/index.sqlite` (WAL mode)

```sql
-- File chunks with content and line ranges
chunks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT NOT NULL,           -- relative file path
  cacheKey TEXT NOT NULL,       -- SHA-256(file content), first 16 hex chars
  content TEXT NOT NULL,        -- chunk text
  startLine INTEGER NOT NULL,
  endLine INTEGER NOT NULL,
  idx INTEGER NOT NULL DEFAULT 0,
  UNIQUE(path, cacheKey, startLine, endLine)
)

-- FTS5 virtual table (trigram tokenizer, BM25 ranking)
-- Trigram = every 3-char sequence indexed for substring matching
fts USING fts5(path, content, tokenize = 'trigram')

-- Links FTS entries back to chunks
fts_metadata (
  id INTEGER PRIMARY KEY,      -- matches fts rowid
  path TEXT NOT NULL,
  cacheKey TEXT NOT NULL,
  chunkId INTEGER NOT NULL → chunks(id)
)

-- Vector embeddings (optional)
embeddings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chunkId INTEGER NOT NULL → chunks(id),
  path TEXT NOT NULL,
  cacheKey TEXT NOT NULL,
  vector TEXT NOT NULL,        -- JSON array of floats
  model TEXT NOT NULL,         -- embedding model ID
  UNIQUE(chunkId, model)
)

-- Tracks which files have been indexed (for incremental updates)
index_catalog (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT NOT NULL,
  cacheKey TEXT NOT NULL,
  lastUpdated INTEGER NOT NULL,
  directory TEXT NOT NULL,
  UNIQUE(path, directory)
)
```

---

## What's Working

- [x] SQLite FTS5 with trigram tokenizer + BM25 ranking
- [x] Token-based chunk sizing (384 tokens target)
- [x] Code-aware chunking (regex boundary detection)
- [x] Incremental indexing (SHA-256 diffing)
- [x] BM25 threshold filtering (-2.5) to drop low-quality results
- [x] 3-source hybrid search (recent 25% + FTS 25% + embeddings 50%)
- [x] @codebase provider uses FTS index (ripgrep as fallback)
- [x] RecentEditsCache class with LRU eviction
- [x] Optional embedding provider support
- [x] Lazy index initialization (built on first use)

## What's Missing (TODOs)

### High Priority

1. **Wire RecentEditsCache into file_write/file_edit tools**
   - When the agent edits a file, call `recentEditsCache.put(filePath, newContent, summary)`
   - Need to pass a shared `RecentEditsCache` instance through tool registration
   - Files: `packages/core/src/tools/file/file_write.ts`, `file_edit.ts`
   - Wire through: `packages/cli/src/tools.ts` → `registerFileTools()`

2. **Share RecentEditsCache between CodebaseSearchTool and @codebase provider**
   - Currently both create independent CodebaseIndexer instances
   - Need a shared cache instance passed at registration time
   - Could add to `groupOpts` in `createToolRegistry()`

3. **FTS query preprocessing**
   - Continue does: stemming → stop word removal → trigram extraction
   - We just escape quotes and pass raw query to FTS MATCH
   - Would improve recall for natural language queries

### Medium Priority

4. **Tree-sitter chunking** (instead of regex)
   - More accurate function/class boundary detection
   - Can collapse function bodies for overview chunks
   - Trade-off: adds ~2MB WASM per language

5. **LLM-based reranking pipeline**
   - Retrieve 2x results, then rerank with a small LLM
   - Continue does this optionally with `RerankerRetrievalPipeline`
   - Trade-off: adds latency + cost per search

6. **Cross-branch content deduplication**
   - Content-addressed storage: same chunk content = same ID regardless of branch
   - Continue uses a tag system for branch awareness

### Low Priority

7. **LanceDB for embeddings** (instead of JSON-in-SQLite)
   - Native vector search, no in-process cosine sim
   - Trade-off: platform-specific binary dependency

8. **Embedding expansion**
   - Continue expands top FTS results with nearby embedding matches
   - `nResultsToExpandWithEmbeddings: 5, nEmbeddingsExpandTo: 5`

---

## Comparison with Other Tools

| Feature | Cdoing (us) | Continue | OpenCode |
|---|---|---|---|
| **Chunking** | Regex boundaries | Tree-Sitter AST | None |
| **Chunk sizing** | Token-based (384) | Token-based (384) | N/A |
| **FTS** | SQLite FTS5 trigram | SQLite FTS5 trigram | None |
| **BM25 threshold** | -2.5 | -2.5 | N/A |
| **Embeddings** | JSON in SQLite | LanceDB | Exa API (external) |
| **Recent files** | 25% (LRU cache) | 25% (LRU cache) | None |
| **Reranking** | Not yet | Optional LLM reranker | None |
| **Offline** | Yes | Yes | No (needs Exa) |
| **Dependencies** | better-sqlite3 | better-sqlite3 + LanceDB | Exa API key |

### Why we chose our approach

- **Regex > tree-sitter**: 90% accuracy with zero native deps, falls back to line-based
- **SQLite > LanceDB**: Single file, no platform binaries, fast enough for <100k chunks
- **Built-in > external API**: Works offline, no API keys, no latency
