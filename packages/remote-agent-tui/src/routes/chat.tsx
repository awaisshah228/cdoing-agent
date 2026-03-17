/**
 * Chat Route — talk to the personal assistant directly from the TUI.
 *
 * Simple chat interface:
 *   - Message list (user + assistant messages)
 *   - Input area at the bottom
 *   - Streaming response with typing indicator
 *   - Tool call display
 *   - Slash commands: /clear, /model, /status, /skills, /help
 */

import { useState, useRef, useCallback } from "react";
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

// ── Chat Route ───────────────────────────────────────────

export function Chat() {
  const { theme: t } = useTheme();
  const engine = useEngine();
  const config = engine.getConfig();

  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "system",
      content: `Personal Assistant ready. Model: ${config.agent.provider}/${config.agent.model}\nType a message or use /help for commands.`,
      timestamp: Date.now(),
    },
  ]);
  const [input, setInput] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const msgIdRef = useRef(0);

  const nextId = () => `msg-${++msgIdRef.current}`;

  // ── Send message ───────────────────────────────────────

  const sendMessage = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isProcessing) return;

    // Handle slash commands locally
    if (trimmed.startsWith("/")) {
      const handled = handleSlashCommand(trimmed);
      if (handled) return;
    }

    // Add user message
    const userMsg: ChatMessage = { id: nextId(), role: "user", content: trimmed, timestamp: Date.now() };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setIsProcessing(true);
    setStreamingText("");

    try {
      // Use the bridge to process the message
      const bridge = engine.getBridge();
      const sm = engine.getSessionManager();
      const session = sm.getOrCreate("tui", "local", "tui-user", config.workingDir);

      sm.addMessage(session, "user", trimmed);

      // Get or create the assistant agent
      const agent = (bridge as any).getOrCreateAgent
        ? (bridge as any).getOrCreateAgent(session.id, session.workingDir, "assistant", "tui", "you")
        : null;

      if (!agent) {
        setMessages((prev) => [...prev, {
          id: nextId(), role: "system", content: "Agent not available. Run setup first.", timestamp: Date.now(), isError: true,
        }]);
        setIsProcessing(false);
        return;
      }

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
          setMessages((prev) => [...prev, {
            id: nextId(), role: "system", content: `Error: ${err.message}`, timestamp: Date.now(), isError: true,
          }]);
        },
        onUsage: () => {},
      });

      sm.addMessage(session, "assistant", result || responseText);

      setMessages((prev) => [...prev, {
        id: nextId(),
        role: "assistant",
        content: result || responseText || "(no response)",
        timestamp: Date.now(),
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      }]);
    } catch (err) {
      setMessages((prev) => [...prev, {
        id: nextId(), role: "system",
        content: `Error: ${err instanceof Error ? err.message : String(err)}`,
        timestamp: Date.now(), isError: true,
      }]);
    } finally {
      setIsProcessing(false);
      setStreamingText("");
    }
  }, [engine, config, isProcessing]);

  // ── Slash commands ─────────────────────────────────────

  const handleSlashCommand = useCallback((text: string): boolean => {
    const [cmd, ...args] = text.split(/\s+/);
    const arg = args.join(" ");

    switch (cmd) {
      case "/clear":
        setMessages([{
          id: nextId(), role: "system", content: "Chat cleared.", timestamp: Date.now(),
        }]);
        return true;

      case "/help":
        setMessages((prev) => [...prev, {
          id: nextId(), role: "system", timestamp: Date.now(),
          content: [
            "Commands:",
            "  /clear     — Clear chat history",
            "  /model     — Show/change model",
            "  /status    — Show agent status",
            "  /skills    — List available skills",
            "  /help      — Show this help",
            "",
            "Shortcuts:",
            "  1  Dashboard  2  Skills  3  Config  s  Setup  q  Quit",
            "  Ctrl+P  Command palette  Ctrl+B  Sidebar  F1  Help",
          ].join("\n"),
        }]);
        return true;

      case "/model":
        if (arg) {
          config.agent.model = arg;
          setMessages((prev) => [...prev, {
            id: nextId(), role: "system", content: `Model switched to: ${arg}`, timestamp: Date.now(),
          }]);
        } else {
          const coding = config.agent.codingModel
            ? `\nCoding: ${config.agent.codingProvider || config.agent.provider}/${config.agent.codingModel}`
            : "";
          setMessages((prev) => [...prev, {
            id: nextId(), role: "system", timestamp: Date.now(),
            content: `Assistant: ${config.agent.provider}/${config.agent.model}${coding}`,
          }]);
        }
        return true;

      case "/status": {
        const sm = engine.getSessionManager();
        const bridge = engine.getBridge();
        const stats = bridge.getAgentStats();
        setMessages((prev) => [...prev, {
          id: nextId(), role: "system", timestamp: Date.now(),
          content: [
            `Provider: ${config.agent.provider}`,
            `Assistant: ${config.agent.model}`,
            `Coding: ${config.agent.codingModel || config.agent.model}`,
            `Sessions: ${sm.getStats().active}`,
            `Agents: ${stats.assistant} assistant, ${stats.coding} coding`,
            `Working dir: ${config.workingDir}`,
          ].join("\n"),
        }]);
        return true;
      }

      default:
        return false; // Not handled — send to agent
    }
  }, [engine, config]);

  // ── Keyboard ───────────────────────────────────────────

  useKeyboard((key: any) => {
    // Don't capture keys when parent handles them (routes, dialogs)
    if (key.ctrl || key.meta || key.name === "f1") return;

    if (key.name === "return" && input.trim()) {
      sendMessage(input);
      return;
    }
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

  // Show last N messages that fit
  const visibleMessages = messages.slice(-20);

  return (
    <box flexDirection="column" flexGrow={1}>
      {/* Message list */}
      <box flexDirection="column" flexGrow={1} paddingX={1} overflow="hidden">
        {visibleMessages.map((msg) => (
          <box key={msg.id} flexDirection="column" marginBottom={0}>
            {msg.role === "user" && (
              <box>
                <text fg={t.primary} attributes={TextAttributes.BOLD}>{"You: "}</text>
                <text fg={t.text}>{msg.content}</text>
              </box>
            )}
            {msg.role === "assistant" && (
              <box flexDirection="column">
                <box>
                  <text fg={t.success} attributes={TextAttributes.BOLD}>{"Assistant: "}</text>
                  {msg.toolCalls && (
                    <text fg={t.textDim}>{` [${msg.toolCalls.join(", ")}]`}</text>
                  )}
                </box>
                <text fg={t.text} paddingLeft={2}>{msg.content.substring(0, 500)}</text>
              </box>
            )}
            {msg.role === "system" && (
              <text fg={msg.isError ? t.error : t.textMuted}>
                {msg.isError ? `✗ ${msg.content}` : `● ${msg.content}`}
              </text>
            )}
          </box>
        ))}

        {/* Streaming indicator */}
        {isProcessing && (
          <box>
            <text fg={t.success} attributes={TextAttributes.BOLD}>{"Assistant: "}</text>
            <text fg={t.text}>{streamingText || "thinking..."}</text>
          </box>
        )}
      </box>

      {/* Input area */}
      <box height={1} flexShrink={0}>
        <text fg={t.border}>{"\u2500".repeat(200)}</text>
      </box>
      <box height={1} flexShrink={0} paddingX={1} backgroundColor={t.bgSubtle}>
        <text fg={isProcessing ? t.textDim : t.primary} attributes={TextAttributes.BOLD}>
          {isProcessing ? "... " : "> "}
        </text>
        <text fg={t.text}>{input}</text>
        {!isProcessing && <text fg={t.textDim} attributes={TextAttributes.BOLD}>{"█"}</text>}
      </box>
    </box>
  );
}
