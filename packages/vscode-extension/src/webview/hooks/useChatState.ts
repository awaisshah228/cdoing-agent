/**
 * useChatState.ts — Central Chat State Management (Multi-Tab)
 *
 * Each tab has its own entries, streaming ref, and processing state.
 * Switching tabs preserves history — messages are stored per-tab.
 */

import { useState, useCallback, useRef, useEffect } from "react";
import type { ChatEntry, ChatMessage, ToolCallEntry, IncomingMessage } from "../types";
import { useVsCode } from "./useVsCode";

let idCounter = 0;
function nextId(): string {
  return `entry-${++idCounter}-${Date.now()}`;
}

export interface Tab {
  id: string;
  title: string;
}

/** Per-tab stored state */
interface TabData {
  entries: ChatEntry[];
  streamingId: string | null;
}

export function useChatState() {
  const vscode = useVsCode();

  // Tab management
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);

  // Per-tab entries stored in a ref (avoids re-renders when switching)
  const tabDataRef = useRef<Map<string, TabData>>(new Map());

  // Current tab's entries (copied on switch for React rendering)
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [queueCount, setQueueCount] = useState(0);
  const [modelLabel, setModelLabel] = useState("anthropic");
  const [providerLabel, setProviderLabel] = useState("anthropic");

  const streamingRef = useRef<string | null>(null);

  /** Get or create tab data */
  const getTabData = useCallback((tabId: string): TabData => {
    let data = tabDataRef.current.get(tabId);
    if (!data) {
      data = { entries: [], streamingId: null };
      tabDataRef.current.set(tabId, data);
    }
    return data;
  }, []);

  /** Save current entries to active tab's data */
  const saveCurrentTab = useCallback(() => {
    if (activeTabId) {
      const data = getTabData(activeTabId);
      // We read entries from the latest state via a ref trick
      data.streamingId = streamingRef.current;
    }
  }, [activeTabId, getTabData]);

  // Keep tab data in sync with React state
  useEffect(() => {
    if (activeTabId) {
      const data = getTabData(activeTabId);
      data.entries = entries;
    }
  }, [entries, activeTabId, getTabData]);

  const appendToken = useCallback((token: string) => {
    setEntries((prev) => {
      if (streamingRef.current) {
        return prev.map((e) =>
          e.id === streamingRef.current
            ? { ...e, content: (e as ChatMessage).content + token }
            : e
        );
      }
      const id = nextId();
      streamingRef.current = id;
      const msg: ChatMessage = { id, role: "assistant", content: token };
      return [...prev, msg];
    });
  }, []);

  const addUserMessage = useCallback((text: string) => {
    const msg: ChatMessage = { id: nextId(), role: "user", content: text };
    setEntries((prev) => [...prev, msg]);
  }, []);

  const addSystemMessage = useCallback((text: string, role: "system" | "error" = "system") => {
    const msg: ChatMessage = { id: nextId(), role, content: text };
    setEntries((prev) => [...prev, msg]);
  }, []);

  const addToolCall = useCallback((name: string, input: string) => {
    const entry: ToolCallEntry = { id: nextId(), kind: "call", name, detail: input };
    setEntries((prev) => [...prev, entry]);
  }, []);

  const addToolResult = useCallback((name: string, result: string, isError: boolean) => {
    const entry: ToolCallEntry = { id: nextId(), kind: "result", name, detail: result, isError };
    setEntries((prev) => [...prev, entry]);
  }, []);

  const clearAll = useCallback(() => {
    setEntries([]);
    streamingRef.current = null;
    setQueueCount(0);
  }, []);

  const sendMessage = useCallback(
    (text: string) => {
      if (!text.trim()) return;
      addUserMessage(text);
      vscode.postMessage({ type: "sendMessage", text });
    },
    [addUserMessage, vscode]
  );

  const sendCommand = useCallback(
    (command: string) => {
      vscode.postMessage({ type: "command", command });
    },
    [vscode]
  );

  // Tab actions
  const createNewTab = useCallback(() => {
    vscode.postMessage({ type: "newTab" });
  }, [vscode]);

  const switchToTab = useCallback((tabId: string) => {
    // Save current tab data before switching
    saveCurrentTab();
    vscode.postMessage({ type: "switchTab", tabId });
  }, [vscode, saveCurrentTab]);

  const closeTab = useCallback((tabId: string) => {
    tabDataRef.current.delete(tabId);
    vscode.postMessage({ type: "closeTab", tabId });
  }, [vscode]);

  // Listen for messages
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
        case "toolCall":
          addToolCall(msg.name, msg.input);
          break;
        case "toolResult":
          addToolResult(msg.name, msg.result, msg.isError);
          break;
        case "endResponse":
          setIsProcessing(false);
          streamingRef.current = null;
          break;
        case "error":
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
          setTabs((prev) => {
            // Don't add duplicates
            if (prev.some((t) => t.id === msg.tabId)) return prev;
            return [...prev, { id: msg.tabId, title: msg.title }];
          });
          break;
        case "tabSwitched": {
          // Save current tab data
          setEntries((currentEntries) => {
            if (activeTabId) {
              const data = getTabData(activeTabId);
              data.entries = currentEntries;
              data.streamingId = streamingRef.current;
            }
            // Load new tab data
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
  }, [activeTabId, appendToken, addToolCall, addToolResult, addSystemMessage, clearAll, getTabData]);

  useEffect(() => {
    vscode.postMessage({ type: "ready" });
  }, [vscode]);

  return {
    // Tab state
    tabs,
    activeTabId,
    createNewTab,
    switchToTab,
    closeTab,
    // Chat state
    entries,
    isProcessing,
    queueCount,
    modelLabel,
    providerLabel,
    sendMessage,
    sendCommand,
    clearAll,
  };
}
