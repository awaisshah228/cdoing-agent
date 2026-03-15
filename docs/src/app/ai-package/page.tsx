export default function AiPackage() {
  return (
    <div>
      <h1 className="doc-title">AI Package</h1>
      <p className="doc-subtitle">
        <span className="inline-code">@cdoing/ai</span> — The intelligence layer
        containing the agentic loop, LLM providers, system prompt builder, and
        context management.
      </p>

      <h2 className="doc-h2">Overview</h2>

      <p className="doc-p">
        The AI package is the brain of the system. It manages the continuous
        cycle of LLM inference and tool execution that makes the agent work
        autonomously.
      </p>

      <div className="file-tree">{`packages/ai/src/
├── agent-runner.ts      # Agentic loop + streaming (~19k lines)
├── provider.ts          # Multi-provider LLM factory
├── system-prompt.ts     # System prompt builder
└── context-manager.ts   # Token tracking + cost calculation`}</div>

      <h2 className="doc-h2">Agent Runner</h2>

      <p className="doc-p">
        The agent runner implements the core agentic loop. It&apos;s the most
        critical component in the system.
      </p>

      <h3 className="doc-h3">How the Loop Works</h3>

      <div className="step">
        <div className="step-number">1</div>
        <div className="step-content">
          <div className="step-title">User sends a message</div>
          <div className="step-desc">
            The message is added to the conversation history along with any
            context from @ mention providers.
          </div>
        </div>
      </div>

      <div className="step">
        <div className="step-number">2</div>
        <div className="step-content">
          <div className="step-title">LLM responds (streamed)</div>
          <div className="step-desc">
            The response is streamed token-by-token. The LLM can respond with
            either plain text or tool calls (or both).
          </div>
        </div>
      </div>

      <div className="step">
        <div className="step-number">3</div>
        <div className="step-content">
          <div className="step-title">Tool calls are executed</div>
          <div className="step-desc">
            Each tool call passes through: pre-hooks → permission check →
            execution → post-hooks. Results are fed back to the LLM.
          </div>
        </div>
      </div>

      <div className="step">
        <div className="step-number">4</div>
        <div className="step-content">
          <div className="step-title">Loop continues</div>
          <div className="step-desc">
            The LLM receives tool results and either makes more tool calls or
            returns a final text response to the user.
          </div>
        </div>
      </div>

      <h3 className="doc-h3">Key Features</h3>

      <ul className="feature-list">
        <li>
          <strong>Real-time Streaming</strong> — Token-by-token output via
          LangChain&apos;s <span className="inline-code">.stream()</span> method
        </li>
        <li>
          <strong>Parallel Tool Execution</strong> — Multiple independent tool
          calls can run concurrently
        </li>
        <li>
          <strong>Exponential Backoff Retry</strong> — Automatic retry on
          transient API failures
        </li>
        <li>
          <strong>Context Compression</strong> — Automatic summarization when
          approaching token limits
        </li>
        <li>
          <strong>Raw JSON Schema Tool Binding</strong> — No Zod dependency,
          maximum provider compatibility
        </li>
      </ul>

      <h2 className="doc-h2">LLM Providers</h2>

      <p className="doc-p">
        The provider factory creates LLM instances for any supported provider:
      </p>

      <table className="doc-table">
        <thead>
          <tr>
            <th>Provider</th>
            <th>Package</th>
            <th>Default Model</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <span className="badge badge-purple">Anthropic</span>
            </td>
            <td>
              <span className="inline-code">@langchain/anthropic</span>
            </td>
            <td>claude-sonnet-4-6</td>
          </tr>
          <tr>
            <td>
              <span className="badge badge-green">OpenAI</span>
            </td>
            <td>
              <span className="inline-code">@langchain/openai</span>
            </td>
            <td>gpt-4o</td>
          </tr>
          <tr>
            <td>
              <span className="badge badge-blue">Google</span>
            </td>
            <td>
              <span className="inline-code">@langchain/google-genai</span>
            </td>
            <td>gemini-2.0-flash</td>
          </tr>
          <tr>
            <td>
              <span className="badge badge-yellow">Ollama</span>
            </td>
            <td>
              <span className="inline-code">@langchain/openai</span> (compatible)
            </td>
            <td>llama3.1</td>
          </tr>
          <tr>
            <td>
              <span className="badge badge-blue">Custom</span>
            </td>
            <td>
              <span className="inline-code">@langchain/openai</span> (OpenAI-compatible)
            </td>
            <td>User-defined</td>
          </tr>
        </tbody>
      </table>

      <h3 className="doc-h3">Provider Enum</h3>

      <div className="code-block">{`export enum ModelProvider {
  ANTHROPIC = "anthropic",
  OPENAI = "openai",
  GOOGLE = "google",
  OLLAMA = "ollama",
  CUSTOM = "custom",
}`}</div>

      <h3 className="doc-h3">OAuth Support</h3>

      <p className="doc-p">
        Anthropic OAuth is supported for Claude Pro/Max users with Bearer
        authentication and beta headers. The CLI provides{" "}
        <span className="inline-code">--login</span> and{" "}
        <span className="inline-code">--logout</span> commands for managing
        OAuth sessions.
      </p>

      <h2 className="doc-h2">System Prompt Builder</h2>

      <p className="doc-p">
        The system prompt is dynamically constructed based on the current state:
      </p>

      <ul className="feature-list">
        <li>
          <strong>Tool Definitions</strong> — Lists all available tools with
          their schemas
        </li>
        <li>
          <strong>Permission Context</strong> — Current permission mode and
          active rules
        </li>
        <li>
          <strong>Project Context</strong> — Working directory, project type,
          available config files
        </li>
        <li>
          <strong>Sandbox Status</strong> — Filesystem and network restrictions
        </li>
        <li>
          <strong>Custom Instructions</strong> — User-defined instructions from
          config files
        </li>
      </ul>

      <h2 className="doc-h2">Context Manager</h2>

      <p className="doc-p">
        The context manager handles the conversation&apos;s token budget:
      </p>

      <h3 className="doc-h3">Token Tracking</h3>
      <ul className="feature-list">
        <li>
          Estimates tokens at ~4 characters per token
        </li>
        <li>
          Tracks input/output tokens via LangChain&apos;s UsageMetadata
        </li>
        <li>
          Triggers context pruning at 75% of the model&apos;s context window
        </li>
      </ul>

      <h3 className="doc-h3">Context Compression</h3>
      <ul className="feature-list">
        <li>
          Summarizes older messages to free up context space
        </li>
        <li>
          Truncates large tool outputs (30k character limit, preserves tail)
        </li>
        <li>
          Maintains recent messages in full for continuity
        </li>
      </ul>

      <h3 className="doc-h3">Cost Tracking</h3>
      <p className="doc-p">
        The context manager calculates approximate cost per provider based on
        token usage and provider-specific pricing.
      </p>

      <div className="callout callout-info">
        <div className="callout-title">Dependencies</div>
        The AI package depends on:{" "}
        <span className="inline-code">@langchain/core</span>,{" "}
        <span className="inline-code">@langchain/anthropic</span>,{" "}
        <span className="inline-code">@langchain/openai</span>,{" "}
        <span className="inline-code">@langchain/google-genai</span>, and{" "}
        <span className="inline-code">@cdoing/core</span>.
      </div>
    </div>
  );
}
