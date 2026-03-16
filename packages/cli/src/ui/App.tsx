/**
 * App — root Ink component.
 *
 * Layout modeled after Continue CLI:
 *   <Box flexDirection="column" height="100%">
 *     <Box flexGrow={1} overflow="hidden">     ← Chat history (Static + pending)
 *       <StaticChatContent />
 *     </Box>
 *     <Box flexShrink={0}>                     ← Fixed bottom section
 *       <ToolSpinner />                          - tool activity
 *       <StreamingMessage />                     - live streaming
 *       <Spinner />                              - thinking indicator
 *       <UserInput />                            - input box
 *       <StatusBar />                            - status bar
 *     </Box>
 *   </Box>
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
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
import { ShellExecTool } from "@cdoing/core";

import { StreamingMessage } from "./MessageList";
import { ToolSpinner } from "./Spinner";
import { UserInput } from "./UserInput";
import { StatusBar } from "./StatusBar";
import { SessionBrowser } from "./SessionBrowser";
import { SetupWizard } from "./SetupWizard";
import { StaticChatContent } from "./components/StaticChatContent";
import { ActionStatus } from "./components/ActionStatus";
import { IntroMessage } from "./components/IntroMessage";
import { useChat } from "./hooks/useChat";

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

  const [responseStartTime, setResponseStartTime] = useState<number | null>(null);
  const [showSetupWizard, setShowSetupWizard] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [showIntro, setShowIntro] = useState(true);

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

  // Track when processing starts for the ActionStatus timer
  useEffect(() => {
    if (isProcessing && responseStartTime === null) {
      setResponseStartTime(Date.now());
      if (showIntro) setShowIntro(false); // hide intro after first message
    } else if (!isProcessing) {
      setResponseStartTime(null);
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

        // Shell command — capture output, combine in one message
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
          setRefreshTrigger((prev) => prev + 1);
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

  // ── Main layout (Continue pattern) ──────────────────────────────────────
  return (
    <Box flexDirection="column" height="100%">
      {/* Chat history — takes all available space, overflow hidden */}
      <Box flexDirection="column" flexGrow={1}>
        {/* Intro message — shown until first user message */}
        {showIntro && messages.length === 0 && (
          <IntroMessage
            provider={String(liveModelConfig.provider || "anthropic")}
            model={String(liveModelConfig.model || "")}
            workingDir={workingDir}
            mode={permissionManager.getMode()}
          />
        )}

        <StaticChatContent
          messages={messages}
          refreshTrigger={refreshTrigger}
        />
      </Box>

      {/* Fixed bottom section — never scrolls away */}
      <Box flexDirection="column" flexShrink={0}>
        {/* Tool activity spinner */}
        {toolActivity ? (
          <ToolSpinner
            name={toolActivity.name}
            preview={toolActivity.preview}
            status={toolActivity.status}
          />
        ) : null}

        {/* Streaming response tokens (only partial line, rest in Static) */}
        {streamingContent ? <StreamingMessage content={streamingContent} /> : null}

        {/* Thinking indicator with braille spinner + timer */}
        <ActionStatus
          visible={isProcessing && !streamingContent && !toolActivity}
          startTime={responseStartTime || Date.now()}
          message="Thinking..."
        />

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

function detectShellCommand(input: string): string | null {
  const trimmed = input.trim();
  const firstWord = trimmed.split(/\s+/)[0].toLowerCase();
  return SHELL_COMMANDS.has(firstWord) ? trimmed : null;
}
