/**
 * Session Route — active chat session with full agent integration
 *
 * Wires up the AgentRunner with streaming callbacks to display:
 *   - Token-by-token streaming with cursor
 *   - Tool call display with status icons
 *   - Permission prompts (via SDK context)
 *   - Token usage tracking
 *   - Full slash command handling
 *   - Session persistence (save/resume/fork/delete)
 *   - @mention context expansion
 *   - Background jobs (/bg, /jobs)
 *   - One-shot questions (/btw)
 *   - Shell command auto-detection
 *   - OAuth status (/auth-status)
 *   - /config set support
 */

import { useState, useRef, useEffect } from "react";
import { TextAttributes } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { MessageList, type Message } from "../components/message-list";
import { InputArea, type AgentMode } from "../components/input-area";
import { PermissionPrompt } from "../components/permission-prompt";
import { LoadingSpinner } from "../components/loading-spinner";
import { useSDK } from "../context/sdk";
import { useTheme } from "../context/theme";
import { useToast } from "../components/toast";
import { setTerminalTitle } from "../lib/terminal-title";
import { execSync } from "child_process";
import type { AgentCallbacks, ImageAttachment } from "@cdoing/ai";
import {
  createConversation,
  addMessage as addHistoryMessage,
  listConversations,
  loadConversation,
  deleteConversation,
  forkConversation,
  formatRelativeDate,
  type Conversation,
} from "../lib/history";
import {
  resolveContextProviders,
  hasContextMentions,
  pushTerminalOutput,
} from "../lib/context-providers";

// ── Shell Command Detection ──────────────────────────

const SHELL_COMMANDS = new Set([
  "ls", "ll", "la", "pwd", "cd", "mkdir", "rmdir", "rm", "cp", "mv",
  "cat", "head", "tail", "touch", "echo", "env",
  "git", "npm", "yarn", "pnpm", "npx", "node", "ts-node",
  "python", "python3", "pip", "pip3",
  "docker", "docker-compose",
  "grep", "find", "which", "whereis",
  "curl", "wget",
  "chmod", "chown", "ln",
  "ps", "kill", "df", "du",
  "open", "code",
  "vim", "vi", "nano", "less", "more", "man", "top", "htop",
]);

function detectShellCommand(input: string): string | null {
  const trimmed = input.trim();
  const firstWord = trimmed.split(/\s+/)[0].toLowerCase();
  return SHELL_COMMANDS.has(firstWord) ? trimmed : null;
}

// ── Background Job ──────────────────────────────────

interface BackgroundJob {
  id: string;
  prompt: string;
  status: "running" | "done" | "error";
  result?: string;
  error?: string;
  startedAt: number;
  completedAt?: number;
}

// ── Interrupt/Queue Prompt ────────────────────────────

function InterruptPrompt(props: {
  message: string;
  onInterrupt: () => void;
  onQueue: () => void;
  onCancel: () => void;
}) {
  const { theme } = useTheme();
  const t = theme;
  const [selected, setSelected] = useState(0);
  const options = [
    { label: "Interrupt — stop current response and send new message", action: props.onInterrupt },
    { label: "Queue — wait for current response, then send", action: props.onQueue },
    { label: "Cancel — discard new message", action: props.onCancel },
  ];

  useKeyboard((key: any) => {
    if (key.name === "escape") { props.onCancel(); return; }
    if (key.name === "up" || key.name === "k") { setSelected((s) => Math.max(0, s - 1)); return; }
    if (key.name === "down" || key.name === "j") { setSelected((s) => Math.min(options.length - 1, s + 1)); return; }
    if (key.name === "return") { options[selected].action(); return; }
    // Quick keys
    if (key.sequence === "1" || key.sequence === "i") { props.onInterrupt(); return; }
    if (key.sequence === "2" || key.sequence === "q") { props.onQueue(); return; }
    if (key.sequence === "3") { props.onCancel(); return; }
  });

  const preview = props.message.length > 50 ? props.message.slice(0, 47) + "..." : props.message;

  return (
    <box flexDirection="column" flexShrink={0} paddingX={1}>
      <text fg={t.warning} attributes={TextAttributes.BOLD}>
        {"  Agent is streaming. What to do with your message?"}
      </text>
      <text fg={t.textDim}>{`  "${preview}"`}</text>
      <text>{""}</text>
      {options.map((opt, i) => (
        <text key={i} fg={i === selected ? t.primary : t.textMuted} attributes={i === selected ? TextAttributes.BOLD : undefined}>
          {`  ${i === selected ? "❯" : " "} ${i + 1}. ${opt.label}`}
        </text>
      ))}
      <text fg={t.textDim}>{"  ↑↓ Navigate  Enter Select  i/q/Esc Quick keys"}</text>
    </box>
  );
}

// ── Session View ────────────────────────────────────

export function SessionView(props: {
  onStatus: (s: string) => void;
  onTokens: (input: number, output: number) => void;
  onActiveTool: (tool: string | undefined) => void;
  onContextPercent: (pct: number) => void;
  onOpenDialog?: (dialog: string) => void;
  initialMessage?: { text: string; images?: ImageAttachment[] } | null;
  dialogOpen?: boolean;
}) {
  const sdk = useSDK();
  const { setMode } = useTheme();
  const { toast } = useToast();

  // Set terminal title to indicate active session
  setTerminalTitle("cdoing - session");

  const [messages, setMessages] = useState<Message[]>([]);
  const [streamingText, setStreamingText] = useState("");
  const streamingTextRef = useRef(streamingText);
  streamingTextRef.current = streamingText;
  const [isStreaming, setIsStreaming] = useState(false);
  const [agentMode, setAgentMode] = useState<AgentMode>("build");

  // Wire mode change to permission manager's agentType
  const handleModeChange = (mode: AgentMode) => {
    setAgentMode(mode);
    sdk.permissionManager.setAgentType(mode);
  };
  const [activeTool, setActiveTool] = useState<string | undefined>();
  const [pendingPermission, setPendingPermission] = useState<{
    toolName: string;
    message: string;
    resolve: (decision: "allow" | "always" | "deny") => void;
  } | null>(null);

  // Interrupt/queue prompt state
  const [pendingInterrupt, setPendingInterrupt] = useState<{
    text: string;
    images?: ImageAttachment[];
  } | null>(null);
  const queuedMessagesRef = useRef<string[]>([]);

  const totalInputRef = useRef(0);
  const totalOutputRef = useRef(0);
  const msgIdCounterRef = useRef(0);
  const conversationRef = useRef<Conversation | null>(null);
  const backgroundJobsRef = useRef<BackgroundJob[]>([]);
  const bgIdCounterRef = useRef(0);
  const planPendingRef = useRef(false);
  const planSummaryRef = useRef("");

  // Initialize conversation on first render
  if (!conversationRef.current) {
    conversationRef.current = createConversation(sdk.provider, sdk.model);
  }

  const addMessage = (role: Message["role"], content: string, extra?: Partial<Message>) => {
    const msg: Message = {
      id: `msg-${++msgIdCounterRef.current}`,
      role,
      content,
      timestamp: Date.now(),
      ...extra,
    };
    setMessages((prev) => [...prev, msg]);

    // Persist to conversation history
    if (conversationRef.current && (role === "user" || role === "assistant")) {
      addHistoryMessage(conversationRef.current, role, content);
    }

    return msg.id;
  };

  const updateMessage = (id: string, updates: Partial<Message>) => {
    setMessages((prev) =>
      prev.map((m) => (m.id === id ? { ...m, ...updates } : m))
    );
  };

  // ── Helpers ────────────────────────────────────────

  const loadStoredConfig = (): Record<string, any> => {
    try {
      const configPath = path.join(os.homedir(), ".cdoing", "config.json");
      if (fs.existsSync(configPath)) {
        return JSON.parse(fs.readFileSync(configPath, "utf-8"));
      }
    } catch {}
    return {};
  };

  const saveConfigKey = (key: string, value: any): void => {
    const configDir = path.join(os.homedir(), ".cdoing");
    const configPath = path.join(configDir, "config.json");
    let config: Record<string, any> = {};
    try {
      if (fs.existsSync(configPath)) {
        config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      }
    } catch {}
    config[key] = value;
    if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
  };

  const loadProjectSettings = (): Record<string, any> => {
    try {
      const settingsPath = path.join(sdk.workingDir, ".cdoing", "settings.json");
      if (fs.existsSync(settingsPath)) {
        return JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
      }
      const claudePath = path.join(sdk.workingDir, ".claude", "settings.json");
      if (fs.existsSync(claudePath)) {
        return JSON.parse(fs.readFileSync(claudePath, "utf-8"));
      }
    } catch {}
    return {};
  };

  // ── Background Jobs ──────────────────────────────

  const runBackgroundJob = (prompt: string) => {
    const job: BackgroundJob = {
      id: `bg-${++bgIdCounterRef.current}`,
      prompt,
      status: "running",
      startedAt: Date.now(),
    };
    backgroundJobsRef.current = [...backgroundJobsRef.current, job];
    addMessage("system", `Background job ${job.id} started: ${prompt.substring(0, 60)}${prompt.length > 60 ? "..." : ""}`);

    // Run in background with a separate callback set
    let bgResult = "";
    const bgCallbacks: AgentCallbacks = {
      onToken: (token) => { bgResult += token; },
      onToolCall: () => {},
      onToolResult: () => {},
      onComplete: () => {
        job.status = "done";
        job.result = bgResult.trim();
        job.completedAt = Date.now();
        backgroundJobsRef.current = [...backgroundJobsRef.current];
        addMessage("system", `Background job ${job.id} completed. Use /jobs ${job.id} to see results.`);
      },
      onError: (error) => {
        job.status = "error";
        job.error = error.message;
        job.completedAt = Date.now();
        backgroundJobsRef.current = [...backgroundJobsRef.current];
        addMessage("system", `Background job ${job.id} failed: ${error.message}`);
      },
    };

    // Fire and forget
    sdk.agent.run(prompt, bgCallbacks).catch((err) => {
      job.status = "error";
      job.error = err instanceof Error ? err.message : String(err);
      job.completedAt = Date.now();
    });
  };

  // ── Slash Commands ──────────────────────────────────

  const handleSlashCommand = (cmd: string) => {
    const [command, ...args] = cmd.split(" ");
    const arg = args.join(" ").trim();

    switch (command) {
      case "/clear":
        setMessages([]);
        sdk.agent.clearHistory();
        addMessage("system", "Chat cleared.");
        toast("success", "Chat cleared");
        break;

      case "/new":
        setMessages([]);
        sdk.agent.clearHistory();
        totalInputRef.current = 0;
        totalOutputRef.current = 0;
        props.onTokens(0, 0);
        props.onContextPercent(0);
        conversationRef.current = createConversation(sdk.provider, sdk.model);
        addMessage("system", "New conversation started.");
        toast("success", "New conversation started");
        break;

      case "/model": {
        if (arg && sdk.rebuildAgent) {
          sdk.rebuildAgent(sdk.provider, arg);
          addMessage("system", `Model switched to: ${arg}`);
          toast("info", `Model: ${arg}`);
        } else if (arg) {
          addMessage("system", "Model switching not available.");
          toast("warning", "Model switching not available");
        } else {
          addMessage("system", `Current model: ${sdk.model}`);
        }
        break;
      }

      case "/provider": {
        if (arg && sdk.rebuildAgent) {
          const { getDefaultModel } = require("@cdoing/ai");
          const defaultModel = getDefaultModel(arg) || sdk.model;
          sdk.rebuildAgent(arg, defaultModel);
          addMessage("system", `Provider switched to: ${arg} (model: ${defaultModel})`);
          toast("info", `Provider: ${arg} (${defaultModel})`);
        } else if (arg) {
          addMessage("system", "Provider switching not available.");
          toast("warning", "Provider switching not available");
        } else {
          addMessage("system", `Current provider: ${sdk.provider}`);
        }
        break;
      }

      case "/mode": {
        const currentMode = (sdk.permissionManager as any)?.mode || "ask";
        addMessage("system", `Permission mode: ${currentMode}\nAvailable: ask, auto-edit, auto`);
        break;
      }

      case "/dir": {
        if (arg) {
          const resolved = path.resolve(sdk.workingDir, arg);
          if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
            if (sdk.setWorkingDir) sdk.setWorkingDir(resolved);
            addMessage("system", `Working directory changed to: ${resolved}`);
          } else {
            addMessage("system", `Directory not found: ${resolved}`);
          }
        } else {
          addMessage("system", `Working directory: ${sdk.workingDir}`);
        }
        break;
      }

      case "/config": {
        if (arg.startsWith("set ")) {
          const setParts = arg.substring(4).trim().split(/\s+/);
          if (setParts.length >= 2) {
            const [key, ...valParts] = setParts;
            const value = valParts.join(" ");
            if (key === "api-key") {
              const config = loadStoredConfig();
              if (!config.apiKeys) config.apiKeys = {};
              config.apiKeys[sdk.provider] = value;
              saveConfigKey("apiKeys", config.apiKeys);
              addMessage("system", `API key saved for ${sdk.provider}.`);
            } else if (key === "api-key-helper") {
              saveConfigKey("apiKeyHelper", value);
              addMessage("system", `API key helper set to: ${value}`);
            } else {
              saveConfigKey(key, value);
              addMessage("system", `Config ${key} set to: ${value}`);
            }
          } else {
            addMessage("system", "Usage: /config set <key> <value>");
          }
        } else if (arg === "show" || !arg) {
          const config = loadStoredConfig();
          const lines = Object.entries(config)
            .filter(([k]) => k !== "apiKeys")
            .map(([k, v]) => `  ${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`);
          addMessage("system", lines.length > 0 ? "Configuration:\n" + lines.join("\n") : "No configuration found. Run /setup to configure.");
        } else {
          addMessage("system", "Usage: /config [show | set <key> <value>]");
        }
        break;
      }

      case "/theme": {
        const validModes = ["dark", "light"] as const;
        if (arg && (validModes as readonly string[]).includes(arg)) {
          setMode(arg as "dark" | "light");
          addMessage("system", `Theme mode switched to: ${arg}`);
          toast("success", `Mode: ${arg}`);
        } else {
          addMessage("system", "Usage: /theme dark | light  (or Ctrl+T for theme picker)");
          toast("warning", "Usage: /theme dark | light");
        }
        break;
      }

      case "/compact":
        if ((sdk.agent as any).compressContext) {
          (sdk.agent as any).compressContext();
          addMessage("system", "Context compressed.");
          toast("success", "Context compressed");
        } else {
          addMessage("system", "Context compression not available.");
          toast("warning", "Context compression not available");
        }
        break;

      case "/effort": {
        const levels = ["low", "medium", "high", "max"];
        if (arg && levels.includes(arg)) {
          addMessage("system", `Effort level set to: ${arg}`);
          toast("info", `Effort: ${arg}`);
        } else {
          addMessage("system", `Usage: /effort <${levels.join("|")}>`);
        }
        break;
      }

      case "/plan": {
        // Helper: rebuild agent with fresh system prompt, preserving history
        const rebuildWithHistory = () => {
          if (sdk.rebuildAgent) {
            const history = sdk.agent.getHistory();
            sdk.rebuildAgent(sdk.provider, sdk.model);
            if (history.length > 0) {
              sdk.agent.setHistory(history);
            }
          }
        };

        if (arg === "off" || arg === "cancel") {
          planPendingRef.current = false;
          sdk.permissionManager.setMode("default" as any);
          rebuildWithHistory();
          addMessage("system", "Plan mode cancelled. Switched to build mode.");
        } else if (arg === "show") {
          addMessage("system", planSummaryRef.current || "No active plan.");
        } else if (arg === "approve" || arg === "yes") {
          if (!planPendingRef.current) {
            addMessage("system", "No plan to approve. Use /plan <request> to create one.");
            break;
          }
          planPendingRef.current = false;
          sdk.permissionManager.setMode("default" as any);
          rebuildWithHistory();
          addMessage("system", "Plan approved! Switched to build mode. Executing...");
          const buildPrompt = [
            "[MODE SWITCH: Plan → Build]",
            "Your operational mode has changed from plan to build.",
            "You now have full access to write files, run commands, and execute tools.",
            "",
            "## Approved Plan",
            planSummaryRef.current || "Execute the plan you created.",
            "",
            "## Instructions",
            "Execute the plan step by step. If a step fails, explain why and suggest alternatives.",
          ].join("\n");
          sendMessage(buildPrompt);
        } else if (arg === "reject" || arg === "no") {
          planPendingRef.current = false;
          sdk.permissionManager.setMode("default" as any);
          rebuildWithHistory();
          addMessage("system", "Plan rejected. Switched to build mode.");
        } else if (!arg) {
          const isActive = planPendingRef.current;
          if (isActive) {
            planPendingRef.current = false;
            sdk.permissionManager.setMode("default" as any);
            rebuildWithHistory();
            addMessage("system", "Plan mode OFF. Switched to build mode.");
          } else {
            sdk.permissionManager.setMode("plan" as any);
            rebuildWithHistory();
            addMessage("system", "Plan mode ON (read-only). Send a message to start planning.\nUse /plan approve to execute, /plan reject to cancel.");
          }
        } else {
          // /plan <request>
          sdk.permissionManager.setMode("plan" as any);
          rebuildWithHistory();
          planPendingRef.current = true;
          addMessage("system", "Plan mode ON (read-only). Generating plan...\nUse /plan approve when ready, /plan reject to cancel.");
          const planPrompt = [
            "[PLAN MODE — Read-only]",
            "Analyze this request and create a detailed step-by-step implementation plan.",
            "You are in read-only mode — you can read files, search code, and explore, but CANNOT write or execute.",
            "When your plan is complete, call plan_exit with a summary.",
            "",
            `Request: ${arg}`,
          ].join("\n");
          sendMessage(planPrompt);
        }
        break;
      }

      case "/permissions": {
        const settings = loadProjectSettings();
        const allow = settings?.allow || [];
        const deny = settings?.deny || [];
        const lines: string[] = ["Permission rules:"];
        if (deny.length > 0) lines.push("  Deny: " + deny.join(", "));
        if (allow.length > 0) lines.push("  Allow: " + allow.join(", "));
        if (deny.length === 0 && allow.length === 0) lines.push("  No custom rules configured.");
        addMessage("system", lines.join("\n"));
        break;
      }

      case "/hooks": {
        try {
          const hooksPath = path.join(sdk.workingDir, ".cdoing", "hooks.json");
          if (fs.existsSync(hooksPath)) {
            const hooks = JSON.parse(fs.readFileSync(hooksPath, "utf-8"));
            const keys = Object.keys(hooks);
            addMessage("system", keys.length > 0
              ? "Configured hooks:\n" + keys.map((k) => `  ${k}: ${JSON.stringify(hooks[k])}`).join("\n")
              : "No hooks configured.");
          } else {
            addMessage("system", "No hooks file found (.cdoing/hooks.json).");
          }
        } catch {
          addMessage("system", "No hooks configured.");
        }
        break;
      }

      case "/rules": {
        try {
          const rulesDir = path.join(sdk.workingDir, ".cdoing", "rules");
          if (fs.existsSync(rulesDir)) {
            const files = fs.readdirSync(rulesDir).filter((f: string) => f.endsWith(".md"));
            addMessage("system", files.length > 0
              ? "Project rules:\n" + files.map((f: string) => `  ${f}`).join("\n")
              : "No rules found in .cdoing/rules/.");
          } else {
            addMessage("system", "No rules directory found (.cdoing/rules/).");
          }
        } catch {
          addMessage("system", "No rules configured.");
        }
        break;
      }

      case "/memory":
        addMessage("system", "Memory store: not yet implemented in TUI. Coming soon.");
        break;

      case "/tasks":
        addMessage("system", "Task list: not yet implemented in TUI. Coming soon.");
        break;

      case "/context":
        addMessage("system", [
          "Context providers (use @ to invoke):",
          "  @terminal  — Recent terminal output",
          "  @url       — Fetch URL content",
          "  @tree      — Project file tree",
          "  @codebase  — Full codebase context",
          "  @clip      — Clipboard content",
          "  @file      — Include a file",
        ].join("\n"));
        break;

      case "/mcp":
        addMessage("system", "MCP server management: not yet implemented in TUI. Coming soon.");
        break;

      case "/history":
      case "/ls": {
        const convs = listConversations().slice(0, 20);
        if (convs.length > 0) {
          const lines = convs.map((c) => {
            const id = c.id.substring(0, 12);
            const date = formatRelativeDate(c.updatedAt);
            const msgCount = c.messages.filter((m) => m.role === "user").length;
            return `  ${id}  ${date.padEnd(10)}  (${msgCount} msgs)  ${c.title}`;
          });
          addMessage("system", "Conversations:\n" + lines.join("\n") + "\n\nUse /resume <id> to continue. Ctrl+S for interactive browser.");
        } else {
          addMessage("system", "No saved conversations found.");
        }
        break;
      }

      case "/resume": {
        if (!arg) {
          addMessage("system", "Usage: /resume <conversation-id>");
          break;
        }
        const conv = loadConversation(arg);
        if (!conv) {
          addMessage("system", `Conversation not found: ${arg}`);
          break;
        }
        // Restore conversation
        conversationRef.current = conv;
        setMessages([]);
        sdk.agent.clearHistory();
        totalInputRef.current = 0;
        totalOutputRef.current = 0;
        // Replay messages into UI
        for (const m of conv.messages) {
          if (m.role === "user" || m.role === "assistant") {
            const msg: Message = {
              id: `msg-${++msgIdCounterRef.current}`,
              role: m.role,
              content: m.content,
              timestamp: m.timestamp,
            };
            setMessages((prev) => [...prev, msg]);
          }
        }
        addMessage("system", `Resumed conversation: ${conv.title}`);
        break;
      }

      case "/view": {
        if (!arg) {
          addMessage("system", "Usage: /view <conversation-id>");
          break;
        }
        const conv = loadConversation(arg);
        if (!conv) {
          addMessage("system", `Conversation not found: ${arg}`);
          break;
        }
        const viewMsgs = conv.messages
          .filter((m) => m.role !== "tool")
          .slice(-20)
          .map((m) => {
            const prefix = m.role === "user" ? "❯" : "◆";
            const content = m.content.length > 100 ? m.content.substring(0, 97) + "..." : m.content;
            return `  ${prefix} ${content.replace(/\n/g, " ")}`;
          });
        addMessage("system", `Conversation: ${conv.title}\n\n${viewMsgs.join("\n")}`);
        break;
      }

      case "/fork": {
        const sourceConv = arg ? loadConversation(arg) : conversationRef.current;
        if (!sourceConv) {
          addMessage("system", arg ? `Conversation not found: ${arg}` : "No active conversation to fork.");
          break;
        }
        const forked = forkConversation(sourceConv);
        if (forked) {
          addMessage("system", `Forked conversation: ${forked.id.substring(0, 12)} — "${forked.title}"`);
        } else {
          addMessage("system", "Failed to fork conversation.");
        }
        break;
      }

      case "/delete": {
        if (!arg) {
          addMessage("system", "Usage: /delete <conversation-id>");
          break;
        }
        if (deleteConversation(arg)) {
          addMessage("system", `Conversation deleted: ${arg}`);
        } else {
          addMessage("system", `Conversation not found: ${arg}`);
        }
        break;
      }

      case "/bg": {
        if (!arg) {
          addMessage("system", "Usage: /bg <prompt>");
          break;
        }
        runBackgroundJob(arg);
        break;
      }

      case "/jobs": {
        const jobs = backgroundJobsRef.current;
        if (arg) {
          // Show specific job
          const job = jobs.find((j) => j.id === arg);
          if (job) {
            const elapsed = job.completedAt
              ? `${((job.completedAt - job.startedAt) / 1000).toFixed(1)}s`
              : `${((Date.now() - job.startedAt) / 1000).toFixed(1)}s (running)`;
            const result = job.result
              ? job.result.length > 500 ? job.result.substring(0, 497) + "..." : job.result
              : job.error || "(no output)";
            addMessage("system", `Job ${job.id} [${job.status}] (${elapsed}):\n  Prompt: ${job.prompt}\n  Result: ${result}`);
          } else {
            addMessage("system", `Job not found: ${arg}`);
          }
        } else if (jobs.length > 0) {
          const lines = jobs.map((j) => {
            const icon = j.status === "running" ? "⏳" : j.status === "done" ? "✓" : "✗";
            return `  ${icon} ${j.id}  ${j.status}  ${j.prompt.substring(0, 50)}${j.prompt.length > 50 ? "..." : ""}`;
          });
          addMessage("system", "Background jobs:\n" + lines.join("\n"));
        } else {
          addMessage("system", "No background jobs.");
        }
        break;
      }

      case "/btw": {
        if (!arg) {
          addMessage("system", "Usage: /btw <question>");
          break;
        }
        // Ephemeral question — don't add to conversation history
        const btwMsg: Message = {
          id: `msg-${++msgIdCounterRef.current}`,
          role: "user",
          content: `(btw) ${arg}`,
          timestamp: Date.now(),
        };
        setMessages((prev) => [...prev, btwMsg]);
        setIsStreaming(true);
        setStreamingText("");
        props.onStatus("Processing...");

        let btwResult = "";
        const btwCallbacks: AgentCallbacks = {
          onToken: (token) => {
            btwResult += token;
            setStreamingText((prev) => prev + token);
          },
          onToolCall: () => {},
          onToolResult: () => {},
          onComplete: () => {
            if (btwResult.trim()) {
              const msg: Message = {
                id: `msg-${++msgIdCounterRef.current}`,
                role: "assistant",
                content: btwResult.trim(),
                timestamp: Date.now(),
              };
              setMessages((prev) => [...prev, msg]);
              setStreamingText("");
            }
            setIsStreaming(false);
            props.onStatus("Ready");
          },
          onError: (error) => {
            addMessage("system", `Error: ${error.message}`);
            setIsStreaming(false);
            props.onStatus("Error");
          },
        };

        sdk.agent.run(arg, btwCallbacks).catch((err) => {
          addMessage("system", `Error: ${err instanceof Error ? err.message : String(err)}`);
          setIsStreaming(false);
          props.onStatus("Error");
        });
        break;
      }

      case "/login":
      case "/setup":
        if (props.onOpenDialog) {
          props.onOpenDialog("setup");
        } else {
          addMessage("system", "Setup wizard: configure via ~/.cdoing/config.json or run the base CLI with --login.");
        }
        break;

      case "/logout": {
        try {
          const { fullLogout } = require("@cdoing/core");
          const msg = fullLogout(sdk.provider);

          // Invalidate the in-memory agent so it can't make further API calls
          sdk.agent.invalidate();

          addMessage("system", msg);
        } catch {
          addMessage("system", "OAuth logout not available.");
        }
        break;
      }

      case "/auth-status": {
        const config = loadStoredConfig();
        const lines: string[] = ["Authentication Status:", ""];

        // OAuth status
        try {
          const { getAllOAuthStatuses } = require("@cdoing/core");
          const oauthStatuses = getAllOAuthStatuses();
          lines.push("OAuth:");
          let hasOAuth = false;
          for (const s of oauthStatuses) {
            if (s.status === "none") continue;
            hasOAuth = true;
            const icon = s.status === "active" ? "✓" : "✗";
            const label = s.status === "active" ? "active" : "expired";
            const expires = s.expiresAt ? new Date(s.expiresAt).toLocaleString() : "unknown";
            lines.push(`  ${icon} ${s.name}: ${label}`);
            if (s.expiresAt) lines.push(`    Expires: ${expires}`);
          }
          if (!hasOAuth) lines.push("  None");
        } catch {
          lines.push("OAuth: unavailable");
        }

        // API keys
        lines.push("");
        lines.push("Stored API keys:");
        if (config.apiKeys && Object.keys(config.apiKeys).length > 0) {
          for (const [prov, key] of Object.entries(config.apiKeys)) {
            const k = String(key);
            const masked = k.slice(0, 8) + "..." + k.slice(-4);
            lines.push(`  ✓ ${prov}: ${masked}`);
          }
        } else {
          lines.push("  None");
        }

        lines.push("");
        lines.push("Environment variables:");
        const envVars: [string, string | undefined][] = [
          ["ANTHROPIC_API_KEY", process.env.ANTHROPIC_API_KEY],
          ["OPENAI_API_KEY", process.env.OPENAI_API_KEY],
          ["GOOGLE_API_KEY", process.env.GOOGLE_API_KEY],
        ];
        let hasEnvKey = false;
        for (const [name, value] of envVars) {
          if (value) {
            hasEnvKey = true;
            const masked = value.slice(0, 8) + "..." + value.slice(-4);
            lines.push(`  ✓ ${name}: ${masked}`);
          }
        }
        if (!hasEnvKey) lines.push("  None");

        addMessage("system", lines.join("\n"));
        break;
      }

      case "/doctor": {
        const checks: string[] = ["System health check:"];
        const config = loadStoredConfig();
        const envKey = process.env[`${sdk.provider.toUpperCase()}_API_KEY`];
        let hasAuth = !!(config.apiKeys?.[sdk.provider] || envKey);
        if (!hasAuth) {
          try {
            const { getOAuthStatus } = require("@cdoing/core");
            hasAuth = getOAuthStatus(sdk.provider).status === "active";
          } catch {}
        }
        checks.push(`  Provider: ${sdk.provider} ${hasAuth ? "✓ Authenticated" : "✗ No API key or OAuth token"}`);
        checks.push(`  Model: ${sdk.model}`);
        checks.push(`  Working dir: ${sdk.workingDir} ${fs.existsSync(sdk.workingDir) ? "✓" : "✗"}`);
        const hasCdoing = fs.existsSync(path.join(sdk.workingDir, ".cdoing"));
        const hasClaude = fs.existsSync(path.join(sdk.workingDir, ".claude"));
        checks.push(`  Project config: ${hasCdoing ? ".cdoing/ ✓" : hasClaude ? ".claude/ ✓" : "✗ none"}`);
        checks.push(`  Node: ${process.version}`);
        checks.push(`  Platform: ${process.platform} ${process.arch}`);

        // Check conversation history
        const convs = listConversations();
        checks.push(`  Conversations: ${convs.length} saved`);

        // Check background jobs
        const runningJobs = backgroundJobsRef.current.filter((j) => j.status === "running");
        if (runningJobs.length > 0) {
          checks.push(`  Background jobs: ${runningJobs.length} running`);
        }

        addMessage("system", checks.join("\n"));
        break;
      }

      case "/init": {
        const cdoingDir = path.join(sdk.workingDir, ".cdoing");
        if (fs.existsSync(cdoingDir)) {
          addMessage("system", "Project already initialized (.cdoing/ exists).");
        } else {
          try {
            fs.mkdirSync(cdoingDir, { recursive: true });
            fs.mkdirSync(path.join(cdoingDir, "rules"), { recursive: true });
            fs.writeFileSync(
              path.join(cdoingDir, "config.md"),
              "# Project Configuration\n\nDescribe your project here for the AI assistant.\n",
              "utf-8"
            );
            addMessage("system", "Project initialized. Created .cdoing/ with config.md and rules/.");
          } catch (err) {
            addMessage("system", `Failed to initialize: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
        break;
      }

      case "/queue":
        addMessage("system", "Message queue is empty.");
        break;

      case "/help":
        addMessage("system", [
          "Available commands:",
          "",
          "  Session",
          "  /clear           Clear chat history",
          "  /new             Start new conversation",
          "  /compact         Compress context window",
          "  /btw <question>  Ask without adding to history",
          "",
          "  Configuration",
          "  /model [name]    Show/change model",
          "  /provider [name] Show/change provider",
          "  /mode            Show permission mode",
          "  /dir [path]      Show/change working directory",
          "  /config          Show configuration",
          "  /config set k v  Set a config value",
          "  /theme <mode>    Switch theme (dark/light/auto)",
          "  /effort <level>  Set effort (low/medium/high/max)",
          "  /plan <on|off>   Toggle plan mode",
          "",
          "  History",
          "  /history, /ls    List saved conversations",
          "  /resume <id>     Resume conversation",
          "  /view <id>       View conversation messages",
          "  /fork [id]       Fork current/specified conversation",
          "  /delete <id>     Delete conversation",
          "",
          "  Background",
          "  /bg <prompt>     Run prompt in background",
          "  /jobs [id]       List/inspect background jobs",
          "",
          "  System",
          "  /permissions     Show permission rules",
          "  /hooks           Show configured hooks",
          "  /rules           Show project rules",
          "  /context         Show context providers",
          "  /mcp             MCP server management",
          "  /doctor          System health check",
          "  /usage           Show token usage",
          "  /auth-status     Show authentication status",
          "",
          "  /setup           Run setup wizard",
          "  /login           Open setup wizard",
          "  /logout          Clear OAuth tokens",
          "  /init            Initialize project config",
          "  /exit            Quit",
          "",
          "Keyboard shortcuts:",
          "  Ctrl+V    Paste text or image",
          "  Ctrl+U    Clear input line",
          "  Ctrl+W    Delete last word",
          "  Ctrl+P    Command palette",
          "  Ctrl+O    Model picker",
          "  Ctrl+N    New session",
          "  Ctrl+S    Session browser",
          "  Tab       Switch mode (Build/Plan)",
          "  →         Accept autocomplete",
          "  ↑/↓       Navigate suggestions",
          "  Escape    Close dropdown",
          "",
          "Shell: prefix with ! or type commands directly (ls, git, npm, etc.)",
          "Context: use @terminal, @url, @tree, @codebase, @clip, @file in messages",
        ].join("\n"));
        break;

      case "/usage":
        addMessage("system", `Tokens: ${totalInputRef.current.toLocaleString()}→${totalOutputRef.current.toLocaleString()} (${(totalInputRef.current + totalOutputRef.current).toLocaleString()} total)`);
        break;

      case "/exit":
      case "/quit":
        process.exit(0);
        break;

      default:
        addMessage("system", `Unknown command: ${command}. Type /help for available commands.`);
        toast("error", `Unknown command: ${command}`);
    }
  };

  // ── Shell Commands ────────────────────────────────

  const runShellCommand = (shellCmd: string) => {
    addMessage("user", `!${shellCmd}`);
    let output = "";
    let errorMsg = "";
    try {
      output = execSync(shellCmd, {
        cwd: sdk.workingDir,
        env: { ...process.env },
        encoding: "utf-8",
        timeout: 120000,
        maxBuffer: 10 * 1024 * 1024,
      });
    } catch (err: any) {
      if (err.stdout) output = String(err.stdout);
      if (err.stderr) errorMsg = String(err.stderr);
      if (err.status !== undefined && err.status !== 0) {
        errorMsg += `\n[exited with code ${err.status}]`;
      } else if (!err.stdout && !err.stderr && err.message) {
        errorMsg = err.message;
      }
    }
    const result = (output + (errorMsg ? `\n${errorMsg}` : "")).trim();
    addMessage("system", `$ ${shellCmd}\n${result || "(no output)"}`);

    // Push to terminal context provider
    pushTerminalOutput(`$ ${shellCmd}\n${result}`);
  };

  // ── Interrupt: stop streaming, flush partial, send new message with context ──

  const handleInterrupt = (text: string, images?: ImageAttachment[]) => {
    // Capture partial response and interrupt — adds partial to agent history for context
    const partialResponse = streamingTextRef.current.trim();
    sdk.agent.interrupt(partialResponse);

    // Flush partial streaming text as a message
    if (partialResponse) {
      addMessage("assistant", partialResponse + "\n\n*(interrupted)*");
      setStreamingText("");
    }

    setIsStreaming(false);
    props.onStatus("Ready");
    setActiveTool(undefined);
    props.onActiveTool(undefined);
    setPendingInterrupt(null);

    // Send the new message — agent.cancel() calls onComplete which resets state,
    // so we use a small delay to let that settle
    setTimeout(() => {
      doSendMessage(text, images);
    }, 100);
  };

  // ── Queue: add to queue, process after current stream finishes ──

  const handleQueue = (text: string) => {
    queuedMessagesRef.current.push(text);
    addMessage("system", `📬 Queued message (${queuedMessagesRef.current.length} in queue)`);
    setPendingInterrupt(null);
  };

  // ── Process queued messages after streaming completes ──

  const processQueue = () => {
    if (queuedMessagesRef.current.length > 0) {
      const next = queuedMessagesRef.current.shift()!;
      setTimeout(() => doSendMessage(next), 100);
    }
  };

  // ── Send Message ────────────────────────────────────

  const sendMessage = async (text: string, images?: ImageAttachment[]) => {
    if (text.startsWith("/")) {
      handleSlashCommand(text);
      return;
    }

    // Shell commands always run immediately
    const shellCmd = text.startsWith("!")
      ? text.slice(1).trim()
      : detectShellCommand(text);

    if (shellCmd) {
      // Intercept "cd" — execSync runs in a child process, so cd has no effect there
      const shellParts = shellCmd.trim().split(/\s+/);
      if (shellParts[0] === "cd") {
        const target = shellParts.slice(1).join(" ") || process.env.HOME || "/";
        const resolved = path.resolve(sdk.workingDir, target);
        if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
          if (sdk.setWorkingDir) sdk.setWorkingDir(resolved);
          addMessage("system", `Working directory changed to: ${resolved}`);
        } else {
          addMessage("system", `cd: no such directory: ${resolved}`);
        }
        return;
      }
      runShellCommand(shellCmd);
      return;
    }

    // If currently streaming, show interrupt/queue prompt
    if (isStreaming) {
      setPendingInterrupt({ text, images });
      return;
    }

    await doSendMessage(text, images);
  };

  // Auto-send initial message from home screen input
  const initialMessageSentRef = useRef(false);
  useEffect(() => {
    if (props.initialMessage && !initialMessageSentRef.current) {
      initialMessageSentRef.current = true;
      sendMessage(props.initialMessage.text, props.initialMessage.images);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const doSendMessage = async (text: string, images?: ImageAttachment[]) => {
    // Inject plan mode context if active
    let messageText = text;
    if (planPendingRef.current || sdk.permissionManager.getMode() === ("plan" as any)) {
      messageText = `[PLAN MODE — Read-only] You are in plan mode. Do NOT write files, run commands, or modify anything. Only read, search, analyze, and create a plan using the todo tool. When your plan is ready, call plan_exit.\n\n${text}`;
    }

    // Resolve @mention context providers
    let expandedText = messageText;
    if (hasContextMentions(messageText)) {
      try {
        expandedText = await resolveContextProviders(text, sdk.workingDir);
      } catch {
        // If expansion fails, send original text
      }
    }

    addMessage("user", text + (images && images.length > 0 ? ` [${images.length} image${images.length > 1 ? "s" : ""}]` : ""));
    setIsStreaming(true);
    setStreamingText("");
    props.onStatus("Processing...");

    // FIFO queue per tool name — supports parallel calls (e.g. multiple file_read)
    const toolCallQueue = new Map<string, string[]>();
    function pushToolCallId(name: string, id: string) {
      const queue = toolCallQueue.get(name) || [];
      queue.push(id);
      toolCallQueue.set(name, queue);
    }
    function popToolCallId(name: string): string | undefined {
      const queue = toolCallQueue.get(name);
      if (!queue || queue.length === 0) return undefined;
      const id = queue.shift()!;
      if (queue.length === 0) toolCallQueue.delete(name);
      return id;
    }
    function peekToolCallId(name: string): string | undefined {
      const queue = toolCallQueue.get(name);
      return queue?.[queue.length - 1];
    }

    let currentToolId: string | undefined;
    let currentToolOutput = "";
    const toolOutputMap = new Map<string, string>(); // per-tool-id output accumulator
    let turnInput = 0;

    const callbacks: AgentCallbacks = {
      onToken: (token) => {
        setStreamingText((prev) => prev + token);
      },

      onTextToolCallDetected: () => {
        // Local models (Ollama) may stream tool calls as text — clear raw JSON
        setStreamingText("");
      },

      onToolCallStreaming: (name) => {
        // Model is starting to generate a tool call — flush text and show indicator
        const current = streamingTextRef.current.trim();
        if (current) {
          addMessage("assistant", current);
          setStreamingText("");
        }
        currentToolOutput = "";
        const id = addMessage("tool", `Generating ${name}...`, {
          toolName: name,
          toolStatus: "running",
          toolInput: {},
        });
        currentToolId = id;
        pushToolCallId(name, id);
        toolOutputMap.set(id, "");
        setActiveTool(name);
        props.onActiveTool(name);
      },

      onToolCall: (name, input) => {
        // Flush streaming text to a message
        const current = streamingTextRef.current.trim();
        if (current) {
          addMessage("assistant", current);
          setStreamingText("");
        }

        const toolInput = (typeof input === "object" && input) ? input as Record<string, any> : {};
        const description = toolInput.description || "";

        // If we already have a streaming placeholder for this tool, update it
        if (currentToolId && peekToolCallId(name) === currentToolId) {
          updateMessage(currentToolId, {
            content: description,
            toolInput,
          });
          toolOutputMap.set(currentToolId, "");
        } else {
          const id = addMessage("tool", description, {
            toolName: name,
            toolStatus: "running",
            toolInput,
          });
          currentToolId = id;
          pushToolCallId(name, id);
          toolOutputMap.set(id, "");
        }
        setActiveTool(name);
        props.onActiveTool(name);
      },

      onToolProgress: (name, chunk) => {
        // Stream tool output (e.g., shell commands) in real-time
        const callId = peekToolCallId(name) || currentToolId;
        if (callId) {
          const prev = toolOutputMap.get(callId) || "";
          const updated = prev + chunk;
          toolOutputMap.set(callId, updated);
          updateMessage(callId, { content: updated });
        }
      },

      onDiffChunk: (chunk) => {
        // Stream file diff chunks — append to current tool output
        if (currentToolId) {
          let line = "";
          switch (chunk.type) {
            case "file-header": line = `📄 ${chunk.content}\n`; break;
            case "add": line = `+ ${chunk.content}\n`; break;
            case "remove": line = `- ${chunk.content}\n`; break;
            case "hunk-header": line = `${chunk.content}\n`; break;
            default: line = `${chunk.content}\n`; break;
          }
          const prev = toolOutputMap.get(currentToolId) || "";
          const updated = prev + line;
          toolOutputMap.set(currentToolId, updated);
          updateMessage(currentToolId, { content: updated });
        }
      },

      onToolResult: (name, result, isError) => {
        // Pop the oldest pending call for this tool name (FIFO — matches VS Code queue)
        const callId = popToolCallId(name) || currentToolId;
        if (callId) {
          const summary = result.length > 80 ? result.substring(0, 77) + "..." : result;
          updateMessage(callId, {
            content: summary,
            toolStatus: isError ? "error" : "done",
            isError,
          });
          toolOutputMap.delete(callId);
          // If this was the active tool, clear it
          if (callId === currentToolId) {
            currentToolId = undefined;
          }
        }
        // Only clear active tool if no more pending calls
        if (toolCallQueue.size === 0) {
          setActiveTool(undefined);
          props.onActiveTool(undefined);
        }
      },

      onCompactStart: (contextPercent) => {
        try {
          addMessage("system", `⟳ Compacting context (${contextPercent}% used)...`);
        } catch {}
      },

      onCompactEnd: (savedTokens, newPercent) => {
        try {
          addMessage("system", `✓ Context compacted — saved ${savedTokens.toLocaleString()} tokens (now ${newPercent}%)`);
        } catch {}
      },

      onComplete: () => {
        const current = streamingTextRef.current.trim();
        if (current) {
          addMessage("assistant", current);
          setStreamingText("");
        }

        setIsStreaming(false);
        props.onStatus("Ready");
        setActiveTool(undefined);
        props.onActiveTool(undefined);
        props.onTokens(totalInputRef.current, totalOutputRef.current);
        // Process queued messages
        processQueue();
      },

      onError: (error) => {
        const current = streamingTextRef.current.trim();
        if (current) {
          addMessage("assistant", current);
          setStreamingText("");
        }
        const msg = error.message;
        const lower = msg.toLowerCase();
        let display: string;
        if (lower.includes("401") || lower.includes("403") || lower.includes("authentication") || lower.includes("invalid_api_key")) {
          display = `Authentication Error: ${msg}\n\nRun /setup or /login to re-authenticate.`;
        } else if (lower.includes("429") || lower.includes("rate") || lower.includes("quota") || lower.includes("credit balance")) {
          display = `Rate Limit / Quota Error: ${msg}\n\nWait a moment and retry, or use /model to switch.`;
        } else if (lower.includes("econnrefused") || lower.includes("enotfound") || lower.includes("etimedout") || lower.includes("fetch failed") || lower.includes("network") || lower.includes("socket")) {
          display = `Network Error: ${msg}\n\nCheck your internet connection and try again.`;
        } else if (lower.includes("empty response")) {
          display = `Empty Response: The model returned no output. Try again or switch models.`;
        } else if (lower.includes("404") || (lower.includes("not found") && lower.includes("model"))) {
          display = `Model Not Found: ${msg}\n\nUse /model to switch to a valid model.`;
        } else {
          display = `Error: ${msg}`;
        }
        addMessage("system", display);
        toast("error", display.split("\n")[0]);
        setIsStreaming(false);
        props.onStatus("Error");
        setActiveTool(undefined);
        props.onActiveTool(undefined);
      },

      onUsage: (usage) => {
        turnInput += usage.inputTokens;
        totalInputRef.current += usage.inputTokens;
        totalOutputRef.current += usage.outputTokens;
        props.onTokens(totalInputRef.current, totalOutputRef.current);
        // Estimate context usage (rough: typical 200k window)
        const pct = Math.min(100, (turnInput / 200000) * 100);
        props.onContextPercent(pct);
      },
    };

    try {
      await sdk.agent.run(expandedText, callbacks, images);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      addMessage("system", `Error: ${msg}`);
      toast("error", msg);
      setIsStreaming(false);
      props.onStatus("Error");
    }
  };

  return (
    <box flexDirection="column" flexGrow={1} paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1} gap={1}>
      {/* Scrollable message area — directly in layout for proper flex height (like OpenCode) */}
      <scrollbox
        stickyScroll={true}
        stickyStart="bottom"
        flexGrow={1}
        scrollY={true}
      >
        <MessageList
          messages={messages}
          streamingText={streamingText}
          isStreaming={isStreaming}
        />
      </scrollbox>

      {/* Fixed bottom area — never pushed off screen */}
      <box flexDirection="column" flexShrink={0}>
        {/* Permission prompt overlay */}
        {pendingPermission && (
          <PermissionPrompt
            toolName={pendingPermission.toolName}
            message={pendingPermission.message}
            onDecision={(decision) => {
              pendingPermission.resolve(decision);
              setPendingPermission(null);
            }}
          />
        )}

        {/* Interrupt/Queue prompt */}
        {pendingInterrupt && (
          <InterruptPrompt
            message={pendingInterrupt.text}
            onInterrupt={() => handleInterrupt(pendingInterrupt.text, pendingInterrupt.images)}
            onQueue={() => handleQueue(pendingInterrupt.text)}
            onCancel={() => setPendingInterrupt(null)}
          />
        )}

        {/* Loading spinner */}
        {isStreaming && !streamingText && !pendingInterrupt && (
          <LoadingSpinner label={activeTool || "Thinking..."} />
        )}

        {/* Input area */}
        <InputArea
          onSubmit={sendMessage}
          disabled={false}
          suppressInput={props.dialogOpen}
          placeholder={isStreaming ? "Type to interrupt or queue..." : undefined}
          workingDir={sdk.workingDir}
          mode={agentMode}
          onModeChange={handleModeChange}
          modelLabel={sdk.model}
        />
      </box>
    </box>
  );
}
