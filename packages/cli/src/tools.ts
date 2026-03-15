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
  SubAgentManager,
  SubAgentStatusTool,
  SubAgentTerminateTool,
  TodoTool,
  TodoStore,
  SandboxManager,
  SystemInfoTool,
  MultiEditTool,

  ListDirTool,
  ViewDiffTool,
  ViewRepoMapTool,
  CodebaseSearchTool,
  ASTEditTool,
  NotebookEditTool,
  PermissionManager,
} from "@cdoing/core";
import type { SubAgentRunnerFactory } from "@cdoing/core";

export interface ToolRegistryOptions {
  subAgentFactory?: SubAgentRunnerFactory;
  subAgentManager?: SubAgentManager;
  todoStore?: TodoStore;
  sandboxManager?: SandboxManager;
  permissionManager?: PermissionManager;
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

  const sm = options.sandboxManager;
  const registry = new ToolRegistry();

  // File tools
  registry.register(new FileReadTool(workingDir, sm));
  registry.register(new FileWriteTool(workingDir, sm));
  registry.register(new FileEditTool(workingDir, sm));
  registry.register(new MultiEditTool(workingDir, sm));
  registry.register(new ASTEditTool(workingDir, sm));
  registry.register(new NotebookEditTool(workingDir, sm));

  // Search & discovery tools
  registry.register(new GlobSearchTool(workingDir));
  registry.register(new GrepSearchTool(workingDir));
  registry.register(new ListDirTool(workingDir, sm));
  registry.register(new ViewDiffTool(workingDir));
  registry.register(new ViewRepoMapTool(workingDir));
  registry.register(new CodebaseSearchTool(workingDir));

  // Execution tools
  registry.register(new ShellExecTool(workingDir, sm, options.permissionManager));
  registry.register(new FileRunTool(workingDir, sm));
  registry.register(new CodeVerifyTool(workingDir));

  // Web tools
  registry.register(new WebFetchTool(sm));
  registry.register(new WebSearchTool());

  // Sub-agent (only if factory provided — prevents infinite recursion)
  if (options.subAgentFactory) {
    const manager = options.subAgentManager || new SubAgentManager();
    registry.register(new SubAgentTool(options.subAgentFactory, manager));
    registry.register(new SubAgentStatusTool(manager));
    registry.register(new SubAgentTerminateTool(manager));
  }

  // Todo tool (for task tracking)
  if (options.todoStore) {
    registry.register(new TodoTool(options.todoStore));
  }

  // System info tool — gives the LLM live access to its permission/sandbox state
  if (options.permissionManager) {
    registry.register(new SystemInfoTool(options.permissionManager, registry, sm));
  }

  return registry;
}
