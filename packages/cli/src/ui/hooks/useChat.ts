import { useState, useCallback, useRef } from "react";
import * as path from "path";
import * as fs from "fs";
import chalk from "chalk";
import type {} from "diff"; // type-only import for @types/diff
import { AgentRunner, getDefaultModel } from "@cdoing/ai";
import type { ModelConfig } from "@cdoing/ai";
import type {
  ToolRegistry,
  PermissionManager,
  PermissionMode,
  HookManager,
  MemoryStore,
  TodoStore,
} from "@cdoing/core";
import {
  loadProjectConfig,
  PlanManager,
  RulesManager,
  McpManager,
  EffortManager,
  ContextProviderRegistry,
  TerminalContextProvider,
  UrlContextProvider,
  TreeContextProvider,
  CodebaseContextProvider,
  ClipboardContextProvider,
  FileIncludeContextProvider,
} from "@cdoing/core";
import type { EffortLevel } from "@cdoing/core";
import {
  createConversation,
  addMessage,
  loadConversation,
  deleteConversation,
  printConversationList,
  type Conversation,
} from "../../history";
import { createToolRegistry } from "../../tools";
import {
  parsePermissionMode,
  updateStoredConfig,
  getStoredConfigDisplay,
} from "../../config";
import { oauthLogout, oauthStatus } from "../../oauth";
import { handleInit, handleDoctor } from "../../commands";
import type { ChatMessage, ToolActivity, UsageInfo } from "../types";

let _msgId = 0;
function nextId() {
  return String(++_msgId);
}

export interface UseChatOptions {
  modelConfig: Partial<ModelConfig>;
  toolRegistry: ToolRegistry;
  permissionManager: PermissionManager;
  hookManager: HookManager;
  memoryStore: MemoryStore;
  todoStore?: TodoStore;
}

export function useChat(opts: UseChatOptions) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streamingContent, setStreamingContent] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [toolActivity, setToolActivity] = useState<ToolActivity | null>(null);
  const [lastUsage, setLastUsage] = useState<UsageInfo | null>(null);
  const [workingDir, setWorkingDir] = useState(process.cwd());
  // Ref so buildAgent() always reads the latest dir without stale closure issues
  const workingDirRef = useRef(process.cwd());

  // Mutable refs for config that changes without re-render
  const modelConfigRef = useRef<Partial<ModelConfig>>({ ...opts.modelConfig });
  const toolRegistryRef = useRef(opts.toolRegistry);
  const abortRef = useRef<AbortController | null>(null);
  const queueRef = useRef<string[]>([]);
  const lastToolInputRef = useRef<Record<string, unknown>>({});

  // Feature managers
  const planManagerRef = useRef(new PlanManager());
  const rulesManagerRef = useRef(new RulesManager(process.cwd()));
  const effortManagerRef = useRef(new EffortManager());
  const mcpManagerRef = useRef(new McpManager(process.cwd()));
  const contextProvidersRef = useRef<ContextProviderRegistry>(
    buildContextProviders(),
  );
  const conversationRef = useRef<Conversation>(
    createConversation(
      String(opts.modelConfig.provider || "anthropic"),
      String(opts.modelConfig.model || "default"),
    ),
  );
  const lastTerminalOutputRef = useRef("");
  const planModeActiveRef = useRef(false);

  const agentRef = useRef<AgentRunner>(buildAgent());

  function buildContextProviders(): ContextProviderRegistry {
    const reg = new ContextProviderRegistry();
    reg.register(new TerminalContextProvider());
    reg.register(new UrlContextProvider());
    reg.register(new TreeContextProvider());
    reg.register(new CodebaseContextProvider());
    reg.register(new ClipboardContextProvider());
    reg.register(new FileIncludeContextProvider());
    return reg;
  }

  function buildAgent(): AgentRunner {
    const dir = workingDirRef.current;
    const projectConfig = loadProjectConfig(dir);
    const rulesText = rulesManagerRef.current?.formatForPrompt() || "";
    const effortAddition =
      effortManagerRef.current?.getSystemPromptAddition() || "";
    const combined = [projectConfig || "", rulesText, effortAddition]
      .filter(Boolean)
      .join("\n\n");

    return new AgentRunner(
      modelConfigRef.current,
      toolRegistryRef.current,
      opts.permissionManager,
      opts.hookManager,
      {
        workingDir: dir,
        projectConfig: combined || undefined,
        memory: opts.memoryStore.formatForPrompt() || undefined,
      },
    );
  }

  function rebuildAgent() {
    agentRef.current = buildAgent();
  }

  function addSystemMessage(content: string) {
    setMessages((prev) => [
      ...prev,
      { id: nextId(), role: "system", content },
    ]);
  }

  const cancelCurrent = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setIsProcessing(false);
    setStreamingContent("");
    setToolActivity(null);
    addSystemMessage("⏹  Cancelled.");
  }, []);

  const resolveContextProviders = useCallback(
    async (message: string): Promise<string> => {
      const providers = contextProvidersRef.current.getAll();
      if (!providers.length) return message;
      const parts: string[] = [];
      let clean = message;
      for (const p of providers) {
        const idx = message.indexOf(p.trigger);
        if (idx < 0) continue;
        const after = message.substring(idx + p.trigger.length);
        let arg: string | undefined;
        if (p.requiresArg) {
          const end = after.indexOf("\n");
          arg = (end >= 0 ? after.substring(0, end) : after).trim();
        }
        const fullTrigger =
          p.requiresArg && arg ? `${p.trigger} ${arg}` : p.trigger;
        clean = clean.replace(fullTrigger, "").trim();
        try {
          const res = await p.resolve(arg, {
            workingDir,
            terminalOutput: lastTerminalOutputRef.current,
          });
          if (res.content) parts.push(res.content);
        } catch {
          // skip failed provider
        }
      }
      return parts.length ? `${clean}\n\n---\n\n${parts.join("\n\n---\n\n")}` : clean;
    },
    [workingDir],
  );

  const sendMessage = useCallback(
    async (text: string) => {
      if (isProcessing) {
        queueRef.current.push(text);
        addSystemMessage(`📬 Queued (${queueRef.current.length} waiting)`);
        return;
      }

      const enriched = await resolveContextProviders(text);

      setIsProcessing(true);
      setMessages((prev) => [
        ...prev,
        { id: nextId(), role: "user", content: text },
      ]);
      addMessage(conversationRef.current, "user", text);

      const ctrl = new AbortController();
      abortRef.current = ctrl;
      let fullReply = "";
      // Track how many chars of fullReply have already been flushed to stdout
      let flushedPos = 0;

      /**
       * Flush any unprinted streaming text to stdout and clear the Ink live area.
       * Called before each tool call so text doesn't disappear in Ink's render area.
       */
      function flushStreamingText() {
        const pending = fullReply.slice(flushedPos);
        if (pending.trim()) {
          process.stdout.write("\n" + pending + "\n");
        }
        flushedPos = fullReply.length;
        setStreamingContent("");
      }

      await agentRef.current.run(enriched, {
        onToken: (token) => {
          fullReply += token;
          // Show only the unflushed portion in the Ink streaming area
          setStreamingContent(fullReply.slice(flushedPos));
        },
        onToolCall: (name, input) => {
          // Flush any streaming text before showing the tool call
          flushStreamingText();
          lastToolInputRef.current = input;
          // Print tool call header to stdout immediately (stays in scrollback)
          printToolCall(name, input);
          const preview = JSON.stringify(input).substring(0, 60);
          setToolActivity({ name, preview, status: "running" });
        },
        onToolResult: (name, _result, isError) => {
          // Print the completed tool call result permanently to stdout
          printToolResult(name, isError, lastToolInputRef.current);
          lastToolInputRef.current = {};
          // Clear the live spinner immediately
          setToolActivity(null);
        },
        onComplete: () => {
          // Only add the unflushed remainder to messages (avoids double-printing)
          const remaining = fullReply.slice(flushedPos);
          if (remaining.trim()) {
            setMessages((prev) => [
              ...prev,
              { id: nextId(), role: "assistant", content: remaining },
            ]);
            addMessage(conversationRef.current, "assistant", remaining);
          } else if (flushedPos > 0) {
            // Everything was flushed via tool call flushes — print separator
            process.stdout.write(chalk.gray("─".repeat(40)) + "\n");
          }
          // Save full reply to conversation regardless
          if (flushedPos > 0 && remaining.trim()) {
            // already saved above
          } else if (flushedPos === 0 && fullReply.trim()) {
            addMessage(conversationRef.current, "assistant", fullReply);
          }
          setStreamingContent("");
          setIsProcessing(false);
          abortRef.current = null;

          // Process next queued message
          const next = queueRef.current.shift();
          if (next) sendMessage(next);
        },
        onError: (err) => {
          setMessages((prev) => [
            ...prev,
            {
              id: nextId(),
              role: "system",
              content: `❌ Error: ${err.message}`,
              isError: true,
            },
          ]);
          setStreamingContent("");
          setIsProcessing(false);
          abortRef.current = null;
        },
        onUsage: (usage) => {
          setLastUsage(usage as UsageInfo);
        },
      });
    },
    [isProcessing, resolveContextProviders],
  );

  /**
   * Handle a slash command.  Returns the output lines to display
   * (as a single string), or null if the command takes over (e.g. /exit).
   */
  const handleSlashCommand = useCallback(
    async (command: string): Promise<string | null> => {
      const parts = command.split(/\s+/);
      const cmd = parts[0];
      const arg = parts.slice(1).join(" ");

      switch (cmd) {
        case "/help":
          return getHelpText();

        case "/clear":
          agentRef.current.clearHistory();
          setMessages([]);
          return "Conversation cleared.";

        case "/new":
          agentRef.current.clearHistory();
          conversationRef.current = createConversation(
            String(modelConfigRef.current.provider || "anthropic"),
            String(modelConfigRef.current.model || "default"),
          );
          setMessages([]);
          return "New conversation started.";

        case "/history":
          return getConversationListText();

        case "/resume": {
          if (!arg) return "Usage: /resume <id>";
          const conv = loadConversation(arg);
          if (!conv) return `Conversation not found: ${arg}`;
          agentRef.current.clearHistory();
          for (const m of conv.messages) {
            if (m.role === "user") agentRef.current.addToHistory("user", m.content);
            else if (m.role === "assistant") agentRef.current.addToHistory("assistant", m.content);
          }
          conversationRef.current = conv;
          setMessages(
            conv.messages.map((m) => ({
              id: nextId(),
              role: m.role as "user" | "assistant",
              content: m.content,
            })),
          );
          return `Resumed conversation: ${arg}`;
        }

        case "/delete": {
          if (!arg) return "Usage: /delete <id>";
          const ok = deleteConversation(arg);
          return ok ? `Deleted: ${arg}` : `Not found: ${arg}`;
        }

        case "/config": {
          if (arg === "show") {
            return ["Stored Config:", ...getStoredConfigDisplay()].join("\n  ");
          }
          if (arg.startsWith("set ")) {
            const sp = arg.slice(4).trim().split(/\s+/);
            const key = sp[0];
            const val = sp.slice(1).join(" ");
            if (!key || !val)
              return "Usage: /config set <key> <value>\nKeys: provider, model, mode, api-key, base-url";
            const res = updateStoredConfig(key, val);
            if (res.success) {
              if (key === "provider") {
                modelConfigRef.current.provider = val;
                rebuildAgent();
              }
              if (key === "model") {
                modelConfigRef.current.model = val;
                rebuildAgent();
              }
              if (key === "mode")
                opts.permissionManager.setMode(
                  parsePermissionMode(val) as PermissionMode,
                );
              if (key === "api-key") {
                modelConfigRef.current.apiKey = val;
                rebuildAgent();
              }
              if (key === "base-url") {
                modelConfigRef.current.baseURL = val;
                rebuildAgent();
              }
              return `Saved: ${key} = ${key === "api-key" ? val.slice(0, 8) + "..." : val}`;
            }
            return res.error || "Error saving config";
          }
          return [
            `Provider: ${modelConfigRef.current.provider || "anthropic"}`,
            `Model:    ${modelConfigRef.current.model || "(default)"}`,
            `Mode:     ${opts.permissionManager.getMode()}`,
            `Dir:      ${workingDir}`,
            `Chat ID:  ${conversationRef.current.id}`,
          ].join("\n");
        }

        case "/model": {
          if (!arg) {
            const provider = String(modelConfigRef.current.provider || "anthropic");
            const def = getDefaultModel(provider) || "(none)";
            const cur = modelConfigRef.current.model || `(default: ${def})`;
            return [
              `Current model: ${cur}`,
              `Usage: /model <name>    — switch to a specific model`,
              `       /model default  — reset to provider default (${def})`,
              `Provider models:`,
              `  anthropic: claude-sonnet-4-6, claude-opus-4-6, claude-haiku-4-5`,
              `  openai:    gpt-4o, gpt-4o-mini, o3-mini`,
              `  google:    gemini-2.0-flash, gemini-1.5-pro`,
              `  ollama:    llama3.1, mistral, codellama`,
            ].join("\n");
          }
          if (arg === "default") {
            modelConfigRef.current.model = undefined;
            rebuildAgent();
            const def = getDefaultModel(String(modelConfigRef.current.provider || "anthropic")) || "provider default";
            return `Model reset to default: ${def}`;
          }
          modelConfigRef.current.model = arg;
          rebuildAgent();
          return `Model switched to: ${arg}`;
        }

        case "/provider": {
          if (!arg) {
            return [
              `Current provider: ${modelConfigRef.current.provider || "anthropic"}`,
              `Usage: /provider <name>   — switch provider`,
              `       /provider default  — reset to anthropic + default model`,
              `Options: anthropic, openai, google, ollama`,
            ].join("\n");
          }
          if (arg === "default") {
            modelConfigRef.current.provider = "anthropic";
            modelConfigRef.current.model = undefined;
            modelConfigRef.current.apiKey = undefined;
            rebuildAgent();
            return `Reset to default: anthropic / ${getDefaultModel("anthropic")}`;
          }
          modelConfigRef.current.provider = arg.toLowerCase();
          modelConfigRef.current.model = undefined;
          rebuildAgent();
          return `Provider switched to: ${arg}\nTip: use /model to pick a model`;
        }

        case "/mode": {
          if (!arg)
            return `Current mode: ${opts.permissionManager.getMode()}\nUsage: /mode <ask|auto-edit|auto>`;
          opts.permissionManager.setMode(
            parsePermissionMode(arg) as PermissionMode,
          );
          return `Permission mode: ${arg}`;
        }

        case "/dir": {
          if (!arg) return `Working directory: ${workingDir}`;
          const newDir = path.resolve(workingDir, arg);
          if (!fs.existsSync(newDir) || !fs.statSync(newDir).isDirectory())
            return `Not a valid directory: ${newDir}`;
          workingDirRef.current = newDir;
          setWorkingDir(newDir);
          toolRegistryRef.current = createToolRegistry(newDir);
          opts.permissionManager.setProjectDir(newDir);
          opts.hookManager.setWorkingDir(newDir);
          rebuildAgent();
          return `Working directory: ${newDir}`;
        }

        case "/permissions": {
          const pm = opts.permissionManager as unknown as Record<string, (...a: unknown[]) => unknown>;
          if (arg === "clear") {
            pm.clearStored?.();
            return "Stored permissions cleared.";
          }
          const perms = (pm.getAllStored?.() as Record<string, unknown>) || {};
          const lines = Object.entries(perms);
          if (!lines.length) return "No stored permissions.";
          return lines.map(([k, v]) => `${k}: ${v}`).join("\n");
        }

        case "/memory": {
          const ms = opts.memoryStore as unknown as Record<string, (...a: unknown[]) => unknown>;
          if (arg === "clear") {
            ms.clear?.();
            return "Memory cleared.";
          }
          return opts.memoryStore.formatForPrompt() || "No memory stored.";
        }

        case "/hooks": {
          const hm = opts.hookManager as unknown as Record<string, (...a: unknown[]) => unknown>;
          return JSON.stringify(hm.getConfig?.() || {}, null, 2);
        }

        case "/usage": {
          if (!lastUsage) return "No usage data yet.";
          return [
            `Input tokens:  ${lastUsage.inputTokens.toLocaleString()}`,
            `Output tokens: ${lastUsage.outputTokens.toLocaleString()}`,
            `Total tokens:  ${lastUsage.totalTokens.toLocaleString()}`,
            lastUsage.cost !== undefined
              ? `Cost:          $${lastUsage.cost.toFixed(4)}`
              : "",
          ]
            .filter(Boolean)
            .join("\n");
        }

        case "/compact": {
          const ag = agentRef.current as unknown as Record<string, (...a: unknown[]) => unknown>;
          ag.compactHistory?.();
          return "Context compacted.";
        }

        case "/tasks": {
          const todos = opts.todoStore?.getAll?.() || [];
          if (!todos.length) return "No tasks.";
          return todos
            .map((t: { id: string; status: string; subject: string }) => `[${t.status}] ${t.id}: ${t.subject}`)
            .join("\n");
        }

        case "/plan": {
          if (arg === "off" || arg === "cancel") {
            planModeActiveRef.current = false;
            planManagerRef.current.clearPlan();
            return "Plan mode disabled.";
          }
          if (arg === "show") {
            const plan = planManagerRef.current.getCurrentPlan();
            return plan ? planManagerRef.current.formatPlan() : "No active plan.";
          }
          if (arg === "approve" || arg === "yes") {
            if (planManagerRef.current.approvePlan()) {
              planModeActiveRef.current = false;
              const plan = planManagerRef.current.getCurrentPlan();
              if (plan) {
                planManagerRef.current.startExecution();
                sendMessage(
                  `Execute this plan:\n\n${planManagerRef.current.formatPlan()}\n\nOriginal request: ${plan.originalRequest}`,
                );
              }
              return "Plan approved! Executing...";
            }
            return "No plan to approve.";
          }
          if (arg === "reject" || arg === "no") {
            planManagerRef.current.rejectPlan();
            planModeActiveRef.current = false;
            return "Plan rejected.";
          }
          if (!arg) {
            planModeActiveRef.current = !planModeActiveRef.current;
            return planModeActiveRef.current
              ? "Plan mode ON — next message will generate a plan."
              : "Plan mode OFF.";
          }
          planModeActiveRef.current = true;
          sendMessage(
            `[PLAN MODE] Analyze this request and create a step-by-step plan. Do NOT modify files.\n\nRequest: ${arg}`,
          );
          return "Generating plan...";
        }

        case "/effort": {
          if (!arg)
            return `Current effort: ${effortManagerRef.current.getLevel()}\nUsage: /effort <low|medium|high|max>`;
          effortManagerRef.current.setLevel(arg as EffortLevel);
          rebuildAgent();
          return `Effort level: ${arg}`;
        }

        case "/btw": {
          if (!arg)
            return "Usage: /btw <question>  (ask without adding to history)";
          // Run a one-shot agent call without touching history
          setIsProcessing(true);
          const ephemeralAgent = buildAgent();
          let reply = "";
          await ephemeralAgent.run(arg, {
            onToken: (t) => {
              reply += t;
              setStreamingContent(reply);
            },
            onToolCall: () => {},
            onToolResult: () => {},
            onComplete: () => {
              setMessages((prev) => [
                ...prev,
                { id: nextId(), role: "assistant", content: reply },
              ]);
              setStreamingContent("");
              setIsProcessing(false);
            },
            onError: (e) => {
              addSystemMessage(`❌ ${e.message}`);
              setStreamingContent("");
              setIsProcessing(false);
            },
          });
          return null; // streaming takes over
        }

        case "/rules":
          return rulesManagerRef.current.formatForPrompt() || "No rules defined.";

        case "/mcp": {
          const mcp = mcpManagerRef.current as unknown as Record<string, (...a: unknown[]) => unknown>;
          return (mcp.getStatus?.() as string) || "No MCP servers configured.";
        }

        case "/context": {
          const ps = contextProvidersRef.current.getAll();
          if (!ps.length) return "No context providers registered.";
          return ps.map((p) => `${p.trigger} — ${p.description || ""}`).join("\n");
        }

        case "/queue": {
          if (!queueRef.current.length) return "No messages in queue.";
          return queueRef.current
            .map((m, i) => `${i + 1}. ${m.substring(0, 60)}`)
            .join("\n");
        }

        case "/doctor":
          handleDoctor();
          return "Doctor check complete.";

        case "/init":
          handleInit();
          return "Project initialized.";

        case "/logout":
          oauthLogout();
          return "Logged out.";

        case "/auth-status":
          oauthStatus();
          return "Auth status shown.";

        case "/exit":
        case "/quit":
          process.exit(0);

        default:
          return `Unknown command: ${cmd}\nType /help for available commands.`;
      }
    },
    [workingDir, lastUsage, sendMessage, opts],
  );

  return {
    messages,
    streamingContent,
    isProcessing,
    toolActivity,
    lastUsage,
    workingDir,
    modelConfig: modelConfigRef.current,
    sendMessage,
    handleSlashCommand,
    cancelCurrent,
    addSystemMessage,
  };
}

// ── helpers ──────────────────────────────────────────────

const TOOL_ICONS: Record<string, string> = {
  file_read:   "📖",
  file_write:  "✏️ ",
  file_edit:   "🔧",
  glob_search: "🔍",
  grep_search: "🔎",
  shell_exec:  "💻",
  web_fetch:   "🌐",
  web_search:  "🔮",
  sub_agent:   "🤖",
  todo:        "📋",
};

function printToolCall(name: string, input: Record<string, unknown>): void {
  const icon = TOOL_ICONS[name] || "⚡";
  // Show a short preview of the key argument (file path, query, command, etc.)
  const hint = getToolHint(name, input);
  process.stdout.write(
    chalk.yellow("  ▶ ") + chalk.yellow(`${icon} ${name}`) +
    (hint ? chalk.gray("  " + hint) : "") + "\n"
  );
}

function getToolHint(name: string, input: Record<string, unknown>): string {
  const p = (k: string) => String(input[k] || "").replace(process.cwd() + "/", "");
  switch (name) {
    case "file_read":   return p("file_path") || p("path");
    case "file_write":  return p("file_path") || p("path");
    case "file_edit":   return p("file_path") || p("path");
    case "glob_search": return String(input.pattern || "");
    case "grep_search": return String(input.pattern || "");
    case "shell_exec":  return String(input.command || "").substring(0, 50);
    case "web_fetch":   return String(input.url || "").substring(0, 60);
    case "web_search":  return String(input.query || "").substring(0, 60);
    default:            return "";
  }
}

function printToolResult(name: string, isError: boolean, input: Record<string, unknown>): void {
  const icon = TOOL_ICONS[name] || "⚡";
  if (isError) {
    process.stdout.write(chalk.red(`  ✗ ${icon} ${name}`) + "\n");
  } else {
    process.stdout.write(chalk.green(`  ✓ `) + chalk.cyan(`${icon} ${name}`) + "\n");
  }

  // Show file diffs for edit/write operations
  if (!isError && (name === "file_edit" || name === "file_write")) {
    printFileDiff(name, input);
  }
}

function printFileDiff(toolName: string, input: Record<string, unknown>): void {
  try {
    let oldContent = "";
    let newContent = "";
    let filePath = "";

    if (toolName === "file_edit") {
      filePath = String(input.file_path || input.path || "");
      oldContent = String(input.old_string || "");
      newContent = String(input.new_string || "");
    } else if (toolName === "file_write") {
      filePath = String(input.file_path || input.path || "");
      newContent = String(input.content || "");
      // Try to read old content for comparison
      try {
        oldContent = fs.readFileSync(filePath, "utf-8");
      } catch {
        oldContent = "";
      }
    }

    if (!oldContent && !newContent) return;

    const shortPath = filePath.replace(process.cwd() + "/", "");
    process.stdout.write(chalk.bold.white(`\n  📄 ${shortPath}\n`));

    if (!oldContent) {
      // New file — show all lines as added
      const lines = newContent.split("\n");
      const preview = lines.slice(0, 20);
      for (const line of preview) {
        process.stdout.write(chalk.green("  + ") + chalk.green(line) + "\n");
      }
      if (lines.length > 20) {
        process.stdout.write(chalk.gray(`  ... +${lines.length - 20} more lines\n`));
      }
    } else {
      const { diffLines: computeDiff } = require("diff") as typeof import("diff");
      const hunks = computeDiff(oldContent, newContent);
      let shownLines = 0;
      for (const hunk of hunks) {
        if (hunk.added || hunk.removed) {
          const lines = (hunk.value || "").split("\n").filter((l, i, arr) => i < arr.length - 1 || l);
          for (const line of lines) {
            if (shownLines >= 30) {
              process.stdout.write(chalk.gray("  ... (diff truncated)\n"));
              return;
            }
            if (hunk.added) {
              process.stdout.write(chalk.green("  + ") + chalk.green(line) + "\n");
            } else {
              process.stdout.write(chalk.red("  - ") + chalk.red(line) + "\n");
            }
            shownLines++;
          }
        }
      }
    }
    process.stdout.write("\n");
  } catch {
    // skip diff on any error
  }
}

function getHelpText(): string {
  return [
    "Available commands:",
    "  /help          — this message",
    "  /clear         — clear conversation",
    "  /new           — new conversation",
    "  /history       — list saved conversations",
    "  /resume <id>   — resume a conversation",
    "  /delete <id>   — delete a conversation",
    "  /config        — view config",
    "  /model <name>  — switch model",
    "  /provider <n>  — switch provider",
    "  /mode <mode>   — change permission mode",
    "  /dir <path>    — change working directory",
    "  /usage         — token usage",
    "  /plan          — toggle plan mode",
    "  /effort <lvl>  — set effort level (low/medium/high/max)",
    "  /btw <q>       — ask without adding to history",
    "  /rules         — show project rules",
    "  /mcp           — MCP server status",
    "  /context       — list context providers",
    "  /tasks         — show task list",
    "  /compact       — compact context",
    "  /exit          — quit",
    "",
    "Prefix with ! to run a shell command directly.",
    "Use @terminal, @tree, @url <u>, @codebase in messages for context.",
  ].join("\n");
}

function getConversationListText(): string {
  // Reuse the existing printConversationList but capture output
  const lines: string[] = [];
  const orig = console.log;
  console.log = (...args: unknown[]) => lines.push(args.join(" "));
  printConversationList();
  console.log = orig;
  return lines.join("\n") || "No saved conversations.";
}
