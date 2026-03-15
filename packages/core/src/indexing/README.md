# Codebase Indexing System

## Overview

The indexing system provides fast, ranked code search across the entire codebase using **SQLite FTS5** (full-text search with BM25 ranking) and optional **vector embeddings** (cosine similarity). It powers both the `codebase_search` tool and the `@codebase` context provider.

## Architecture

```
┌──────────────────────────────────────────────────┐
│                 CodebaseIndexer                    │
│                                                    │
│  1. Scan files (respects .gitignore)               │
│  2. SHA-256 cache key per file                     │
│  3. Diff against catalog (incremental updates)     │
│  4. Chunk files (code-aware / basic / markdown)    │
│  5. Insert into SQLite                             │
│  6. Build FTS5 index (trigram tokenizer)            │
│  7. Optional: compute embeddings                   │
│                                                    │
│  ┌──────────┐  ┌───────────┐  ┌──────────────┐   │
│  │  Chunks   │  │  FTS5     │  │  Embeddings  │   │
│  │  (SQLite) │  │  (BM25)   │  │  (Vectors)   │   │
│  └──────────┘  └───────────┘  └──────────────┘   │
│       │              │               │             │
│       └──────────────┴───────────────┘             │
│                      │                             │
│              search(query)                         │
│           FTS(35%) + Embeddings(65%)                │
│              → deduplicated results                │
└──────────────────────────────────────────────────┘
```

## How It Works

### 1. File Scanning

- Recursively scans the working directory
- Respects `.gitignore` patterns
- Skips: `node_modules`, `.git`, `dist`, `build`, `__pycache__`, `coverage`, etc.
- Skips files > 1MB
- Supports 40+ file extensions (code, config, docs)

### 2. Incremental Updates

Files are tracked in a `index_catalog` table with SHA-256 content hashes:

```
index_catalog:
  path, cacheKey (SHA-256), lastUpdated, directory
```

On each index run:
- **New files** → chunk + index
- **Modified files** (hash changed) → delete old chunks, re-index
- **Deleted files** → remove from all tables
- **Unchanged files** → skip entirely

This makes re-indexing fast — only changed files are processed.

### 3. Chunking Strategies

Three strategies based on file type:

#### Code-Aware Chunking (`.ts`, `.js`, `.py`, `.go`, `.rs`, etc.)
Splits on function/class boundaries using regex patterns:
- Function declarations, arrow functions, class definitions
- Method declarations, interfaces, type aliases, enums
- Python `def`/`class`, Go `func`, Rust `fn`/`struct`/`impl`

Falls back to line-based splitting if a chunk exceeds size limits.

#### Markdown Chunking (`.md`, `.mdx`)
Splits on header boundaries (`# H1`, `## H2`, `### H3`), keeping each section as a chunk.

#### Basic Chunking (everything else)
Line-based splitting with ~17 lines per chunk (targeting ~384 tokens) and 3-line overlap between chunks.

All strategies:
- Target ~384 tokens per chunk (~1400 chars)
- Merge tiny chunks (< 100 chars) with neighbors
- Track `startLine` and `endLine` for source mapping

### 4. SQLite FTS5 Full-Text Search

Uses SQLite's FTS5 extension with **trigram tokenizer** for substring matching:

```sql
CREATE VIRTUAL TABLE fts USING fts5(
  path,
  content,
  tokenize = 'trigram'
);
```

**How trigram works:** Text is broken into overlapping 3-character sequences. "function" → "fun", "unc", "nct", "cti", "tio", "ion". This enables substring matching without word boundaries.

**BM25 ranking** with 10x path boost:
```sql
ORDER BY bm25(fts, 10.0)
```
Matches in file paths (e.g., searching "auth" matches `src/auth/middleware.ts`) rank 10x higher than matches in content only.

### 5. Vector Embeddings (Optional)

When an `EmbeddingProvider` is configured:

1. Each chunk's text is sent to the embedding model (batched)
2. Vectors stored in SQLite as JSON arrays
3. Search uses **cosine similarity** computed in-process:

```typescript
cosine_similarity(query_vector, chunk_vector) = dot(a,b) / (|a| * |b|)
```

No external vector database needed — all stored in the same SQLite file.

### 6. Combined Search Pipeline

When `search(query)` is called:

```
query
  ├─ FTS5 search (35% of results)
  │   └─ BM25 ranking with path boost
  │
  ├─ Embedding search (65% of results)
  │   └─ Cosine similarity ranking
  │
  └─ Deduplicate by (path + startLine)
      └─ Return top-k results
```

If no embedding provider is configured, falls back to FTS-only.

## Database Schema

```sql
-- File chunks with line ranges
chunks (
  id INTEGER PRIMARY KEY,
  path TEXT,           -- relative file path
  cacheKey TEXT,       -- SHA-256 hash of file content
  content TEXT,        -- chunk text
  startLine INTEGER,
  endLine INTEGER,
  idx INTEGER          -- chunk index within file
)

-- FTS5 virtual table (trigram tokenizer, BM25 ranking)
fts (path, content)

-- Links FTS entries to chunks
fts_metadata (
  id INTEGER PRIMARY KEY,  -- matches fts rowid
  path TEXT,
  cacheKey TEXT,
  chunkId INTEGER → chunks(id)
)

-- Vector embeddings
embeddings (
  id INTEGER PRIMARY KEY,
  chunkId INTEGER → chunks(id),
  path TEXT,
  cacheKey TEXT,
  vector TEXT,    -- JSON array of floats
  model TEXT      -- embedding model identifier
)

-- Tracks indexed files for incremental updates
index_catalog (
  path TEXT,
  cacheKey TEXT,     -- SHA-256 of file content
  lastUpdated INTEGER,
  directory TEXT
)
```

Storage location: `~/.cdoing/index.sqlite`

## Usage

### As a Tool (`codebase_search`)

The LLM calls this tool to search the codebase:

```
codebase_search({ query: "authentication middleware" })
codebase_search({ query: "sendEmail function", directory: "src/services" })
```

The index is built lazily on first use and refreshed if stale (>1 hour).

### As a Context Provider (`@codebase`)

Users type `@codebase auth middleware` to attach relevant code to their message.

### Programmatic API

```typescript
import { CodebaseIndexer } from "@cdoing/core";

const indexer = new CodebaseIndexer("/path/to/project");

// Index (incremental)
await indexer.index((progress) => {
  console.log(`${progress.phase}: ${progress.message}`);
});

// Search
const results = await indexer.search("authentication", 20);
for (const r of results) {
  console.log(`${r.path}:${r.startLine} (${r.source}, score: ${r.score})`);
  console.log(r.content);
}

// With embeddings
import { CodebaseIndexer, type EmbeddingProvider } from "@cdoing/core";

const embedder: EmbeddingProvider = {
  modelId: "text-embedding-3-small",
  embed: async (texts) => {
    // Call OpenAI/Ollama/etc.
    return vectors;
  },
};

const indexer = new CodebaseIndexer("/path/to/project", embedder);
await indexer.index();
const results = await indexer.search("how does auth work?"); // Uses both FTS + embeddings
```

## Comparison with Continue.dev

| Feature | Cdoing | Continue |
|---|---|---|
| Storage | Single SQLite file | SQLite + LanceDB (separate) |
| FTS | FTS5 with trigram tokenizer | FTS5 with trigram tokenizer |
| BM25 path boost | 10x | 10x |
| Chunking | Regex boundary detection | Tree-sitter AST |
| Code structure | Heuristic (function/class patterns) | Full AST parsing (15+ languages) |
| Embeddings | SQLite JSON + in-process cosine sim | LanceDB native vector search |
| Incremental updates | SHA-256 content hashing | SHA-256 with cross-branch dedup |
| Cross-branch cache | Not yet | Content-addressed global cache |
| Search pipeline | FTS(35%) + Embeddings(65%) | FTS(25%) + Embeddings(50%) + Recent(25%) |
| Dependencies | better-sqlite3 only | better-sqlite3 + LanceDB native |

### Design Trade-offs

**Why SQLite for embeddings instead of LanceDB?**
- Zero additional native dependencies (LanceDB requires platform-specific binaries)
- Single file for all index data
- In-process cosine similarity is fast enough for codebases < 100k chunks
- Simpler deployment and no platform compatibility issues

**Why regex chunking instead of tree-sitter?**
- Tree-sitter requires per-language WASM binaries (~2MB each)
- Regex patterns cover 90% of function/class boundary detection
- Falls back gracefully to line-based chunking
- Much smaller package size

**Future improvements:**
- Add tree-sitter for more accurate code structure analysis
- Add recently-edited file cache as a retrieval source
- Add cross-branch content deduplication
- Add reranking model support for the retrieval pipeline
