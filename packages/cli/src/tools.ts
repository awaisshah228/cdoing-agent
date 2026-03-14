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
} from "@cdoing/core";

export function createToolRegistry(workingDir: string): ToolRegistry {
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

  return registry;
}
