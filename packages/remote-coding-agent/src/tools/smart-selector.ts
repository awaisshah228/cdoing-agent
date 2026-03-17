/**
 * Smart Tool Selector — Minimizes tool bloat per LLM call.
 *
 * Problem:
 *   The remote agent has 18+ tools. Sending all of them with every API call
 *   wastes ~3,000-5,000 tokens on tool definitions alone, which:
 *   - Increases cost per message
 *   - Slows response time
 *   - Confuses the LLM with irrelevant options
 *
 * Solution:
 *   Analyze the user message to pick only relevant tools for each turn.
 *   Tools are organized into categories with keyword triggers:
 *
 *   Category        | When activated                           | Tools
 *   ─────────────── | ──────────────────────────────────────── | ──────
 *   Core (always)   | Every message                            | file_read, shell_exec, list_dir
 *   File Edit       | "edit", "fix", "change", "refactor"      | file_edit, multi_edit, file_write
 *   Search          | "search", "find", "where", "grep"        | glob_search, grep_search, codebase_search
 *   Code Ops        | "run", "test", "build", "verify"         | file_run, code_verify, view_repo_map
 *   Git             | "diff", "git", "commit", "branch"        | view_diff
 *   Web             | "web", "fetch", "url", "http"            | web_fetch, web_search
 *   Scheduling      | "remind", "schedule", "cron", "every"    | cron_manager
 *   Skills          | "skill", "commit", "review", "explain"   | skill_manager
 *   Config          | "config", "model", "provider", "setting" | config_manager
 *
 *   If no signals match → send ALL tools (ambiguous request).
 *   After turn 1 → send all tools (LLM may chain anything).
 *
 * Token savings: ~40-60% reduction in tool definition tokens per call.
 */

import type { ToolRegistry } from "@cdoing/core";
import type { AgentRole } from "../types";

// ── Tool Categories ─────────────────────────────────────────────────────

/**
 * Core tools for the CODING agent (always included).
 */
const CODING_CORE_TOOLS = new Set([
  "file_read",
  "shell_exec",
  "list_dir",
  "glob_search",
]);

/**
 * Core tools for the ASSISTANT agent (always included).
 * Read-only + management tools. No file write/edit/exec.
 */
const ASSISTANT_CORE_TOOLS = new Set([
  "file_read",
  "glob_search",
  "list_dir",
  "delegate_to_coder",
  "config_manager",
]);

/**
 * Tool groups activated by keyword signals in the user message.
 * Each entry maps a regex pattern to the tools it should activate.
 */
const TOOL_SIGNALS: Array<{ keywords: RegExp; tools: string[] }> = [
  // ── File Editing ──
  {
    keywords: /edit|fix|change|replace|rename|refactor|update|modify|write|create|new file|add|implement/i,
    tools: ["file_edit", "multi_edit", "file_write", "view_diff"],
  },
  // ── Search & Analysis ──
  {
    keywords: /search|find|grep|look for|where is|locate|occurrences?|usage/i,
    tools: ["grep_search", "glob_search", "codebase_search"],
  },
  // ── Code Operations ──
  {
    keywords: /run|execute|test|build|install|compile|npm|yarn|pip|make|verify|check/i,
    tools: ["file_run", "code_verify", "view_repo_map"],
  },
  // ── Git & Version Control ──
  {
    keywords: /diff|git|commit|branch|merge|status|log|push|pull|stash/i,
    tools: ["view_diff"],
  },
  // ── Web & API ──
  {
    keywords: /web|fetch|url|http|download|api|browse|scrape|curl/i,
    tools: ["web_fetch", "web_search"],
  },
  // ── Repository Understanding ──
  {
    keywords: /repo|map|structure|overview|architecture|tree|project/i,
    tools: ["view_repo_map", "codebase_search"],
  },

  // ── Remote Agent Specific ──

  // Scheduling & Cron
  {
    keywords: /remind|schedule|cron|every\s+\d|recurring|timer|alarm|daily|hourly|weekly|interval|automate/i,
    tools: ["cron_manager"],
  },
  // Skills
  {
    keywords: /skill|commit\s+(this|these|change)|review\s+(this|the|code)|explain\s+(this|how)|deploy|summarize/i,
    tools: ["skill_manager"],
  },
  // Config
  {
    keywords: /config|setting|model|provider|switch\s+to|change\s+model|permission|working\s*dir|log\s*level/i,
    tools: ["config_manager"],
  },
];

// ── Public API ──────────────────────────────────────────────────────────

/**
 * Result of tool selection, used by the bridge to filter tools before
 * sending to the LLM.
 */
export interface ToolSelectionResult {
  /** Tool names to include in this turn. Empty = include all. */
  selectedTools: Set<string>;
  /** Whether selection was applied (false = ambiguous, send all). */
  filtered: boolean;
  /** Number of tools selected (for logging). */
  count: number;
  /** Matched categories (for debugging). */
  matchedCategories: string[];
}

/**
 * Analyze a user message and select only the relevant tools.
 *
 * @param message      - The user's message text
 * @param turnNumber   - Current turn (1 = first, 2+ = subsequent)
 * @param registry     - Full tool registry (to validate tool names exist)
 * @param role         - Agent role ("assistant" or "coding")
 * @returns            - Set of tool names to include
 *
 * Rules:
 *   - Turn 1: analyze message keywords → select relevant tools
 *   - Turn 2+: return all tools (agent may chain anything in multi-turn)
 *   - No matches: return all tools (ambiguous request)
 *   - Assistant role: only management + read-only + delegate tools
 *   - Coding role: only coding tools (no config/cron/delegate)
 */
export function selectToolsForTurn(
  message: string,
  turnNumber: number,
  registry: ToolRegistry,
  role: AgentRole = "coding",
): ToolSelectionResult {
  const coreTools = role === "assistant" ? ASSISTANT_CORE_TOOLS : CODING_CORE_TOOLS;

  // After turn 1, send all tools registered for this role
  if (turnNumber > 1) {
    return {
      selectedTools: new Set(),
      filtered: false,
      count: registry.getAll().length,
      matchedCategories: ["all (turn > 1)"],
    };
  }

  const selected = new Set(coreTools);
  const matchedCategories: string[] = ["core"];
  let signalMatched = false;

  // For assistant: only match management-related signals
  const signals = role === "assistant"
    ? TOOL_SIGNALS.filter((s) => {
        const cat = s.keywords.source.split("|")[0].replace(/[\\(]/g, "");
        // Assistant gets: scheduling, skills, config, search (read-only), web
        return ["remind", "skill", "config", "search", "web", "repo"].includes(cat);
      })
    : TOOL_SIGNALS;

  for (const signal of signals) {
    if (signal.keywords.test(message)) {
      for (const tool of signal.tools) {
        selected.add(tool);
      }
      const category = signal.keywords.source.split("|")[0].replace(/[\\(]/g, "");
      matchedCategories.push(category);
      signalMatched = true;
    }
  }

  // No specific signals → include everything in the registry
  if (!signalMatched) {
    return {
      selectedTools: new Set(),
      filtered: false,
      count: registry.getAll().length,
      matchedCategories: ["all (no signal)"],
    };
  }

  // Validate against registry
  const available = new Set(registry.getAll().map((t) => t.definition.name));
  const validated = new Set<string>();
  for (const tool of selected) {
    if (available.has(tool)) {
      validated.add(tool);
    }
  }

  return {
    selectedTools: validated,
    filtered: true,
    count: validated.size,
    matchedCategories,
  };
}

/**
 * Compact a tool description to reduce token usage.
 *
 * Strips verbose instructions, IMPORTANT blocks, and bullet-point
 * guides that the LLM already knows from training.
 * Saves ~40-50% tokens on tool definitions.
 *
 * @param description - Full tool description
 * @returns           - Compacted description (first paragraph only)
 */
export function compactToolDescription(description: string): string {
  const lines = description.split("\n");
  const compacted: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    // Stop at instruction blocks
    if (trimmed.startsWith("IMPORTANT") || trimmed.startsWith("Note:") || trimmed.startsWith("Usage:")) break;
    if (trimmed.startsWith("- ") && compacted.length > 0) break;
    if (!trimmed && compacted.length > 0) break;
    compacted.push(line);
  }

  const result = compacted.join("\n").trim();
  return result.length < 20 ? description.substring(0, 200).trim() : result;
}

/**
 * Compact a JSON Schema to reduce token usage.
 *
 * Removes property descriptions that just restate the property name,
 * and truncates long descriptions to the first sentence.
 *
 * @param schema - Full JSON Schema object
 * @returns      - Compacted schema
 */
export function compactToolSchema(schema: Record<string, unknown>): Record<string, unknown> {
  if (!schema || typeof schema !== "object") return schema;

  const result = { ...schema };
  if (!result.properties || typeof result.properties !== "object") return result;

  const props = { ...result.properties } as Record<string, Record<string, unknown>>;
  const compacted: Record<string, Record<string, unknown>> = {};

  for (const [key, prop] of Object.entries(props)) {
    if (!prop || typeof prop !== "object") { compacted[key] = prop; continue; }

    const cp = { ...prop };
    if (typeof cp.description === "string") {
      const desc = cp.description as string;
      // Compact long descriptions to first sentence
      if (desc.length > 60) {
        const first = desc.split(/[.!]\s/)[0];
        cp.description = first.length < desc.length ? first : desc.substring(0, 60);
      }
      // Remove descriptions that just restate the key name
      const keyWords = key.replace(/_/g, " ").toLowerCase();
      if (desc.toLowerCase().startsWith(keyWords) || desc.toLowerCase() === `the ${keyWords}`) {
        delete cp.description;
      }
    }
    compacted[key] = cp;
  }

  result.properties = compacted;
  return result;
}
