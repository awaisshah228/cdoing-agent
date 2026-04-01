import type { BaseTool, ToolResult, ToolProgressCallback, CompleteTool, ConcurrencyMode } from "./types";
import { buildTool } from "./types";

/** Deny rule: blocks a tool entirely, or blocks specific input patterns */
export interface DenyRule {
  /** Tool name to deny (exact match) */
  toolName: string;
  /** Optional pattern — if set, only inputs matching this are denied. If unset, tool is blanket-denied. */
  pattern?: string;
}

/** Central registry of all available tools */
export class ToolRegistry {
  private tools: Map<string, CompleteTool> = new Map();
  private denyRules: DenyRule[] = [];

  /**
   * Register a tool. Automatically wraps it with buildTool() to fill
   * safe defaults for any missing behavioral flags.
   */
  register(tool: BaseTool): void {
    this.tools.set(tool.definition.name, buildTool(tool));
  }

  get(name: string): CompleteTool | undefined {
    return this.tools.get(name);
  }

  /** Get all registered tools (unfiltered — includes disabled/denied) */
  getAll(): CompleteTool[] {
    return Array.from(this.tools.values());
  }

  /**
   * Get tools that are currently enabled and not blanket-denied.
   * This is what should be sent to the LLM.
   */
  getEnabled(): CompleteTool[] {
    return this.getAll().filter((t) => {
      if (!t.isEnabled()) return false;
      if (this.isDenied(t.definition.name)) return false;
      return true;
    });
  }

  getDefinitions() {
    return this.getEnabled().map((t) => t.definition);
  }

  // ── Deny rules ──────────────────────────────────────────────────────────

  /** Add deny rules (from settings, sandbox, etc.) */
  setDenyRules(rules: DenyRule[]): void {
    this.denyRules = rules;
  }

  /** Check if a tool is blanket-denied (no pattern = entire tool blocked) */
  isDenied(toolName: string): boolean {
    return this.denyRules.some(
      (r) => r.toolName === toolName && !r.pattern,
    );
  }

  /**
   * Check if a specific tool+input combination is denied.
   * Matches against pattern-based deny rules.
   */
  isDeniedWithInput(toolName: string, input: Record<string, unknown>): boolean {
    return this.denyRules.some((r) => {
      if (r.toolName !== toolName) return false;
      if (!r.pattern) return true; // blanket deny
      // Pattern match: check command, file_path, or stringified input
      const inputStr = (input.command as string)
        || (input.file_path as string)
        || JSON.stringify(input);
      return inputStr.includes(r.pattern);
    });
  }

  // ── Execution ───────────────────────────────────────────────────────────

  /**
   * Execute a tool by name with input validation and deny-rule checking.
   *
   * Pipeline: deny check → validate input → execute
   */
  async execute(
    name: string,
    input: Record<string, unknown>,
    onProgress?: ToolProgressCallback,
  ): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return { success: false, output: "", error: `Unknown tool: ${name}` };
    }

    // Deny rule check
    if (this.isDeniedWithInput(name, input)) {
      return {
        success: false,
        output: "",
        error: `Tool "${name}" is blocked by a deny rule. Check your settings.`,
      };
    }

    // Input validation (tool-specific)
    if (tool.validateInput) {
      const validationError = tool.validateInput(input);
      if (validationError) {
        return { success: false, output: "", error: `Validation failed: ${validationError}` };
      }
    }

    try {
      return await tool.execute(input, onProgress);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, output: "", error: message };
    }
  }

  // ── Schema helpers ──────────────────────────────────────────────────────

  getToolSchemas() {
    return this.getEnabled().map((t) => ({
      name: t.definition.name,
      description: t.definition.description,
      inputSchema: t.definition.inputSchema,
    }));
  }

  // ── Concurrency helpers (used by agent-runner) ──────────────────────────

  /**
   * Get concurrency classification for a tool call.
   * Returns the tool's concurrency mode for the given input.
   */
  getConcurrencyMode(name: string, input: Record<string, unknown>): ConcurrencyMode {
    const tool = this.tools.get(name);
    if (!tool) return "sequential"; // unknown tools run sequentially (fail-closed)
    return tool.concurrencyMode(input);
  }

  /**
   * Get the file path a tool call targets (if any).
   * Used for parallel-file grouping.
   */
  getFilePath(name: string, input: Record<string, unknown>): string | undefined {
    const tool = this.tools.get(name);
    return tool?.getFilePath?.(input);
  }

  /**
   * Get the output size limit for a tool.
   */
  getMaxResultSizeChars(name: string): number {
    const tool = this.tools.get(name);
    return tool?.maxResultSizeChars ?? 30_000;
  }
}
