/**
 * Tool Registration — creates a ToolRegistry with grouped tool categories.
 *
 * Tools are organized into logical groups (file, search, execution, web, etc.)
 * rather than importing 30+ individual classes. This makes registration cleaner
 * and allows selective category loading for different contexts.
 */

import {
  ToolRegistry,
  registerAllTools,
  registerToolCategories,
  SubAgentManager,
  ProcessManager,
  TodoStore,
  MemoryStore,
  SandboxManager,
  PermissionManager,
  FileTimeLock,
} from "@cdoing/core";
import type { SubAgentRunnerFactory, QuestionPromptFn, PlanExitCallback, ToolCategory, DiagnosticsCallback } from "@cdoing/core";

export interface ToolRegistryOptions {
  subAgentFactory?: SubAgentRunnerFactory;
  subAgentManager?: SubAgentManager;
  processManager?: ProcessManager;
  todoStore?: TodoStore;
  memoryStore?: MemoryStore;
  sandboxManager?: SandboxManager;
  permissionManager?: PermissionManager;
  /** Prompt function for the question tool (provided by CLI or VSCode) */
  questionPromptFn?: QuestionPromptFn;
  /** Callback for the plan_exit tool */
  planExitCallback?: PlanExitCallback;
  /** File time lock for read-before-write safety */
  fileTimeLock?: FileTimeLock;
  /** Callback for running LSP diagnostics after file writes */
  diagnosticsCallback?: DiagnosticsCallback;
  /**
   * Specific tool categories to register. If omitted, all categories are registered.
   * Useful for lightweight contexts (e.g., sub-agents only need file + search + execution).
   */
  categories?: ToolCategory[];
}

export async function createToolRegistry(
  workingDir: string,
  optionsOrSubAgentFactory?: ToolRegistryOptions | SubAgentRunnerFactory,
): Promise<ToolRegistry> {
  // Support both old signature (subAgentFactory) and new signature (options)
  let options: ToolRegistryOptions = {};
  if (typeof optionsOrSubAgentFactory === "function") {
    options = { subAgentFactory: optionsOrSubAgentFactory };
  } else if (optionsOrSubAgentFactory) {
    options = optionsOrSubAgentFactory;
  }

  const registry = new ToolRegistry();

  const groupOpts = {
    workingDir,
    sandboxManager: options.sandboxManager,
    permissionManager: options.permissionManager,
    processManager: options.processManager || new ProcessManager(),
    subAgentFactory: options.subAgentFactory,
    subAgentManager: options.subAgentManager,
    todoStore: options.todoStore,
    memoryStore: options.memoryStore,
    questionPromptFn: options.questionPromptFn,
    planExitCallback: options.planExitCallback,
    diagnosticsCallback: options.diagnosticsCallback,
  };

  if (options.categories) {
    await registerToolCategories(registry, options.categories, groupOpts);
  } else {
    await registerAllTools(registry, groupOpts);
  }

  return registry;
}

/**
 * Create a lightweight tool registry for sub-agents.
 * Only includes file, search, execution, and web tools — no sub-agents (prevents recursion).
 */
export async function createSubAgentToolRegistry(
  workingDir: string,
  options?: Omit<ToolRegistryOptions, "subAgentFactory" | "subAgentManager" | "categories">,
): Promise<ToolRegistry> {
  return createToolRegistry(workingDir, {
    ...options,
    categories: ["file", "search", "execution", "web", "viewing"],
  });
}
