/**
 * useChat.ts — Main chat state hook.
 *
 * This is the top-level hook consumed by App.tsx.  It wires together three
 * concerns that intentionally live in separate modules:
 *
 *   1. Agent lifecycle   →  ./useAgent.ts
 *      Build / rebuild the AgentRunner when settings change.
 *
 *   2. Pure utilities    →  ./helpers.ts
 *      Terminal output, diff printing, help text — no React.
 *
 *   3. This file (useChat.ts)
 *      - Message history (what's displayed in the chat window)
 *      - Session / conversation persistence
 *      - Background jobs (/bg, /jobs)
 *      - Slash command dispatch (/model, /dir, /clear, …)
 *      - The sendMessage() function that runs the agent and streams tokens
 *
 * Learning note — why split at all?
 *   A single 1000-line file works but becomes hard to navigate.  Splitting by
 *   responsibility means you can read useAgent.ts to understand "how is the
 *   AI agent built?" without wading through session management, and vice versa.
 *
 * Data flow:
 *   User types  →  UserInput.tsx  →  onSubmit  →  App.tsx  →  sendMessage()
 *                                                              ↓
 *                                                       agentRef.current.run()
 *                                                              ↓
 *                                              onToken / onToolCall / onComplete
 *                                                              ↓
 *                                                    setStreamingContent / setMessages
 */

import { useState, useCallback, useRef, useMemo } from "react";
import * as path from "path";
import * as fs from "fs";
import chalk from "chalk";
import { getDefaultModel } from "@cdoing/ai";
import type { ModelConfig } from "@cdoing/ai";
import type {
  ToolRegistry,
  PermissionManager,
  PermissionMode,
  HookManager,
  MemoryStore,
  TodoStore,
} from "@cdoing/core";
import type { EffortLevel } from "@cdoing/core";

// History helpers — read / write conversations to ~/.cdoing/history/
import {
  createConversation,
  addMessage,
  loadConversation,
  listConversations,
  deleteConversation,
  forkConversation,
  updateConversationTitle,
  type Conversation,
} from "../../history";

import { createToolRegistry } from "../../tools";
import {
  parsePermissionMode,
  updateStoredConfig,
  getStoredConfigDisplay,
} from "../../config";
import { oauthLogout, oauthStatus } from "../../oauth";
import { handleInit, handleDoctor } from "../../commands";
import { setTheme, getThemeName, getAvailableThemes } from "../theme";

// Split modules
import { useAgent }            from "./useAgent";
import {
  getContextWindowMax,
  printToolCall,
  printToolResult,
  getHelpText,
  getConversationListText,
} from "./helpers";

import type { ChatMessage, ToolActivity, UsageInfo, ContextUsage, BackgroundJob } from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// Small utilities local to this file
// ─────────────────────────────────────────────────────────────────────────────

/** Auto-incrementing message ID — keeps React list keys stable */
let _msgId = 0;
function nextId(): string { return String(++_msgId); }

/** Short unique ID for background jobs — e.g. "bg-1a2b" */
function jobId(): string { return `bg-${Date.now().toString(36).slice(-4)}`; }

// ─────────────────────────────────────────────────────────────────────────────
// Public interface
// ─────────────────────────────────────────────────────────────────────────────

/** Props passed by the parent component (App.tsx → chat.ts → here) */
export interface UseChatOptions {
  modelConfig:       Partial<ModelConfig>;
  toolRegistry:      ToolRegistry;
  permissionManager: PermissionManager;
  hookManager:       HookManager;
  memoryStore:       MemoryStore;
  todoStore?:        TodoStore;
}

// ─────────────────────────────────────────────────────────────────────────────
// The hook
// ─────────────────────────────────────────────────────────────────────────────

export function useChat(opts: UseChatOptions) {

  // ── 1. Agent infrastructure (from useAgent.ts) ───────────────────────────
  //
  // useAgent owns: agentRef, modelConfigRef, toolRegistryRef, workingDirRef,
  //                planManagerRef, rulesManagerRef, effortManagerRef, …
  //                rebuildAgent(), resolveContextProviders()
  //
  // We destructure everything we need from it.
  const agent = useAgent(opts);
  const {
    agentRef, modelConfigRef, toolRegistryRef, workingDirRef,
    planManagerRef, rulesManagerRef, effortManagerRef,
    mcpManagerRef, contextProvidersRef,
    rebuildAgent, resolveContextProviders,
  } = agent;

  // ── 2. UI state — these drive React re-renders ───────────────────────────

  /** All committed messages shown in the chat window (user + assistant + system) */
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  /** Token stream currently being received — shown in the live streaming area */
  const [streamingContent, setStreamingContent] = useState("");

  /** Whether the agent is processing a request (disables input, shows spinner) */
  const [isProcessing, setIsProcessing] = useState(false);

  /** Tool currently executing (shows animated spinner with tool name) */
  const [toolActivity, setToolActivity] = useState<ToolActivity | null>(null);

  /** Last token-usage report from the LLM (shown in the status bar) */
  const [lastUsage, setLastUsage] = useState<UsageInfo | null>(null);

  /** Current working directory — shown in the status bar, changed by /dir */
  const [workingDir, setWorkingDir] = useState(process.cwd());

  /** Context-window fill percentage — used to auto-compact at 80% */
  const [contextUsage, setContextUsage] = useState<ContextUsage | null>(null);

  /** List of /bg background jobs and their statuses */
  const [backgroundJobs, setBackgroundJobs] = useState<BackgroundJob[]>([]);

  /** Whether the /ls session browser overlay is open */
  const [showSessionBrowser, setShowSessionBrowser] = useState(false);

  /** Bumped whenever modelConfigRef is mutated — forces a re-render so StatusBar reflects changes */
  const [_configVersion, _bumpConfigVersion] = useState(0);

  /** Snapshot of the live model config — recalculated whenever _configVersion bumps */
  const liveModelConfig = useMemo(
    () => ({ ...modelConfigRef.current }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [_configVersion],
  );

  /** Rebuild agent and trigger a re-render so UI (StatusBar, etc.) shows updated config */
  const rebuildAndRefresh = useCallback(() => {
    rebuildAgent();
    _bumpConfigVersion((v) => v + 1);
  }, [rebuildAgent]);

  // ── 3. Mutable refs — data that changes without triggering a re-render ───

  /** The AbortController for the current agent run — set to cancel in-flight requests */
  const abortRef = useRef<AbortController | null>(null);

  /**
   * Message queue — when a message arrives while isProcessing is true it's
   * pushed here.  The next message in the queue is dequeued in onComplete.
   */
  const queueRef = useRef<string[]>([]);

  /**
   * Last tool input — saved so printToolResult() can show the diff after the
   * tool finishes.  Cleared after each tool result.
   */
  const lastToolInputRef = useRef<Record<string, unknown>>({});

  /** Active conversation — persisted to disk on every message */
  const conversationRef = useRef<Conversation>(
    createConversation(
      String(opts.modelConfig.provider || "anthropic"),
      String(opts.modelConfig.model   || "default"),
    ),
  );

  /**
   * Last captured terminal output — injected when the user types @terminal.
   * Set by App.tsx after shell commands finish.
   */
  const lastTerminalOutputRef = useRef("");

  /** Whether plan-mode is active (agent proposes a plan before acting) */
  const planModeActiveRef = useRef(false);

  // ─────────────────────────────────────────────────────────────────────────
  // Helper: add a system notification to the message list
  // ─────────────────────────────────────────────────────────────────────────

  function addSystemMessage(content: string): void {
    setMessages((prev) => [
      ...prev,
      { id: nextId(), role: "system", content },
    ]);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Helper: auto-generate a session title after the first exchange
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Fires a lightweight LLM call in the background to produce a short title
   * for the conversation (e.g. "Fix TypeScript build errors").
   * Saved to disk via updateConversationTitle — never blocks the main UI.
   */
  function generateSessionTitle(conv: Conversation): void {
    const firstUser      = conv.messages.find((m) => m.role === "user");
    const firstAssistant = conv.messages.find((m) => m.role === "assistant");
    if (!firstUser) return;

    const snippet = [
      `User: ${firstUser.content.substring(0, 200)}`,
      firstAssistant ? `Assistant: ${firstAssistant.content.substring(0, 200)}` : "",
    ].filter(Boolean).join("\n");

    // Build a throwaway agent with no tools — we only need a text response
    const titleAgent = new (agentRef.current!.constructor as any)(
      modelConfigRef.current,
      toolRegistryRef.current,
      opts.permissionManager,
      opts.hookManager,
    );
    let title = "";
    titleAgent.run(
      `Generate a concise session title (5–8 words max, no quotes) for this conversation:\n\n${snippet}\n\nTitle:`,
      {
        onToken:      (t: string) => { title += t; },
        onToolCall:   () => {},
        onToolResult: () => {},
        onComplete:   () => {
          const clean = title.trim().replace(/^["']|["']$/g, "").replace(/\.$/, "");
          if (clean) updateConversationTitle(conv.id, clean);
        },
        onError: () => {},
      },
    ).catch(() => {});
  }

  // ─────────────────────────────────────────────────────────────────────────
  // cancelCurrent — abort the running agent
  // ─────────────────────────────────────────────────────────────────────────

  const cancelCurrent = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setIsProcessing(false);
    setStreamingContent("");
    setToolActivity(null);
    addSystemMessage("⏹  Cancelled.");
  }, []);

  // ─────────────────────────────────────────────────────────────────────────
  // sendMessage — the core function that runs the agent
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Send a message to the agent and stream the response back into the UI.
   *
   * Flow:
   *  1. If already processing → queue the message and return.
   *  2. Expand any @mention context providers in the text.
   *  3. Add the user message to the visible chat history.
   *  4. Run the agent; wire up streaming callbacks:
   *       onToken      → update the live streaming area
   *       onToolCall   → flush text to stdout, show tool spinner
   *       onToolResult → clear spinner, print diff
   *       onComplete   → commit reply, dequeue next message
   *       onError      → show error message
   *       onUsage      → update token counter and auto-compact if needed
   */
  const sendMessage = useCallback(
    async (text: string) => {
      // ── Guard: no agent (no key configured) ─────────────────────────────
      if (!agentRef.current) {
        addSystemMessage("No API key configured. Run /setup to authenticate.");
        return;
      }

      // ── Queue if busy ────────────────────────────────────────────────────
      if (isProcessing) {
        queueRef.current.push(text);
        addSystemMessage(`📬 Queued (${queueRef.current.length} waiting)`);
        return;
      }

      // ── Resolve @mentions ────────────────────────────────────────────────
      const enriched = await resolveContextProviders(
        text,
        workingDirRef.current,
        lastTerminalOutputRef.current,
      );

      // ── Optimistic UI update ─────────────────────────────────────────────
      setIsProcessing(true);
      setMessages((prev) => [
        ...prev,
        { id: nextId(), role: "user", content: text },
      ]);
      addMessage(conversationRef.current, "user", text);

      const ctrl = new AbortController();
      abortRef.current = ctrl;

      /**
       * Track how much of fullReply has already been written directly to
       * stdout (to avoid double-printing it when it's committed to messages).
       */
      let fullReply  = "";
      let flushedPos = 0;

      /**
       * Flush any un-printed streaming text to stdout BEFORE showing a tool
       * call.  Without this, the text would disappear when Ink clears the
       * live area to render the tool spinner.
       */
      function flushStreamingText(): void {
        const pending = fullReply.slice(flushedPos);
        if (pending.trim()) process.stdout.write("\n" + pending + "\n");
        flushedPos = fullReply.length;
        setStreamingContent("");
      }

      // ── Agent run ────────────────────────────────────────────────────────
      await agentRef.current.run(enriched, {

        onToken: (token) => {
          fullReply += token;
          // Show only the part not yet flushed to stdout
          setStreamingContent(fullReply.slice(flushedPos));
        },

        onToolCall: (name, input) => {
          flushStreamingText();
          lastToolInputRef.current = input;
          printToolCall(name, input);          // permanent stdout line
          const preview = JSON.stringify(input).substring(0, 60);
          setToolActivity({ name, preview, status: "running" });
        },

        onToolResult: (_name, _result, isError) => {
          printToolResult(_name, isError, lastToolInputRef.current);
          lastToolInputRef.current = {};
          setToolActivity(null);
        },

        onComplete: () => {
          // Commit only the portion NOT already flushed to stdout
          const remaining = fullReply.slice(flushedPos);
          if (remaining.trim()) {
            setMessages((prev) => [
              ...prev,
              { id: nextId(), role: "assistant", content: remaining },
            ]);
            addMessage(conversationRef.current, "assistant", remaining);
          } else if (flushedPos > 0) {
            // All text was flushed — print a separator to mark the end
            process.stdout.write(chalk.gray("─".repeat(40)) + "\n");
          }
          // Save the full reply to the conversation for the non-flushed case
          if (flushedPos === 0 && fullReply.trim()) {
            addMessage(conversationRef.current, "assistant", fullReply);
          }

          setStreamingContent("");
          setIsProcessing(false);
          abortRef.current = null;

          // Auto-generate a title after the first exchange
          const conv = conversationRef.current;
          if (conv.title === "New conversation" && conv.messages.length >= 2) {
            generateSessionTitle(conv);
          }

          // Dequeue next message
          const next = queueRef.current.shift();
          if (next) sendMessage(next);
        },

        onError: (err) => {
          setMessages((prev) => [
            ...prev,
            { id: nextId(), role: "system", content: `❌ Error: ${err.message}`, isError: true },
          ]);
          setStreamingContent("");
          setIsProcessing(false);
          abortRef.current = null;
        },

        onUsage: (usage) => {
          const u = usage as UsageInfo;
          setLastUsage(u);

          // Calculate context-window fill % and auto-compact at 80%
          const provider  = String(modelConfigRef.current.provider || "anthropic");
          const model     = String(modelConfigRef.current.model    || "");
          const maxTokens = getContextWindowMax(provider, model);
          const percent   = Math.min(100, (u.inputTokens / maxTokens) * 100);
          setContextUsage({ inputTokens: u.inputTokens, maxTokens, percent });

          if (percent >= 80) {
            const ag = agentRef.current as unknown as Record<string, (...a: unknown[]) => unknown>;
            if (typeof ag.compactHistory === "function") {
              ag.compactHistory();
              addSystemMessage("📦 Context compacted automatically (reached 80%).");
            }
          }
        },
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isProcessing, resolveContextProviders],
  );

  // ─────────────────────────────────────────────────────────────────────────
  // handleSlashCommand — dispatch /commands typed in the input
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Process a slash command string (e.g. "/model gpt-4o").
   *
   * Returns a string to display in the UI, or null if the command takes over
   * (e.g. /ls opens the session browser, /exit terminates the process).
   *
   * Adding a new command?  Just add a new case here.
   */
  const handleSlashCommand = useCallback(
    async (command: string): Promise<string | null> => {
      const parts = command.split(/\s+/);
      const cmd   = parts[0];           // e.g. "/model"
      const arg   = parts.slice(1).join(" "); // e.g. "gpt-4o"

      switch (cmd) {

        // ── Conversation management ─────────────────────────────────────────

        case "/help":
          return getHelpText();

        case "/clear":
          // Reset the agent's internal history AND the visible message list
          agentRef.current?.clearHistory();
          setMessages([]);
          return "Conversation cleared.";

        case "/new":
          agentRef.current?.clearHistory();
          conversationRef.current = createConversation(
            String(modelConfigRef.current.provider || "anthropic"),
            String(modelConfigRef.current.model   || "default"),
          );
          setMessages([]);
          return "New conversation started.";

        case "/history":
          return getConversationListText();

        case "/ls":
          // Open the interactive TUI session browser (App.tsx renders it)
          setShowSessionBrowser(true);
          return null;

        case "/resume": {
          if (!arg) return "Usage: /resume <id>";
          const conv = loadConversation(arg);
          if (!conv) return `Conversation not found: ${arg}`;
          agentRef.current?.clearHistory();
          for (const m of conv.messages) {
            if (m.role === "user")      agentRef.current?.addToHistory("user",      m.content);
            else if (m.role === "assistant") agentRef.current?.addToHistory("assistant", m.content);
          }
          conversationRef.current = conv;
          setMessages(conv.messages.map((m) => ({
            id:      nextId(),
            role:    m.role as "user" | "assistant",
            content: m.content,
          })));
          return `Resumed conversation: ${arg}`;
        }

        case "/delete": {
          if (!arg) return "Usage: /delete <id>";
          const ok = deleteConversation(arg);
          return ok ? `Deleted: ${arg}` : `Not found: ${arg}`;
        }

        case "/fork": {
          // Fork creates a copy of a conversation so you can explore a divergent path
          const sourceId = arg || conversationRef.current.id;
          const forked   = forkConversation(sourceId);
          if (!forked) return `Not found: ${sourceId}`;
          return `Forked → new session: ${forked.id}\nTitle: ${forked.title}\nUse /resume ${forked.id} to switch to it.`;
        }

        // ── Background jobs ─────────────────────────────────────────────────

        case "/bg": {
          // Run a prompt in the background without blocking the main chat
          if (!arg) return "Usage: /bg <prompt>  — run a prompt as a background job";
          const id    = jobId();
          const bgJob: BackgroundJob = { id, prompt: arg, status: "running", startedAt: Date.now() };
          setBackgroundJobs((prev) => [...prev, bgJob]);
          addSystemMessage(`⚡ Background job started: ${id}`);

          // Build a fresh ephemeral agent so it doesn't share history with main chat
          if (!agentRef.current) return "No API key configured. Run /setup first.";
          const bgAgent = new (agentRef.current.constructor as any)(
            modelConfigRef.current, toolRegistryRef.current,
            opts.permissionManager, opts.hookManager,
          );
          let result = "";
          bgAgent.run(arg, {
            onToken:      (t: string) => { result += t; },
            onToolCall:   () => {},
            onToolResult: () => {},
            onComplete:   () => {
              setBackgroundJobs((prev) =>
                prev.map((j) => j.id === id
                  ? { ...j, status: "done", result, completedAt: Date.now() }
                  : j));
              addSystemMessage(`✅ Background job done: ${id}`);
            },
            onError: (e: Error) => {
              setBackgroundJobs((prev) =>
                prev.map((j) => j.id === id
                  ? { ...j, status: "error", error: e.message, completedAt: Date.now() }
                  : j));
              addSystemMessage(`❌ Background job failed: ${id} — ${e.message}`);
            },
          }).catch(() => {});
          return `Job ${id} started in background.`;
        }

        case "/jobs": {
          if (!backgroundJobs.length) return "No background jobs.";
          const jobArg = arg.trim();
          if (jobArg) {
            // /jobs <id> — show full result for one job
            const job = backgroundJobs.find((j) => j.id === jobArg);
            if (!job) return `Job not found: ${jobArg}`;
            const elapsed = job.completedAt
              ? `${((job.completedAt - job.startedAt) / 1000).toFixed(1)}s`
              : "running";
            return [
              `Job: ${job.id}  [${job.status}]  ${elapsed}`,
              `Prompt: ${job.prompt.substring(0, 100)}`,
              job.result ? `\nResult:\n${job.result}` : "",
              job.error  ? `\nError: ${job.error}`   : "",
            ].filter(Boolean).join("\n");
          }
          // /jobs — list all jobs
          return backgroundJobs.map((j) => {
            const elapsed = j.completedAt
              ? `${((j.completedAt - j.startedAt) / 1000).toFixed(1)}s`
              : "running…";
            const icon = j.status === "done" ? "✅" : j.status === "error" ? "❌" : "⚡";
            return `${icon} ${j.id}  ${j.status.padEnd(8)} ${elapsed}  ${j.prompt.substring(0, 50)}`;
          }).join("\n");
        }

        // ── Model / provider configuration ──────────────────────────────────

        case "/config": {
          if (arg === "show") {
            return ["Stored Config:", ...getStoredConfigDisplay()].join("\n  ");
          }
          if (arg.startsWith("set ")) {
            const sp  = arg.slice(4).trim().split(/\s+/);
            const key = sp[0];
            const val = sp.slice(1).join(" ");
            if (!key || !val)
              return "Usage: /config set <key> <value>\nKeys: provider, model, mode, api-key, base-url, oauth-token";

            // oauth-token is stored in keychain (not config.json) — handle separately
            if (key === "oauth-token") {
              modelConfigRef.current.oauthToken = val;
              modelConfigRef.current.apiKey     = undefined;
              rebuildAndRefresh();
              return `OAuth token set (${val.slice(0, 8)}...)`;
            }

            const res = updateStoredConfig(key, val);
            if (res.success) {
              // Mutate the ref and rebuild so changes take effect immediately
              if (key === "provider")  { modelConfigRef.current.provider = val; rebuildAndRefresh(); }
              if (key === "model")     { modelConfigRef.current.model    = val; rebuildAndRefresh(); }
              if (key === "mode")      opts.permissionManager.setMode(parsePermissionMode(val) as PermissionMode);
              if (key === "api-key")   { modelConfigRef.current.apiKey = val; modelConfigRef.current.oauthToken = undefined; rebuildAndRefresh(); }
              if (key === "base-url")  { modelConfigRef.current.baseURL = val; rebuildAndRefresh(); }
              const masked = key === "api-key" ? val.slice(0, 8) + "..." : val;
              return `Saved: ${key} = ${masked}`;
            }
            return res.error || "Error saving config";
          }
          return [
            `Provider: ${modelConfigRef.current.provider || "anthropic"}`,
            `Model:    ${modelConfigRef.current.model    || "(default)"}`,
            `Mode:     ${opts.permissionManager.getMode()}`,
            `Dir:      ${workingDir}`,
            `Chat ID:  ${conversationRef.current.id}`,
          ].join("\n");
        }

        case "/model": {
          if (!arg) {
            const provider = String(modelConfigRef.current.provider || "anthropic");
            const def = getDefaultModel(provider) || "(none)";
            const cur = modelConfigRef.current.model || `(default: ${def})`;
            return [
              `Current model: ${cur}`,
              `Usage: /model <name>    — switch to a specific model`,
              `       /model default  — reset to provider default (${def})`,
              `Provider models:`,
              `  anthropic: claude-sonnet-4-6, claude-opus-4-6, claude-haiku-4-5`,
              `  openai:    gpt-4o, gpt-4o-mini, o3-mini`,
              `  google:    gemini-2.0-flash, gemini-1.5-pro`,
              `  ollama:    llama3.1, mistral, codellama`,
            ].join("\n");
          }
          if (arg === "default") {
            modelConfigRef.current.model = undefined;
            rebuildAndRefresh();
            const def = getDefaultModel(String(modelConfigRef.current.provider || "anthropic")) || "provider default";
            return `Model reset to default: ${def}`;
          }
          modelConfigRef.current.model = arg;
          rebuildAndRefresh();
          return `Model switched to: ${arg}`;
        }

        case "/provider": {
          if (!arg) {
            return [
              `Current provider: ${modelConfigRef.current.provider || "anthropic"}`,
              `Usage: /provider <name>   — switch provider`,
              `       /provider default  — reset to anthropic + default model`,
              `Options: anthropic, openai, google, ollama`,
            ].join("\n");
          }
          if (arg === "default") {
            modelConfigRef.current.provider = "anthropic";
            modelConfigRef.current.model    = undefined;
            modelConfigRef.current.apiKey   = undefined;
            rebuildAndRefresh();
            return `Reset to default: anthropic / ${getDefaultModel("anthropic")}`;
          }
          modelConfigRef.current.provider = arg.toLowerCase();
          modelConfigRef.current.model    = undefined;
          rebuildAndRefresh();
          return `Provider switched to: ${arg}\nTip: use /model to pick a model`;
        }

        case "/mode": {
          if (!arg)
            return `Current mode: ${opts.permissionManager.getMode()}\nUsage: /mode <ask|auto-edit|auto>`;
          opts.permissionManager.setMode(parsePermissionMode(arg) as PermissionMode);
          return `Permission mode: ${arg}`;
        }

        // ── Working directory ────────────────────────────────────────────────

        case "/dir": {
          if (!arg) return `Working directory: ${workingDir}`;
          const newDir = path.resolve(workingDir, arg);
          if (!fs.existsSync(newDir) || !fs.statSync(newDir).isDirectory())
            return `Not a valid directory: ${newDir}`;
          // Sync all references to the new directory
          workingDirRef.current           = newDir;
          setWorkingDir(newDir);
          toolRegistryRef.current         = createToolRegistry(newDir);
          opts.permissionManager.setProjectDir(newDir);
          opts.hookManager.setWorkingDir(newDir);
          rebuildAndRefresh();
          return `Working directory: ${newDir}`;
        }

        // ── Context window & compaction ──────────────────────────────────────

        case "/compact": {
          const ag = agentRef.current as unknown as Record<string, (...a: unknown[]) => unknown>;
          ag.compactHistory?.();
          return "Context compacted.";
        }

        // ── Permissions, memory, hooks ───────────────────────────────────────

        case "/permissions": {
          const pm = opts.permissionManager as unknown as Record<string, (...a: unknown[]) => unknown>;
          if (arg === "clear") { pm.clearStored?.(); return "Stored permissions cleared."; }
          const perms = (pm.getAllStored?.() as Record<string, unknown>) || {};
          const lines = Object.entries(perms);
          return lines.length ? lines.map(([k, v]) => `${k}: ${v}`).join("\n") : "No stored permissions.";
        }

        case "/memory": {
          const ms = opts.memoryStore as unknown as Record<string, (...a: unknown[]) => unknown>;
          if (arg === "clear") { ms.clear?.(); return "Memory cleared."; }
          return opts.memoryStore.formatForPrompt() || "No memory stored.";
        }

        case "/hooks": {
          const hm = opts.hookManager as unknown as Record<string, (...a: unknown[]) => unknown>;
          return JSON.stringify(hm.getConfig?.() || {}, null, 2);
        }

        // ── Usage stats ──────────────────────────────────────────────────────

        case "/usage": {
          if (!lastUsage) return "No usage data yet.";
          return [
            `Input tokens:  ${lastUsage.inputTokens.toLocaleString()}`,
            `Output tokens: ${lastUsage.outputTokens.toLocaleString()}`,
            `Total tokens:  ${lastUsage.totalTokens.toLocaleString()}`,
            lastUsage.cost !== undefined ? `Cost:          $${lastUsage.cost.toFixed(4)}` : "",
          ].filter(Boolean).join("\n");
        }

        // ── Tasks & todos ────────────────────────────────────────────────────

        case "/tasks": {
          const todos = opts.todoStore?.getAll?.() || [];
          if (!todos.length) return "No tasks.";
          return todos
            .map((t: { id: string; status: string; subject: string }) =>
              `[${t.status}] ${t.id}: ${t.subject}`)
            .join("\n");
        }

        // ── Plan mode ────────────────────────────────────────────────────────

        case "/plan": {
          if (arg === "off" || arg === "cancel") {
            planModeActiveRef.current = false;
            planManagerRef.current.clearPlan();
            return "Plan mode disabled.";
          }
          if (arg === "show") {
            const plan = planManagerRef.current.getCurrentPlan();
            return plan ? planManagerRef.current.formatPlan() : "No active plan.";
          }
          if (arg === "approve" || arg === "yes") {
            if (planManagerRef.current.approvePlan()) {
              planModeActiveRef.current = false;
              const plan = planManagerRef.current.getCurrentPlan();
              if (plan) {
                planManagerRef.current.startExecution();
                sendMessage(`Execute this plan:\n\n${planManagerRef.current.formatPlan()}\n\nOriginal request: ${plan.originalRequest}`);
              }
              return "Plan approved! Executing...";
            }
            return "No plan to approve.";
          }
          if (arg === "reject" || arg === "no") {
            planManagerRef.current.rejectPlan();
            planModeActiveRef.current = false;
            return "Plan rejected.";
          }
          if (!arg) {
            planModeActiveRef.current = !planModeActiveRef.current;
            return planModeActiveRef.current
              ? "Plan mode ON — next message will generate a plan."
              : "Plan mode OFF.";
          }
          // /plan <request> — immediately generate a plan for the given request
          planModeActiveRef.current = true;
          sendMessage(`[PLAN MODE] Analyze this request and create a step-by-step plan. Do NOT modify files.\n\nRequest: ${arg}`);
          return "Generating plan...";
        }

        // ── Effort level ─────────────────────────────────────────────────────

        case "/effort": {
          if (!arg)
            return `Current effort: ${effortManagerRef.current.getLevel()}\nUsage: /effort <low|medium|high|max>`;
          effortManagerRef.current.setLevel(arg as EffortLevel);
          rebuildAndRefresh();
          return `Effort level: ${arg}`;
        }

        // ── Ephemeral / one-shot questions ───────────────────────────────────

        case "/btw": {
          // Ask a question that doesn't get added to the conversation history
          if (!arg) return "Usage: /btw <question>  (ask without adding to history)";
          setIsProcessing(true);
          if (!agentRef.current) { setIsProcessing(false); return "No API key configured. Run /setup first."; }
          const ephemeralAgent = new (agentRef.current.constructor as any)(
            modelConfigRef.current, toolRegistryRef.current,
            opts.permissionManager, opts.hookManager,
          );
          let reply = "";
          await ephemeralAgent.run(arg, {
            onToken:      (t: string) => { reply += t; setStreamingContent(reply); },
            onToolCall:   () => {},
            onToolResult: () => {},
            onComplete:   () => {
              setMessages((prev) => [...prev, { id: nextId(), role: "assistant", content: reply }]);
              setStreamingContent("");
              setIsProcessing(false);
            },
            onError: (e: Error) => {
              addSystemMessage(`❌ ${e.message}`);
              setStreamingContent("");
              setIsProcessing(false);
            },
          });
          return null; // streaming has taken over the display
        }

        // ── Misc ─────────────────────────────────────────────────────────────

        case "/rules":
          return rulesManagerRef.current.formatForDisplay();

        case "/mcp": {
          const mcp = mcpManagerRef.current as unknown as Record<string, (...a: unknown[]) => unknown>;
          return (mcp.getStatus?.() as string) || "No MCP servers configured.";
        }

        case "/context": {
          const ps = contextProvidersRef.current.getAll();
          if (!ps.length) return "No context providers registered.";
          return ps.map((p) => `${p.trigger} — ${p.description || ""}`).join("\n");
        }

        case "/queue": {
          if (!queueRef.current.length) return "No messages in queue.";
          return queueRef.current.map((m, i) => `${i + 1}. ${m.substring(0, 60)}`).join("\n");
        }

        case "/theme": {
          if (!arg) {
            const current = getThemeName();
            const available = getAvailableThemes().join(", ");
            return `Current theme: ${current}\nUsage: /theme <${available}>`;
          }
          const validThemes = getAvailableThemes();
          if (!validThemes.includes(arg)) {
            return `Unknown theme "${arg}". Available: ${validThemes.join(", ")}`;
          }
          const result = setTheme(arg as any);
          return result;
        }

        case "/doctor":
          handleDoctor();
          return "Doctor check complete.";

        case "/init":
          handleInit();
          return "Project initialized.";

        case "/logout":
          modelConfigRef.current.oauthToken = undefined;
          modelConfigRef.current.apiKey     = undefined;
          return oauthLogout() + "\nRun /setup to configure a new API key or log in again.";

        case "/login":
          return "Use /setup to configure provider, model, and authentication.";

        case "/auth-status":
          return oauthStatus();

        case "/exit":
        case "/quit":
          process.exit(0);

        default:
          return `Unknown command: ${cmd}\nType /help for available commands.`;
      }
    },
    // The deps array includes everything the callback closes over that changes
    [workingDir, lastUsage, sendMessage, backgroundJobs, opts],
  );

  // ─────────────────────────────────────────────────────────────────────────
  // Public API — what App.tsx destructures from useChat()
  // ─────────────────────────────────────────────────────────────────────────

  return {
    // Message list (drives the <Static> / stdout rendering in App.tsx)
    messages,
    setMessages,

    // Live streaming area
    streamingContent,

    // Processing state
    isProcessing,
    toolActivity,

    // Token usage (status bar)
    lastUsage,
    contextUsage,

    // Working directory (status bar + /dir command)
    workingDir,

    // Background jobs (status bar badge)
    backgroundJobs,

    // Session browser overlay (/ls command)
    showSessionBrowser,
    setShowSessionBrowser,

    // Returns all saved conversations (used by SessionBrowser)
    conversations: listConversations,

    // Current model config (read by StatusBar) — live snapshot, updates on every config change
    modelConfig: liveModelConfig,

    // Actions
    sendMessage,
    handleSlashCommand,
    cancelCurrent,
    addSystemMessage,
  };
}
