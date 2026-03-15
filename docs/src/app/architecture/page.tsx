export default function Architecture() {
  return (
    <div>
      <h1 className="doc-title">Architecture Overview</h1>
      <p className="doc-subtitle">
        How Cdoing Agent is structured as a modular monorepo and how all the
        pieces connect.
      </p>

      <h2 className="doc-h2" id="project-structure">
        Project Structure
      </h2>

      <div className="file-tree">{`cdoing-agent/
├── package.json            # Workspace root (Yarn workspaces)
├── turbo.json              # Turbo build orchestration
├── tsconfig.json           # Shared TypeScript config
│
├── packages/
│   ├── core/               # @cdoing/core — Foundation layer
│   │   ├── src/
│   │   │   ├── tools/          # 21 built-in tools
│   │   │   ├── permissions/    # Permission engine
│   │   │   ├── sandbox/        # FS & network sandbox
│   │   │   ├── context-providers/  # 10 @ mention providers
│   │   │   ├── indexing/       # SQLite FTS5 + vectors
│   │   │   ├── hooks/          # Pre/post tool hooks
│   │   │   ├── rules/          # Glob-scoped project rules
│   │   │   ├── plan/           # Read-only plan mode
│   │   │   ├── mcp/            # Model Context Protocol
│   │   │   ├── effort/         # Effort level control
│   │   │   ├── agents/         # Multi-agent coordinator
│   │   │   └── utils/          # Path safety, search, etc.
│   │   └── package.json
│   │
│   ├── ai/                 # @cdoing/ai — Intelligence layer
│   │   ├── src/
│   │   │   ├── agent-runner.ts    # Agentic loop + streaming
│   │   │   ├── provider.ts       # Multi-LLM factory
│   │   │   ├── system-prompt.ts   # Prompt builder
│   │   │   └── context-manager.ts # Token tracking + cost
│   │   └── package.json
│   │
│   ├── cli/                # @cdoing/cli — Terminal UI
│   │   ├── src/
│   │   │   ├── index.ts          # Entry point + args
│   │   │   ├── chat.ts           # Interactive chat
│   │   │   ├── config.ts         # Setup wizard
│   │   │   ├── tools.ts          # Tool registry setup
│   │   │   ├── commands.ts       # Subcommands
│   │   │   ├── oauth.ts          # OAuth login flow
│   │   │   └── ui/               # Ink React components
│   │   └── package.json
│   │
│   └── vscode-extension/   # cdoing-vscode — VS Code UI
│       ├── src/
│       │   ├── extension.ts          # Activation + commands
│       │   ├── chat-panel-provider.ts # Webview + agent
│       │   ├── inline-edit.ts        # Cmd+I editing
│       │   ├── inline-autocomplete.ts # Ghost text
│       │   └── webview/              # React chat UI
│       └── package.json
│
└── docs/                   # This documentation site`}</div>

      <h2 className="doc-h2">Package Dependency Graph</h2>

      <div className="arch-diagram">{`
               ┌──────────────┐     ┌─────────────────────┐
               │  @cdoing/cli │     │  cdoing-vscode       │
               │  (Terminal)  │     │  (VS Code Extension) │
               └──────┬───────┘     └──────────┬───────────┘
                      │                        │
                      └────────┬───────────────┘
                               │
                               ▼
                      ┌────────────────┐
                      │   @cdoing/ai   │
                      │  (Agent Loop)  │
                      └────────┬───────┘
                               │
                               ▼
                      ┌────────────────┐
                      │  @cdoing/core  │
                      │  (Foundation)  │
                      └────────────────┘
      `}</div>

      <p className="doc-p">
        The dependency graph is strictly layered. The{" "}
        <strong>core</strong> package has no internal dependencies. The{" "}
        <strong>ai</strong> package depends only on core. Both{" "}
        <strong>cli</strong> and <strong>vscode-extension</strong> depend on ai
        and core.
      </p>

      <h2 className="doc-h2">Build System</h2>

      <p className="doc-p">
        The project uses <strong>Turbo</strong> for build orchestration across
        the Yarn workspace monorepo. Key build commands:
      </p>

      <table className="doc-table">
        <thead>
          <tr>
            <th>Command</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><span className="inline-code">yarn build</span></td>
            <td>Build all packages via Turbo (respects dependency order)</td>
          </tr>
          <tr>
            <td><span className="inline-code">yarn dev</span></td>
            <td>Watch mode for all packages (persistent, no cache)</td>
          </tr>
          <tr>
            <td><span className="inline-code">yarn start</span></td>
            <td>Build core + ai, then run CLI</td>
          </tr>
          <tr>
            <td><span className="inline-code">yarn clean</span></td>
            <td>Remove all dist/ directories</td>
          </tr>
        </tbody>
      </table>

      <p className="doc-p">
        Each package compiles TypeScript to CommonJS (ES2022 target) with
        declaration files. Build outputs go to{" "}
        <span className="inline-code">dist/</span> in each package.
      </p>

      <h2 className="doc-h2" id="data-flow">
        Data Flow: The Agentic Loop
      </h2>

      <p className="doc-p">
        The core runtime is an <strong>agentic loop</strong> that continuously
        cycles between the LLM and tool execution until the task is complete:
      </p>

      <div className="arch-diagram">{`
  User Message
       │
       ▼
  ┌─────────────────────────────────────────┐
  │           System Prompt Builder          │
  │  (permissions, tools, context providers) │
  └─────────────────────┬───────────────────┘
                        │
                        ▼
  ┌─────────────────────────────────────────┐
  │              LLM Provider               │
  │  (Anthropic / OpenAI / Google / Ollama) │
  └─────────────────────┬───────────────────┘
                        │
              ┌─────────┴─────────┐
              │                   │
         Text Response       Tool Calls
              │                   │
              ▼                   ▼
        Return to User    ┌──────────────┐
                          │  Pre-Hooks   │
                          └──────┬───────┘
                                 │
                                 ▼
                          ┌──────────────┐
                          │  Permission  │
                          │   Check      │
                          └──────┬───────┘
                                 │
                          ┌──────┴───────┐
                          │ Approved?    │
                          │  Yes    No   │
                          └──┬───────┬───┘
                             │       │
                             ▼       ▼
                       ┌──────┐  Return
                       │ Tool │  Denied
                       │ Exec │  Error
                       └──┬───┘
                          │
                          ▼
                    ┌──────────┐
                    │ Post-Hooks│
                    └─────┬────┘
                          │
                          ▼
                   Feed result back
                   to LLM (loop)
      `}</div>

      <h2 className="doc-h2">Key Architectural Decisions</h2>

      <h3 className="doc-h3">1. Raw JSON Schema for Tool Binding</h3>
      <p className="doc-p">
        Tools are bound to the LLM using raw JSON Schema definitions rather than
        Zod or other schema libraries. This keeps the core package dependency-free
        from validation libraries and ensures maximum compatibility across LLM
        providers.
      </p>

      <h3 className="doc-h3">2. SQLite for Indexing (No External DB)</h3>
      <p className="doc-p">
        The codebase indexer uses SQLite with FTS5 for full-text search and stores
        vector embeddings as JSON. This eliminates the need for an external vector
        database like Pinecone or Weaviate, keeping the system self-contained.
      </p>

      <h3 className="doc-h3">3. LangChain for Provider Abstraction</h3>
      <p className="doc-p">
        The AI package uses <span className="inline-code">@langchain/core</span>{" "}
        as a thin abstraction layer over multiple LLM providers. This allows
        switching between Anthropic, OpenAI, Google, and Ollama with minimal code
        changes.
      </p>

      <h3 className="doc-h3">4. Permissions as a First-Class Concern</h3>
      <p className="doc-p">
        Every tool execution passes through the permission engine before running.
        The 3-tier deny/ask/allow rule system with settings hierarchy ensures
        security without sacrificing usability.
      </p>

      <h3 className="doc-h3">5. Incremental Indexing with Content Hashing</h3>
      <p className="doc-p">
        The indexer uses SHA-256 content hashing to detect changes. Only modified
        files are re-chunked and re-indexed, making subsequent indexing runs fast
        even on large codebases.
      </p>

      <h2 className="doc-h2">Technology Stack</h2>

      <table className="doc-table">
        <thead>
          <tr>
            <th>Layer</th>
            <th>Technology</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Language</td>
            <td>TypeScript (ES2022, CommonJS output)</td>
          </tr>
          <tr>
            <td>Monorepo</td>
            <td>Yarn Workspaces + Turbo</td>
          </tr>
          <tr>
            <td>LLM Abstraction</td>
            <td>LangChain (@langchain/core, @langchain/anthropic, etc.)</td>
          </tr>
          <tr>
            <td>Database</td>
            <td>SQLite (better-sqlite3) with FTS5</td>
          </tr>
          <tr>
            <td>CLI Framework</td>
            <td>Commander + Ink (React for terminals)</td>
          </tr>
          <tr>
            <td>VS Code UI</td>
            <td>React + esbuild (webview)</td>
          </tr>
          <tr>
            <td>File Matching</td>
            <td>glob + minimatch</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
