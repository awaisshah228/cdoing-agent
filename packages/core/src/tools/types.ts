/** Schema for a tool the agent can call */
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>; // JSON Schema
  requiresPermission: boolean;
  permissionMessage?: (input: Record<string, unknown>) => string;
}

/** Result returned after executing a tool */
export interface ToolResult {
  success: boolean;
  output: string;
  error?: string;
}

/** Optional callback for tools that produce streaming output (e.g., shell commands) */
export type ToolProgressCallback = (chunk: string) => void;

/**
 * Concurrency classification for a tool invocation.
 *
 * - 'parallel'       — always safe to run concurrently (reads, searches)
 * - 'parallel-file'  — safe to run concurrently IF targeting a different file
 * - 'sequential'     — must run one-at-a-time (side effects, shared state)
 */
export type ConcurrencyMode = "parallel" | "parallel-file" | "sequential";

/** Every tool implements this interface */
export interface BaseTool {
  definition: ToolDefinition;
  execute(input: Record<string, unknown>, onProgress?: ToolProgressCallback): Promise<ToolResult>;

  // ── Behavioral flags (optional — buildTool fills safe defaults) ──

  /**
   * Whether this tool is currently enabled.
   * Disabled tools are filtered out before being sent to the LLM.
   * Default: true
   */
  isEnabled?(): boolean;

  /**
   * Whether this tool is read-only (no side effects).
   * Read-only tools skip permission checks in some modes.
   * Default: false (assume writes — fail closed)
   */
  isReadOnly?(): boolean;

  /**
   * Whether this tool performs irreversible/destructive operations.
   * Destructive tools get elevated permission warnings.
   * Default: false
   */
  isDestructive?(input: Record<string, unknown>): boolean;

  /**
   * How this tool should be scheduled relative to other tool calls.
   * Can depend on the specific input (e.g., `bash ls` is parallel-safe,
   * `bash rm -rf` is not).
   *
   * Default: 'sequential' (fail closed — assume side effects)
   */
  concurrencyMode?(input: Record<string, unknown>): ConcurrencyMode;

  /**
   * For file-targeting tools: return the file path this invocation operates on.
   * Used by the orchestrator to parallelize edits to *different* files
   * while serializing edits to the *same* file.
   *
   * Default: undefined (no file target)
   */
  getFilePath?(input: Record<string, unknown>): string | undefined;

  /**
   * Maximum characters in tool output before the orchestrator truncates it.
   * Set to Infinity for tools whose output must never be truncated (e.g., file_read
   * already self-bounds via its own limits).
   *
   * Default: 30_000
   */
  maxResultSizeChars?: number;

  /**
   * Validate the input before execution. Called after schema matching
   * but before permission checks. Return an error string to reject,
   * or undefined to accept.
   *
   * Default: no validation (accept all schema-valid inputs)
   */
  validateInput?(input: Record<string, unknown>): string | undefined;
}

// ── buildTool: safe defaults for every tool ────────────────────────────────

/**
 * Keys that buildTool provides defaults for.
 * Tool authors can omit these; the resulting tool always has them.
 */
type DefaultableKeys =
  | "isEnabled"
  | "isReadOnly"
  | "isDestructive"
  | "concurrencyMode"
  | "maxResultSizeChars";

/** Safe defaults (fail-closed where it matters) */
const TOOL_DEFAULTS: Required<Pick<BaseTool, DefaultableKeys>> = {
  isEnabled: () => true,
  isReadOnly: () => false,
  isDestructive: () => false,
  concurrencyMode: () => "sequential",
  maxResultSizeChars: 30_000,
};

/**
 * A complete tool with all behavioral flags guaranteed present.
 * This is what the registry and orchestrator work with.
 */
export type CompleteTool = Required<Pick<BaseTool, DefaultableKeys>> & BaseTool;

/**
 * Build a complete tool from a BaseTool instance, filling in safe defaults
 * for any missing behavioral flags.
 *
 * All tools should go through this so defaults live in one place and
 * consumers never need `tool.isReadOnly?.() ?? false`.
 *
 * Defaults are fail-closed:
 *  - isEnabled     → true
 *  - isReadOnly    → false (assume writes)
 *  - isDestructive → false
 *  - concurrencyMode → 'sequential' (assume side effects)
 *  - maxResultSizeChars → 30,000
 */
export function buildTool(tool: BaseTool): CompleteTool {
  // IMPORTANT: Do NOT spread the tool — class methods live on the prototype
  // and would be lost. Instead, assign defaults directly onto the instance
  // for any missing behavioral flags.
  const t = tool as CompleteTool;
  if (!tool.isEnabled) t.isEnabled = TOOL_DEFAULTS.isEnabled;
  if (!tool.isReadOnly) t.isReadOnly = TOOL_DEFAULTS.isReadOnly;
  if (!tool.isDestructive) t.isDestructive = TOOL_DEFAULTS.isDestructive;
  if (!tool.concurrencyMode) t.concurrencyMode = TOOL_DEFAULTS.concurrencyMode;
  if (tool.maxResultSizeChars == null) t.maxResultSizeChars = TOOL_DEFAULTS.maxResultSizeChars;
  return t;
}
