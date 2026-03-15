/**
 * App — root Ink component.
 *
 * Key design: past messages are printed directly to stdout (so they scroll
 * naturally above the terminal), while Ink only manages the small, fixed-height
 * bottom section: streaming content + tool activity + input + status bar.
 *
 * This prevents Ink from miscalculating its height on every keypress and
 * scrolling the terminal.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Box, Text, Static, useApp } from "ink";
import chalk from "chalk";

import type { ModelConfig } from "@cdoing/ai";
import type {
  ToolRegistry,
  PermissionManager,
  HookManager,
  MemoryStore,
  TodoStore,
} from "@cdoing/core";

import { StreamingMessage } from "./MessageList";
import { Spinner, ToolSpinner } from "./Spinner";
import { UserInput } from "./UserInput";
import { StatusBar } from "./StatusBar";
import { SessionBrowser } from "./SessionBrowser";
import { SetupWizard } from "./SetupWizard";
import { useChat } from "./hooks/useChat";
import type { ChatMessage } from "./types";

// ── Static message renderer ─────────────────────────────────────────────────

function renderStaticMessage(msg: ChatMessage): React.ReactElement {
  switch (msg.role) {
    case "user":
      return (
        <Box key={msg.id} flexDirection="column">
          <Text>{" "}</Text>
          <Box>
            <Text color="green" bold>{"❯ "}</Text>
            <Text color="white">{msg.content}</Text>
          </Box>
        </Box>
      );
    case "assistant":
      return (
        <Box key={msg.id} flexDirection="column">
          <Text>{" "}</Text>
          <Text>{msg.content}</Text>
          <Text color="gray">{"─".repeat(process.stdout.columns > 0 ? Math.min(process.stdout.columns, 60) : 40)}</Text>
        </Box>
      );
    case "system":
      return (
        <Box key={msg.id}>
          {msg.isError ? <Text color="red">{"  ❌ "}</Text> : <Text color="yellow">{"  ▸ "}</Text>}
          <Text>{msg.content}</Text>
        </Box>
      );
    case "shell":
      return <Text key={msg.id}>{msg.content.trimEnd()}</Text>;
    default:
      return <Text key={msg.id}>{msg.content}</Text>;
  }
}

// ── App component ──────────────────────────────────────────────────────────

export interface AppProps {
  modelConfig: Partial<ModelConfig>;
  toolRegistry: ToolRegistry;
  permissionManager: PermissionManager;
  hookManager: HookManager;
  memoryStore: MemoryStore;
  todoStore?: TodoStore;
  initialPrompt?: string;
}

export const App: React.FC<AppProps> = ({
  modelConfig,
  toolRegistry,
  permissionManager,
  hookManager,
  memoryStore,
  todoStore,
  initialPrompt,
}) => {
  const { exit } = useApp();

  const processingStartRef = useRef<number | null>(null);
  // Track background shell processes so Ctrl+C can kill them
  const bgProcessRef = useRef<import("child_process").ChildProcess | null>(null);
  // Live shell command output (streams in dynamic area, flushed to Static on complete)
  const [shellLive, setShellLive] = useState("");
  const shellLiveRef = useRef("");
  const [showSetupWizard, setShowSetupWizard] = useState(false);

  const {
    messages,
    setMessages,
    streamingContent,
    isProcessing,
    toolActivity,
    lastUsage,
    workingDir,
    contextUsage,
    backgroundJobs,
    showSessionBrowser,
    setShowSessionBrowser,
    conversations,
    sendMessage,
    handleSlashCommand,
    cancelCurrent,
    addSystemMessage,
  } = useChat({
    modelConfig,
    toolRegistry,
    permissionManager,
    hookManager,
    memoryStore,
    todoStore,
  });

  // Track when processing starts for the elapsed timer
  useEffect(() => {
    if (isProcessing && processingStartRef.current === null) {
      processingStartRef.current = Date.now();
    } else if (!isProcessing) {
      processingStartRef.current = null;
    }
  }, [isProcessing]);

  // Clear terminal when /clear resets the messages array
  const prevMsgLenRef = useRef(0);
  useEffect(() => {
    if (messages.length === 0 && prevMsgLenRef.current > 0) {
      process.stdout.write("\x1b[2J\x1b[H");
    }
    prevMsgLenRef.current = messages.length;
  }, [messages.length]);

  // Send initial prompt on mount
  useEffect(() => {
    if (initialPrompt) {
      sendMessage(initialPrompt);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Ctrl+C: kill bg process if running, otherwise double-tap to exit
  const ctrlCRef = useRef(0);
  useEffect(() => {
    const handler = () => {
      // If a background shell process is running, kill it
      if (bgProcessRef.current) {
        bgProcessRef.current.kill("SIGINT");
        bgProcessRef.current = null;
        process.stdout.write(chalk.yellow("\n[process killed]\n"));
        return;
      }
      const now = Date.now();
      if (now - ctrlCRef.current < 1000) {
        exit();
        process.exit(0);
      }
      ctrlCRef.current = now;
      process.stdout.write(chalk.gray("Press Ctrl+C again to exit, or type /exit.\n"));
    };
    process.on("SIGINT", handler);
    return () => { process.off("SIGINT", handler); };
  }, [exit]);

  const handleSubmit = useCallback(
    async (value: string) => {
      if (!value.trim()) return;

      // Determine the raw shell command — either explicit `!cmd` or auto-detected
      const shellCmd = value.startsWith("!")
        ? value.slice(1).trim()
        : detectShellCommand(value);

      if (shellCmd !== null) {
        // Intercept `cd` — exec can't change the parent process directory
        if (shellCmd === "cd" || shellCmd.startsWith("cd ") || shellCmd.startsWith("cd\t")) {
          const target = shellCmd.slice(2).trim() || process.env.HOME || "/";
          const result = await handleSlashCommand(`/dir ${target}`);
          if (result !== null) {
            process.stdout.write(chalk.gray(`$ ${shellCmd}`) + "\n" + (result ? chalk.white(result) + "\n" : ""));
          }
          return;
        }

        // Interactive commands (vim, nano, less…) need full TTY — use spawnSync
        if (isInteractiveCommand(shellCmd)) {
          const { spawnSync } = require("child_process") as typeof import("child_process");
          const parts = shellCmd.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [shellCmd];
          const [bin, ...args] = parts;
          // Let the subprocess own the terminal completely
          spawnSync(bin, args, { stdio: "inherit", cwd: workingDir, env: { ...process.env } });
          return;
        }

        // All other shell commands — stream live in dynamic area, flush to Static on done
        {
          const { spawn } = require("child_process") as typeof import("child_process");
          addSystemMessage(`$ ${shellCmd}`);
          shellLiveRef.current = "";
          setShellLive("");

          const child = spawn(shellCmd, [], {
            shell: true,
            cwd: workingDir,
            env: { ...process.env },
          });
          bgProcessRef.current = child;

          const onData = (chunk: Buffer) => {
            shellLiveRef.current += chunk.toString();
            setShellLive(shellLiveRef.current);
          };
          child.stdout?.on("data", onData);
          child.stderr?.on("data", onData);

          child.on("close", (code) => {
            bgProcessRef.current = null;
            const output = shellLiveRef.current;
            shellLiveRef.current = "";
            setShellLive("");
            if (output.trim()) {
              setMessages((prev) => [
                ...prev,
                { id: String(Date.now()), role: "shell" as const, content: output.trimEnd() },
              ]);
            }
            if (code !== null && code !== 0) {
              addSystemMessage(chalk.red(`[exited with code ${code}]`));
            }
          });
          child.on("error", (err) => {
            bgProcessRef.current = null;
            shellLiveRef.current = "";
            setShellLive("");
            addSystemMessage(chalk.red(`[error: ${err.message}]`));
          });
        }
        return;
      }

      if (value.startsWith("/")) {
        if (value.trim() === "/setup") {
          setShowSetupWizard(true);
          return;
        }
        const result = await handleSlashCommand(value);
        if (result !== null) {
          addSystemMessage(result);
        }
        return;
      }

      await sendMessage(value);
    },
    [workingDir, handleSlashCommand, sendMessage, addSystemMessage],
  );

  const runningJobs = backgroundJobs.filter((j) => j.status === "running").length;

  // ── Setup wizard overlay ─────────────────────────────────────────────────
  if (showSetupWizard) {
    return (
      <Box flexDirection="column">
        <SetupWizard
          currentProvider={String(modelConfig.provider || "anthropic")}
          currentModel={String(modelConfig.model || "")}
          onDone={({ provider, model, apiKey, oauthToken }) => {
            setShowSetupWizard(false);
            handleSlashCommand(`/provider ${provider}`);
            if (model) handleSlashCommand(`/model ${model}`);
            if (apiKey) handleSlashCommand(`/config set api-key ${apiKey}`);
            if (oauthToken) handleSlashCommand(`/config set oauth-token ${oauthToken}`);
            const authNote = oauthToken ? "OAuth ✓" : apiKey ? "API key ✓" : "no key";
            addSystemMessage(`✓ Setup saved — provider: ${provider}  model: ${model || "default"}  auth: ${authNote}`);
          }}
          onCancel={() => {
            setShowSetupWizard(false);
            addSystemMessage("Setup cancelled.");
          }}
        />
      </Box>
    );
  }

  // ── Session browser overlay ──────────────────────────────────────────────
  if (showSessionBrowser) {
    const convList = conversations();
    return (
      <Box flexDirection="column">
        <SessionBrowser
          conversations={convList}
          onSelect={async (id) => {
            setShowSessionBrowser(false);
            const result = await handleSlashCommand(`/resume ${id}`);
            if (result) addSystemMessage(result);
          }}
          onDelete={async (id) => {
            await handleSlashCommand(`/delete ${id}`);
          }}
          onFork={async (id) => {
            setShowSessionBrowser(false);
            const result = await handleSlashCommand(`/fork ${id}`);
            if (result) addSystemMessage(result);
          }}
          onClose={() => setShowSessionBrowser(false)}
        />
      </Box>
    );
  }

  // Ink only renders this small fixed section — no scrolling issues
  return (
    <Box flexDirection="column">
      {/* Static: past messages scroll permanently above the dynamic area */}
      <Static items={messages}>
        {(msg) => renderStaticMessage(msg)}
      </Static>

      {/* Live shell command output — streams here, moves to Static when done */}
      {shellLive ? <Text>{shellLive.trimEnd()}</Text> : null}

      {/* Animated tool activity */}
      {toolActivity ? (
        <ToolSpinner
          name={toolActivity.name}
          preview={toolActivity.preview}
          status={toolActivity.status}
        />
      ) : null}

      {/* Streaming response tokens */}
      {streamingContent ? <StreamingMessage content={streamingContent} /> : null}

      {/* Animated thinking spinner (shown before first token arrives) */}
      {isProcessing && !streamingContent && !toolActivity ? (
        <Spinner
          label="Thinking…"
          color="yellow"
          startTime={processingStartRef.current ?? undefined}
        />
      ) : null}

      <UserInput
        isProcessing={isProcessing}
        queueLength={0}
        workingDir={workingDir}
        permissionMode={permissionManager.getMode()}
        onSubmit={handleSubmit}
        onCancel={cancelCurrent}
        onModeChange={(mode) => {
          const { parsePermissionMode } = require("../config") as typeof import("../config");
          permissionManager.setMode(parsePermissionMode(mode) as any);
        }}
      />

      <StatusBar
        provider={String(modelConfig.provider || "anthropic")}
        model={String(modelConfig.model || "")}
        mode={permissionManager.getMode()}
        workingDir={workingDir}
        isProcessing={isProcessing}
        lastUsage={lastUsage}
        queueLength={0}
        contextUsage={contextUsage}
        backgroundJobs={runningJobs}
      />
    </Box>
  );
};

// ── Shell command auto-detection ────────────────────────────────────────────

// Commands that run non-interactively (exec is fine)
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
  // interactive ones below are handled separately
  "vim", "vi", "nano", "less", "more", "man", "top", "htop",
]);

// Commands that require full TTY control — spawned with stdio:'inherit'
const INTERACTIVE_COMMANDS = new Set([
  "vim", "vi", "nvim", "nano", "pico",
  "less", "more", "man", "info",
  "top", "htop", "btop",
  "ssh", "fzf", "ranger", "mc",
]);

/** Returns the command string if input looks like a shell command, else null. */
function detectShellCommand(input: string): string | null {
  const trimmed = input.trim();
  const firstWord = trimmed.split(/\s+/)[0].toLowerCase();
  return SHELL_COMMANDS.has(firstWord) ? trimmed : null;
}

// Dev server / watcher patterns — need a real TTY so their UI renders correctly
const SERVER_PATTERNS = /\b(run\s+(dev|start|serve|watch|preview)|nodemon|ts-node-dev|live-server|concurrently|turbo\s+dev|next\s+dev|vite|astro\s+dev|nuxt\s+dev|remix\s+dev)\b/i;

/** Returns true if this command needs full TTY (vim, nano, less, dev servers…). */
function isInteractiveCommand(cmd: string): boolean {
  const firstWord = cmd.trim().split(/\s+/)[0].toLowerCase();
  if (INTERACTIVE_COMMANDS.has(firstWord)) return true;
  // Dev servers / watchers: need real TTY so their dashboard/colors work correctly
  return SERVER_PATTERNS.test(cmd);
}
