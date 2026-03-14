/**
 * useChatState.ts — Central Chat State Management (Multi-Tab, Performance-Optimized)
 *
 * Performance features (inspired by Continue.dev):
 *   - Batched token streaming via requestAnimationFrame (not per-token re-renders)
 *   - React.memo-compatible state updates
 *   - Per-tab entry storage for instant tab switching
 */

import { useState, useCallback, useRef, useEffect } from "react";
import type { ChatEntry, ChatMessage, IncomingMessage } from "../types";
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

  const addToolCall = useCallback((name: string, input: string) => {
    setEntries((prev) => [...prev, { id: nextId(), kind: "call" as const, name, detail: input }]);
  }, []);

  const addToolResult = useCallback((name: string, result: string, isError: boolean) => {
    setEntries((prev) => [...prev, { id: nextId(), kind: "result" as const, name, detail: result, isError }]);
  }, []);

  const clearAll = useCallback(() => {
    setEntries([]);
    streamingRef.current = null;
    tokenBufferRef.current = "";
    setQueueCount(0);
  }, []);

  // ── Actions ──────────────────────────────────────────

  const sendMessage = useCallback((text: string) => {
    if (!text.trim()) return;
    addUserMessage(text);
    vscode.postMessage({ type: "sendMessage", text });
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
        case "discardStreaming":
          // Remove current streaming assistant message (intermediate text before tool calls)
          if (streamingRef.current) {
            const discardId = streamingRef.current;
            streamingRef.current = null;
            setEntries((prev) => prev.filter((e) => e.id !== discardId));
          }
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
          addSystemMessage(`📊 ${msg.text}`);
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
  };
}
