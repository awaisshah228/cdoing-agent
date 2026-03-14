/**
 * Tool Registration
 *
 * Sets up the ToolRegistry with all available core tools,
 * scoped to the user's working directory.
 */

import {
  ToolRegistry,
  FileReadTool,
  FileWriteTool,
  FileEditTool,
  GlobSearchTool,
  GrepSearchTool,
  ShellExecTool,
} from "@cdoing/core";

/**
 * Create a ToolRegistry pre-loaded with all core tools.
 * Each tool is scoped to `workingDir` for path resolution.
 */
export function createToolRegistry(workingDir: string): ToolRegistry {
  const registry = new ToolRegistry();

  // File manipulation tools
  registry.register(new FileReadTool(workingDir));
  registry.register(new FileWriteTool(workingDir));
  registry.register(new FileEditTool(workingDir));

  // Search tools
  registry.register(new GlobSearchTool(workingDir));
  registry.register(new GrepSearchTool(workingDir));

  // Shell execution
  registry.register(new ShellExecTool(workingDir));

  return registry;
}
