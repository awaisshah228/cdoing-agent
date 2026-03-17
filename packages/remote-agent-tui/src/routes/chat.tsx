/**
 * Chat Route — talk to the personal assistant directly from the TUI.
 *
 * Uses the InputArea component (same style as opentuicli) for all input
 * handling — autocomplete, ghost text, history, clipboard, shell mode.
 *
 * This file only handles: session management, message display, slash
 * commands, agent interaction, and route switching.
 */

import { useState, useRef, useCallback } from "react";
import { TextAttributes } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { execSync } from "child_process";
import { useTheme } from "../context/theme";
import { useEngine } from "../context/engine";
import { useSettingsStore } from "../store/settings";
import { InputArea } from "../components/input-area";
import { MessageList } from "../components/message-list";
import { resolveContextProviders, hasContextMentions, pushTerminalOutput } from "../lib/context-providers";
import { CredentialManager } from "@cdoing/remote-coding-agent";

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
  sessionKey: string;
}

// ── Chat Welcome Screen ─────────────────────────────────

function hasApiKeyAvailable(config: any): boolean {
  // Check config, env vars, and CredentialManager (stored API keys + OAuth tokens)
  if (
    !!config.agent.apiKey
    || !!process.env.ANTHROPIC_API_KEY
    || !!process.env.OPENAI_API_KEY
    || !!process.env.GOOGLE_API_KEY
  ) return true;

  // Check CredentialManager for stored API key or OAuth token
  try {
    const creds = new CredentialManager();
    const stored = creds.getApiKey(config.agent.provider, "assistant");
    if (stored) return true;
    // Check OAuth status synchronously (checks encrypted file)
    const status = creds.getStatus();
    if (status.oauth[config.agent.provider]) return true;
  } catch { /* ignore */ }

  return false;
}

function ChatWelcome() {
  const { theme: t } = useTheme();
  const engine = useEngine();
  const config = engine.getConfig();

  const hasApiKey = hasApiKeyAvailable(config);
  const hasChannels = Object.values(config.channels).some((c: any) => c.enabled);
  const hasCodingModel = !!config.agent.codingModel;
  const skills = engine.getSkillRegistry();
  const skillCount = skills.getAll().length;

  return (
    <box flexDirection="column" paddingX={2} paddingY={1}>
      <box height={1} />
      <text fg={t.primary} attributes={TextAttributes.BOLD}>{"Personal Assistant Chat"}</text>
      <box height={1} />
      <text fg={t.text}>{"Chat with your AI assistant. It can help with coding, math, weather, and more."}</text>
      <box height={2} />

      <text fg={t.text} attributes={TextAttributes.BOLD}>{"Status"}</text>
      <box height={1} />

      <box flexDirection="row">
        <text fg={hasApiKey ? t.success : t.error}>{hasApiKey ? " \u2713 " : " \u2717 "}</text>
        <text fg={t.text}>{"AI Provider  "}</text>
        <text fg={hasApiKey ? t.textMuted : t.error}>
          {hasApiKey ? `${config.agent.provider}/${config.agent.model}` : "Not configured \u2014 API key required"}
        </text>
      </box>

      <box flexDirection="row">
        <text fg={hasCodingModel ? t.success : t.textDim}>{hasCodingModel ? " \u2713 " : " - "}</text>
        <text fg={t.text}>{"Coding Agent "}</text>
        <text fg={t.textMuted}>
          {hasCodingModel
            ? `${config.agent.codingProvider || config.agent.provider}/${config.agent.codingModel}`
            : "Uses assistant model (optional)"}
        </text>
      </box>

      <box flexDirection="row">
        <text fg={hasChannels ? t.success : t.textDim}>{hasChannels ? " \u2713 " : " - "}</text>
        <text fg={t.text}>{"Channels     "}</text>
        <text fg={t.textMuted}>
          {hasChannels
            ? Object.entries(config.channels).filter(([, c]: [string, any]) => c.enabled).map(([id]) => id).join(", ")
            : "None enabled (optional)"}
        </text>
      </box>

      <box flexDirection="row">
        <text fg={skillCount > 0 ? t.success : t.textDim}>{skillCount > 0 ? " \u2713 " : " - "}</text>
        <text fg={t.text}>{"Skills       "}</text>
        <text fg={t.textMuted}>{`${skillCount} loaded`}</text>
      </box>

      <box height={2} />

      {!hasApiKey && (
        <box flexDirection="column">
          <text fg={t.warning} attributes={TextAttributes.BOLD}>{"To start chatting, set up your AI provider:"}</text>
          <box height={1} />
          <text fg={t.textMuted}>{"  1. Press  s  to open the setup wizard"}</text>
          <text fg={t.textMuted}>{"  2. Select a provider (Anthropic, OpenAI, Google, etc.)"}</text>
          <text fg={t.textMuted}>{"  3. Enter your API key or authenticate via OAuth"}</text>
          <text fg={t.textMuted}>{"  4. Choose your assistant model"}</text>
          <box height={2} />
        </box>
      )}

      <box flexDirection="row" gap={2}>
        {!hasApiKey && (
          <>
            <text fg={t.primary} attributes={TextAttributes.BOLD}>{"Press  s  to start setup"}</text>
            <text fg={t.border}>{"\u2502"}</text>
          </>
        )}
        <text fg={t.textMuted}>{"1  dashboard"}</text>
        <text fg={t.border}>{"\u2502"}</text>
        <text fg={t.textMuted}>{"2  skills"}</text>
        <text fg={t.border}>{"\u2502"}</text>
        <text fg={t.textMuted}>{"3  config"}</text>
        <text fg={t.border}>{"\u2502"}</text>
        <text fg={t.textMuted}>{"q  quit"}</text>
      </box>
    </box>
  );
}

// ── Chat Route ───────────────────────────────────────────

let globalSessionCounter = 0;

export function Chat() {
  const { theme: t } = useTheme();
  const engine = useEngine();
  const config = engine.getConfig();
  const msgIdRef = useRef(0);
  const nextId = () => `msg-${++msgIdRef.current}`;

  const hasApiKey = hasApiKeyAvailable(config);

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
        content: `Personal Assistant ready \u2014 ${config.agent.provider}/${config.agent.model}\n/ commands  @ context  ! shell  Esc dashboard  /help for all`,
        timestamp: Date.now(),
      }],
    }];
  });
  const [activeSessionIdx, setActiveSessionIdx] = useState(0);
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
        content: `New session \u2014 ${config.agent.provider}/${config.agent.model}`,
        timestamp: Date.now(),
      }],
    };
    setSessions((prev) => [...prev, newSession]);
    setActiveSessionIdx(sessions.length);
  }, [sessions.length, config]);

  const switchSession = useCallback((direction: 1 | -1) => {
    setActiveSessionIdx((i) => {
      const next = i + direction;
      if (next < 0) return sessions.length - 1;
      if (next >= sessions.length) return 0;
      return next;
    });
  }, [sessions.length]);

  // ── Shell mode execution ─────────────────────────────

  const executeShellCommand = useCallback((cmd: string) => {
    addMessage({ id: nextId(), role: "user", content: `! ${cmd}`, timestamp: Date.now() });

    try {
      const output = execSync(cmd, {
        encoding: "utf-8",
        timeout: 30_000,
        cwd: config.workingDir,
        stdio: "pipe",
      }).trim();
      pushTerminalOutput(output);
      const display = output.length > 2000 ? output.substring(0, 1997) + "..." : output;
      addMessage({ id: nextId(), role: "system", content: display || "(no output)", timestamp: Date.now() });
    } catch (err: any) {
      const stderr = err?.stderr?.toString?.()?.trim() || "";
      const stdout = err?.stdout?.toString?.()?.trim() || "";
      const combined = [stdout, stderr].filter(Boolean).join("\n").substring(0, 1000);
      pushTerminalOutput(combined);
      addMessage({ id: nextId(), role: "system", content: combined || `Exit code: ${err.status || 1}`, timestamp: Date.now(), isError: true });
    }
  }, [config.workingDir, addMessage]);

  // ── Slash commands ─────────────────────────────────────

  const handleSlashCommand = useCallback((text: string): boolean => {
    const [cmd, ...args] = text.split(/\s+/);
    const arg = args.join(" ");

    switch (cmd) {
      case "/clear":
        clearMessages("Chat cleared.");
        return true;

      case "/new":
        createNewSession();
        return true;

      case "/sessions":
        addMessage({
          id: nextId(), role: "system", timestamp: Date.now(),
          content: sessions.map((s, i) =>
            `${i === activeSessionIdx ? "\u25B6" : " "} ${s.name} \u2014 ${s.messages.filter((m) => m.role === "user").length} messages`
          ).join("\n") || "No sessions",
        });
        return true;

      case "/inspect": {
        if (!arg) {
          // List all engine sessions with IDs
          const sm = engine.getSessionManager();
          const allSessions = sm.getAll();
          if (allSessions.length === 0) {
            addMessage({ id: nextId(), role: "system", timestamp: Date.now(), content: "No engine sessions found." });
          } else {
            const lines = allSessions.map((s: any) => {
              const msgs = s.history.length;
              const ago = new Date(s.lastActiveAt).toLocaleTimeString("en", { hour12: false, hour: "2-digit", minute: "2-digit" });
              return `  ${s.id}  (${msgs} msgs, last ${ago})`;
            });
            addMessage({ id: nextId(), role: "system", timestamp: Date.now(),
              content: `Engine sessions:\n${lines.join("\n")}\n\nUsage: /inspect <session-id>` });
          }
          return true;
        }
        // Show messages for a specific session
        const sm = engine.getSessionManager();
        let target = sm.getById(arg);
        if (!target) {
          // Try partial match
          const allSessions = sm.getAll();
          const match = allSessions.find((s: any) => s.id.includes(arg));
          if (!match) {
            addMessage({ id: nextId(), role: "system", timestamp: Date.now(), isError: true,
              content: `Session not found: ${arg}\nUse /inspect to list sessions.` });
            return true;
          }
          target = match;
        }
        const msgLines = target.history.map((m: any) => {
          const time = new Date(m.timestamp).toLocaleTimeString("en", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
          const role = m.role.toUpperCase().padEnd(9);
          const text = m.content.length > 200 ? m.content.substring(0, 197) + "..." : m.content;
          return `[${time}] ${role} ${text}`;
        });
        addMessage({ id: nextId(), role: "system", timestamp: Date.now(),
          content: `Session: ${target.id}\nChannel: ${target.channel} | User: ${target.userId}\n${"─".repeat(50)}\n${msgLines.join("\n") || "(no messages)"}` });
        return true;
      }

      case "/help":
        addMessage({
          id: nextId(), role: "system", timestamp: Date.now(),
          content: [
            "Commands:",
            "  /clear        \u2014 Clear this session",
            "  /new          \u2014 Create new session",
            "  /sessions     \u2014 List all sessions",
            "  /inspect [id] \u2014 View engine session messages",
            "  /model [m]    \u2014 Show/change model",
            "  /status       \u2014 Agent status",
            "  /tools        \u2014 Check installed CLI tools",
            "  /login [p]    \u2014 OAuth login (opens browser)",
            "  /logout [p]   \u2014 Clear OAuth tokens + API key",
            "",
            "Navigation:",
            "  /dashboard    \u2014 Dashboard      (Ctrl+1)",
            "  /chat         \u2014 Chat           (Ctrl+2)",
            "  /skills       \u2014 Skills screen  (Ctrl+3)",
            "  /config       \u2014 Config screen  (Ctrl+4)",
            "  /setup        \u2014 Setup wizard   (Ctrl+5)",
            "",
            "Exit:",
            "  /detach       \u2014 Exit TUI, keep engine running",
            "  /quit         \u2014 Shutdown everything and exit",
            "",
            "Input:",
            "  !<command>    \u2014 Run shell command (e.g. !git status)",
            "  @terminal     \u2014 Attach recent shell output",
            "  @url <url>    \u2014 Fetch URL content",
            "  @tree         \u2014 Project file tree",
            "  @file <path>  \u2014 Attach a file",
            "  @clip         \u2014 Clipboard content",
            "",
            "Shortcuts:",
            "  \u2191\u2193          History / autocomplete",
            "  \u2192           Accept ghost text",
            "  Ctrl+V      Paste text or image",
            "  Ctrl+U      Clear line",
            "  Ctrl+W      Delete last word",
            "  Ctrl+N      New session",
            "  Ctrl+Tab    Next session",
            "  Esc         Clear input / dashboard",
          ].join("\n"),
        });
        return true;

      case "/model":
        if (arg) {
          config.agent.model = arg;
          addMessage({ id: nextId(), role: "system", content: `Model \u2192 ${arg}`, timestamp: Date.now() });
        } else {
          const coding = config.agent.codingModel ? `\nCoding: ${config.agent.codingProvider || config.agent.provider}/${config.agent.codingModel}` : "";
          addMessage({ id: nextId(), role: "system", content: `Assistant: ${config.agent.provider}/${config.agent.model}${coding}`, timestamp: Date.now() });
        }
        return true;

      case "/status": {
        const sm = engine.getSessionManager();
        const bridge = engine.getBridge();
        const stats = bridge.getAgentStats();
        addMessage({
          id: nextId(), role: "system", timestamp: Date.now(),
          content: `Provider: ${config.agent.provider}\nAssistant: ${config.agent.model}\nCoding: ${config.agent.codingModel || config.agent.model}\nSessions: ${sm.getStats().active}\nAgents: ${stats.assistant}a/${stats.coding}c\nDir: ${config.workingDir}`,
        });
        return true;
      }

      case "/tools":
        sendMessage("check what CLI tools are installed on my machine");
        return true;

      case "/detach":
        addMessage({ id: nextId(), role: "system", timestamp: Date.now(),
          content: "Detaching TUI... Engine continues running in background." });
        setTimeout(() => {
          const detach = (globalThis as any).__remoteTuiDetach;
          if (detach) detach();
        }, 200);
        return true;

      case "/quit":
      case "/exit":
        addMessage({ id: nextId(), role: "system", timestamp: Date.now(),
          content: "Shutting down engine and exiting..." });
        setTimeout(() => {
          const cleanup = (globalThis as any).__remoteTuiCleanup;
          if (cleanup) cleanup();
          else process.exit(0);
        }, 200);
        return true;

      case "/dashboard":
      case "/dash":
        useSettingsStore.getState().setRoute("dashboard");
        return true;

      case "/setup":
        useSettingsStore.getState().setRoute("setup");
        return true;

      case "/config":
        useSettingsStore.getState().setRoute("config");
        return true;

      case "/skills":
      case "/skill":
        if (!arg) {
          useSettingsStore.getState().setRoute("skills");
          return true;
        }
        // "/skills list" — show inline
        {
          const sr = engine.getSkillRegistry();
          const all = sr.getAll();
          const enabled = all.filter((e) => e.enabled);
          const disabled = all.filter((e) => !e.enabled);
          const lines: string[] = [];
          if (enabled.length > 0) {
            lines.push("Enabled:");
            for (const e of enabled) lines.push(`  \u2713 ${e.skill.id} \u2014 ${e.skill.description}`);
          }
          if (disabled.length > 0) {
            lines.push("Disabled (ask to enable):");
            for (const e of disabled) lines.push(`  \u2717 ${e.skill.id} \u2014 ${e.skill.description}`);
          }
          addMessage({ id: nextId(), role: "system", timestamp: Date.now(), content: lines.join("\n") || "No skills." });
        }
        return true;

      case "/login": {
        const provider = arg || config.agent.provider;
        addMessage({ id: nextId(), role: "system", timestamp: Date.now(),
          content: `Starting OAuth login for ${provider}...` });
        (async () => {
          try {
            const creds = new CredentialManager();
            const { url, codeVerifier, state, port, codePromise } = await creds.startOAuth(provider);
            const openCmd = process.platform === "darwin" ? "open"
              : process.platform === "win32" ? "start \"\"" : "xdg-open";
            try { execSync(`${openCmd} "${url}"`, { stdio: "ignore" }); } catch {}
            addMessage({ id: nextId(), role: "system", timestamp: Date.now(),
              content: `Browser opened. Waiting for login on port ${port}...\nIf browser didn't open:\n${url}` });
            const code = await codePromise;
            const redirectUri = `http://localhost:${port}/callback`;
            const result = await creds.completeOAuth(provider, code, codeVerifier, redirectUri, state);
            // Update the running config so chat works immediately
            config.agent.apiKey = result.accessToken;
            addMessage({ id: nextId(), role: "system", timestamp: Date.now(),
              content: `Authenticated with ${provider} successfully! You can now chat.` });
          } catch (err) {
            addMessage({ id: nextId(), role: "system", timestamp: Date.now(), isError: true,
              content: `OAuth login failed: ${err instanceof Error ? err.message : String(err)}` });
          }
        })();
        return true;
      }

      case "/logout": {
        const provider = arg || config.agent.provider;
        (async () => {
          try {
            const creds = new CredentialManager();
            await creds.oauthLogout(provider);
            creds.removeApiKey(provider, "assistant");
            config.agent.apiKey = undefined as any;
            addMessage({ id: nextId(), role: "system", timestamp: Date.now(),
              content: `Logged out from ${provider}. OAuth tokens and API key cleared.\nRun /login to re-authenticate.` });
          } catch (err) {
            addMessage({ id: nextId(), role: "system", timestamp: Date.now(), isError: true,
              content: `Logout failed: ${err instanceof Error ? err.message : String(err)}` });
          }
        })();
        return true;
      }

      case "/chat":
        return true; // Already in chat

      default:
        return false;
    }
  }, [engine, config, sessions, activeSessionIdx, addMessage, clearMessages, createNewSession]);

  // ── Send message (called by InputArea onSubmit) ────────

  const sendMessage = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isProcessing) return;

    // Shell mode
    if (trimmed.startsWith("!") && trimmed.length > 1) {
      executeShellCommand(trimmed.substring(1).trim());
      return;
    }

    // Slash commands
    if (trimmed.startsWith("/")) {
      if (handleSlashCommand(trimmed)) return;
    }

    if (!hasApiKey) {
      addMessage({ id: nextId(), role: "system", timestamp: Date.now(), isError: true,
        content: "No API key configured. Press Esc then s to run setup." });
      return;
    }

    // Resolve @context providers
    let finalText = trimmed;
    if (hasContextMentions(trimmed)) {
      try {
        finalText = await resolveContextProviders(trimmed, config.workingDir);
      } catch { /* send as-is */ }
    }

    addMessage({ id: nextId(), role: "user", content: trimmed, timestamp: Date.now() });
    setIsProcessing(true);
    setStreamingText("");

    try {
      const bridge = engine.getBridge();
      const sm = engine.getSessionManager();
      const session = sm.getOrCreate("tui", activeSession.id, "tui-user", config.workingDir);

      sm.addMessage(session, "user", finalText);

      const agent = bridge.getOrCreateAgent(session.id, session.workingDir, "assistant", "tui", "you");

      const toolCalls: string[] = [];
      let responseText = "";

      const result = await agent.run(finalText, {
        onToken: (token: string) => { responseText += token; setStreamingText(responseText); },
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
      const errMsg = err instanceof Error ? err.message : String(err);
      const isAuthError = errMsg.includes("invalid") && (errMsg.includes("api") || errMsg.includes("key") || errMsg.includes("auth"));
      addMessage({
        id: nextId(), role: "system",
        content: isAuthError
          ? `Auth failed for ${config.agent.provider}/${config.agent.model}. Try /login or press Esc then s.`
          : `Error: ${errMsg}`,
        timestamp: Date.now(), isError: true,
      });
    } finally {
      setIsProcessing(false);
      setStreamingText("");
    }
  }, [engine, config, isProcessing, hasApiKey, activeSession, addMessage, executeShellCommand, handleSlashCommand]);

  // ── Keyboard (only for session/route shortcuts — InputArea handles input) ──

  useKeyboard((key: any) => {
    // Route switching: Ctrl+1..5 — always available
    if (key.ctrl && key.name === "1") { useSettingsStore.getState().setRoute("dashboard"); return; }
    if (key.ctrl && key.name === "2") { useSettingsStore.getState().setRoute("chat"); return; }
    if (key.ctrl && key.name === "3") { useSettingsStore.getState().setRoute("skills"); return; }
    if (key.ctrl && key.name === "4") { useSettingsStore.getState().setRoute("config"); return; }
    if (key.ctrl && key.name === "5") { useSettingsStore.getState().setRoute("setup"); return; }

    // Escape with no input → dashboard
    if (key.name === "escape" && !isProcessing) {
      useSettingsStore.getState().setRoute("dashboard");
      return;
    }

    // Session management — only when configured
    if (!hasApiKey) return;
    if (key.ctrl && key.name === "n") { createNewSession(); return; }
    if (key.ctrl && key.name === "tab") { switchSession(1); return; }
    if (key.ctrl && key.name === "left") { switchSession(-1); return; }
    if (key.ctrl && key.name === "right") { switchSession(1); return; }
  }, {});

  // ── Render ────────────────────────────────────────────

  const visibleMessages = activeSession.messages.slice(-30);

  return (
    <box flexDirection="column" flexGrow={1}>
      {/* Welcome screen OR session tab bar */}
      {!hasApiKey && <ChatWelcome />}

      {hasApiKey && (
        /* Session tab bar */
        <box height={1} flexShrink={0} paddingX={1} backgroundColor={t.bgSubtle}>
          {sessions.map((s, i) => {
            const msgCount = s.messages.filter((m) => m.role === "user" || m.role === "assistant").length;
            const isActive = i === activeSessionIdx;
            return (
              <box key={s.id} flexDirection="row">
                <text
                  fg={isActive ? t.primary : t.textDim}
                  {...(isActive ? { attributes: TextAttributes.BOLD } : {})}
                >
                  {` ${s.name}`}
                </text>
                <text fg={isActive ? t.textMuted : t.textDim}>{` (${msgCount})`}</text>
                {i < sessions.length - 1 && <text fg={t.border}>{" \u2502"}</text>}
              </box>
            );
          })}
          <box flexGrow={1} />
          <text fg={t.textDim}>{"Ctrl+\u2190\u2192 switch  Ctrl+N new"}</text>
        </box>
      )}

      {/* Message list — always visible so command output shows */}
      <box flexDirection="column" flexGrow={1} overflow="hidden">
        <MessageList
          messages={visibleMessages}
          streamingText={streamingText}
          isStreaming={isProcessing}
          showTimestamps={false}
        />
      </box>

      {/* Input area — always visible so user can run commands even without config */}
      <InputArea
        onSubmit={sendMessage}
        disabled={isProcessing}
        workingDir={config.workingDir}
        placeholder={hasApiKey
          ? "Message, /cmd, @ctx, !shell  \u2502  \u2192 accept  \u2502  /help"
          : "!shell, /setup, /help  \u2502  Configure API key to chat"}
        rightLabel={hasApiKey ? activeSession.name : "not configured"}
        hintText={`Esc dashboard  \u2502  Ctrl+1\u20145 routes  \u2502  ${hasApiKey ? `Ctrl+N new session  \u2502  ${sessions.length} session${sessions.length > 1 ? "s" : ""}` : "s setup wizard"}`}
      />
    </box>
  );
}
