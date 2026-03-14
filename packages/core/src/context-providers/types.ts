/**
 * Context Provider Types — Defines the contract for all context providers.
 *
 * Learning note: Using interfaces (not classes) keeps this flexible.
 * Any object that satisfies these shapes can be a context provider,
 * whether it's a simple object literal or a full class instance.
 */

/**
 * The result returned by a context provider after resolving.
 * Contains the formatted content ready to inject into the prompt.
 */
export interface ContextResult {
  /** Human-readable label shown in the UI (e.g., "Terminal Output") */
  label: string;

  /** The actual content to inject into the conversation */
  content: string;

  /** Optional metadata for display purposes */
  metadata?: {
    source?: string;       // Where the content came from
    truncated?: boolean;   // Whether the content was trimmed
    itemCount?: number;    // Number of items (files, diagnostics, etc.)
  };
}

/**
 * A context provider resolves an @ mention into content.
 *
 * Example: "@terminal" → last terminal output
 *          "@url https://example.com" → fetched page content
 */
export interface ContextProvider {
  /** Unique identifier (e.g., "terminal", "open", "url") */
  id: string;

  /** The @ trigger keyword (e.g., "@terminal") */
  trigger: string;

  /** Short description shown in autocomplete */
  description: string;

  /**
   * Whether this provider needs an argument after the trigger.
   * E.g., "@url" needs a URL, but "@terminal" doesn't.
   */
  requiresArg: boolean;

  /**
   * Resolve the context — fetch the actual content.
   *
   * @param arg - Optional argument (e.g., URL for @url provider)
   * @param options - Runtime context (working dir, VS Code API, etc.)
   * @returns The resolved context content
   */
  resolve(arg?: string, options?: ContextResolveOptions): Promise<ContextResult>;
}

/**
 * Options passed to context providers at resolve time.
 * Provides access to runtime environment without tight coupling.
 */
export interface ContextResolveOptions {
  /** Current working directory */
  workingDir?: string;

  /** Open file paths (for @open provider) */
  openFiles?: string[];

  /** Recent terminal output (for @terminal provider) */
  terminalOutput?: string;

  /** Diagnostics/problems (for @problems provider) */
  diagnostics?: Array<{
    file: string;
    line: number;
    severity: "error" | "warning" | "info" | "hint";
    message: string;
  }>;

  /** Max content length (chars) before truncation */
  maxContentLength?: number;
}
