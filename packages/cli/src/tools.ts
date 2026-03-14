/**
 * Tool Registration — creates a ToolRegistry with all core tools.
 */

import {
  ToolRegistry,
  FileReadTool,
  FileWriteTool,
  FileEditTool,
  GlobSearchTool,
  GrepSearchTool,
  ShellExecTool,
  FileRunTool,
  CodeVerifyTool,
  WebFetchTool,
  WebSearchTool,
  SubAgentTool,
  TodoTool,
  TodoStore,
} from "@cdoing/core";
import type { SubAgentRunnerFactory } from "@cdoing/core";

export interface ToolRegistryOptions {
  subAgentFactory?: SubAgentRunnerFactory;
  todoStore?: TodoStore;
}

export function createToolRegistry(
  workingDir: string,
  optionsOrSubAgentFactory?: ToolRegistryOptions | SubAgentRunnerFactory,
): ToolRegistry {
  // Support both old signature (subAgentFactory) and new signature (options)
  let options: ToolRegistryOptions = {};
  if (typeof optionsOrSubAgentFactory === "function") {
    options = { subAgentFactory: optionsOrSubAgentFactory };
  } else if (optionsOrSubAgentFactory) {
    options = optionsOrSubAgentFactory;
  }

  const registry = new ToolRegistry();

  // File tools
  registry.register(new FileReadTool(workingDir));
  registry.register(new FileWriteTool(workingDir));
  registry.register(new FileEditTool(workingDir));

  // Search tools
  registry.register(new GlobSearchTool(workingDir));
  registry.register(new GrepSearchTool(workingDir));

  // Execution tools
  registry.register(new ShellExecTool(workingDir));
  registry.register(new FileRunTool(workingDir));
  registry.register(new CodeVerifyTool(workingDir));

  // Web tools
  registry.register(new WebFetchTool());
  registry.register(new WebSearchTool());

  // Sub-agent (only if factory provided — prevents infinite recursion)
  if (options.subAgentFactory) {
    registry.register(new SubAgentTool(options.subAgentFactory));
  }

  // Todo tool (for task tracking)
  if (options.todoStore) {
    registry.register(new TodoTool(options.todoStore));
  }

  return registry;
}
