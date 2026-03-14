// Tools
export { ToolRegistry } from "./tools/registry";
export { FileReadTool } from "./tools/file-read";
export { FileWriteTool } from "./tools/file-write";
export { FileEditTool } from "./tools/file-edit";
export { GlobSearchTool } from "./tools/glob-search";
export { GrepSearchTool } from "./tools/grep-search";
export { ShellExecTool } from "./tools/shell-exec";
export { FileRunTool } from "./tools/file-run";
export { CodeVerifyTool } from "./tools/code-verify";
export { WebFetchTool } from "./tools/web-fetch";
export { WebSearchTool } from "./tools/web-search";
export { SubAgentTool } from "./tools/sub-agent";
export type { SubAgentRunnerFactory } from "./tools/sub-agent";
export { TodoTool } from "./tools/todo";
export type { ToolDefinition, ToolResult, BaseTool } from "./tools/types";

// Permissions
export { PermissionManager, PermissionMode } from "./permissions";
export type { PermissionRule, PermissionScope, PermissionPromptFn } from "./permissions";

// Hooks
export { HookManager } from "./hooks";
export type { HookDefinition, HookResult } from "./hooks";

// Utilities
export { safePath } from "./utils/path-safety";
export { loadIgnorePatterns } from "./utils/gitignore";
export { loadProjectConfig, getProjectConfigPath } from "./utils/project-config";
export { MemoryStore } from "./utils/memory";
export type { MemoryEntry } from "./utils/memory";
export { TodoStore } from "./utils/todo";
export type { TodoItem, TodoStatus } from "./utils/todo";

// Context Providers — pluggable @ mention system
export { ContextProviderRegistry } from "./context-providers/registry";
export type { ContextProvider, ContextResult, ContextResolveOptions } from "./context-providers/types";
export { TerminalContextProvider } from "./context-providers/terminal";
export { OpenFilesContextProvider } from "./context-providers/open-files";
export { UrlContextProvider } from "./context-providers/url";
export { TreeContextProvider } from "./context-providers/tree";
export { ProblemsContextProvider } from "./context-providers/problems";
export { CodebaseContextProvider } from "./context-providers/codebase";

// Project Rules — hierarchical glob-scoped rules
export { RulesManager } from "./rules/manager";
export type { Rule, RuleSource } from "./rules/types";

// Plan Mode — read-only planning before execution
export { PlanManager } from "./plan/manager";
export type { Plan, PlanStep, PlanStatus } from "./plan/manager";

// MCP Server Support — Model Context Protocol
export { McpManager } from "./mcp/manager";
export type { McpServerConfig, McpTool } from "./mcp/manager";

// Effort Level Control — adjusts analysis depth
export { EffortManager } from "./effort";
export type { EffortLevel, EffortConfig } from "./effort";
