/**
 * useChatState.ts — Central Chat State Management
 *
 * This hook manages ALL chat state and communication with the extension host.
 * It handles:
 *   - The list of chat entries (messages + tool calls)
 *   - Processing state (is the agent thinking?)
 *   - Message queuing (send while processing)
 *   - Current model/provider labels (shown in the header badge)
 *   - Sending messages to the extension host
 *   - Listening for incoming messages (tokens, tool results, errors)
 *
 * All React components get their state from this hook via ChatPanel.
 */

import { useState, useCallback, useRef, useEffect } from "react";
import type { ChatEntry, ChatMessage, ToolCallEntry, IncomingMessage } from "../types";
import { useVsCode } from "./useVsCode";

/** Simple counter for generating unique IDs for each chat entry */
let idCounter = 0;
function nextId(): string {
  return `entry-${++idCounter}-${Date.now()}`;
}

export function useChatState() {
  const vscode = useVsCode();

  // All entries shown in the message list (messages, tool calls, tool results)
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  // True while the agent is processing (shows typing indicator, but input stays enabled)
  const [isProcessing, setIsProcessing] = useState(false);
  // Number of messages waiting in queue
  const [queueCount, setQueueCount] = useState(0);
  // Current model and provider names (displayed in the header badge)
  const [modelLabel, setModelLabel] = useState("anthropic");
  const [providerLabel, setProviderLabel] = useState("anthropic");

  // Ref to track the ID of the currently streaming assistant message.
  // When tokens arrive, we append them to this message instead of creating a new one.
  const streamingRef = useRef<string | null>(null);

  /**
   * Appends a token to the current streaming assistant message.
   * If no streaming message exists yet, creates one.
   * This is called rapidly as the LLM streams its response token by token.
   */
  const appendToken = useCallback((token: string) => {
    setEntries((prev) => {
      if (streamingRef.current) {
        // Append to the existing streaming message
        return prev.map((e) =>
          e.id === streamingRef.current
            ? { ...e, content: (e as ChatMessage).content + token }
            : e
        );
      }
      // First token — create a new assistant message
      const id = nextId();
      streamingRef.current = id;
      const msg: ChatMessage = { id, role: "assistant", content: token };
      return [...prev, msg];
    });
  }, []);

  /** Adds a user message bubble to the list */
  const addUserMessage = useCallback((text: string) => {
    const msg: ChatMessage = { id: nextId(), role: "user", content: text };
    setEntries((prev) => [...prev, msg]);
  }, []);

  /** Adds a system or error message to the list */
  const addSystemMessage = useCallback((text: string, role: "system" | "error" = "system") => {
    const msg: ChatMessage = { id: nextId(), role, content: text };
    setEntries((prev) => [...prev, msg]);
  }, []);

  /** Adds a "tool invoked" entry (shown when the agent calls a tool like file_read) */
  const addToolCall = useCallback((name: string, input: string) => {
    const entry: ToolCallEntry = { id: nextId(), kind: "call", name, detail: input };
    setEntries((prev) => [...prev, entry]);
  }, []);

  /** Adds a "tool finished" entry (shown after a tool returns its result) */
  const addToolResult = useCallback((name: string, result: string, isError: boolean) => {
    const entry: ToolCallEntry = { id: nextId(), kind: "result", name, detail: result, isError };
    setEntries((prev) => [...prev, entry]);
  }, []);

  /** Clears the entire chat history */
  const clearAll = useCallback(() => {
    setEntries([]);
    streamingRef.current = null;
    setQueueCount(0);
  }, []);

  /**
   * Sends a user message to the extension host.
   * Always adds to UI immediately. If processing, message gets queued on the host side.
   */
  const sendMessage = useCallback(
    (text: string) => {
      if (!text.trim()) return;
      addUserMessage(text);
      vscode.postMessage({ type: "sendMessage", text });
    },
    [addUserMessage, vscode]
  );

  /** Sends a slash command to the extension host (e.g. /model, /clear) */
  const sendCommand = useCallback(
    (command: string) => {
      vscode.postMessage({ type: "command", command });
    },
    [vscode]
  );

  // ─── Listen for messages FROM the extension host ───
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
      }

      // Update queue count from any message that includes it
      if ("queueCount" in msg && typeof (msg as any).queueCount === "number") {
        setQueueCount((msg as any).queueCount);
      }
    }

    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [appendToken, addToolCall, addToolResult, addSystemMessage, clearAll]);

  // On mount, tell the extension host we're ready to receive messages
  useEffect(() => {
    vscode.postMessage({ type: "ready" });
  }, [vscode]);

  return {
    entries,        // All chat entries to render
    isProcessing,   // Whether the agent is currently working
    queueCount,     // Number of queued messages
    modelLabel,     // Current model name (for header badge)
    providerLabel,  // Current provider name
    sendMessage,    // Function to send a user message (always works, queues if busy)
    sendCommand,    // Function to send a slash command
    clearAll,       // Function to clear chat
  };
}
