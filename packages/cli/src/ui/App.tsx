/**
 * App — root Ink component.
 *
 * Uses Ink's <Static> for past messages (written once, never cleared by Ink).
 * Ink manages only the dynamic bottom section (streaming, input, status bar).
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
import { ShellExecTool } from "@cdoing/core";

import { StreamingMessage } from "./MessageList";
import { Spinner, ToolSpinner } from "./Spinner";
import { UserInput } from "./UserInput";
import { StatusBar } from "./StatusBar";
import { SessionBrowser } from "./SessionBrowser";
import { SetupWizard } from "./SetupWizard";
import { RenderMarkdown } from "./MessageList";
import { useChat } from "./hooks/useChat";
import { getTheme } from "./theme";
import type { ChatMessage } from "./types";

// ── Render a single message for Static ──────────────────────────────────────

function renderStaticMessage(msg: ChatMessage): React.ReactElement {
  const t = getTheme();
  switch (msg.role) {
    case "user":
      return (
        <Box key={msg.id} flexDirection="column">
          <Text>{" "}</Text>
          <Box>
            <Text color={t.prompt} bold>{"❯ "}</Text>
            <Text color={t.text}>{msg.content}</Text>
          </Box>
        </Box>
      );
    case "assistant":
      return (
        <Box key={msg.id} flexDirection="column">
          <Text>{" "}</Text>
          <RenderMarkdown text={msg.content} />
          <Text color={t.separator}>{"─".repeat(process.stdout.columns > 0 ? Math.min(process.stdout.columns, 60) : 40)}</Text>
        </Box>
      );
    case "system":
      return (
        <Box key={msg.id}>
          {msg.isError ? <Text color={t.error}>{"  ❌ "}</Text> : <Text color={t.info}>{"  ▸ "}</Text>}
          <Text>{msg.content}</Text>
        </Box>
      );
    case "shell":
      return <RenderMarkdown key={msg.id} text={msg.content.trimEnd()} />;
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
    modelConfig: liveModelConfig,
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

  // Send initial prompt on mount
  useEffect(() => {
    if (initialPrompt) sendMessage(initialPrompt);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Ctrl+C: double-tap to exit
  const ctrlCRef = useRef(0);
  useEffect(() => {
    const handler = () => {
      const now = Date.now();
      if (now - ctrlCRef.current < 1000) {
        const shellTool = toolRegistry.get("shell_exec") as ShellExecTool | undefined;
        if (shellTool?.getProcessManager) {
          shellTool.getProcessManager().killAll();
        }
        exit();
        process.exit(0);
      }
      ctrlCRef.current = now;
      addSystemMessage(chalk.gray("Press Ctrl+C again to exit, or type /exit."));
    };
    process.on("SIGINT", handler);
    return () => { process.off("SIGINT", handler); };
  }, [exit]);

  const handleSubmit = useCallback(
    async (value: string) => {
      if (!value.trim()) return;

      const shellCmd = value.startsWith("!")
        ? value.slice(1).trim()
        : detectShellCommand(value);

      if (shellCmd !== null) {
        if (shellCmd === "cd" || shellCmd.startsWith("cd ") || shellCmd.startsWith("cd\t")) {
          const target = shellCmd.slice(2).trim() || process.env.HOME || "/";
          const result = await handleSlashCommand(`/dir ${target}`);
          if (result !== null) addSystemMessage(`$ ${shellCmd}\n${result || ""}`);
          return;
        }

        // Shell command — capture output, combine label+output in one Static item
        {
          const { execSync } = require("child_process") as typeof import("child_process");
          let output = "";
          let errorMsg = "";
          try {
            output = execSync(shellCmd, {
              cwd: workingDir,
              env: { ...process.env },
              encoding: "utf-8",
              timeout: 120000,
              maxBuffer: 10 * 1024 * 1024,
            });
          } catch (err: any) {
            if (err.stdout) output = String(err.stdout);
            if (err.stderr) errorMsg = String(err.stderr);
            if (err.status !== undefined && err.status !== 0) {
              errorMsg += chalk.red(`\n[exited with code ${err.status}]`);
            } else if (!err.stdout && !err.stderr && err.message) {
              errorMsg = chalk.red(`[error: ${err.message}]`);
            }
          }
          const parts = [chalk.gray(`$ ${shellCmd}`)];
          if (output.trim()) parts.push(output.trimEnd());
          if (errorMsg.trim()) parts.push(errorMsg.trimEnd());
          addSystemMessage(parts.join("\n"));
        }
        return;
      }

      if (value.startsWith("/")) {
        if (value.trim() === "/clear") {
          setMessages([]);
          return;
        }
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
    [workingDir, handleSlashCommand, sendMessage, addSystemMessage, setMessages],
  );

  const runningJobs = backgroundJobs.filter((j) => j.status === "running").length;

  // ── Setup wizard overlay ─────────────────────────────────────────────────
  if (showSetupWizard) {
    return (
      <Box flexDirection="column">
        <SetupWizard
          currentProvider={String(liveModelConfig.provider || "anthropic")}
          currentModel={String(liveModelConfig.model || "")}
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

  // ── Main layout ─────────────────────────────────────────────────────────
  return (
    <Box flexDirection="column">
      {/* Static: messages written once, never cleared by Ink */}
      <Static items={messages}>
        {(msg) => renderStaticMessage(msg)}
      </Static>

      {/* Tool activity spinner */}
      {toolActivity ? (
        <ToolSpinner
          name={toolActivity.name}
          preview={toolActivity.preview}
          status={toolActivity.status}
        />
      ) : null}

      {/* Streaming response tokens */}
      {streamingContent ? <StreamingMessage content={streamingContent} /> : null}

      {/* Thinking spinner */}
      {isProcessing && !streamingContent && !toolActivity ? (
        <Spinner
          label="Thinking…"
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
        provider={String(liveModelConfig.provider || "anthropic")}
        model={String(liveModelConfig.model || "")}
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

const INTERACTIVE_COMMANDS = new Set([
  "vim", "vi", "nvim", "nano", "pico",
  "less", "more", "man", "info",
  "top", "htop", "btop",
  "ssh", "fzf", "ranger", "mc",
]);

function detectShellCommand(input: string): string | null {
  const trimmed = input.trim();
  const firstWord = trimmed.split(/\s+/)[0].toLowerCase();
  return SHELL_COMMANDS.has(firstWord) ? trimmed : null;
}

const SERVER_PATTERNS = /\b(run\s+(dev|start|serve|watch|preview)|nodemon|ts-node-dev|live-server|concurrently|turbo\s+dev|next\s+dev|vite|astro\s+dev|nuxt\s+dev|remix\s+dev)\b/i;

function isInteractiveCommand(cmd: string): boolean {
  const firstWord = cmd.trim().split(/\s+/)[0].toLowerCase();
  if (INTERACTIVE_COMMANDS.has(firstWord)) return true;
  return SERVER_PATTERNS.test(cmd);
}
