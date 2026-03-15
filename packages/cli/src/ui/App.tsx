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

import React, { useCallback, useEffect, useRef } from "react";
import { Box, useApp } from "ink";
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
import { useChat } from "./hooks/useChat";
import type { ChatMessage } from "./types";

// ── Direct stdout formatters (bypasses Ink entirely) ───────────────────────

function printMessage(msg: ChatMessage): void {
  switch (msg.role) {
    case "user":
      process.stdout.write(chalk.green.bold("\n❯ ") + chalk.white(msg.content) + "\n");
      break;
    case "assistant":
      process.stdout.write("\n" + chalk.white(msg.content) + "\n");
      process.stdout.write(chalk.gray("─".repeat(40)) + "\n");
      break;
    case "system":
      process.stdout.write(
        (msg.isError ? chalk.red("  ❌ ") : chalk.yellow("  ")) +
        msg.content + "\n"
      );
      break;
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

  const {
    messages,
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

  // Print new messages directly to stdout as they arrive (not via Ink).
  // This keeps Ink's render area small and prevents scrolling on keypress.
  const printedCountRef = useRef(0);
  useEffect(() => {
    // If messages was reset (e.g. /clear), reset our pointer too
    if (messages.length < printedCountRef.current) {
      printedCountRef.current = 0;
    }
    const newMsgs = messages.slice(printedCountRef.current);
    for (const msg of newMsgs) {
      printMessage(msg);
    }
    printedCountRef.current = messages.length;
  }, [messages]);

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

        // All other shell commands — stream output in real time via spawn
        {
          const { spawn } = require("child_process") as typeof import("child_process");
          process.stdout.write(chalk.gray(`$ ${shellCmd}`) + "\n");
          const child = spawn(shellCmd, [], {
            shell: true,
            cwd: workingDir,
            env: { ...process.env },
          });
          bgProcessRef.current = child;

          child.stdout?.on("data", (chunk: Buffer) => {
            process.stdout.write(chunk);
          });
          child.stderr?.on("data", (chunk: Buffer) => {
            process.stdout.write(chunk);
          });
          child.on("close", (code) => {
            bgProcessRef.current = null;
            if (code !== null && code !== 0) {
              process.stdout.write(chalk.red(`\n[exited with code ${code}]\n`));
            }
          });
          child.on("error", (err) => {
            bgProcessRef.current = null;
            process.stdout.write(chalk.red(`\n[error: ${err.message}]\n`));
          });
        }
        return;
      }

      if (value.startsWith("/")) {
        const result = await handleSlashCommand(value);
        if (result !== null) {
          // Write directly to stdout — avoids React state timing issues with Ink
          process.stdout.write(chalk.cyan(result) + "\n");
        }
        return;
      }

      await sendMessage(value);
    },
    [workingDir, handleSlashCommand, sendMessage, addSystemMessage],
  );

  const runningJobs = backgroundJobs.filter((j) => j.status === "running").length;

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
            if (result) process.stdout.write(chalk.cyan(result) + "\n");
          }}
          onDelete={async (id) => {
            await handleSlashCommand(`/delete ${id}`);
          }}
          onFork={async (id) => {
            setShowSessionBrowser(false);
            const result = await handleSlashCommand(`/fork ${id}`);
            if (result) process.stdout.write(chalk.cyan(result) + "\n");
          }}
          onClose={() => setShowSessionBrowser(false)}
        />
      </Box>
    );
  }

  // Ink only renders this small fixed section — no scrolling issues
  return (
    <Box flexDirection="column">
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
