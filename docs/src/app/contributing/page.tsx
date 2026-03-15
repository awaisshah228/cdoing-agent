export default function Contributing() {
  return (
    <div>
      <h1 className="doc-title">Contributing Guide</h1>
      <p className="doc-subtitle">
        How to set up the development environment, add features, write tests,
        and submit pull requests.
      </p>

      <h2 className="doc-h2">Development Setup</h2>

      <div className="step">
        <div className="step-number">1</div>
        <div className="step-content">
          <div className="step-title">Fork and clone</div>
          <div className="code-block">{`git clone https://github.com/YOUR_USERNAME/cdoing-agent.git
cd cdoing-agent`}</div>
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
        </div>
      </div>

      <div className="step">
        <div className="step-number">4</div>
        <div className="step-content">
          <div className="step-title">Start development mode</div>
          <div className="code-block">yarn dev</div>
          <div className="step-desc">
            Runs all packages in watch mode with Turbo. Changes to any package
            automatically rebuild dependents.
          </div>
        </div>
      </div>

      <div className="step">
        <div className="step-number">5</div>
        <div className="step-content">
          <div className="step-title">Test your changes</div>
          <div className="code-block">yarn start</div>
          <div className="step-desc">
            Builds core + ai and launches the CLI for manual testing.
          </div>
        </div>
      </div>

      <h2 className="doc-h2">Project Architecture at a Glance</h2>

      <div className="callout callout-info">
        <div className="callout-title">Key Principle</div>
        Dependencies flow <strong>one way</strong>: core &larr; ai &larr; cli / vscode.
        Never import from a higher-level package into a lower-level one.
      </div>

      <table className="doc-table">
        <thead>
          <tr>
            <th>Package</th>
            <th>When to Modify</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><span className="inline-code">@cdoing/core</span></td>
            <td>Adding tools, changing permissions/sandbox, new context providers, indexing improvements</td>
          </tr>
          <tr>
            <td><span className="inline-code">@cdoing/ai</span></td>
            <td>LLM provider changes, agent loop behavior, prompt engineering, context management</td>
          </tr>
          <tr>
            <td><span className="inline-code">@cdoing/cli</span></td>
            <td>CLI commands, terminal UI, configuration, output formats</td>
          </tr>
          <tr>
            <td><span className="inline-code">cdoing-vscode</span></td>
            <td>VS Code commands, webview UI, inline editing, autocomplete</td>
          </tr>
        </tbody>
      </table>

      <h2 className="doc-h2">Common Contribution Types</h2>

      <h3 className="doc-h3">Adding a New Tool</h3>

      <p className="doc-p">
        This is one of the most common contributions. Follow these steps:
      </p>

      <div className="step">
        <div className="step-number">1</div>
        <div className="step-content">
          <div className="step-title">
            Create <span className="inline-code">packages/core/src/tools/my-tool.ts</span>
          </div>
          <div className="code-block">{`import { BaseTool, ToolDefinition } from "./registry";

export class MyTool extends BaseTool {
  definition: ToolDefinition = {
    name: "my_tool",
    description: "Clear description of what this tool does",
    parameters: {
      type: "object",
      properties: {
        input: {
          type: "string",
          description: "What this parameter is for",
        },
      },
      required: ["input"],
    },
  };

  async execute(params: { input: string }): Promise<string> {
    // Your implementation here
    // Always return a string result
    return "Tool result";
  }
}`}</div>
        </div>
      </div>

      <div className="step">
        <div className="step-number">2</div>
        <div className="step-content">
          <div className="step-title">Export from core index</div>
          <div className="step-desc">
            Add <span className="inline-code">export {`{ MyTool }`} from &quot;./tools/my-tool&quot;;</span>{" "}
            to <span className="inline-code">packages/core/src/index.ts</span>.
          </div>
        </div>
      </div>

      <div className="step">
        <div className="step-number">3</div>
        <div className="step-content">
          <div className="step-title">Register in CLI tools</div>
          <div className="step-desc">
            Add your tool to the registry in{" "}
            <span className="inline-code">packages/cli/src/tools.ts</span>.
          </div>
        </div>
      </div>

      <div className="step">
        <div className="step-number">4</div>
        <div className="step-content">
          <div className="step-title">Register in VS Code extension</div>
          <div className="step-desc">
            Add your tool to{" "}
            <span className="inline-code">packages/vscode-extension/src/chat-panel-provider.ts</span>.
          </div>
        </div>
      </div>

      <h3 className="doc-h3">Adding a Context Provider</h3>

      <div className="step">
        <div className="step-number">1</div>
        <div className="step-content">
          <div className="step-title">
            Create <span className="inline-code">packages/core/src/context-providers/my-provider.ts</span>
          </div>
          <div className="code-block">{`import { ContextProvider } from "./registry";

export class MyProvider implements ContextProvider {
  trigger = "@mycontext";
  description = "Provides custom context";

  async resolve(args: string): Promise<string> {
    // Fetch and return the context
    return "Context content here";
  }

  getSuggestions(partial: string): string[] {
    return ["@mycontext option1", "@mycontext option2"];
  }
}`}</div>
        </div>
      </div>

      <div className="step">
        <div className="step-number">2</div>
        <div className="step-content">
          <div className="step-title">Register in the context registry</div>
          <div className="step-desc">
            Add your provider to the registry in the context providers module.
          </div>
        </div>
      </div>

      <h3 className="doc-h3">Adding an LLM Provider</h3>

      <p className="doc-p">
        New LLM providers are added in{" "}
        <span className="inline-code">packages/ai/src/provider.ts</span>:
      </p>

      <ul className="feature-list">
        <li>
          Add a new value to the <span className="inline-code">ModelProvider</span> enum
        </li>
        <li>
          Add a new case in the provider factory function
        </li>
        <li>
          Use <span className="inline-code">@langchain/openai</span> for
          OpenAI-compatible APIs or add a new LangChain package
        </li>
        <li>
          Update the CLI config wizard in{" "}
          <span className="inline-code">packages/cli/src/config.ts</span>
        </li>
      </ul>

      <h2 className="doc-h2">Code Style Guidelines</h2>

      <ul className="feature-list">
        <li>
          <strong>TypeScript strict mode</strong> — All packages use{" "}
          <span className="inline-code">strict: true</span>
        </li>
        <li>
          <strong>CommonJS output</strong> — All packages compile to CommonJS
          (ES2022 target)
        </li>
        <li>
          <strong>No default exports</strong> — Use named exports consistently
        </li>
        <li>
          <strong>JSON Schema for tool parameters</strong> — No Zod, no
          io-ts. Raw JSON Schema for maximum LLM compatibility
        </li>
        <li>
          <strong>Minimal dependencies</strong> — Especially in the core package.
          Think twice before adding a new dependency
        </li>
        <li>
          <strong>Error messages for users</strong> — Tool errors should be
          human-readable strings the LLM can understand and relay
        </li>
      </ul>

      <h2 className="doc-h2">Pull Request Process</h2>

      <div className="step">
        <div className="step-number">1</div>
        <div className="step-content">
          <div className="step-title">Create a feature branch</div>
          <div className="code-block">{`git checkout -b feature/my-new-feature`}</div>
        </div>
      </div>

      <div className="step">
        <div className="step-number">2</div>
        <div className="step-content">
          <div className="step-title">Make your changes</div>
          <div className="step-desc">
            Follow the code style guidelines. Keep changes focused — one feature
            or fix per PR.
          </div>
        </div>
      </div>

      <div className="step">
        <div className="step-number">3</div>
        <div className="step-content">
          <div className="step-title">Build and test</div>
          <div className="code-block">{`yarn build
yarn start  # Manual testing`}</div>
        </div>
      </div>

      <div className="step">
        <div className="step-number">4</div>
        <div className="step-content">
          <div className="step-title">Write a clear commit message</div>
          <div className="code-block">{`git commit -m "feat(core): add my-tool for doing X

Brief description of what the tool does and why it's useful."`}</div>
        </div>
      </div>

      <div className="step">
        <div className="step-number">5</div>
        <div className="step-content">
          <div className="step-title">Open a pull request</div>
          <div className="step-desc">
            Include a description of the changes, why they&apos;re needed, and how
            to test them. Reference any related issues.
          </div>
        </div>
      </div>

      <h2 className="doc-h2">Commit Message Convention</h2>

      <p className="doc-p">
        Follow the conventional commits format:
      </p>

      <div className="code-block">{`type(scope): description

Types:
  feat     — New feature
  fix      — Bug fix
  refactor — Code restructuring (no feature change)
  docs     — Documentation only
  chore    — Build, tooling, or dependency changes
  perf     — Performance improvement

Scopes:
  core     — @cdoing/core package
  ai       — @cdoing/ai package
  cli      — @cdoing/cli package
  vscode   — VS Code extension
  docs     — Documentation`}</div>

      <h2 className="doc-h2">File Locations Reference</h2>

      <p className="doc-p">
        Quick reference for where to find and modify things:
      </p>

      <table className="doc-table">
        <thead>
          <tr>
            <th>Want to...</th>
            <th>Look at...</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Add a new tool</td>
            <td><span className="inline-code">packages/core/src/tools/</span></td>
          </tr>
          <tr>
            <td>Change permission logic</td>
            <td><span className="inline-code">packages/core/src/permissions/index.ts</span></td>
          </tr>
          <tr>
            <td>Modify sandbox rules</td>
            <td><span className="inline-code">packages/core/src/sandbox/</span></td>
          </tr>
          <tr>
            <td>Add a context provider</td>
            <td><span className="inline-code">packages/core/src/context-providers/</span></td>
          </tr>
          <tr>
            <td>Change the indexer</td>
            <td><span className="inline-code">packages/core/src/indexing/</span></td>
          </tr>
          <tr>
            <td>Modify the agent loop</td>
            <td><span className="inline-code">packages/ai/src/agent-runner.ts</span></td>
          </tr>
          <tr>
            <td>Add an LLM provider</td>
            <td><span className="inline-code">packages/ai/src/provider.ts</span></td>
          </tr>
          <tr>
            <td>Change the system prompt</td>
            <td><span className="inline-code">packages/ai/src/system-prompt.ts</span></td>
          </tr>
          <tr>
            <td>Add a CLI flag</td>
            <td><span className="inline-code">packages/cli/src/index.ts</span></td>
          </tr>
          <tr>
            <td>Add a CLI subcommand</td>
            <td><span className="inline-code">packages/cli/src/commands.ts</span></td>
          </tr>
          <tr>
            <td>Modify chat UI (VS Code)</td>
            <td><span className="inline-code">packages/vscode-extension/src/webview/</span></td>
          </tr>
          <tr>
            <td>Add a VS Code command</td>
            <td><span className="inline-code">packages/vscode-extension/src/extension.ts</span></td>
          </tr>
        </tbody>
      </table>

      <div className="callout callout-tip">
        <div className="callout-title">Need Help?</div>
        Open an issue on the repository if you have questions or need guidance
        on implementing a feature. We&apos;re happy to help!
      </div>
    </div>
  );
}
