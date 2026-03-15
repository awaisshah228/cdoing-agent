export default function GettingStarted() {
  return (
    <div>
      <h1 className="doc-title">Getting Started</h1>
      <p className="doc-subtitle">
        Set up the Cdoing Agent development environment and start coding in
        minutes.
      </p>

      <h2 className="doc-h2">Prerequisites</h2>

      <ul className="feature-list">
        <li>
          <strong>Node.js</strong> &ge; 18.0.0
        </li>
        <li>
          <strong>Yarn</strong> (workspace-based monorepo)
        </li>
        <li>
          <strong>Git</strong> for version control
        </li>
        <li>
          An API key from at least one LLM provider (Anthropic, OpenAI, Google,
          or a local Ollama instance)
        </li>
      </ul>

      <h2 className="doc-h2">Installation</h2>

      <div className="step">
        <div className="step-number">1</div>
        <div className="step-content">
          <div className="step-title">Clone the repository</div>
          <div className="code-block">
            git clone https://github.com/your-org/cdoing-agent.git{"\n"}cd
            cdoing-agent
          </div>
        </div>
      </div>

      <div className="step">
        <div className="step-number">2</div>
        <div className="step-content">
          <div className="step-title">Install dependencies</div>
          <div className="code-block">yarn install</div>
        </div>
      </div>

      <div className="step">
        <div className="step-number">3</div>
        <div className="step-content">
          <div className="step-title">Build all packages</div>
          <div className="code-block">yarn build</div>
          <p className="step-desc">
            This runs Turbo to build packages in dependency order: core &rarr; ai
            &rarr; cli / vscode-extension.
          </p>
        </div>
      </div>

      <div className="step">
        <div className="step-number">4</div>
        <div className="step-content">
          <div className="step-title">Configure your API key</div>
          <div className="code-block">yarn start</div>
          <p className="step-desc">
            On first run, the CLI setup wizard will ask you to select a provider
            and enter your API key. Configuration is saved to{" "}
            <span className="inline-code">~/.cdoing/config.json</span>.
          </p>
        </div>
      </div>

      <h2 className="doc-h2">Configuration</h2>

      <p className="doc-p">
        The main configuration file lives at{" "}
        <span className="inline-code">~/.cdoing/config.json</span>:
      </p>

      <div className="code-block">{`{
  "provider": "anthropic",
  "model": "claude-sonnet-4-6",
  "apiKeys": {
    "anthropic": "sk-ant-...",
    "openai": "sk-...",
    "google": "AIza..."
  },
  "mode": "default",
  "indexer": {
    "autoIndex": true,
    "embeddingProvider": "openai",
    "embeddingModel": "text-embedding-3-small"
  }
}`}</div>

      <h3 className="doc-h3">Configuration Options</h3>

      <table className="doc-table">
        <thead>
          <tr>
            <th>Option</th>
            <th>Description</th>
            <th>Default</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <span className="inline-code">provider</span>
            </td>
            <td>LLM provider to use</td>
            <td>anthropic</td>
          </tr>
          <tr>
            <td>
              <span className="inline-code">model</span>
            </td>
            <td>Model identifier</td>
            <td>claude-sonnet-4-6</td>
          </tr>
          <tr>
            <td>
              <span className="inline-code">apiKeys</span>
            </td>
            <td>Map of provider name to API key</td>
            <td>-</td>
          </tr>
          <tr>
            <td>
              <span className="inline-code">mode</span>
            </td>
            <td>Permission mode (default, acceptEdits, plan, dontAsk, bypassPermissions)</td>
            <td>default</td>
          </tr>
          <tr>
            <td>
              <span className="inline-code">baseUrl</span>
            </td>
            <td>Custom base URL for API requests</td>
            <td>-</td>
          </tr>
          <tr>
            <td>
              <span className="inline-code">indexer.autoIndex</span>
            </td>
            <td>Automatically index codebase on start</td>
            <td>true</td>
          </tr>
        </tbody>
      </table>

      <h2 className="doc-h2">Development Mode</h2>

      <p className="doc-p">
        For active development with hot-reload across all packages:
      </p>

      <div className="code-block">yarn dev</div>

      <p className="doc-p">
        This runs all packages in watch mode using Turbo, so changes to core
        automatically rebuild dependent packages.
      </p>

      <h2 className="doc-h2">Running the CLI</h2>

      <div className="code-block">{`# Interactive mode (default)
yarn start

# With a specific prompt
yarn start -- -p "explain this code"

# Non-interactive / print mode
yarn start -- --print "list all files"

# Resume a previous conversation
yarn start -- --continue

# Use a different model
yarn start -- -m gpt-4o -p openai`}</div>

      <h2 className="doc-h2">VS Code Extension</h2>

      <div className="step">
        <div className="step-number">1</div>
        <div className="step-content">
          <div className="step-title">Build the extension</div>
          <div className="code-block">{`cd packages/vscode-extension
npm run build`}</div>
        </div>
      </div>

      <div className="step">
        <div className="step-number">2</div>
        <div className="step-content">
          <div className="step-title">Launch in VS Code</div>
          <p className="step-desc">
            Open the <span className="inline-code">packages/vscode-extension</span> folder
            in VS Code and press <strong>F5</strong> to launch the Extension
            Development Host.
          </p>
        </div>
      </div>

      <div className="step">
        <div className="step-number">3</div>
        <div className="step-content">
          <div className="step-title">Configure settings</div>
          <p className="step-desc">
            Open VS Code Settings and search for{" "}
            <span className="inline-code">cdoing</span> to set your provider, API
            key, and permission mode.
          </p>
        </div>
      </div>

      <div className="callout callout-tip">
        <div className="callout-title">Tip</div>
        Use <span className="inline-code">Cmd+Shift+L</span> to open the Cdoing
        Agent editor panel alongside your code.
      </div>
    </div>
  );
}
