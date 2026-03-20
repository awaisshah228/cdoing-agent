/**
 * useAgent.ts — React hook that owns the AgentRunner lifecycle.
 *
 * Single responsibility: build, rebuild, and run the AI agent.
 * It knows nothing about conversations, sessions, slash commands, or UI
 * messages — those live in useChat.ts.
 *
 * Why a separate hook?
 *  - The agent can be rebuilt (e.g. when the user changes the model) without
 *    touching any message or session state.
 *  - The streaming callbacks (onToken, onToolCall…) are pure side-effects of
 *    the agent run.  Keeping them here makes them easy to read end-to-end.
 *  - useChat.ts can stay focused on slash commands and message history.
 *
 * What this hook exposes:
 *  - agentRef          — the live AgentRunner instance
 *  - modelConfigRef    — mutable model settings (mutated by /model, /provider)
 *  - toolRegistryRef   — mutable tool list (mutated by /dir)
 *  - workingDirRef     — current working directory as a ref
 *  - planManagerRef    — manages plan-mode state
 *  - rulesManagerRef   — loads .cdoing/rules.md
 *  - effortManagerRef  — tracks effort level
 *  - mcpManagerRef     — MCP server configuration
 *  - contextProvidersRef — @mention context providers
 *  - rebuildAgent()    — recreate the agent after config changes
 *  - resolveContextProviders() — expand @mentions in a message
 */

import { useRef } from "react";
import { AgentRunner } from "@cdoing/ai";
import type { ModelConfig } from "@cdoing/ai";
import type { ToolRegistry, HookManager, MemoryStore, PermissionManager, SubAgentManager, ProcessManager } from "@cdoing/core";
import {
  loadProjectConfig,
  PlanManager,
  RulesManager,
  McpManager,
  EffortManager,
  ContextProviderRegistry,
  TerminalContextProvider,
  UrlContextProvider,
  TreeContextProvider,
  CodebaseContextProvider,
  ClipboardContextProvider,
  FileIncludeContextProvider,
} from "@cdoing/core";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/** Everything useAgent needs from the parent component props. */
export interface UseAgentOptions {
  modelConfig:       Partial<ModelConfig>;
  toolRegistry:      ToolRegistry;
  permissionManager: PermissionManager;
  hookManager:       HookManager;
  memoryStore:       MemoryStore;
  subAgentManager?:  SubAgentManager;
  processManager?:   ProcessManager;
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Manages the AgentRunner and all mutable config references.
 *
 * All returned refs are intentionally mutable — slash commands in useChat.ts
 * mutate them (e.g. modelConfigRef.current.model = "gpt-4o") and then call
 * rebuildAgent() to create a fresh AgentRunner with the new settings.
 */
export function useAgent(opts: UseAgentOptions) {

  // ── Mutable config refs ───────────────────────────────────────────────────
  // These use useRef (not useState) because changing them should NOT trigger
  // a re-render.  Re-renders are triggered by state variables in useChat.ts.

  /** Current working directory — changes when the user runs /dir */
  const workingDirRef = useRef(process.cwd());

  /** Model + provider + API key settings — changes on /model, /provider, /config set */
  const modelConfigRef = useRef<Partial<ModelConfig>>({ ...opts.modelConfig });

  /** The set of tools available to the agent — swapped on /dir to match the new cwd */
  const toolRegistryRef = useRef<ToolRegistry>(opts.toolRegistry);

  // ── Feature-manager refs ─────────────────────────────────────────────────
  // Each manager encapsulates one feature.  They are ref-stored so the agent
  // can query them synchronously inside buildAgent() without going through state.

  /** Plan mode: the agent proposes a plan before executing */
  const planManagerRef = useRef(new PlanManager(process.cwd()));

  /** Project-specific rules loaded from .cdoing/rules.md */
  const rulesManagerRef = useRef(new RulesManager(process.cwd()));

  /** Effort level — low / medium / high / max — affects the system prompt */
  const effortManagerRef = useRef(new EffortManager());

  /** MCP (Model Context Protocol) server configuration */
  const mcpManagerRef = useRef(new McpManager(process.cwd()));

  /**
   * Registry of @mention context providers.
   * Each provider has a trigger (e.g. "@file") and a resolve() function that
   * returns context to inject into the user's message before it reaches the LLM.
   */
  const contextProvidersRef = useRef<ContextProviderRegistry>(
    buildContextProviders(),
  );

  // ── Agent ref ────────────────────────────────────────────────────────────
  /**
   * The live AgentRunner instance.  Wrapped in a ref so the same object is
   * accessible inside async callbacks without capturing a stale closure.
   *
   * Initialized with buildAgentInternal() immediately, then replaced via
   * rebuildAgent() whenever settings change.
   */
  const agentRef = useRef<AgentRunner | null>((() => {
    try { return buildAgentInternal(); } catch { return null; }
  })());

  // ─────────────────────────────────────────────────────────────────────────
  // Agent builder
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Construct a new AgentRunner from the current refs.
   *
   * Called once on mount and again via rebuildAgent() after any config change.
   * Combines project config, rules, and effort hints into a single system prompt.
   */
  function buildAgentInternal(): AgentRunner {
    const dir          = workingDirRef.current;
    const projectConfig = loadProjectConfig(dir);        // .cdoing/config.md
    const rulesText    = rulesManagerRef.current?.formatForPrompt() || "";
    const effortHint   = effortManagerRef.current?.getSystemPromptAddition() || "";

    // Merge all system-prompt additions, filtering out empty strings
    const systemPrompt = [projectConfig || "", rulesText, effortHint]
      .filter(Boolean)
      .join("\n\n");

    // Detect git repo for environment context (like OpenCode's SystemPrompt.environment())
    let isGitRepo = false;
    try { isGitRepo = require("fs").existsSync(require("path").join(dir, ".git")); } catch {}

    return new AgentRunner(
      modelConfigRef.current,
      toolRegistryRef.current,
      opts.permissionManager,
      opts.hookManager,
      {
        workingDir:    dir,
        projectConfig: systemPrompt || undefined,
        memory:        opts.memoryStore.formatForPrompt() || undefined,
        subAgentManager: opts.subAgentManager,
        processManager:  opts.processManager,
        isGitRepo,
      },
    );
  }

  /**
   * Replace the live agent with a freshly built one.
   * Call this any time you mutate modelConfigRef, toolRegistryRef, or workingDirRef.
   */
  function rebuildAgent(): void {
    try {
      // Preserve conversation history across rebuilds
      const oldHistory = agentRef.current?.getHistory() || [];
      agentRef.current = buildAgentInternal();
      if (oldHistory.length > 0) {
        agentRef.current.setHistory(oldHistory);
      }
    } catch (err) {
      // Don't crash — agentRef keeps the previous agent (or null).
      // The error will surface as a friendly message on the next send.
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Context provider resolver
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Expand any @mention triggers in the user's message.
   *
   * Example: "@file src/main.ts tell me what this does"
   *   → strips "@file src/main.ts"
   *   → reads the file
   *   → returns "tell me what this does\n\n---\n\n<file path="src/main.ts">…</file>"
   *
   * @param message           Raw message as typed by the user
   * @param workingDir        Current working directory (for relative file paths)
   * @param lastTerminalOutput Last captured terminal output (for @terminal)
   */
  async function resolveContextProviders(
    message: string,
    workingDir: string,
    lastTerminalOutput: string,
  ): Promise<string> {
    const providers = contextProvidersRef.current.getAll();
    if (!providers.length) return message;

    const injected: string[] = [];
    let clean = message;

    for (const provider of providers) {
      const idx = message.indexOf(provider.trigger);
      if (idx < 0) continue;                             // trigger not present

      // Extract the argument (text after the trigger on the same line)
      const after = message.substring(idx + provider.trigger.length);
      let arg: string | undefined;
      if (provider.requiresArg) {
        const end = after.indexOf("\n");
        arg = (end >= 0 ? after.substring(0, end) : after).trim();
      }

      // Remove the trigger (+ optional arg) from the clean message
      const fullTrigger = provider.requiresArg && arg
        ? `${provider.trigger} ${arg}`
        : provider.trigger;
      clean = clean.replace(fullTrigger, "").trim();

      try {
        const result = await provider.resolve(arg, { workingDir, terminalOutput: lastTerminalOutput });
        if (result.content) injected.push(result.content);
      } catch {
        // If a provider fails, skip it silently — the message still goes through
      }
    }

    // Append all injected context blocks separated by a horizontal rule
    return injected.length
      ? `${clean}\n\n---\n\n${injected.join("\n\n---\n\n")}`
      : clean;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Public API
  // ─────────────────────────────────────────────────────────────────────────

  return {
    // Refs exposed so slash commands in useChat.ts can mutate them
    agentRef,
    modelConfigRef,
    toolRegistryRef,
    workingDirRef,
    planManagerRef,
    rulesManagerRef,
    effortManagerRef,
    mcpManagerRef,
    contextProvidersRef,
    // Actions
    rebuildAgent,
    resolveContextProviders,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Private helpers (module-level, not exported)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Register all built-in @mention context providers.
 *
 * The Strategy pattern: each provider is interchangeable and can be added or
 * removed without changing the chat hook.
 */
function buildContextProviders(): ContextProviderRegistry {
  const reg = new ContextProviderRegistry();
  reg.register(new TerminalContextProvider());   // @terminal — recent shell output
  reg.register(new UrlContextProvider());        // @url <link> — fetch a webpage
  reg.register(new TreeContextProvider());       // @tree — project file tree
  reg.register(new CodebaseContextProvider());   // @codebase — full codebase
  reg.register(new ClipboardContextProvider());  // @clip — clipboard content
  reg.register(new FileIncludeContextProvider());// @file <path> — include a file
  return reg;
}
