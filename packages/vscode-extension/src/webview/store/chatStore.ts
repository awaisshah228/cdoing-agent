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
  /** Maps toolCallId (or name fallback) → entryId for reliable result matching */
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
  /** ID of the message currently being streamed (for smooth rendering) */
  streamingMessageId: string | null;

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

  // Agent mode (plan vs build)
  agentMode: "build" | "plan";

  // Plan approval prompt (shown inline like permission prompts)
  planApproval: { summary: string; filePath?: string } | null;

  // OAuth status (captured from extension host, survives SettingsPanel mount/unmount)
  oauthStatus: "none" | "active" | "expired";
  oauthExpiresAt: number | undefined;
}

interface ChatActions {
  // Entry mutators
  addUserMessage: (text: string, context?: ContextAttachment[]) => void;
  addSystemMessage: (text: string, role?: "system" | "error") => void;
  addToolCall: (name: string, input: string, description?: string, toolCallId?: string) => void;
  updateToolProgress: (name: string, chunk: string, toolCallId?: string) => void;
  addToolResult: (name: string, result: string, isError: boolean, toolCallId?: string) => void;
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
  switchModel: (model: string) => void;
  toggleMode: () => void;

  // Permissions
  respondToPermission: (decision: string) => void;

  // Plan approval
  respondToPlanApproval: (decision: "approve" | "reject") => void;

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
// Maps toolCallId (or tool name fallback) → entryId for reliable parallel call matching
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
          streamingMessageId: sid,
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
        streamingMessageId: id,
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
      streamingMessageId: data.streamingId,
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
    agentMode: "build",
    planApproval: null,
    streamingMessageId: null,
    oauthStatus: "none",
    oauthExpiresAt: undefined,

    // ── Entry Mutators ──────────────────────────────

    addUserMessage: (text, context) => {
      set((s) => ({
        entries: [...s.entries, {
          id: nextId(),
          role: "user" as const,
          content: text,
          ...(context && context.length > 0 ? { context } : {}),
        }],
      }));
    },

    addSystemMessage: (text, role = "system") => {
      set((s) => ({
        entries: [...s.entries, { id: nextId(), role, content: text }],
      }));
    },

    addToolCall: (name, input, description, toolCallId) => {
      const id = nextId();
      // Map by toolCallId for reliable parallel matching, fall back to name
      toolCallMap.set(toolCallId || name, id);
      set((s) => ({
        entries: [
          ...s.entries,
          { id, kind: "call" as const, name, input, output: "", description },
        ],
      }));
    },

    updateToolProgress: (name, chunk, toolCallId) => {
      const lookupKey = toolCallId || name;
      const callId = toolCallMap.get(lookupKey);
      if (callId) {
        set((s) => ({
          entries: s.entries.map((e) =>
            e.id === callId && "kind" in e && e.kind === "call"
              ? { ...e, output: (e.output || "") + chunk }
              : e
          ),
        }));
      }
    },

    addToolResult: (name, result, isError, toolCallId) => {
      const lookupKey = toolCallId || name;
      const callId = toolCallMap.get(lookupKey);
      if (callId) {
        toolCallMap.delete(lookupKey);
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
      set({ entries: [], queueCount: 0, streamingMessageId: null });
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
      get().addUserMessage(text, context);
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

      set({ isProcessing: false, streamingMessageId: null });
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
      // Clear stale config so SettingsPanel waits for fresh data
      set({ showSettings: true, extensionConfig: null });
      getVsCode().postMessage({ type: "getConfig" });
      getVsCode().postMessage({ type: "getOAuthStatus" });
    },

    closeSettings: () => set({ showSettings: false }),

    saveSettings: (config) => {
      getVsCode().postMessage({ type: "updateConfig", config });
      set({ showSettings: false });
    },

    openVscodeSettings: () => {
      getVsCode().postMessage({ type: "openVscodeSettings" });
    },

    switchModel: (model: string) => {
      getVsCode().postMessage({ type: "updateConfig", config: { model } } as any);
      set({ modelLabel: model });
    },

    toggleMode: () => {
      const current = get().agentMode;
      const next = current === "plan" ? "default" : "plan";
      getVsCode().postMessage({ type: "command", command: "/mode", args: [next] });
    },

    // ── Permissions ─────────────────────────────────

    respondToPermission: (decision) => {
      const req = get().permissionRequest;
      if (!req) return;
      getVsCode().postMessage({ type: "permissionResponse", id: req.id, decision });
      set({ permissionRequest: null });
    },

    respondToPlanApproval: (decision) => {
      set({ planApproval: null });
      getVsCode().postMessage({ type: "command", command: "/plan", args: [decision] });
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
          set({ isProcessing: true, streamingMessageId: null });
          streamingId = null;
          break;

        case "token":
          appendToken(msg.text);
          break;

        case "finalizeStreaming":
          if (tokenBuffer) flush();
          streamingId = null;
          set({ streamingMessageId: null });
          break;

        case "clearStreamingText":
          // Local models (Ollama) emitted tool call JSON as text — remove it
          // Cancel any pending RAF flush so cleared buffer doesn't reappear
          if (rafHandle !== null) { cancelAnimationFrame(rafHandle); rafHandle = null; }
          tokenBuffer = "";
          if (streamingId) {
            const sid = streamingId;
            set((state) => ({
              entries: state.entries.filter((e) => e.id !== sid),
              streamingMessageId: null,
            }));
            streamingId = null;
          }
          break;

        case "toolCallStreaming": {
          // Model is generating a tool call — show a placeholder entry with "Generating..." state
          const tcName = (msg as any).name as string;
          const placeholderId = nextId();
          toolCallMap.set(`streaming:${tcName}`, placeholderId);
          set((s) => ({
            entries: [
              ...s.entries,
              { id: placeholderId, kind: "call" as const, name: tcName, input: "{}", output: "", description: `Generating ${tcName}...` },
            ],
          }));
          break;
        }

        case "toolCall": {
          // Replace streaming placeholder if one exists, otherwise add new entry
          const streamingKey = `streaming:${msg.name}`;
          const placeholderId = toolCallMap.get(streamingKey);
          if (placeholderId) {
            toolCallMap.delete(streamingKey);
            // Re-map using toolCallId for reliable result matching
            toolCallMap.set(msg.toolCallId || msg.name, placeholderId);
            set((s) => ({
              entries: s.entries.map((e) =>
                e.id === placeholderId
                  ? { ...e, input: msg.input, description: msg.description }
                  : e
              ),
            }));
          } else {
            addToolCall(msg.name, msg.input, msg.description, msg.toolCallId);
          }
          break;
        }

        case "toolProgress":
          get().updateToolProgress((msg as any).name, (msg as any).chunk, (msg as any).toolCallId);
          break;

        case "diffChunk": {
          // Render diff chunks as streaming progress on the current tool call
          const dm = msg as any;
          const prefix = dm.diffType === "add" ? "+" : dm.diffType === "remove" ? "-" : " ";
          const line = dm.diffType === "file-header" ? `📄 ${dm.content}\n` : `${prefix} ${dm.content}\n`;
          // Find the most recent tool call entry and append the diff line
          const entries = get().entries;
          for (let i = entries.length - 1; i >= 0; i--) {
            const e = entries[i];
            if ("kind" in e && e.kind === "call") {
              set((s) => ({
                entries: s.entries.map((en) =>
                  en.id === e.id && "kind" in en && en.kind === "call"
                    ? { ...en, output: (en.output || "") + line }
                    : en
                ),
              }));
              break;
            }
          }
          break;
        }

        case "toolResult":
          addToolResult(msg.name, msg.result, msg.isError, msg.toolCallId);
          break;

        case "endResponse":
          if (tokenBuffer) flush();
          streamingId = null;
          set({ isProcessing: false, streamingMessageId: null });
          break;

        case "error":
          if (tokenBuffer) flush();
          streamingId = null;
          set({ isProcessing: false, streamingMessageId: null });
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

        case "modeChanged":
          set({ agentMode: (msg as any).mode === "plan" ? "plan" : "build" });
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

        case "oauthStatus":
          set({
            oauthStatus: (msg as any).status || "none",
            oauthExpiresAt: (msg as any).expiresAt,
          });
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

        case "planReady":
          set({
            planApproval: {
              summary: (msg as any).summary || "Plan is ready",
              filePath: (msg as any).filePath,
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
