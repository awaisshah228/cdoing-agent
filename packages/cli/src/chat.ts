/**
 * ChatInterface — launches the Ink-based TUI.
 *
 * This replaces the raw readline REPL with a React/Ink component tree,
 * modelled on how Continue (continuedev/continue) builds its CLI.
 *
 * Structure:
 *   App.tsx        — root Ink component
 *   MessageList    — committed messages (via <Static>)
 *   StreamingMessage — live token stream
 *   UserInput      — keyboard input + slash-command suggestions
 *   StatusBar      — provider / model / mode / cost
 *   hooks/useChat  — all agent state + slash-command logic
 */

import React from "react";
import { render } from "ink";
import type { ModelConfig } from "@cdoing/ai";
import type {
  ToolRegistry,
  PermissionManager,
  HookManager,
  MemoryStore,
  TodoStore,
} from "@cdoing/core";
import { App } from "./ui/App";
import { printWelcome } from "./help";
import { initThemeAsync, restoreTerminalBackground } from "./ui/theme";

export class ChatInterface {
  private modelConfig: Partial<ModelConfig>;
  private toolRegistry: ToolRegistry;
  private permissionManager: PermissionManager;
  private hookManager: HookManager;
  private memoryStore: MemoryStore;
  private todoStore: TodoStore | null;

  constructor(
    modelConfig: Partial<ModelConfig>,
    toolRegistry: ToolRegistry,
    permissionManager: PermissionManager,
    hookManager: HookManager,
    memoryStore: MemoryStore,
    todoStore?: TodoStore,
  ) {
    this.modelConfig = modelConfig;
    this.toolRegistry = toolRegistry;
    this.permissionManager = permissionManager;
    this.hookManager = hookManager;
    this.memoryStore = memoryStore;
    this.todoStore = todoStore || null;
  }

  async start(initialPrompt?: string): Promise<void> {
    // Detect terminal background (OSC 11) and optionally sync bg color
    await initThemeAsync({ syncTerminalBg: true });
    printWelcome();

    // Restore terminal background on exit
    const cleanup = () => {
      restoreTerminalBackground();
    };
    process.on("exit", cleanup);
    process.on("SIGINT", cleanup);
    process.on("SIGTERM", cleanup);

    const { waitUntilExit } = render(
      React.createElement(App, {
        modelConfig: this.modelConfig,
        toolRegistry: this.toolRegistry,
        permissionManager: this.permissionManager,
        hookManager: this.hookManager,
        memoryStore: this.memoryStore,
        todoStore: this.todoStore || undefined,
        initialPrompt,
      }),
    );

    await waitUntilExit();
    restoreTerminalBackground();
  }
}
