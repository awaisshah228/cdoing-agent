import Link from "next/link";

export default function Home() {
  return (
    <div>
      <div className="hero">
        <h1 className="hero-title">
          <span className="gradient">Cdoing Agent</span>
          <br />
          Developer Docs
        </h1>
        <p className="hero-subtitle">
          A production-grade, open-source AI coding agent with multi-provider
          LLM support, 21 built-in tools, and both CLI and VS Code interfaces.
        </p>
        <div className="hero-buttons">
          <Link href="/getting-started" className="btn-primary">
            Get Started
          </Link>
          <Link href="/architecture" className="btn-secondary">
            Architecture
          </Link>
        </div>
      </div>

      <h2 className="doc-h2">Explore the Documentation</h2>

      <div className="card-grid">
        <Link href="/getting-started" className="card">
          <div className="card-icon">&#9889;</div>
          <div className="card-title">Getting Started</div>
          <div className="card-desc">
            Installation, configuration, and running your first session with the
            CLI or VS Code extension.
          </div>
        </Link>

        <Link href="/architecture" className="card">
          <div className="card-icon">&#9878;</div>
          <div className="card-title">Architecture</div>
          <div className="card-desc">
            Monorepo structure, package dependencies, data flow, and how all
            the pieces fit together.
          </div>
        </Link>

        <Link href="/core-package" className="card">
          <div className="card-icon">&#9881;</div>
          <div className="card-title">Core Package</div>
          <div className="card-desc">
            Tools, permissions, sandbox, context providers, indexing, hooks,
            rules, and utilities.
          </div>
        </Link>

        <Link href="/tools" className="card">
          <div className="card-icon">&#128295;</div>
          <div className="card-title">Tools System</div>
          <div className="card-desc">
            All 21 built-in tools: file ops, search, shell execution, web
            access, code verification, and more.
          </div>
        </Link>

        <Link href="/ai-package" className="card">
          <div className="card-icon">&#129302;</div>
          <div className="card-title">AI Package</div>
          <div className="card-desc">
            Agent runner, LLM providers (Anthropic, OpenAI, Google, Ollama),
            context management, and streaming.
          </div>
        </Link>

        <Link href="/cli" className="card">
          <div className="card-icon">&#128187;</div>
          <div className="card-title">CLI Package</div>
          <div className="card-desc">
            Terminal interface, interactive chat, commands, configuration
            wizard, and output formats.
          </div>
        </Link>

        <Link href="/vscode-extension" className="card">
          <div className="card-icon">&#128640;</div>
          <div className="card-title">VS Code Extension</div>
          <div className="card-desc">
            Sidebar chat, editor panel, inline editing, autocomplete, and
            context menu integrations.
          </div>
        </Link>

        <Link href="/permissions" className="card">
          <div className="card-icon">&#128274;</div>
          <div className="card-title">Permissions & Sandbox</div>
          <div className="card-desc">
            5 permission modes, rule engine, filesystem sandboxing, network
            domain allowlists, and settings.
          </div>
        </Link>

        <Link href="/contributing" className="card">
          <div className="card-icon">&#129309;</div>
          <div className="card-title">Contributing Guide</div>
          <div className="card-desc">
            How to set up the dev environment, add tools, write tests, submit
            PRs, and follow the code style.
          </div>
        </Link>
      </div>

      <h2 className="doc-h2">Key Features</h2>

      <ul className="feature-list">
        <li>
          <strong>21 Built-in Tools</strong> — File operations, search, shell
          execution, web access, code verification, and more
        </li>
        <li>
          <strong>Multi-Provider LLM Support</strong> — Anthropic Claude, OpenAI
          GPT, Google Gemini, Ollama, and custom providers
        </li>
        <li>
          <strong>Advanced Permission System</strong> — 5 modes with
          deny/ask/allow rule engine and 3-tier settings hierarchy
        </li>
        <li>
          <strong>Filesystem & Network Sandbox</strong> — Configurable read/write
          restrictions and domain allowlisting
        </li>
        <li>
          <strong>Full-Text + Vector Search</strong> — SQLite FTS5 with BM25
          ranking and optional embedding-based semantic search
        </li>
        <li>
          <strong>10 Context Providers</strong> — @terminal, @tree, @url,
          @codebase, @git, @diff, @file, @clipboard, @open, @problems
        </li>
        <li>
          <strong>CLI + VS Code</strong> — Feature-rich terminal interface and
          full VS Code extension with sidebar, inline edits, and autocomplete
        </li>
        <li>
          <strong>Modular Monorepo</strong> — Clean separation of concerns across
          core, ai, cli, and vscode-extension packages
        </li>
      </ul>

      <h2 className="doc-h2">Quick Architecture Overview</h2>

      <div className="arch-diagram">{`
  ┌─────────────────────────────────────────────────────┐
  │                   User Interfaces                    │
  │  ┌──────────────────┐   ┌────────────────────────┐  │
  │  │   CLI (Terminal)  │   │  VS Code Extension     │  │
  │  │  @cdoing/cli      │   │  cdoing-vscode         │  │
  │  └────────┬─────────┘   └──────────┬─────────────┘  │
  │           │                        │                 │
  │           └────────┬───────────────┘                 │
  │                    ▼                                 │
  │  ┌─────────────────────────────────────────────┐    │
  │  │             AI Package (@cdoing/ai)          │    │
  │  │  Agent Runner │ Providers │ Context Manager  │    │
  │  └──────────────────────┬──────────────────────┘    │
  │                         ▼                            │
  │  ┌─────────────────────────────────────────────┐    │
  │  │           Core Package (@cdoing/core)        │    │
  │  │  21 Tools │ Permissions │ Sandbox │ Indexing │    │
  │  │  Context Providers │ Hooks │ Rules │ MCP     │    │
  │  └─────────────────────────────────────────────┘    │
  └─────────────────────────────────────────────────────┘
      `}</div>
    </div>
  );
}
