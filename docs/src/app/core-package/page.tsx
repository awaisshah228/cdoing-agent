export default function CorePackage() {
  return (
    <div>
      <h1 className="doc-title">Core Package</h1>
      <p className="doc-subtitle">
        <span className="inline-code">@cdoing/core</span> — The foundation layer
        containing tools, permissions, sandbox, context providers, indexing, and
        all core infrastructure.
      </p>

      <h2 className="doc-h2">Overview</h2>

      <p className="doc-p">
        The core package is the dependency-free foundation of the entire system.
        It has no internal package dependencies and exports everything needed by
        the ai, cli, and vscode-extension packages.
      </p>

      <div className="file-tree">{`packages/core/src/
├── index.ts                # All exports
├── tools/                  # 21 built-in tools
│   ├── registry.ts         # Central tool registry
│   ├── file-read.ts        # File reading (text, images, PDFs)
│   ├── file-write.ts       # File creation/overwrite
│   ├── file-edit.ts        # Find-and-replace editing
│   ├── multi-edit.ts       # Atomic batch edits
│   ├── file-delete.ts      # Permission-controlled deletion
│   ├── file-run.ts         # Auto-detect & run 14 languages
│   ├── shell-exec.ts       # Shell command execution
│   ├── glob-search.ts      # File pattern matching
│   ├── grep-search.ts      # Content search with regex
│   ├── list-dir.ts         # Directory listing
│   ├── view-repo-map.ts    # Repository tree view
│   ├── view-diff.ts        # Git diff viewer
│   ├── web-fetch.ts        # URL content fetching
│   ├── web-search.ts       # DuckDuckGo search
│   ├── codebase-search.ts  # FTS5 + vector search
│   └── system-info.ts      # Runtime info query
├── permissions/            # Permission engine
│   └── index.ts            # PermissionManager (738 lines)
├── sandbox/                # Filesystem & network sandbox
│   ├── manager.ts          # Orchestrator
│   ├── filesystem.ts       # Path checking
│   ├── network.ts          # Domain allowlisting
│   └── types.ts            # Configuration types
├── context-providers/      # 10 @ mention providers
│   ├── registry.ts         # Provider registry
│   ├── git.ts              # @git context
│   ├── diff.ts             # @diff context
│   └── folder.ts           # @folder context
├── indexing/               # Codebase indexing
│   ├── indexer.ts          # Main orchestration
│   ├── database.ts         # SQLite schema + queries
│   ├── chunker.ts          # Code-aware chunking
│   └── types.ts            # TypeScript interfaces
├── hooks/                  # Pre/post tool hooks
│   └── index.ts
├── rules/                  # Project rules
│   └── manager.ts
├── plan/                   # Plan mode (read-only)
│   └── manager.ts
├── mcp/                    # Model Context Protocol
│   └── manager.ts
├── effort/                 # Effort level control
│   └── index.ts
├── agents/                 # Multi-agent coordination
│   └── coordinator.ts
└── utils/                  # Utilities
    ├── path-safety.ts      # Resolve paths safely
    ├── path-matching.ts    # Glob pattern matching
    ├── shell-paths.ts      # Extract paths from commands
    ├── search-match.ts     # Find + replace, unified diff
    ├── gitignore.ts        # .gitignore loader
    ├── project-config.ts   # Config file loader
    ├── memory.ts           # Conversation memory store
    └── todo.ts             # Task tracking store`}</div>

      <h2 className="doc-h2">Tool Registry</h2>

      <p className="doc-p">
        All 21 tools are managed by the central{" "}
        <span className="inline-code">ToolRegistry</span> which provides:
      </p>

      <ul className="feature-list">
        <li>
          <span className="inline-code">register(tool)</span> — Register a new
          tool instance
        </li>
        <li>
          <span className="inline-code">get(name)</span> — Retrieve a tool by
          name
        </li>
        <li>
          <span className="inline-code">getAll()</span> — Get all registered
          tools
        </li>
        <li>
          <span className="inline-code">execute(name, params)</span> — Run a tool
          with parameters
        </li>
        <li>
          <span className="inline-code">getDefinitions()</span> — Get JSON Schema
          definitions for LLM binding
        </li>
      </ul>

      <p className="doc-p">
        Each tool implements the <span className="inline-code">BaseTool</span>{" "}
        interface with a <span className="inline-code">ToolDefinition</span>{" "}
        (name, description, parameters as JSON Schema) and an{" "}
        <span className="inline-code">execute()</span> method.
      </p>

      <h2 className="doc-h2">Context Providers</h2>

      <p className="doc-p">
        Context providers allow users to inject additional information into the
        conversation using <span className="inline-code">@mentions</span>:
      </p>

      <table className="doc-table">
        <thead>
          <tr>
            <th>Provider</th>
            <th>Trigger</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Terminal</td>
            <td><span className="inline-code">@terminal</span></td>
            <td>Last terminal command output</td>
          </tr>
          <tr>
            <td>Tree</td>
            <td><span className="inline-code">@tree [path] [depth]</span></td>
            <td>Workspace file tree</td>
          </tr>
          <tr>
            <td>URL</td>
            <td><span className="inline-code">@url &lt;url&gt;</span></td>
            <td>Fetch and attach web page content</td>
          </tr>
          <tr>
            <td>Codebase</td>
            <td><span className="inline-code">@codebase &lt;query&gt;</span></td>
            <td>Full-text + semantic search</td>
          </tr>
          <tr>
            <td>Open Files</td>
            <td><span className="inline-code">@open</span></td>
            <td>All open editor files (VS Code only)</td>
          </tr>
          <tr>
            <td>Problems</td>
            <td><span className="inline-code">@problems</span></td>
            <td>File diagnostics/errors (VS Code only)</td>
          </tr>
          <tr>
            <td>Clipboard</td>
            <td><span className="inline-code">@clipboard</span></td>
            <td>Clipboard contents</td>
          </tr>
          <tr>
            <td>File</td>
            <td><span className="inline-code">@file &lt;path&gt;</span></td>
            <td>Include a specific file</td>
          </tr>
          <tr>
            <td>Git</td>
            <td><span className="inline-code">@git</span></td>
            <td>Git context (commits, branch info)</td>
          </tr>
          <tr>
            <td>Diff</td>
            <td><span className="inline-code">@diff</span></td>
            <td>Current working changes</td>
          </tr>
        </tbody>
      </table>

      <h2 className="doc-h2">Indexing System</h2>

      <p className="doc-p">
        The indexing system provides intelligent code search using SQLite FTS5
        for full-text search and optional vector embeddings for semantic search.
      </p>

      <h3 className="doc-h3">How Indexing Works</h3>

      <div className="step">
        <div className="step-number">1</div>
        <div className="step-content">
          <div className="step-title">File Scanning</div>
          <div className="step-desc">
            Scans the workspace respecting .gitignore. Skips node_modules, .git,
            dist, build, and files over 1MB. Supports 40+ file extensions.
          </div>
        </div>
      </div>

      <div className="step">
        <div className="step-number">2</div>
        <div className="step-content">
          <div className="step-title">Incremental Updates (SHA-256)</div>
          <div className="step-desc">
            Content hashing detects changes. New files are chunked and indexed,
            modified files are re-indexed, unchanged files are skipped.
          </div>
        </div>
      </div>

      <div className="step">
        <div className="step-number">3</div>
        <div className="step-content">
          <div className="step-title">Code-Aware Chunking</div>
          <div className="step-desc">
            Code files are split at function/class boundaries. Markdown splits at
            headers. Basic files split at ~17 lines (~384 tokens per chunk).
          </div>
        </div>
      </div>

      <div className="step">
        <div className="step-number">4</div>
        <div className="step-content">
          <div className="step-title">Search Pipeline</div>
          <div className="step-desc">
            FTS5 search (BM25 ranking with 10x path boost) provides 35% of
            results. Vector embedding search provides 65%. Results are
            deduplicated by path + line.
          </div>
        </div>
      </div>

      <h3 className="doc-h3">Database Schema</h3>

      <div className="code-block">{`-- File chunks with line ranges
CREATE TABLE chunks (
  id INTEGER PRIMARY KEY,
  path TEXT NOT NULL,
  content TEXT NOT NULL,
  startLine INTEGER,
  endLine INTEGER,
  hash TEXT NOT NULL
);

-- FTS5 virtual table (trigram tokenizer, BM25)
CREATE VIRTUAL TABLE fts USING fts5(
  path, content, tokenize='trigram'
);

-- Vector embeddings (JSON storage)
CREATE TABLE embeddings (
  chunk_id INTEGER REFERENCES chunks(id),
  vector TEXT NOT NULL  -- JSON array
);

-- Incremental index tracking
CREATE TABLE index_catalog (
  path TEXT PRIMARY KEY,
  hash TEXT NOT NULL,
  indexed_at TEXT
);`}</div>

      <h2 className="doc-h2">Utilities</h2>

      <table className="doc-table">
        <thead>
          <tr>
            <th>Utility</th>
            <th>Purpose</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><span className="inline-code">path-safety.ts</span></td>
            <td>Resolve paths safely, prevent directory traversal escape</td>
          </tr>
          <tr>
            <td><span className="inline-code">path-matching.ts</span></td>
            <td>Glob pattern matching for permission rules</td>
          </tr>
          <tr>
            <td><span className="inline-code">shell-paths.ts</span></td>
            <td>Extract file paths from shell commands for permission checking</td>
          </tr>
          <tr>
            <td><span className="inline-code">search-match.ts</span></td>
            <td>Find-and-replace engine with unified diff support</td>
          </tr>
          <tr>
            <td><span className="inline-code">gitignore.ts</span></td>
            <td>Parse and apply .gitignore patterns</td>
          </tr>
          <tr>
            <td><span className="inline-code">project-config.ts</span></td>
            <td>Load project configuration files</td>
          </tr>
          <tr>
            <td><span className="inline-code">memory.ts</span></td>
            <td>Persistent conversation memory storage</td>
          </tr>
          <tr>
            <td><span className="inline-code">todo.ts</span></td>
            <td>Task tracking with status management</td>
          </tr>
        </tbody>
      </table>

      <h2 className="doc-h2">External Dependencies</h2>

      <div className="callout callout-info">
        <div className="callout-title">Minimal Dependencies</div>
        The core package deliberately keeps its external dependency count low:
        <strong> better-sqlite3</strong> (database),{" "}
        <strong>chalk</strong> (colors),{" "}
        <strong>glob</strong> (file patterns),{" "}
        <strong>minimatch</strong> (glob matching).
      </div>
    </div>
  );
}
