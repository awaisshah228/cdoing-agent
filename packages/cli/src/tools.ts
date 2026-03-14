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
  WebFetchTool,
  WebSearchTool,
  SubAgentTool,
} from "@cdoing/core";
import type { SubAgentRunnerFactory } from "@cdoing/core";

export function createToolRegistry(
  workingDir: string,
  subAgentFactory?: SubAgentRunnerFactory,
): ToolRegistry {
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

  // Web tools
  registry.register(new WebFetchTool());
  registry.register(new WebSearchTool());

  // Sub-agent (only if factory provided — prevents infinite recursion)
  if (subAgentFactory) {
    registry.register(new SubAgentTool(subAgentFactory));
  }

  return registry;
}
