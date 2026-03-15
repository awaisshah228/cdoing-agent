export default function VscodeExtension() {
  return (
    <div>
      <h1 className="doc-title">VS Code Extension</h1>
      <p className="doc-subtitle">
        <span className="inline-code">cdoing-vscode</span> — Full-featured VS
        Code extension with sidebar chat, editor panel, inline editing, and
        autocomplete.
      </p>

      <h2 className="doc-h2">Overview</h2>

      <p className="doc-p">
        The VS Code extension brings the Cdoing Agent directly into the editor
        with a React-based webview UI. It supports all the same tools and
        capabilities as the CLI but with tight IDE integration.
      </p>

      <div className="file-tree">{`packages/vscode-extension/src/
├── extension.ts              # Activation + command registration
├── chat-panel-provider.ts    # Webview panel + agent runner
├── inline-edit.ts            # Cmd+I inline editing
├── inline-autocomplete.ts    # Ghost text suggestions
├── webview-content.ts        # HTML template
└── webview/
    ├── components/
    │   ├── ChatPanel.tsx      # Main chat interface
    │   ├── InputArea.tsx      # Message input
    │   └── SettingsPanel.tsx  # Extension settings UI
    ├── hooks/
    │   └── useChatState.ts    # Chat state management
    ├── styles/
    │   └── chat.css           # Chat styling
    └── types.ts               # TypeScript types`}</div>

      <h2 className="doc-h2">Features</h2>

      <div className="card-grid">
        <div className="card">
          <div className="card-icon">&#128172;</div>
          <div className="card-title">Sidebar Chat</div>
          <div className="card-desc">
            Chat panel in the left activity bar. Persistent across editor sessions.
          </div>
        </div>
        <div className="card">
          <div className="card-icon">&#128196;</div>
          <div className="card-title">Editor Panel</div>
          <div className="card-desc">
            Open the agent beside your code with Cmd+Shift+L for side-by-side work.
          </div>
        </div>
        <div className="card">
          <div className="card-icon">&#9999;</div>
          <div className="card-title">Inline Editing</div>
          <div className="card-desc">
            Press Cmd+I to edit selected code inline with AI assistance.
          </div>
        </div>
        <div className="card">
          <div className="card-icon">&#128171;</div>
          <div className="card-title">Autocomplete</div>
          <div className="card-desc">
            Ghost text suggestions as you type, powered by the AI model.
          </div>
        </div>
      </div>

      <h2 className="doc-h2">Commands</h2>

      <table className="doc-table">
        <thead>
          <tr>
            <th>Command</th>
            <th>Keybinding</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><span className="inline-code">cdoing.newChat</span></td>
            <td>—</td>
            <td>Create a new chat tab</td>
          </tr>
          <tr>
            <td><span className="inline-code">cdoing.openEditorPanel</span></td>
            <td>Cmd+Shift+L</td>
            <td>Open agent panel beside editor</td>
          </tr>
          <tr>
            <td><span className="inline-code">cdoing.selectModel</span></td>
            <td>—</td>
            <td>Change the active model</td>
          </tr>
          <tr>
            <td><span className="inline-code">cdoing.sendSelection</span></td>
            <td>Cmd+Shift+Enter</td>
            <td>Send selected code to the agent</td>
          </tr>
          <tr>
            <td><span className="inline-code">cdoing.explainSelection</span></td>
            <td>Context menu</td>
            <td>Ask the agent to explain selected code</td>
          </tr>
          <tr>
            <td><span className="inline-code">cdoing.refactorSelection</span></td>
            <td>Context menu</td>
            <td>Ask the agent to refactor selected code</td>
          </tr>
          <tr>
            <td><span className="inline-code">cdoing.fixSelection</span></td>
            <td>Context menu</td>
            <td>Ask the agent to fix selected code</td>
          </tr>
          <tr>
            <td><span className="inline-code">cdoing.openFile</span></td>
            <td>—</td>
            <td>Ask about a specific file</td>
          </tr>
          <tr>
            <td><span className="inline-code">cdoing.addToChat</span></td>
            <td>—</td>
            <td>Add current selection to chat context</td>
          </tr>
        </tbody>
      </table>

      <h2 className="doc-h2">VS Code Settings</h2>

      <p className="doc-p">
        Configure the extension through VS Code Settings (search for
        &quot;cdoing&quot;):
      </p>

      <table className="doc-table">
        <thead>
          <tr>
            <th>Setting</th>
            <th>Type</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><span className="inline-code">cdoing.provider</span></td>
            <td>anthropic | openai | google | custom</td>
            <td>LLM provider to use</td>
          </tr>
          <tr>
            <td><span className="inline-code">cdoing.model</span></td>
            <td>string</td>
            <td>Model identifier</td>
          </tr>
          <tr>
            <td><span className="inline-code">cdoing.customProviderName</span></td>
            <td>string</td>
            <td>Display name for custom providers</td>
          </tr>
          <tr>
            <td><span className="inline-code">cdoing.customBaseURL</span></td>
            <td>string</td>
            <td>Base URL for custom provider API</td>
          </tr>
          <tr>
            <td><span className="inline-code">cdoing.apiKey</span></td>
            <td>string</td>
            <td>API key for the selected provider</td>
          </tr>
          <tr>
            <td><span className="inline-code">cdoing.temperature</span></td>
            <td>number</td>
            <td>Model temperature (default: 0)</td>
          </tr>
          <tr>
            <td><span className="inline-code">cdoing.maxTokens</span></td>
            <td>number</td>
            <td>Max output tokens (default: 8096)</td>
          </tr>
          <tr>
            <td><span className="inline-code">cdoing.permissionMode</span></td>
            <td>ask | auto-edit | auto</td>
            <td>Permission handling mode</td>
          </tr>
        </tbody>
      </table>

      <h2 className="doc-h2">Architecture</h2>

      <div className="arch-diagram">{`
  ┌─────────────────────────────────────────────┐
  │                VS Code Host                  │
  │                                              │
  │  ┌────────────────────────────────────────┐  │
  │  │  extension.ts                          │  │
  │  │  • Registers commands                  │  │
  │  │  • Creates chat panel provider         │  │
  │  │  • Handles inline edit/autocomplete    │  │
  │  └────────────────┬───────────────────────┘  │
  │                   │                          │
  │  ┌────────────────▼───────────────────────┐  │
  │  │  chat-panel-provider.ts                │  │
  │  │  • Creates webview (React app)         │  │
  │  │  • Runs agent (from @cdoing/ai)        │  │
  │  │  • Bridges webview ↔ agent messages    │  │
  │  └────────────────┬───────────────────────┘  │
  │                   │                          │
  │  ┌────────────────▼───────────────────────┐  │
  │  │  Webview (React)                       │  │
  │  │  • ChatPanel.tsx (messages, streaming) │  │
  │  │  • InputArea.tsx (compose + send)      │  │
  │  │  • SettingsPanel.tsx (configuration)   │  │
  │  └────────────────────────────────────────┘  │
  └─────────────────────────────────────────────┘
      `}</div>

      <h2 className="doc-h2">Development</h2>

      <div className="step">
        <div className="step-number">1</div>
        <div className="step-content">
          <div className="step-title">Build dependencies first</div>
          <div className="code-block">{`cd cdoing-agent
yarn build`}</div>
        </div>
      </div>

      <div className="step">
        <div className="step-number">2</div>
        <div className="step-content">
          <div className="step-title">Build the extension</div>
          <div className="code-block">{`cd packages/vscode-extension
npm run build`}</div>
        </div>
      </div>

      <div className="step">
        <div className="step-number">3</div>
        <div className="step-content">
          <div className="step-title">Launch Extension Development Host</div>
          <div className="step-desc">
            Open <span className="inline-code">packages/vscode-extension</span>{" "}
            in VS Code and press <strong>F5</strong>. A new VS Code window will
            open with the extension loaded.
          </div>
        </div>
      </div>

      <div className="step">
        <div className="step-number">4</div>
        <div className="step-content">
          <div className="step-title">Watch mode for development</div>
          <div className="code-block">npm run watch</div>
          <div className="step-desc">
            Uses esbuild in watch mode for fast rebuilds during development.
          </div>
        </div>
      </div>

      <div className="callout callout-tip">
        <div className="callout-title">Hot Reload</div>
        After making changes, use <strong>Cmd+Shift+P</strong> → &quot;Developer:
        Reload Webviews&quot; to refresh the chat panel without restarting the
        extension host.
      </div>
    </div>
  );
}
