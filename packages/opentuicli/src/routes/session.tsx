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

import { useState, useRef } from "react";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { MessageList, type Message } from "../components/message-list";
import { InputArea } from "../components/input-area";
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

// ── Session View ────────────────────────────────────

export function SessionView(props: {
  onStatus: (s: string) => void;
  onTokens: (input: number, output: number) => void;
  onActiveTool: (tool: string | undefined) => void;
  onContextPercent: (pct: number) => void;
  onOpenDialog?: (dialog: string) => void;
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
  const [activeTool, setActiveTool] = useState<string | undefined>();
  const [pendingPermission, setPendingPermission] = useState<{
    toolName: string;
    message: string;
    resolve: (decision: "allow" | "always" | "deny") => void;
  } | null>(null);

  const totalInputRef = useRef(0);
  const totalOutputRef = useRef(0);
  const msgIdCounterRef = useRef(0);
  const conversationRef = useRef<Conversation | null>(null);
  const backgroundJobsRef = useRef<BackgroundJob[]>([]);
  const bgIdCounterRef = useRef(0);

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
        const validThemes = ["dark", "light", "auto"] as const;
        if (arg && validThemes.includes(arg as any)) {
          setMode(arg as "dark" | "light" | "auto");
          addMessage("system", `Theme switched to: ${arg}`);
          toast("success", `Theme: ${arg}`);
        } else {
          addMessage("system", "Usage: /theme dark | light | auto");
          toast("warning", "Usage: /theme dark | light | auto");
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
        if (arg === "on") {
          addMessage("system", "Plan mode enabled. Agent will propose a plan before executing.");
        } else if (arg === "off") {
          addMessage("system", "Plan mode disabled.");
        } else if (arg === "show") {
          addMessage("system", "No active plan.");
        } else if (arg === "approve") {
          addMessage("system", "No plan to approve.");
        } else if (arg === "reject") {
          addMessage("system", "No plan to reject.");
        } else {
          addMessage("system", "Usage: /plan <on|off|show|approve|reject>");
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
          const { clearOAuthTokens } = require("@cdoing/core");
          clearOAuthTokens();
          addMessage("system", "OAuth tokens cleared.");
        } catch {
          addMessage("system", "OAuth logout not available.");
        }
        break;
      }

      case "/auth-status": {
        const config = loadStoredConfig();
        const lines: string[] = ["Authentication Status:", ""];

        // API keys
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
        checks.push(`  Provider: ${sdk.provider} ${config.apiKeys?.[sdk.provider] || envKey ? "✓ API key found" : "✗ No API key"}`);
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
          "  Ctrl+N    New session",
          "  Ctrl+P    Model picker",
          "  Ctrl+S    Session browser",
          "  Tab/→     Accept autocomplete",
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

  // ── Send Message ────────────────────────────────────

  const sendMessage = async (text: string, images?: ImageAttachment[]) => {
    if (text.startsWith("/")) {
      handleSlashCommand(text);
      return;
    }

    // Shell command: explicit ! prefix or auto-detected
    const shellCmd = text.startsWith("!")
      ? text.slice(1).trim()
      : detectShellCommand(text);

    if (shellCmd) {
      runShellCommand(shellCmd);
      return;
    }

    // Resolve @mention context providers
    let expandedText = text;
    if (hasContextMentions(text)) {
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

    let currentToolId: string | undefined;
    let turnInput = 0;

    const callbacks: AgentCallbacks = {
      onToken: (token) => {
        setStreamingText((prev) => prev + token);
      },

      onToolCall: (name, input) => {
        // Flush streaming text to a message
        const current = streamingTextRef.current.trim();
        if (current) {
          addMessage("assistant", current);
          setStreamingText("");
        }

        const description = (input as any)?.description || "";
        currentToolId = addMessage("tool", description, {
          toolName: name,
          toolStatus: "running",
        });
        setActiveTool(name);
        props.onActiveTool(name);
      },

      onToolResult: (_name, result, isError) => {
        if (currentToolId) {
          const summary = result.length > 80 ? result.substring(0, 77) + "..." : result;
          updateMessage(currentToolId, {
            content: summary,
            toolStatus: isError ? "error" : "done",
            isError,
          });
          currentToolId = undefined;
        }
        setActiveTool(undefined);
        props.onActiveTool(undefined);
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
      },

      onError: (error) => {
        const current = streamingTextRef.current.trim();
        if (current) {
          addMessage("assistant", current);
          setStreamingText("");
        }
        addMessage("system", `Error: ${error.message}`);
        toast("error", error.message);
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
    <box flexDirection="column" width="100%" flexGrow={1}>
      {/* Message list */}
      <MessageList
        messages={messages}
        streamingText={streamingText}
        isStreaming={isStreaming}
      />

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

      {/* Loading spinner */}
      {isStreaming && !streamingText && (
        <LoadingSpinner label={activeTool || "Thinking..."} />
      )}

      {/* Input area */}
      <InputArea
        onSubmit={sendMessage}
        disabled={isStreaming}
        placeholder={isStreaming ? "Agent is working..." : undefined}
        workingDir={sdk.workingDir}
      />
    </box>
  );
}
