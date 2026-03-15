export default function Tools() {
  return (
    <div>
      <h1 className="doc-title">Tools System</h1>
      <p className="doc-subtitle">
        All 21 built-in tools that the AI agent can use to interact with the
        filesystem, execute code, search the web, and more.
      </p>

      <h2 className="doc-h2">Tool Categories</h2>

      <div className="card-grid">
        <div className="card">
          <div className="card-icon">&#128193;</div>
          <div className="card-title">File Operations (5)</div>
          <div className="card-desc">
            Read, write, edit, multi-edit, and delete files
          </div>
        </div>
        <div className="card">
          <div className="card-icon">&#128269;</div>
          <div className="card-title">Search & Discovery (4)</div>
          <div className="card-desc">
            Glob search, grep, list directory, repo map
          </div>
        </div>
        <div className="card">
          <div className="card-icon">&#9654;</div>
          <div className="card-title">Code & Execution (3)</div>
          <div className="card-desc">
            Shell exec, file run, code verify
          </div>
        </div>
        <div className="card">
          <div className="card-icon">&#127760;</div>
          <div className="card-title">Web Access (2)</div>
          <div className="card-desc">Fetch URLs, search the web</div>
        </div>
        <div className="card">
          <div className="card-icon">&#129504;</div>
          <div className="card-title">Intelligence (2)</div>
          <div className="card-desc">
            Codebase search, view diff
          </div>
        </div>
        <div className="card">
          <div className="card-icon">&#128736;</div>
          <div className="card-title">Agent Control (3)</div>
          <div className="card-desc">
            Sub-agent, todo tracking, system info
          </div>
        </div>
      </div>

      <h2 className="doc-h2">File Operations</h2>

      <h3 className="doc-h3">file_read</h3>
      <p className="doc-p">
        Reads files from the filesystem. Supports text files with optional
        offset/limit for reading specific line ranges, image files (returns
        base64 for LLM description), and PDF files.
      </p>
      <div className="code-block">{`Parameters:
  path: string      — Absolute or relative file path
  offset?: number   — Starting line number (1-based)
  limit?: number    — Number of lines to read`}</div>

      <h3 className="doc-h3">file_write</h3>
      <p className="doc-p">
        Creates or overwrites files. Automatically creates parent directories
        if they don&apos;t exist. Requires write permission.
      </p>
      <div className="code-block">{`Parameters:
  path: string      — File path to create/overwrite
  content: string   — Full file content to write`}</div>

      <h3 className="doc-h3">file_edit</h3>
      <p className="doc-p">
        Performs find-and-replace edits on files. Uses a multi-strategy matching
        approach: exact match → trimmed match → case-insensitive → whitespace-
        ignored. This makes edits robust against minor formatting differences.
      </p>
      <div className="code-block">{`Parameters:
  path: string        — File to edit
  old_string: string  — Text to find
  new_string: string  — Replacement text`}</div>

      <h3 className="doc-h3">multi_edit</h3>
      <p className="doc-p">
        Applies multiple edits to a single file atomically. Edits are applied in
        reverse order to preserve line positions. All edits succeed or none do.
      </p>
      <div className="code-block">{`Parameters:
  path: string    — File to edit
  edits: Array<{
    old_string: string
    new_string: string
  }>`}</div>

      <h3 className="doc-h3">file_delete</h3>
      <p className="doc-p">
        Deletes files with permission checking and safe guards. Requires explicit
        delete permission from the user.
      </p>
      <div className="code-block">{`Parameters:
  path: string    — File path to delete`}</div>

      <h2 className="doc-h2">Search & Discovery</h2>

      <h3 className="doc-h3">glob_search</h3>
      <p className="doc-p">
        Finds files matching glob patterns. Respects .gitignore rules and returns
        paths sorted by modification time.
      </p>
      <div className="code-block">{`Parameters:
  pattern: string   — Glob pattern (e.g., "**/*.ts", "src/**/test.*")
  path?: string     — Directory to search in (default: cwd)`}</div>

      <h3 className="doc-h3">grep_search</h3>
      <p className="doc-p">
        Searches file contents with full regex support. Case-insensitive option
        available.
      </p>
      <div className="code-block">{`Parameters:
  pattern: string       — Regex pattern to search for
  path?: string         — Directory to search in
  include?: string      — File glob filter (e.g., "*.ts")
  case_insensitive?: boolean`}</div>

      <h3 className="doc-h3">list_dir</h3>
      <p className="doc-p">
        Lists directory contents with file type indicators. Enhanced replacement
        for <span className="inline-code">ls</span>.
      </p>
      <div className="code-block">{`Parameters:
  path: string    — Directory path to list`}</div>

      <h3 className="doc-h3">view_repo_map</h3>
      <p className="doc-p">
        Generates a structural overview of the repository as an indented tree
        view. Useful for understanding project layout at a glance.
      </p>
      <div className="code-block">{`Parameters:
  path?: string     — Root directory (default: cwd)
  depth?: number    — Max depth to traverse`}</div>

      <h2 className="doc-h2">Code & Execution</h2>

      <h3 className="doc-h3">shell_exec</h3>
      <p className="doc-p">
        Executes shell commands with path extraction and destructive command
        detection. Extracted paths are checked against read/edit/delete
        permission rules before execution.
      </p>
      <div className="code-block">{`Parameters:
  command: string     — Shell command to execute
  timeout?: number    — Timeout in milliseconds (default: 30000)`}</div>

      <div className="callout callout-warning">
        <div className="callout-title">Destructive Command Detection</div>
        Commands containing operators like <span className="inline-code">rm -rf</span>,{" "}
        <span className="inline-code">git reset --hard</span>, or{" "}
        <span className="inline-code">DROP TABLE</span> are flagged and require
        explicit user approval.
      </div>

      <h3 className="doc-h3">file_run</h3>
      <p className="doc-p">
        Auto-detects the programming language of a file and runs it with the
        appropriate interpreter. Supports 14 languages: JavaScript, TypeScript,
        Python, Ruby, Go, Rust, Java, C, C++, PHP, Bash, Perl, Lua, and Swift.
      </p>
      <div className="code-block">{`Parameters:
  path: string      — File path to execute
  args?: string[]   — Command-line arguments
  timeout?: number  — Timeout (default: 30000ms)`}</div>

      <h3 className="doc-h3">code_verify</h3>
      <p className="doc-p">
        Runs syntax and type checking on the current project. Detects the project
        type (TypeScript, ESLint, etc.) and runs the appropriate checker.
      </p>

      <h2 className="doc-h2">Web Access</h2>

      <h3 className="doc-h3">web_fetch</h3>
      <p className="doc-p">
        Fetches content from URLs, extracts the main text, and returns it. Domain
        access is controlled by the sandbox network configuration.
      </p>
      <div className="code-block">{`Parameters:
  url: string    — URL to fetch`}</div>

      <h3 className="doc-h3">web_search</h3>
      <p className="doc-p">
        Searches the web using DuckDuckGo (no API key required). Returns titles,
        URLs, and snippets.
      </p>
      <div className="code-block">{`Parameters:
  query: string    — Search query`}</div>

      <h2 className="doc-h2">Intelligence</h2>

      <h3 className="doc-h3">codebase_search</h3>
      <p className="doc-p">
        Performs intelligent search across the indexed codebase. Combines FTS5
        full-text search (35%) and vector embedding similarity (65%) for
        comprehensive results.
      </p>
      <div className="code-block">{`Parameters:
  query: string     — Natural language or keyword query
  path?: string     — Scope search to a directory`}</div>

      <h3 className="doc-h3">view_diff</h3>
      <p className="doc-p">
        Shows git diffs for working changes, staged changes, or specific commits.
      </p>
      <div className="code-block">{`Parameters:
  type?: string    — "working", "staged", or a commit hash`}</div>

      <h2 className="doc-h2">Agent Control</h2>

      <h3 className="doc-h3">sub_agent</h3>
      <p className="doc-p">
        Spawns an independent sub-agent for parallel research tasks. Sub-agents
        have their own conversation context but share the same tool set.
      </p>
      <div className="code-block">{`Parameters:
  prompt: string    — Task description for the sub-agent
  name?: string     — Identifier for the sub-agent`}</div>

      <h3 className="doc-h3">todo</h3>
      <p className="doc-p">
        Manages task tracking with status management (pending, in_progress,
        completed). Visible to the user for progress tracking.
      </p>
      <div className="code-block">{`Parameters:
  action: string    — "add", "update", "complete", "list"
  task?: string     — Task description
  id?: string       — Task ID for updates`}</div>

      <h3 className="doc-h3">system_info</h3>
      <p className="doc-p">
        Queries the agent&apos;s own runtime state: current permissions, sandbox
        configuration, available tools, and active settings.
      </p>

      <h2 className="doc-h2">Adding a New Tool</h2>

      <p className="doc-p">
        To add a new tool to the system:
      </p>

      <div className="step">
        <div className="step-number">1</div>
        <div className="step-content">
          <div className="step-title">
            Create the tool file in{" "}
            <span className="inline-code">packages/core/src/tools/</span>
          </div>
          <div className="code-block">{`import { BaseTool, ToolDefinition } from "./registry";

export class MyNewTool extends BaseTool {
  definition: ToolDefinition = {
    name: "my_new_tool",
    description: "What this tool does",
    parameters: {
      type: "object",
      properties: {
        param1: { type: "string", description: "..." },
      },
      required: ["param1"],
    },
  };

  async execute(params: { param1: string }): Promise<string> {
    // Implementation
    return "result";
  }
}`}</div>
        </div>
      </div>

      <div className="step">
        <div className="step-number">2</div>
        <div className="step-content">
          <div className="step-title">
            Export from{" "}
            <span className="inline-code">packages/core/src/index.ts</span>
          </div>
          <div className="code-block">{`export { MyNewTool } from "./tools/my-new-tool";`}</div>
        </div>
      </div>

      <div className="step">
        <div className="step-number">3</div>
        <div className="step-content">
          <div className="step-title">
            Register in{" "}
            <span className="inline-code">packages/cli/src/tools.ts</span>
          </div>
          <div className="step-desc">
            Add an instance of your tool to the registry setup function so it
            becomes available to the agent.
          </div>
        </div>
      </div>
    </div>
  );
}
