/**
 * useChatState.ts — Central Chat State Management (Multi-Tab, Performance-Optimized)
 *
 * Performance features (inspired by Continue.dev):
 *   - Batched token streaming via requestAnimationFrame (not per-token re-renders)
 *   - React.memo-compatible state updates
 *   - Per-tab entry storage for instant tab switching
 */

import { useState, useCallback, useRef, useEffect } from "react";
import type { ChatEntry, ChatMessage, ConversationSummary, ContextAttachment, ExtensionConfig, IncomingMessage } from "../types";
import { useVsCode } from "./useVsCode";

let idCounter = 0;
function nextId(): string {
  return `entry-${++idCounter}-${Date.now()}`;
}

export interface Tab {
  id: string;
  title: string;
}

interface TabData {
  entries: ChatEntry[];
  streamingId: string | null;
}

export function useChatState() {
  const vscode = useVsCode();

  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const tabDataRef = useRef<Map<string, TabData>>(new Map());

  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [queueCount, setQueueCount] = useState(0);
  const [modelLabel, setModelLabel] = useState("anthropic");
  const [providerLabel, setProviderLabel] = useState("anthropic");
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [extensionConfig, setExtensionConfig] = useState<ExtensionConfig | null>(null);

  const streamingRef = useRef<string | null>(null);

  // ── Batched Token Streaming ──────────────────────────
  // Accumulate tokens in a buffer and flush via rAF (not per-token setState)
  const tokenBufferRef = useRef<string>("");
  const rafRef = useRef<number | null>(null);

  const flushTokenBuffer = useCallback(() => {
    rafRef.current = null;
    const buffered = tokenBufferRef.current;
    if (!buffered) return;
    tokenBufferRef.current = "";

    setEntries((prev) => {
      if (streamingRef.current) {
        return prev.map((e) =>
          e.id === streamingRef.current
            ? { ...e, content: (e as ChatMessage).content + buffered }
            : e
        );
      }
      const id = nextId();
      streamingRef.current = id;
      return [...prev, { id, role: "assistant" as const, content: buffered }];
    });
  }, []);

  const appendToken = useCallback((token: string) => {
    tokenBufferRef.current += token;
    if (rafRef.current === null) {
      rafRef.current = requestAnimationFrame(flushTokenBuffer);
    }
  }, [flushTokenBuffer]);

  // Cleanup rAF on unmount
  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  // ── Tab Data Helpers ─────────────────────────────────

  const getTabData = useCallback((tabId: string): TabData => {
    let data = tabDataRef.current.get(tabId);
    if (!data) {
      data = { entries: [], streamingId: null };
      tabDataRef.current.set(tabId, data);
    }
    return data;
  }, []);

  // Keep tab data in sync
  useEffect(() => {
    if (activeTabId) {
      const data = getTabData(activeTabId);
      data.entries = entries;
    }
  }, [entries, activeTabId, getTabData]);

  // ── Entry Mutators ───────────────────────────────────

  const addUserMessage = useCallback((text: string) => {
    setEntries((prev) => [...prev, { id: nextId(), role: "user" as const, content: text }]);
  }, []);

  const addSystemMessage = useCallback((text: string, role: "system" | "error" = "system") => {
    setEntries((prev) => [...prev, { id: nextId(), role, content: text }]);
  }, []);

  // Track the latest tool call ID per tool name so results can update the same entry
  const toolCallMapRef = useRef<Map<string, string>>(new Map());

  const addToolCall = useCallback((name: string, input: string) => {
    const id = nextId();
    // Store mapping: toolName → entryId (for result matching)
    toolCallMapRef.current.set(name, id);
    setEntries((prev) => [...prev, { id, kind: "call" as const, name, input, output: "" }]);
  }, []);

  const addToolResult = useCallback((name: string, result: string, isError: boolean) => {
    const callId = toolCallMapRef.current.get(name);
    if (callId) {
      // Update the existing call entry with the result
      toolCallMapRef.current.delete(name);
      setEntries((prev) =>
        prev.map((e) =>
          e.id === callId && "kind" in e
            ? { ...e, kind: "result" as const, output: result, isError }
            : e
        )
      );
    } else {
      // No matching call — create a standalone result entry
      setEntries((prev) => [...prev, { id: nextId(), kind: "result" as const, name, input: "", output: result, isError }]);
    }
  }, []);

  const clearAll = useCallback(() => {
    setEntries([]);
    streamingRef.current = null;
    tokenBufferRef.current = "";
    setQueueCount(0);
  }, []);

  // ── Actions ──────────────────────────────────────────

  const sendMessage = useCallback((text: string, context?: ContextAttachment[]) => {
    if (!text.trim() && (!context || context.length === 0)) return;
    // Build display text: show context labels above the user's message
    let displayText = text;
    if (context && context.length > 0) {
      const labels = context.map((c) => {
        const name = c.path.split("/").pop() || c.path;
        if (c.type === "selection" && c.startLine) return `[${name}:${c.startLine}${c.endLine ? `-${c.endLine}` : ""}]`;
        return `[${name}]`;
      });
      displayText = labels.join(" ") + (text ? "\n" + text : "");
    }
    addUserMessage(displayText);
    vscode.postMessage({ type: "sendMessage", text, context });
  }, [addUserMessage, vscode]);

  const sendCommand = useCallback((command: string) => {
    vscode.postMessage({ type: "command", command });
  }, [vscode]);

  const createNewTab = useCallback(() => {
    vscode.postMessage({ type: "newTab" });
  }, [vscode]);

  const switchToTab = useCallback((tabId: string) => {
    // Save current tab before switch
    if (activeTabId) {
      const data = getTabData(activeTabId);
      data.streamingId = streamingRef.current;
    }
    vscode.postMessage({ type: "switchTab", tabId });
  }, [vscode, activeTabId, getTabData]);

  const closeTab = useCallback((tabId: string) => {
    tabDataRef.current.delete(tabId);
    vscode.postMessage({ type: "closeTab", tabId });
  }, [vscode]);

  const openHistory = useCallback(() => {
    vscode.postMessage({ type: "listHistory" });
    setShowHistory(true);
  }, [vscode]);

  const closeHistory = useCallback(() => {
    setShowHistory(false);
  }, []);

  const resumeConversation = useCallback((id: string) => {
    vscode.postMessage({ type: "resumeConversation", id });
    setShowHistory(false);
  }, [vscode]);

  const deleteConversation = useCallback((id: string) => {
    vscode.postMessage({ type: "deleteConversation", id });
  }, [vscode]);

  const openSettings = useCallback(() => {
    vscode.postMessage({ type: "getConfig" });
    setShowSettings(true);
  }, [vscode]);

  const closeSettings = useCallback(() => {
    setShowSettings(false);
  }, []);

  const saveSettings = useCallback((config: Partial<ExtensionConfig>) => {
    vscode.postMessage({ type: "updateConfig", config });
    setShowSettings(false);
  }, [vscode]);

  const openVscodeSettings = useCallback(() => {
    vscode.postMessage({ type: "openVscodeSettings" });
  }, [vscode]);

  const cancelGeneration = useCallback(() => {
    vscode.postMessage({ type: "cancelGeneration" });
  }, [vscode]);

  // ── Message Handler ──────────────────────────────────

  useEffect(() => {
    function handler(event: MessageEvent<IncomingMessage>) {
      const msg = event.data;
      switch (msg.type) {
        case "startResponse":
          setIsProcessing(true);
          streamingRef.current = null;
          break;
        case "token":
          appendToken(msg.text);
          break;
        case "finalizeStreaming":
          // Flush any buffered tokens first, then finalize the current streaming message
          // so it stays visible and next tokens create a new assistant message
          if (tokenBufferRef.current) flushTokenBuffer();
          streamingRef.current = null;
          break;
        case "toolCall":
          addToolCall(msg.name, msg.input);
          break;
        case "toolResult":
          addToolResult(msg.name, msg.result, msg.isError);
          break;
        case "endResponse":
          // Flush any remaining tokens
          if (tokenBufferRef.current) flushTokenBuffer();
          setIsProcessing(false);
          streamingRef.current = null;
          break;
        case "error":
          if (tokenBufferRef.current) flushTokenBuffer();
          setIsProcessing(false);
          streamingRef.current = null;
          addSystemMessage(msg.text, "error");
          break;
        case "systemMessage":
          addSystemMessage(msg.text);
          break;
        case "clear":
          clearAll();
          break;
        case "usageInfo":
          // Append usage as a subtle footer on the last assistant message (not a separate message)
          setEntries((prev) => {
            // Find the last assistant message and append usage to it
            for (let i = prev.length - 1; i >= 0; i--) {
              const entry = prev[i];
              if ("role" in entry && entry.role === "assistant") {
                const updated = { ...entry, content: entry.content + `\n\n---\n*${msg.text}*` };
                return [...prev.slice(0, i), updated, ...prev.slice(i + 1)];
              }
            }
            // No assistant message found — skip (don't create a separate message)
            return prev;
          });
          break;
        case "configUpdated":
          setProviderLabel(msg.provider);
          setModelLabel(msg.model || msg.provider);
          break;

        // Tab messages
        case "tabCreated":
          setTabs((prev) => prev.some((t) => t.id === msg.tabId) ? prev : [...prev, { id: msg.tabId, title: msg.title }]);
          break;
        case "tabSwitched": {
          setEntries((currentEntries) => {
            if (activeTabId) {
              const data = getTabData(activeTabId);
              data.entries = currentEntries;
              data.streamingId = streamingRef.current;
            }
            const newData = getTabData(msg.tabId);
            streamingRef.current = newData.streamingId;
            return newData.entries;
          });
          setActiveTabId(msg.tabId);
          setIsProcessing(false);
          break;
        }
        case "tabClosed":
          setTabs((prev) => prev.filter((t) => t.id !== msg.tabId));
          tabDataRef.current.delete(msg.tabId);
          break;
        case "tabTitleUpdated":
          setTabs((prev) => prev.map((t) => t.id === msg.tabId ? { ...t, title: msg.title } : t));
          break;

        // Settings
        case "configData":
          setExtensionConfig((msg as any).config || null);
          break;

        // Conversation history
        case "conversationList":
          setConversations((msg as any).conversations || []);
          break;
        case "conversationMessages": {
          // Restore messages from a resumed conversation into the UI
          const restored = (msg as any).messages as Array<{ role: string; content: string }>;
          if (restored && restored.length > 0) {
            const restoredEntries: ChatEntry[] = restored.map((m) => ({
              id: nextId(),
              role: m.role as "user" | "assistant",
              content: m.content,
            }));
            setEntries(restoredEntries);
          }
          break;
        }
      }

      if ("queueCount" in msg && typeof (msg as any).queueCount === "number") {
        setQueueCount((msg as any).queueCount);
      }
    }

    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [activeTabId, appendToken, flushTokenBuffer, addToolCall, addToolResult, addSystemMessage, clearAll, getTabData]);

  useEffect(() => {
    vscode.postMessage({ type: "ready" });
  }, [vscode]);

  return {
    tabs, activeTabId, createNewTab, switchToTab, closeTab,
    entries, isProcessing, queueCount, modelLabel, providerLabel,
    sendMessage, sendCommand, clearAll,
    conversations, showHistory, openHistory, closeHistory,
    resumeConversation, deleteConversation,
    showSettings, extensionConfig, openSettings, closeSettings,
    saveSettings, openVscodeSettings, cancelGeneration,
  };
}
