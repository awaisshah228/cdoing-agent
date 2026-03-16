/**
 * chatStore.ts — Zustand Chat Store (Multi-Tab, Performance-Optimized)
 *
 * Replaces useChatState hook with a Zustand store for cleaner per-tab state isolation.
 * Each tab's entries, streaming, and tool-call state are fully independent —
 * background tabs continue processing without interference.
 *
 * Performance features:
 *   - Batched token streaming via requestAnimationFrame (not per-token re-renders)
 *   - Per-tab isolation: switching tabs saves/restores all transient state
 */

import { create } from "zustand";
import type {
  ChatEntry,
  ChatMessage,
  ConversationSummary,
  ContextAttachment,
  ExtensionConfig,
  IncomingMessage,
  VsCodeApi,
} from "../types";
import { getVsCodeApi } from "../hooks/useVsCode";

// ── Types ──────────────────────────────────────────────

export interface Tab {
  id: string;
  title: string;
}

interface TabData {
  entries: ChatEntry[];
  streamingId: string | null;
  isProcessing: boolean;
  toolCallMap: Map<string, string>;
  tokenBuffer: string;
}

interface ChatState {
  // Tab state
  tabs: Tab[];
  activeTabId: string | null;

  // Active tab's view state (mirrored from TabData for reactivity)
  entries: ChatEntry[];
  isProcessing: boolean;
  queueCount: number;

  // Global UI state
  modelLabel: string;
  providerLabel: string;
  conversations: ConversationSummary[];
  showHistory: boolean;
  showSettings: boolean;
  extensionConfig: ExtensionConfig | null;
  permissionRequest: {
    id: string;
    toolName: string;
    message: string;
    hasProject: boolean;
  } | null;
}

interface ChatActions {
  // Entry mutators
  addUserMessage: (text: string) => void;
  addSystemMessage: (text: string, role?: "system" | "error") => void;
  addToolCall: (name: string, input: string, description?: string) => void;
  addToolResult: (name: string, result: string, isError: boolean) => void;
  clearAll: () => void;

  // Token streaming
  appendToken: (token: string) => void;
  flushTokenBuffer: () => void;

  // Tab management
  createNewTab: () => void;
  switchToTab: (tabId: string) => void;
  closeTab: (tabId: string) => void;

  // Actions
  sendMessage: (text: string, context?: ContextAttachment[]) => void;
  sendCommand: (command: string) => void;
  cancelGeneration: () => void;
  interruptAndSend: (newMessage: string) => void;

  // History
  openHistory: () => void;
  closeHistory: () => void;
  resumeConversation: (id: string) => void;
  deleteConversation: (id: string) => void;

  // Settings
  openSettings: () => void;
  closeSettings: () => void;
  saveSettings: (config: Partial<ExtensionConfig>) => void;
  openVscodeSettings: () => void;

  // Permissions
  respondToPermission: (decision: string) => void;

  // Message handler
  handleMessage: (msg: IncomingMessage) => void;

  // Init
  init: () => void;
}

// ── Helpers ────────────────────────────────────────────

let idCounter = 0;
function nextId(): string {
  return `entry-${++idCounter}-${Date.now()}`;
}

/** Shared VS Code API from useVsCode module (acquired once) */
function getVsCode(): VsCodeApi {
  return getVsCodeApi();
}

// ── Per-tab data (non-reactive, ref-like) ──────────────

const tabDataMap = new Map<string, TabData>();

function getTabData(tabId: string): TabData {
  let data = tabDataMap.get(tabId);
  if (!data) {
    data = {
      entries: [],
      streamingId: null,
      isProcessing: false,
      toolCallMap: new Map(),
      tokenBuffer: "",
    };
    tabDataMap.set(tabId, data);
  }
  return data;
}

// ── Streaming refs (mutable, not in store) ─────────────

let streamingId: string | null = null;
let tokenBuffer = "";
let rafHandle: number | null = null;
const toolCallMap = new Map<string, string>();

// ── Store ──────────────────────────────────────────────

export const useChatStore = create<ChatState & ChatActions>()((set, get) => {
  // Internal flush function (needs access to set)
  function flushTokenBufferInternal() {
    rafHandle = null;
    const buffered = tokenBuffer;
    if (!buffered) return;
    tokenBuffer = "";

    set((state) => {
      if (streamingId) {
        const sid = streamingId;
        return {
          entries: state.entries.map((e) =>
            e.id === sid
              ? { ...e, content: (e as ChatMessage).content + buffered }
              : e
          ),
        };
      }
      const id = nextId();
      streamingId = id;
      return {
        entries: [
          ...state.entries,
          { id, role: "assistant" as const, content: buffered },
        ],
      };
    });
  }

  /** Save active tab's transient state into tabDataMap */
  function saveActiveTabState() {
    const { activeTabId, entries, isProcessing } = get();
    if (!activeTabId) return;
    const data = getTabData(activeTabId);
    data.entries = entries;
    data.isProcessing = isProcessing;
    data.streamingId = streamingId;
    data.toolCallMap = new Map(toolCallMap);
    data.tokenBuffer = tokenBuffer;
  }

  /** Restore a tab's state from tabDataMap into the store */
  function restoreTabState(tabId: string) {
    const data = getTabData(tabId);
    streamingId = data.streamingId;
    toolCallMap.clear();
    for (const [k, v] of data.toolCallMap) toolCallMap.set(k, v);
    tokenBuffer = data.tokenBuffer;
    set({
      entries: data.entries,
      isProcessing: data.isProcessing,
      activeTabId: tabId,
    });
  }

  return {
    // Initial state
    tabs: [],
    activeTabId: null,
    entries: [],
    isProcessing: false,
    queueCount: 0,
    modelLabel: "anthropic",
    providerLabel: "anthropic",
    conversations: [],
    showHistory: false,
    showSettings: false,
    extensionConfig: null,
    permissionRequest: null,

    // ── Entry Mutators ──────────────────────────────

    addUserMessage: (text) => {
      set((s) => ({
        entries: [...s.entries, { id: nextId(), role: "user" as const, content: text }],
      }));
    },

    addSystemMessage: (text, role = "system") => {
      set((s) => ({
        entries: [...s.entries, { id: nextId(), role, content: text }],
      }));
    },

    addToolCall: (name, input, description) => {
      const id = nextId();
      toolCallMap.set(name, id);
      set((s) => ({
        entries: [
          ...s.entries,
          { id, kind: "call" as const, name, input, output: "", description },
        ],
      }));
    },

    addToolResult: (name, result, isError) => {
      const callId = toolCallMap.get(name);
      if (callId) {
        toolCallMap.delete(name);
        set((s) => ({
          entries: s.entries.map((e) =>
            e.id === callId && "kind" in e
              ? { ...e, kind: "result" as const, output: result, isError }
              : e
          ),
        }));
      } else {
        set((s) => ({
          entries: [
            ...s.entries,
            { id: nextId(), kind: "result" as const, name, input: "", output: result, isError },
          ],
        }));
      }
    },

    clearAll: () => {
      streamingId = null;
      tokenBuffer = "";
      set({ entries: [], queueCount: 0 });
    },

    // ── Token Streaming ─────────────────────────────

    appendToken: (token) => {
      tokenBuffer += token;
      if (rafHandle === null) {
        rafHandle = requestAnimationFrame(flushTokenBufferInternal);
      }
    },

    flushTokenBuffer: flushTokenBufferInternal,

    // ── Tab Management ──────────────────────────────

    createNewTab: () => {
      getVsCode().postMessage({ type: "newTab" });
    },

    switchToTab: (tabId) => {
      saveActiveTabState();
      getVsCode().postMessage({ type: "switchTab", tabId });
    },

    closeTab: (tabId) => {
      tabDataMap.delete(tabId);
      getVsCode().postMessage({ type: "closeTab", tabId });
    },

    // ── Actions ─────────────────────────────────────

    sendMessage: (text, context) => {
      if (!text.trim() && (!context || context.length === 0)) return;
      let displayText = text;
      if (context && context.length > 0) {
        const labels = context.map((c) => {
          const name = c.path.split("/").pop() || c.path;
          if (c.type === "selection" && c.startLine)
            return `[${name}:${c.startLine}${c.endLine ? `-${c.endLine}` : ""}]`;
          return `[${name}]`;
        });
        displayText = labels.join(" ") + (text ? "\n" + text : "");
      }
      get().addUserMessage(displayText);
      getVsCode().postMessage({
        type: "sendMessage",
        text,
        tabId: get().activeTabId || undefined,
        context,
      });
    },

    sendCommand: (command) => {
      getVsCode().postMessage({ type: "command", command });
    },

    cancelGeneration: () => {
      getVsCode().postMessage({ type: "cancelGeneration" });
    },

    interruptAndSend: (newMessage: string) => {
      // Flush any buffered tokens to get partial response
      if (tokenBuffer) get().flushTokenBuffer();

      // Collect partial response from current entries
      const entries = get().entries;
      let partialResponse = "";
      for (let i = entries.length - 1; i >= 0; i--) {
        const e = entries[i];
        if ("role" in e && e.role === "assistant") {
          partialResponse = e.content;
          break;
        }
      }

      // Add interrupted marker to the partial message in UI
      if (partialResponse) {
        set((s) => ({
          entries: s.entries.map((e, i) => {
            if (i === s.entries.length - 1 && "role" in e && e.role === "assistant") {
              return { ...e, content: e.content + "\n\n*(interrupted)*" };
            }
            return e;
          }),
        }));
      }

      // Tell extension host to interrupt and send new message
      getVsCode().postMessage({
        type: "interruptGeneration",
        tabId: get().activeTabId || undefined,
        partialResponse,
        newMessage,
      });

      set({ isProcessing: false });
      streamingId = null;
    },

    // ── History ─────────────────────────────────────

    openHistory: () => {
      getVsCode().postMessage({ type: "listHistory" });
      set({ showHistory: true });
    },

    closeHistory: () => set({ showHistory: false }),

    resumeConversation: (id) => {
      getVsCode().postMessage({ type: "resumeConversation", id });
      set({ showHistory: false });
    },

    deleteConversation: (id) => {
      getVsCode().postMessage({ type: "deleteConversation", id });
    },

    // ── Settings ────────────────────────────────────

    openSettings: () => {
      getVsCode().postMessage({ type: "getConfig" });
      set({ showSettings: true });
    },

    closeSettings: () => set({ showSettings: false }),

    saveSettings: (config) => {
      getVsCode().postMessage({ type: "updateConfig", config });
      set({ showSettings: false });
    },

    openVscodeSettings: () => {
      getVsCode().postMessage({ type: "openVscodeSettings" });
    },

    // ── Permissions ─────────────────────────────────

    respondToPermission: (decision) => {
      const req = get().permissionRequest;
      if (!req) return;
      getVsCode().postMessage({ type: "permissionResponse", id: req.id, decision });
      set({ permissionRequest: null });
    },

    // ── Message Handler ─────────────────────────────

    handleMessage: (msg) => {
      const {
        addToolCall,
        addToolResult,
        addSystemMessage,
        clearAll,
        appendToken,
        flushTokenBuffer: flush,
      } = get();

      switch (msg.type) {
        case "startResponse":
          set({ isProcessing: true });
          streamingId = null;
          break;

        case "token":
          appendToken(msg.text);
          break;

        case "finalizeStreaming":
          if (tokenBuffer) flush();
          streamingId = null;
          break;

        case "toolCall":
          addToolCall(msg.name, msg.input, (msg as any).description);
          break;

        case "toolResult":
          addToolResult(msg.name, msg.result, msg.isError);
          break;

        case "endResponse":
          if (tokenBuffer) flush();
          set({ isProcessing: false });
          streamingId = null;
          break;

        case "error":
          if (tokenBuffer) flush();
          set({ isProcessing: false });
          streamingId = null;
          addSystemMessage(msg.text, "error");
          break;

        case "systemMessage":
          addSystemMessage(msg.text);
          break;

        case "clear":
          clearAll();
          break;

        case "usageInfo":
          set((s) => {
            for (let i = s.entries.length - 1; i >= 0; i--) {
              const entry = s.entries[i];
              if ("role" in entry && entry.role === "assistant") {
                const updated = {
                  ...entry,
                  content: entry.content + `\n\n---\n*${msg.text}*`,
                };
                return {
                  entries: [
                    ...s.entries.slice(0, i),
                    updated,
                    ...s.entries.slice(i + 1),
                  ],
                };
              }
            }
            return {};
          });
          break;

        case "configUpdated":
          set({
            providerLabel: msg.provider,
            modelLabel: msg.model || msg.provider,
          });
          break;

        // ── Tab messages ────────────────────────────

        case "tabCreated":
          set((s) => ({
            tabs: s.tabs.some((t) => t.id === msg.tabId)
              ? s.tabs
              : [...s.tabs, { id: msg.tabId, title: msg.title }],
          }));
          break;

        case "tabSwitched": {
          // Flush pending tokens for the outgoing tab
          if (tokenBuffer) flush();
          // Save outgoing tab
          saveActiveTabState();
          // Restore incoming tab
          restoreTabState(msg.tabId);
          // Override isProcessing from extension host (authoritative)
          if ((msg as any).isProcessing !== undefined) {
            set({ isProcessing: (msg as any).isProcessing });
          }
          break;
        }

        case "tabClosed":
          tabDataMap.delete(msg.tabId);
          set((s) => ({
            tabs: s.tabs.filter((t) => t.id !== msg.tabId),
          }));
          break;

        case "tabTitleUpdated":
          set((s) => ({
            tabs: s.tabs.map((t) =>
              t.id === msg.tabId ? { ...t, title: msg.title } : t
            ),
          }));
          break;

        // ── Settings / History / Permissions ────────

        case "configData":
          set({ extensionConfig: (msg as any).config || null });
          break;

        case "conversationList":
          set({ conversations: (msg as any).conversations || [] });
          break;

        case "permissionRequest":
          set({
            permissionRequest: {
              id: (msg as any).id,
              toolName: (msg as any).toolName,
              message: (msg as any).message,
              hasProject: (msg as any).hasProject,
            },
          });
          break;

        case "conversationMessages": {
          const restored = (msg as any).messages as Array<{
            role: string;
            content: string;
          }>;
          if (restored && restored.length > 0) {
            set({
              entries: restored.map((m) => ({
                id: nextId(),
                role: m.role as "user" | "assistant",
                content: m.content,
              })),
            });
          }
          break;
        }
      }

      // Queue count (sent on any message)
      if ("queueCount" in msg && typeof (msg as any).queueCount === "number") {
        set({ queueCount: (msg as any).queueCount });
      }
    },

    // ── Init ────────────────────────────────────────

    init: () => {
      const handler = (event: MessageEvent<IncomingMessage>) => {
        get().handleMessage(event.data);
      };
      window.addEventListener("message", handler);
      getVsCode().postMessage({ type: "ready" });

      // Cleanup rAF on window unload
      window.addEventListener("unload", () => {
        if (rafHandle !== null) cancelAnimationFrame(rafHandle);
      });
    },
  };
});
