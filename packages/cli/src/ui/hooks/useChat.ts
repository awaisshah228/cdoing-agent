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

import { useState, useCallback, useRef, useMemo, useEffect } from "react";
import * as path from "path";
import * as fs from "fs";
import chalk from "chalk";
import { getDefaultModel } from "@cdoing/ai";
import type { ModelConfig, ImageAttachment } from "@cdoing/ai";
import {
  ShellExecTool,
  getOAuthProvider,
  PermissionMode,
  CodebaseIndexer,
} from "@cdoing/core";
import type {
  ToolRegistry,
  PermissionManager,
  HookManager,
  MemoryStore,
  TodoStore,
  SubAgentManager,
  ProcessManager,
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
  getHelpText,
  getConversationListText,
  TOOL_ICONS,
  getToolHint,
  printFileDiff,
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
  subAgentManager?:  SubAgentManager;
  processManager?:   ProcessManager;
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
  /** Full accumulated reply for the current turn (used by interrupt) */
  const fullReplyRef = useRef("");

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

  /** Track whether the component is still mounted to avoid state updates after unmount */
  const mountedRef = useRef(true);
  useEffect(() => {
    return () => { mountedRef.current = false; };
  }, []);

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

  const sendMessageRef = useRef<((text: string) => void) | null>(null);

  const cancelCurrent = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setIsProcessing(false);
    setStreamingContent("");
    setToolActivity(null);
    addSystemMessage("⏹  Cancelled.");

    // Process next queued message (queue would otherwise be stuck since onComplete won't fire)
    const next = queueRef.current.shift();
    if (next && sendMessageRef.current) {
      setTimeout(() => sendMessageRef.current!(next), 0);
    }
  }, []);

  /**
   * Interrupt the current streaming and send a new message immediately.
   * The partial response is preserved in agent history for context.
   */
  const interruptAndSend = useCallback((newMessage: string) => {
    const agent = agentRef.current;
    if (!agent) return;

    // Capture partial response
    const partial = fullReplyRef.current.trim();

    // Interrupt agent — adds partial to history for context
    agent.interrupt(partial);

    // Flush partial response to UI
    if (partial) {
      setMessages((prev) => [
        ...prev,
        { id: nextId(), role: "assistant" as const, content: partial + "\n\n*(interrupted)*" },
      ]);
    }

    setIsProcessing(false);
    setStreamingContent("");
    setToolActivity(null);

    // Send new message after a brief delay for state to settle
    setTimeout(() => {
      if (sendMessageRef.current) sendMessageRef.current(newMessage);
    }, 50);
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
    async (text: string, images?: ImageAttachment[]) => {
      // ── Guard: no agent (no key configured) ─────────────────────────────
      if (!agentRef.current) {
        addSystemMessage("No API key configured. Run /setup to authenticate.");
        return;
      }

      // ── Queue if busy (interrupt is handled externally via interruptAndSend) ──
      if (isProcessing) {
        queueRef.current.push(text);
        addSystemMessage(`📬 Queued (${queueRef.current.length} waiting). Use Escape to interrupt instead.`);
        return;
      }

      // ── Inject plan mode context if active ──────────────────────────────
      let messageText = text;
      if (planModeActiveRef.current && opts.permissionManager.getMode() === PermissionMode.PLAN) {
        messageText = `[PLAN MODE — Read-only] You are in plan mode. Do NOT write files, run commands, or modify anything. Only read, search, analyze, and create a plan using the todo tool. When your plan is ready, call plan_exit.\n\n${text}`;
      }

      // ── Resolve @mentions ────────────────────────────────────────────────
      const enriched = await resolveContextProviders(
        messageText,
        workingDirRef.current,
        lastTerminalOutputRef.current,
      );

      // ── Optimistic UI update ─────────────────────────────────────────────
      setIsProcessing(true);
      setMessages((prev) => [...prev, { id: nextId(), role: "user", content: text }]);
      addMessage(conversationRef.current, "user", text);

      const ctrl = new AbortController();
      abortRef.current = ctrl;

      /**
       * Track how much of fullReply has already been written directly to
       * stdout (to avoid double-printing it when it's committed to messages).
       */
      let fullReply  = "";
      let flushedPos = 0;
      fullReplyRef.current = "";

      /**
       * Flush any un-printed streaming text to stdout BEFORE showing a tool
       * call.  Without this, the text would disappear when Ink clears the
       * live area to render the tool spinner.
       */
      function flushStreamingText(): void {
        const pending = fullReply.slice(flushedPos);
        if (pending.trim()) {
          // "shell" role = no separator. Only onComplete uses "assistant" for final separator.
          setMessages((prev) => [...prev, { id: nextId(), role: "shell" as const, content: pending }]);
        }
        flushedPos = fullReply.length;
        setStreamingContent("");
      }

      // ── Agent run ────────────────────────────────────────────────────────
      await agentRef.current.run(enriched, {

        onToken: (token) => {
          fullReply += token;
          fullReplyRef.current = fullReply;
          if (!mountedRef.current) return;
          const unflushed = fullReply.slice(flushedPos);
          // Flush completed lines to Static immediately.
          // Only keep the last partial line in the dynamic area.
          // This prevents the dynamic area from growing tall and
          // causing scroll-to-top when cleared on completion.
          const lastNewline = unflushed.lastIndexOf("\n");
          if (lastNewline >= 0) {
            const completedLines = unflushed.slice(0, lastNewline);
            if (completedLines.trim()) {
              // Use "shell" role for streamed chunks — no separator line.
              // Only the final chunk in onComplete uses "assistant" (with separator).
              setMessages((prev) => [...prev, {
                id: nextId(), role: "shell" as const, content: completedLines,
              }]);
            }
            flushedPos += lastNewline + 1;
            setStreamingContent(fullReply.slice(flushedPos));
          } else {
            setStreamingContent(unflushed);
          }
        },

        onTextToolCallDetected: () => {
          if (!mountedRef.current) return;
          // Local models (Ollama) may stream tool calls as text — clear the raw JSON
          fullReply = "";
          flushedPos = 0;
          setStreamingContent("");
        },

        onToolCallStreaming: (name) => {
          if (!mountedRef.current) return;
          // Model is starting to generate a tool call — flush and show indicator
          flushStreamingText();
          const icon = TOOL_ICONS[name] || "⚡";
          setMessages((prev) => [...prev, {
            id: nextId(), role: "system",
            content: chalk.dim(`  ◌ ${icon} ${name}…`),
          }]);
        },

        onToolCall: (name, input) => {
          if (!mountedRef.current) return;
          flushStreamingText();
          lastToolInputRef.current = input;
          const icon = TOOL_ICONS[name] || "⚡";
          const hint = getToolHint(name, input);
          setMessages((prev) => [...prev, {
            id: nextId(), role: "system",
            content: chalk.yellow(`  ▶ ${icon} ${name}`) + (hint ? chalk.gray("  " + hint) : ""),
          }]);
          const preview = JSON.stringify(input).substring(0, 60);
          setToolActivity({ name, preview, status: "running" });
        },

        onToolProgress: (name, chunk) => {
          if (!mountedRef.current) return;
          // Stream shell output in real-time to the terminal
          process.stdout.write(chalk.gray(chunk));
        },

        onDiffChunk: (chunk) => {
          if (!mountedRef.current) return;
          // Stream file diff chunks in real-time
          const line = chunk.content;
          switch (chunk.type) {
            case "file-header":
              process.stdout.write(chalk.bold.white(`\n  📄 ${line}\n`));
              break;
            case "add":
              process.stdout.write(chalk.green(`  + ${line}\n`));
              break;
            case "remove":
              process.stdout.write(chalk.red(`  - ${line}\n`));
              break;
            case "hunk-header":
              process.stdout.write(chalk.cyan(`  ${line}\n`));
              break;
            // skip 'context' lines to keep output concise
          }
        },

        onToolResult: (_name, _result, isError) => {
          if (!mountedRef.current) return;
          const icon = TOOL_ICONS[_name] || "⚡";
          const line = isError
            ? chalk.red(`  ✗ ${icon} ${_name}`)
            : chalk.green("  ✓ ") + chalk.cyan(`${icon} ${_name}`);
          setMessages((prev) => [...prev, { id: nextId(), role: "system", content: line }]);
          // Show diff for file edits/writes (fallback if onDiffChunk wasn't triggered)
          if (!isError && (_name === "file_edit" || _name === "file_write")) {
            printFileDiff(_name, lastToolInputRef.current);
          }
          lastToolInputRef.current = {};
          setToolActivity(null);
        },

        onComplete: () => {
          if (!mountedRef.current) return;
          // Flush any remaining un-flushed text to the UI
          const remaining = fullReply.slice(flushedPos);
          if (remaining.trim()) {
            setMessages((prev) => [...prev, { id: nextId(), role: "assistant", content: remaining }]);
          }
          // Save the full reply to conversation history exactly once
          if (fullReply.trim()) {
            addMessage(conversationRef.current, "assistant", fullReply);
          }

          setStreamingContent("");
          setIsProcessing(false);
          abortRef.current = null;

          // Kill all background processes and sub-agents spawned during this agent run
          const shellTool = opts.toolRegistry.get("shell_exec") as ShellExecTool | undefined;
          let killedProcesses = 0;
          let killedAgents = 0;
          if (shellTool?.getProcessManager) {
            killedProcesses = shellTool.getProcessManager().killAll();
          }
          if (opts.subAgentManager) {
            killedAgents = opts.subAgentManager.terminateAll();
          }
          const totalKilled = killedProcesses + killedAgents;
          if (totalKilled > 0) {
            const parts: string[] = [];
            if (killedProcesses > 0) parts.push(`${killedProcesses} background process${killedProcesses > 1 ? "es" : ""}`);
            if (killedAgents > 0) parts.push(`${killedAgents} background sub-agent${killedAgents > 1 ? "s" : ""}`);
            setMessages((prev) => [...prev, {
              id: nextId(), role: "system",
              content: chalk.yellow(`[auto-killed ${parts.join(" and ")}]`),
            }]);
          }

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
          if (!mountedRef.current) return;
          const msg = err.message;
          let display: string;
          if (msg.includes("401") || msg.includes("403") || msg.includes("authentication") || msg.includes("invalid_api_key") || msg.includes("Authentication")) {
            display = `❌ Authentication Error\n${msg}\n\nRun /setup or /login to re-authenticate.`;
          } else if (msg.includes("429") || msg.includes("rate") || msg.includes("quota") || msg.includes("credit balance")) {
            display = `❌ Rate Limit / Quota Error\n${msg}\n\nWait a moment and retry, or use /model to switch models.`;
          } else if (msg.includes("404") || (msg.includes("not found") && msg.includes("odel"))) {
            display = `❌ Model Not Found\n${msg}\n\nUse /model to switch to a valid model.`;
          } else if (msg.includes("ECONNREFUSED") || msg.includes("ENOTFOUND") || msg.includes("ETIMEDOUT") || msg.includes("fetch failed") || msg.includes("network") || msg.includes("socket")) {
            display = `❌ Network Error\n${msg}\n\nCheck your internet connection and try again.`;
          } else if (msg.includes("400") || msg.includes("invalid")) {
            display = `❌ Invalid Request\n${msg}\n\nThe model rejected the request — try /model to switch models.`;
          } else if (msg.includes("Empty response")) {
            display = `❌ Empty Response\nThe model returned no output. Try again or use /model to switch models.`;
          } else {
            display = `❌ Error: ${msg}`;
          }
          setMessages((prev) => [
            ...prev,
            { id: nextId(), role: "system", content: display, isError: true },
          ]);
          setStreamingContent("");
          setIsProcessing(false);
          abortRef.current = null;
        },

        onUsage: (usage) => {
          if (!mountedRef.current) return;
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
        onCompactStart: (contextPercent: number) => {
          if (!mountedRef.current) return;
          try {
            addSystemMessage(`⟳ Compacting context (${contextPercent}% used)...`);
          } catch {}
        },
        onCompactEnd: (savedTokens: number, newPercent: number) => {
          if (!mountedRef.current) return;
          try {
            addSystemMessage(`✓ Context compacted — saved ${savedTokens.toLocaleString()} tokens (now ${newPercent}%)`);
          } catch {}
        },
      }, images);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isProcessing, resolveContextProviders],
  );

  // Keep ref in sync so cancelCurrent (defined earlier) can dequeue
  sendMessageRef.current = sendMessage;

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

        case "/view": {
          if (!arg) return "Usage: /view <id>  — view messages in a conversation";
          const viewConv = loadConversation(arg);
          if (!viewConv) return `Conversation not found: ${arg}`;
          const viewMsgs = viewConv.messages.filter((m) => m.role !== "tool");
          if (viewMsgs.length === 0) return `No messages in conversation: ${arg}`;
          const lines: string[] = [
            chalk.cyan.bold(`💬 ${viewConv.title}`),
            chalk.gray(`   ${viewMsgs.length} messages  ·  ${viewConv.provider}/${viewConv.model}`),
            chalk.gray("─".repeat(60)),
          ];
          for (const m of viewMsgs) {
            const time = new Date(m.timestamp).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
            const isUser = m.role === "user";
            const label = isUser ? chalk.green.bold("❯ You") : chalk.cyan.bold("◆ Assistant");
            const content = m.content.trim();
            // Truncate very long messages
            const display = content.length > 500 ? content.substring(0, 497) + "..." : content;
            lines.push(`${label}  ${chalk.gray(time)}`);
            for (const line of display.split("\n").slice(0, 8)) {
              lines.push(`    ${line}`);
            }
            if (display.split("\n").length > 8) lines.push(chalk.gray("    ..."));
          }
          lines.push(chalk.gray("─".repeat(60)));
          lines.push(chalk.gray(`Use /resume ${arg} to continue this conversation.`));
          return lines.join("\n");
        }

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
              if (!mountedRef.current) return;
              setBackgroundJobs((prev) =>
                prev.map((j) => j.id === id
                  ? { ...j, status: "done", result, completedAt: Date.now() }
                  : j));
              addSystemMessage(`✅ Background job done: ${id}`);
            },
            onError: (e: Error) => {
              if (!mountedRef.current) return;
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
          const provider = String(modelConfigRef.current.provider || "anthropic");
          const isOAuth = !!modelConfigRef.current.oauthToken;
          const oauthConfig = isOAuth ? getOAuthProvider(provider) : null;
          const oauthModels = oauthConfig?.models || [];

          if (!arg) {
            const def = getDefaultModel(provider) || "(none)";
            const cur = modelConfigRef.current.model || `(default: ${def})`;
            const lines = [
              `Current model: ${cur}`,
              `Auth: ${isOAuth ? "OAuth" : "API key"}`,
              `Usage: /model <name>    — switch to a specific model`,
              `       /model default  — reset to provider default (${def})`,
            ];
            if (isOAuth && oauthModels.length > 0) {
              lines.push(`Available OAuth models for ${provider}:`);
              for (const m of oauthModels) {
                const marker = m.id === cur ? " (current)" : "";
                lines.push(`  ${m.id} — ${m.name}${m.hint ? ` (${m.hint})` : ""}${marker}`);
              }
            } else {
              lines.push(
                `Provider models:`,
                `  anthropic: claude-sonnet-4-6, claude-opus-4-6, claude-haiku-4-5`,
                `  openai:    gpt-4o, gpt-4o-mini, o3-mini`,
                `  google:    gemini-2.0-flash, gemini-1.5-pro`,
                `  ollama:    llama3.1, mistral, codellama`,
              );
            }
            return lines.join("\n");
          }
          if (arg === "default") {
            modelConfigRef.current.model = undefined;
            rebuildAndRefresh();
            const def = getDefaultModel(provider) || "provider default";
            return `Model reset to default: ${def}`;
          }
          // Validate model against OAuth allowed list
          if (isOAuth && oauthModels.length > 0) {
            const allowed = oauthModels.map(m => m.id);
            if (!allowed.includes(arg)) {
              const available = oauthModels.map(m => `  ${m.id} — ${m.name}`).join("\n");
              return [
                `Error: "${arg}" is not available with OAuth for ${provider}.`,
                ``,
                `Available models:`,
                available,
                ``,
                `Tip: Use the full model ID (e.g. claude-sonnet-4-6-20260220)`,
              ].join("\n");
            }
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
          toolRegistryRef.current         = await createToolRegistry(newDir, {
            planExitCallback: (summary: string) => {
              planModeActiveRef.current = true;
              addSystemMessage([
                "",
                "📋 **Plan Ready for Review**",
                summary,
                "",
                "`/plan approve`  — approve and start building",
                "`/plan reject`   — reject the plan",
                "`/plan show`     — review plan details",
              ].join("\n"));
            },
          });
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
            opts.permissionManager.setMode(PermissionMode.DEFAULT);
            rebuildAndRefresh();
            return "Plan mode cancelled. Switched to build mode.";
          }
          if (arg === "show") {
            const plan = planManagerRef.current.getCurrentPlan();
            return plan ? planManagerRef.current.formatPlan() : "No active plan.";
          }
          if (arg === "approve" || arg === "yes") {
            const plan = planManagerRef.current.getCurrentPlan();
            if (!plan) return "No plan to approve. Use /plan <request> to create one.";
            if (plan.status !== "pending_approval") return `Plan is ${plan.status}, not pending approval.`;

            // Approve and switch to build mode
            planManagerRef.current.approvePlan();
            planManagerRef.current.startExecution();
            planModeActiveRef.current = false;
            opts.permissionManager.setMode(PermissionMode.DEFAULT);
            rebuildAndRefresh();

            // Send the full plan to the LLM with build mode instructions
            sendMessage([
              "[MODE SWITCH: Plan → Build]",
              "Your operational mode has changed from plan to build.",
              "You are no longer in read-only mode. You now have full access to write files, run commands, and execute tools.",
              "",
              "## Approved Plan",
              planManagerRef.current.formatPlan(),
              "",
              `## Original Request`,
              plan.originalRequest,
              "",
              plan.filePath ? `## Plan File\nSaved at: \`${plan.filePath}\` — you can read this file for reference.\n` : "",
              "## Instructions",
              "Execute the plan above step by step. Mark each step as completed using the todo tool as you go.",
              "If a step fails, explain why and suggest alternatives. Do not skip steps.",
            ].join("\n"));

            const planPath = plan.filePath ? `\nPlan saved at: ${plan.filePath}` : "";
            return `Plan approved! Switched to build mode. Executing plan...${planPath}`;
          }
          if (arg === "reject" || arg === "no") {
            planManagerRef.current.rejectPlan();
            planModeActiveRef.current = false;
            opts.permissionManager.setMode(PermissionMode.DEFAULT);
            rebuildAndRefresh();
            return "Plan rejected. Switched to build mode.";
          }
          if (!arg) {
            planModeActiveRef.current = !planModeActiveRef.current;
            if (planModeActiveRef.current) {
              opts.permissionManager.setMode(PermissionMode.PLAN);
              rebuildAndRefresh();
              return "Plan mode ON (read-only enforced). Send a message to start planning.\nUse /plan approve to execute, /plan reject to cancel.";
            } else {
              opts.permissionManager.setMode(PermissionMode.DEFAULT);
              rebuildAndRefresh();
              return "Plan mode OFF. Switched to build mode.";
            }
          }
          // /plan <request> — enter plan mode and start planning
          planModeActiveRef.current = true;
          opts.permissionManager.setMode(PermissionMode.PLAN);
          rebuildAndRefresh();
          sendMessage([
            "[PLAN MODE — Read-only]",
            "Analyze this request and create a detailed step-by-step implementation plan.",
            "You are in read-only mode — you can read files, search code, and explore, but CANNOT write or execute anything.",
            "",
            "When your plan is complete, call plan_exit with a summary. The user will then review and approve before you can start building.",
            "",
            `Request: ${arg}`,
          ].join("\n"));
          return `Plan mode ON (read-only). Generating plan...\nPlans will be saved to: ${planManagerRef.current.getPlansDir()}`;
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
            onToken:      (t: string) => { reply += t; if (mountedRef.current) setStreamingContent(reply); },
            onToolCall:   () => {},
            onToolResult: () => {},
            onComplete:   () => {
              if (!mountedRef.current) return;
              setMessages((prev) => [...prev, { id: nextId(), role: "assistant", content: reply }]);
              setStreamingContent("");
              setIsProcessing(false);
            },
            onError: (e: Error) => {
              if (!mountedRef.current) return;
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

        case "/index": {
          const indexer = new CodebaseIndexer(workingDir);

          if (arg === "stats") {
            const s = indexer.getStats();
            const ago = s.lastIndexed > 0 ? `${Math.round((Date.now() - s.lastIndexed) / 60000)} min ago` : "never";
            indexer.close();
            return [
              chalk.hex("#4FC3F7").bold("📇 Index Stats"),
              `  Files:      ${s.totalFiles}`,
              `  Chunks:     ${s.totalChunks}`,
              `  FTS:        ${s.ftsEntries}`,
              `  Embeddings: ${s.embeddingEntries}`,
              `  Size:       ${(s.indexSizeBytes / 1024).toFixed(1)} KB`,
              `  Last index: ${ago}`,
            ].join("\n");
          }

          if (arg === "clear") {
            indexer.clearIndex();
            indexer.close();
            return chalk.hex("#81C784")("Index cleared.");
          }

          // Default: run incremental index (--full if arg is "full")
          if (arg === "full") indexer.clearIndex();

          addSystemMessage(chalk.hex("#78909C")("Indexing codebase..."));
          indexer.index().then((result) => {
            const msg = [
              chalk.hex("#81C784")(`✓ Indexed: +${result.added} new, ~${result.updated} updated, -${result.deleted} deleted`),
              chalk.hex("#B0BEC5")(`  ${result.totalChunks} chunks total`),
            ].join("\n");
            addSystemMessage(msg);
            indexer.close();
          }).catch((err) => {
            addSystemMessage(chalk.hex("#EF5350")(`Index error: ${(err as Error).message}`));
            indexer.close();
          });
          return null;
        }

        case "/doctor":
          handleDoctor();
          return "Doctor check complete.";

        case "/init":
          handleInit();
          return "Project initialized.";

        case "/logout": {
          modelConfigRef.current.oauthToken = undefined;
          modelConfigRef.current.apiKey     = undefined;
          // Invalidate the in-memory agent so it can't make further API calls
          agentRef.current?.invalidate();
          return oauthLogout() + "\nRun /setup to configure a new API key or log in again.";
        }

        case "/login":
          return "Use /setup to configure provider, model, and authentication.";

        case "/auth-status":
          return oauthStatus();

        case "/exit":
        case "/quit": {
          // Kill all background processes before exiting
          const shellTool = opts.toolRegistry.get("shell_exec") as ShellExecTool | undefined;
          if (shellTool?.getProcessManager) {
            const killed = shellTool.getProcessManager().killAll();
            if (killed > 0) {
              process.stdout.write(chalk.yellow(`[killed ${killed} background process${killed > 1 ? "es" : ""}]\n`));
            }
          }
          process.exit(0);
        }

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
    interruptAndSend,
    addSystemMessage,
  };
}
