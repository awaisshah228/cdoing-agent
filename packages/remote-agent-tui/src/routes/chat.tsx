/**
 * Chat Route — talk to the personal assistant directly from the TUI.
 *
 * Features:
 *   - Multiple sessions (Ctrl+N new, Ctrl+Tab switch)
 *   - Message history stored via engine's session manager
 *   - Streaming responses with typing indicator
 *   - Tool call display (delegate_to_coder, config_manager, etc.)
 *   - Slash commands: /clear, /new, /sessions, /model, /status, /help
 *   - Sessions shared with Telegram/Discord (same session manager)
 */

import { useState, useRef, useCallback, useEffect } from "react";
import { TextAttributes } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { useTheme } from "../context/theme";
import { useEngine } from "../context/engine";

// ── Types ────────────────────────────────────────────────

interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  toolCalls?: string[];
  isError?: boolean;
}

interface ChatSession {
  id: string;
  name: string;
  messages: ChatMessage[];
  sessionKey: string; // key in session manager: tui:{chatId}:tui-user
}

// ── Chat Route ───────────────────────────────────────────

let globalSessionCounter = 0;

export function Chat() {
  const { theme: t } = useTheme();
  const engine = useEngine();
  const config = engine.getConfig();
  const msgIdRef = useRef(0);
  const nextId = () => `msg-${++msgIdRef.current}`;

  // ── Multi-session state ────────────────────────────────

  const [sessions, setSessions] = useState<ChatSession[]>(() => {
    const id = `chat-${++globalSessionCounter}`;
    return [{
      id,
      name: "Chat 1",
      sessionKey: `tui:${id}:tui-user`,
      messages: [{
        id: "welcome",
        role: "system",
        content: `Personal Assistant ready — ${config.agent.provider}/${config.agent.model}\nType a message or /help for commands. Ctrl+N new session.`,
        timestamp: Date.now(),
      }],
    }];
  });
  const [activeSessionIdx, setActiveSessionIdx] = useState(0);
  const [input, setInput] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [streamingText, setStreamingText] = useState("");

  const activeSession = sessions[activeSessionIdx];

  // ── Helpers ────────────────────────────────────────────

  const addMessage = useCallback((msg: ChatMessage) => {
    setSessions((prev) => prev.map((s, i) =>
      i === activeSessionIdx ? { ...s, messages: [...s.messages, msg] } : s
    ));
  }, [activeSessionIdx]);

  const clearMessages = useCallback((systemMsg: string) => {
    setSessions((prev) => prev.map((s, i) =>
      i === activeSessionIdx ? { ...s, messages: [{ id: nextId(), role: "system", content: systemMsg, timestamp: Date.now() }] } : s
    ));
  }, [activeSessionIdx]);

  const createNewSession = useCallback(() => {
    const id = `chat-${++globalSessionCounter}`;
    const newSession: ChatSession = {
      id,
      name: `Chat ${globalSessionCounter}`,
      sessionKey: `tui:${id}:tui-user`,
      messages: [{
        id: nextId(), role: "system",
        content: `New session — ${config.agent.provider}/${config.agent.model}`,
        timestamp: Date.now(),
      }],
    };
    setSessions((prev) => [...prev, newSession]);
    setActiveSessionIdx(sessions.length);
    setInput("");
  }, [sessions.length, config]);

  const switchSession = useCallback((direction: 1 | -1) => {
    setActiveSessionIdx((i) => {
      const next = i + direction;
      if (next < 0) return sessions.length - 1;
      if (next >= sessions.length) return 0;
      return next;
    });
    setInput("");
  }, [sessions.length]);

  // ── Send message ───────────────────────────────────────

  const sendMessage = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isProcessing) return;

    // Slash commands
    if (trimmed.startsWith("/")) {
      const handled = handleSlashCommand(trimmed);
      if (handled) return;
    }

    // Add user message
    addMessage({ id: nextId(), role: "user", content: trimmed, timestamp: Date.now() });
    setInput("");
    setIsProcessing(true);
    setStreamingText("");

    try {
      const bridge = engine.getBridge();
      const sm = engine.getSessionManager();
      const session = sm.getOrCreate("tui", activeSession.id, "tui-user", config.workingDir);

      sm.addMessage(session, "user", trimmed);

      const agent = bridge.getOrCreateAgent(session.id, session.workingDir, "assistant", "tui", "you");

      const toolCalls: string[] = [];
      let responseText = "";

      const result = await agent.run(trimmed, {
        onToken: (token: string) => {
          responseText += token;
          setStreamingText(responseText);
        },
        onToolCall: (name: string) => { toolCalls.push(name); },
        onToolResult: () => {},
        onComplete: () => {},
        onError: (err: Error) => {
          addMessage({ id: nextId(), role: "system", content: `Error: ${err.message}`, timestamp: Date.now(), isError: true });
        },
        onUsage: () => {},
      });

      sm.addMessage(session, "assistant", result || responseText);

      addMessage({
        id: nextId(), role: "assistant",
        content: result || responseText || "(no response)",
        timestamp: Date.now(),
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      });
    } catch (err) {
      addMessage({
        id: nextId(), role: "system",
        content: `Error: ${err instanceof Error ? err.message : String(err)}`,
        timestamp: Date.now(), isError: true,
      });
    } finally {
      setIsProcessing(false);
      setStreamingText("");
    }
  }, [engine, config, isProcessing, activeSession, addMessage]);

  // ── Slash commands ─────────────────────────────────────

  const handleSlashCommand = useCallback((text: string): boolean => {
    const [cmd, ...args] = text.split(/\s+/);
    const arg = args.join(" ");

    switch (cmd) {
      case "/clear":
        clearMessages("Chat cleared.");
        setInput("");
        return true;

      case "/new":
        createNewSession();
        return true;

      case "/sessions":
        addMessage({
          id: nextId(), role: "system", timestamp: Date.now(),
          content: sessions.map((s, i) =>
            `${i === activeSessionIdx ? "▶" : " "} ${s.name} — ${s.messages.filter((m) => m.role === "user").length} messages`
          ).join("\n") || "No sessions",
        });
        setInput("");
        return true;

      case "/help":
        addMessage({
          id: nextId(), role: "system", timestamp: Date.now(),
          content: [
            "Chat Commands:",
            "  /clear      — Clear this session",
            "  /new        — Create new session",
            "  /sessions   — List all sessions",
            "  /model [m]  — Show/change model",
            "  /status     — Agent status",
            "  /help       — Show this help",
            "",
            "Shortcuts:",
            "  Ctrl+N  New session   Ctrl+Tab  Next session",
            "  Esc     Back to routes",
            "  c  Chat  1  Dashboard  2  Skills  3  Config  s  Setup",
          ].join("\n"),
        });
        setInput("");
        return true;

      case "/model":
        if (arg) {
          config.agent.model = arg;
          addMessage({ id: nextId(), role: "system", content: `Model → ${arg}`, timestamp: Date.now() });
        } else {
          const coding = config.agent.codingModel ? `\nCoding: ${config.agent.codingProvider || config.agent.provider}/${config.agent.codingModel}` : "";
          addMessage({ id: nextId(), role: "system", content: `Assistant: ${config.agent.provider}/${config.agent.model}${coding}`, timestamp: Date.now() });
        }
        setInput("");
        return true;

      case "/status": {
        const sm = engine.getSessionManager();
        const bridge = engine.getBridge();
        const stats = bridge.getAgentStats();
        addMessage({
          id: nextId(), role: "system", timestamp: Date.now(),
          content: `Provider: ${config.agent.provider}\nAssistant: ${config.agent.model}\nCoding: ${config.agent.codingModel || config.agent.model}\nSessions: ${sm.getStats().active}\nAgents: ${stats.assistant}a/${stats.coding}c\nDir: ${config.workingDir}`,
        });
        setInput("");
        return true;
      }

      default:
        return false;
    }
  }, [engine, config, sessions, activeSessionIdx, addMessage, clearMessages, createNewSession]);

  // ── Keyboard ───────────────────────────────────────────

  useKeyboard((key: any) => {
    // Ctrl shortcuts (always active)
    if (key.ctrl && key.name === "n") { createNewSession(); return; }
    if (key.ctrl && key.name === "tab") { switchSession(1); return; }
    // Let parent handle Ctrl+P, Ctrl+B, Ctrl+C, F1
    if (key.ctrl || key.meta || key.name === "f1") return;

    // Escape — back to route navigation (only if not processing)
    if (key.name === "escape" && !isProcessing) return; // Let parent handle

    // Enter — send message
    if (key.name === "return" && input.trim()) {
      sendMessage(input);
      return;
    }

    // Backspace
    if (key.name === "backspace") {
      setInput((v) => v.slice(0, -1));
      return;
    }

    // Regular character input
    if (key.sequence && key.sequence.length === 1 && !key.ctrl && !key.meta) {
      setInput((v) => v + key.sequence);
    }
  }, {});

  // ── Render ─────────────────────────────────────────────

  const visibleMessages = activeSession.messages.slice(-30);

  return (
    <box flexDirection="column" flexGrow={1}>
      {/* Session tab bar (when multiple sessions) */}
      {sessions.length > 1 && (
        <box height={1} flexShrink={0} paddingX={1} backgroundColor={t.bgSubtle}>
          {sessions.map((s, i) => (
            <box key={s.id}>
              <text
                fg={i === activeSessionIdx ? t.primary : t.textDim}
                attributes={i === activeSessionIdx ? TextAttributes.BOLD : 0}
              >
                {` ${s.name} `}
              </text>
              {i < sessions.length - 1 && <text fg={t.border}>{"\u2502"}</text>}
            </box>
          ))}
          <box flexGrow={1} />
          <text fg={t.textDim}>{"Ctrl+N new  Ctrl+Tab switch"}</text>
        </box>
      )}

      {/* Message list */}
      <box flexDirection="column" flexGrow={1} paddingX={1} overflow="hidden">
        {visibleMessages.map((msg) => (
          <box key={msg.id} flexDirection="column">
            {msg.role === "user" && (
              <box>
                <text fg={t.primary} attributes={TextAttributes.BOLD}>{"❯ "}</text>
                <text fg={t.text}>{msg.content}</text>
              </box>
            )}
            {msg.role === "assistant" && (
              <box flexDirection="column">
                <box>
                  <text fg={t.success} attributes={TextAttributes.BOLD}>{"◆ "}</text>
                  {msg.toolCalls && <text fg={t.textDim}>{`[${msg.toolCalls.join(", ")}] `}</text>}
                </box>
                {/* Show up to 500 chars — long responses get truncated */}
                <text fg={t.text} paddingLeft={2}>
                  {msg.content.length > 500 ? msg.content.substring(0, 497) + "..." : msg.content}
                </text>
              </box>
            )}
            {msg.role === "system" && (
              <text fg={msg.isError ? t.error : t.textMuted}>
                {msg.isError ? `✗ ${msg.content}` : `● ${msg.content}`}
              </text>
            )}
          </box>
        ))}

        {/* Streaming */}
        {isProcessing && (
          <box flexDirection="column">
            <text fg={t.success} attributes={TextAttributes.BOLD}>{"◆ "}</text>
            <text fg={t.text} paddingLeft={2}>{streamingText || "thinking..."}</text>
          </box>
        )}
      </box>

      {/* Input separator */}
      <box height={1} flexShrink={0}>
        <text fg={t.border}>{"\u2500".repeat(200)}</text>
      </box>

      {/* Input area */}
      <box height={1} flexShrink={0} paddingX={1} backgroundColor={t.bgSubtle}>
        <text fg={isProcessing ? t.warning : t.primary} attributes={TextAttributes.BOLD}>
          {isProcessing ? "⟳ " : "❯ "}
        </text>
        <text fg={t.text}>{input}</text>
        {!isProcessing && <text fg={t.primary}>{"█"}</text>}
        <box flexGrow={1} />
        <text fg={t.textDim}>{activeSession.name}</text>
      </box>
    </box>
  );
}
