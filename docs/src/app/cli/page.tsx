export default function CliPackage() {
  return (
    <div>
      <h1 className="doc-title">CLI Package</h1>
      <p className="doc-subtitle">
        <span className="inline-code">@cdoing/cli</span> — The terminal
        interface with interactive chat, configuration wizard, and multiple
        output formats.
      </p>

      <h2 className="doc-h2">Overview</h2>

      <p className="doc-p">
        The CLI package provides the <span className="inline-code">cdoing</span>{" "}
        command-line tool. It&apos;s built with Commander for argument parsing and
        Ink (React for terminals) for the interactive UI.
      </p>

      <div className="file-tree">{`packages/cli/src/
├── index.ts        # Entry point + argument parsing
├── chat.ts         # Interactive chat loop
├── config.ts       # Configuration + setup wizard
├── tools.ts        # Tool registry creation
├── callbacks.ts    # Output callbacks (text, JSON, stream)
├── commands.ts     # Subcommands (config, init, doctor)
├── help.ts         # Help text
├── history.ts      # Conversation history loading
├── oauth.ts        # OAuth login/logout flow
├── serve.ts        # Serve mode for debuggers
├── review.ts       # Code review integration
└── ui/             # Ink React components`}</div>

      <h2 className="doc-h2">CLI Flags</h2>

      <table className="doc-table">
        <thead>
          <tr>
            <th>Flag</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><span className="inline-code">-m, --model &lt;model&gt;</span></td>
            <td>Model identifier (e.g., claude-sonnet-4-6, gpt-4o)</td>
          </tr>
          <tr>
            <td><span className="inline-code">-p, --provider &lt;name&gt;</span></td>
            <td>LLM provider (anthropic, openai, google, ollama, custom)</td>
          </tr>
          <tr>
            <td><span className="inline-code">--base-url &lt;url&gt;</span></td>
            <td>Custom base URL for API requests</td>
          </tr>
          <tr>
            <td><span className="inline-code">--api-key &lt;key&gt;</span></td>
            <td>API key (overrides stored config)</td>
          </tr>
          <tr>
            <td><span className="inline-code">--mode &lt;mode&gt;</span></td>
            <td>Permission mode</td>
          </tr>
          <tr>
            <td><span className="inline-code">-d, --dir &lt;directory&gt;</span></td>
            <td>Working directory</td>
          </tr>
          <tr>
            <td><span className="inline-code">--login</span></td>
            <td>Start Anthropic OAuth login flow</td>
          </tr>
          <tr>
            <td><span className="inline-code">--logout</span></td>
            <td>Clear stored OAuth tokens</td>
          </tr>
          <tr>
            <td><span className="inline-code">--print</span></td>
            <td>Non-interactive mode (single prompt, exit after response)</td>
          </tr>
          <tr>
            <td><span className="inline-code">-r, --resume &lt;id&gt;</span></td>
            <td>Resume a previous conversation by ID</td>
          </tr>
          <tr>
            <td><span className="inline-code">-c, --continue</span></td>
            <td>Continue the most recent conversation</td>
          </tr>
          <tr>
            <td><span className="inline-code">--max-turns &lt;n&gt;</span></td>
            <td>Limit number of agent turns</td>
          </tr>
          <tr>
            <td><span className="inline-code">--output-format &lt;fmt&gt;</span></td>
            <td>Output format: text, json, stream-json</td>
          </tr>
          <tr>
            <td><span className="inline-code">--verbose</span></td>
            <td>Enable verbose logging</td>
          </tr>
          <tr>
            <td><span className="inline-code">--system-prompt &lt;prompt&gt;</span></td>
            <td>Custom system prompt</td>
          </tr>
          <tr>
            <td><span className="inline-code">--allowed-tools &lt;tools&gt;</span></td>
            <td>Comma-separated list of allowed tools</td>
          </tr>
          <tr>
            <td><span className="inline-code">--disallowed-tools &lt;tools&gt;</span></td>
            <td>Comma-separated list of disallowed tools</td>
          </tr>
        </tbody>
      </table>

      <h2 className="doc-h2">Subcommands</h2>

      <h3 className="doc-h3">cdoing config</h3>
      <p className="doc-p">
        Manage configuration settings from the terminal:
      </p>
      <div className="code-block">{`cdoing config get provider      # Get a config value
cdoing config set provider openai  # Set a config value
cdoing config list              # List all settings`}</div>

      <h3 className="doc-h3">cdoing init</h3>
      <p className="doc-p">
        Initialize a project with a{" "}
        <span className="inline-code">.cdoing/config.md</span> file containing
        project-specific instructions for the agent.
      </p>
      <div className="code-block">cdoing init</div>

      <h3 className="doc-h3">cdoing doctor</h3>
      <p className="doc-p">
        Diagnose setup issues. Checks Node.js version, API key configuration,
        provider connectivity, and tool availability.
      </p>
      <div className="code-block">cdoing doctor</div>

      <h3 className="doc-h3">cdoing completions</h3>
      <p className="doc-p">
        Generate shell completion scripts for bash, zsh, or fish.
      </p>
      <div className="code-block">{`cdoing completions bash >> ~/.bashrc
cdoing completions zsh >> ~/.zshrc`}</div>

      <h2 className="doc-h2">Output Formats</h2>

      <table className="doc-table">
        <thead>
          <tr>
            <th>Format</th>
            <th>Use Case</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><span className="inline-code">text</span></td>
            <td>Interactive use</td>
            <td>Formatted text with colors and markdown rendering</td>
          </tr>
          <tr>
            <td><span className="inline-code">json</span></td>
            <td>Programmatic use</td>
            <td>Single JSON object with the full response</td>
          </tr>
          <tr>
            <td><span className="inline-code">stream-json</span></td>
            <td>Real-time integration</td>
            <td>Newline-delimited JSON objects streamed as they arrive</td>
          </tr>
        </tbody>
      </table>

      <h2 className="doc-h2">Setup Wizard</h2>

      <p className="doc-p">
        On first run, the CLI launches an interactive setup wizard that guides
        you through:
      </p>

      <ul className="feature-list">
        <li>Selecting an LLM provider</li>
        <li>Entering your API key</li>
        <li>Choosing a default model</li>
        <li>Setting the permission mode</li>
        <li>Configuring optional features (indexing, embeddings)</li>
      </ul>

      <p className="doc-p">
        Configuration is persisted to{" "}
        <span className="inline-code">~/.cdoing/config.json</span> and can be
        modified later with{" "}
        <span className="inline-code">cdoing config set</span>.
      </p>

      <h2 className="doc-h2">Dependencies</h2>

      <div className="callout callout-info">
        <div className="callout-title">Key Dependencies</div>
        <strong>commander</strong> (CLI args), <strong>ink</strong> (React for
        terminals), <strong>chalk</strong> (colors), <strong>figlet</strong>{" "}
        (ASCII art), <strong>ora</strong> (spinners), <strong>react</strong>{" "}
        (UI components).
      </div>
    </div>
  );
}
