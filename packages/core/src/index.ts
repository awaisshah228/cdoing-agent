// Tools — Infrastructure
export { ToolRegistry } from "./tools/registry";
export type { ToolDefinition, ToolResult, BaseTool } from "./tools/types";

// Tools — File operations
export { FileReadTool } from "./tools/file/file-read";
export { FileWriteTool } from "./tools/file/file-write";
export type { DiagnosticsCallback } from "./tools/file/file-write";
export { FileEditTool } from "./tools/file/file-edit";
export { MultiEditTool } from "./tools/file/multi-edit";
export { ApplyPatchTool } from "./tools/file/apply-patch";

// Tools — Search & discovery
export { GlobSearchTool } from "./tools/search/glob-search";
export { GrepSearchTool } from "./tools/search/grep-search";
export { CodebaseSearchTool } from "./tools/search/codebase-search";
export { ListDirTool } from "./tools/search/list-dir";

// Tools — Execution
export { ShellExecTool } from "./tools/execution/shell-exec";
export { FileRunTool } from "./tools/execution/file-run";
export { CodeVerifyTool } from "./tools/execution/code-verify";
export { ProcessManager } from "./tools/execution/process-manager";
export type { ProcessStatus, ProcessEntry } from "./tools/execution/process-manager";

// Tools — Web
export { WebFetchTool } from "./tools/web/web-fetch";
export { WebSearchTool } from "./tools/web/web-search";

// Tools — Specialized editing
export { ASTEditTool } from "./tools/editing/ast-edit";
export { NotebookEditTool } from "./tools/editing/notebook-edit";

// Tools — Viewing
export { ViewDiffTool } from "./tools/viewing/view-diff";
export { ViewRepoMapTool } from "./tools/viewing/view-repo-map";

// Tools — Sub-agents
export { SubAgentTool } from "./tools/agents/sub-agent";
export type { SubAgentRunnerFactory } from "./tools/agents/sub-agent";
export { SubAgentManager } from "./tools/agents/sub-agent-manager";
export type { SubAgentStatus, SubAgentEntry } from "./tools/agents/sub-agent-manager";
export { SubAgentStatusTool } from "./tools/agents/sub-agent-status";
export { SubAgentTerminateTool } from "./tools/agents/sub-agent-terminate";

// Tools — Session management
export { TodoTool } from "./tools/session/todo";
export { BatchTool } from "./tools/session/batch";
export { QuestionTool } from "./tools/session/question";
export type { QuestionPromptFn, QuestionOption } from "./tools/session/question";
export { SkillTool } from "./tools/session/skill";
export { PlanExitTool } from "./tools/session/plan-exit";
export type { PlanExitCallback } from "./tools/session/plan-exit";

// Tools — System
export { SystemInfoTool } from "./tools/system/system-info";
export { LspTool } from "./tools/system/lsp";
export type { LspServerConfig } from "./tools/system/lsp";

// Tool Groups — organized registration by category
export {
  registerFileTools,
  registerSearchTools,
  registerExecutionTools,
  registerWebTools,
  registerEditingTools,
  registerViewingTools,
  registerAgentTools,
  registerSessionTools,
  registerSystemTools,
  registerAllTools,
  registerToolCategories,
} from "./tools/groups";
export type { ToolGroupOptions, ToolCategory } from "./tools/groups";

// Search matching utilities
export { findSearchMatch, findAllSearchMatches, executeFindAndReplace, executeMultiFindAndReplace, isUnifiedDiff, applyUnifiedDiff } from "./utils/search-match";

// Streaming diff utilities
export { streamDeterministicDiff, streamUnifiedDiff, StreamingDiffAccumulator } from "./utils/streaming-diff";
export type { DiffChunk, DiffChunkCallback } from "./utils/streaming-diff";

// Lazy apply — placeholder expansion for LLM-generated edits
export { hasPlaceholders, expandPlaceholders, isPlaceholderLine } from "./utils/lazy-apply";
export type { LazyApplyResult } from "./utils/lazy-apply";

// Permissions
export { PermissionManager, PermissionMode } from "./permissions";
export type { PermissionRule, PermissionScope, PermissionPromptFn, AgentType } from "./permissions";
export { bashCommandPrefix, getHumanReadableCommand } from "./permissions/bash-arity";

// Sandbox
export { SandboxManager } from "./sandbox";
export { defaultSandboxConfig } from "./sandbox";
export type { SandboxConfig, SandboxMode, SandboxCheckResult, SandboxFilesystemConfig, SandboxNetworkConfig } from "./sandbox/types";

// Hooks
export { HookManager } from "./hooks";
export type { HookDefinition, HookResult } from "./hooks";

// File Time Locks — read-before-write safety + write serialization
export { FileTimeLock } from "./utils/file-time";

// Plugin System — extensibility hooks
export { PluginManager } from "./plugins";
export type { CdoingPlugin, PluginContext } from "./plugins";

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
export { ClipboardContextProvider } from "./context-providers/clipboard";
export { FileIncludeContextProvider } from "./context-providers/file-include";
export { GitContextProvider } from "./context-providers/git";
export { DiffContextProvider } from "./context-providers/diff";
export { FolderContextProvider } from "./context-providers/folder";
export { DocsContextProvider } from "./context-providers/docs";

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

// OAuth — multi-provider credential storage, PKCE, token management
export {
  saveOAuthTokens,
  loadOAuthTokens,
  clearOAuthTokens,
  fullLogout,
  isOAuthExpired,
  refreshAccessToken,
  resolveOAuthToken,
  generateOAuthUrl,
  exchangeOAuthCode,
  getOAuthStatus,
  getAllOAuthStatuses,
  getOAuthProvider,
  getOAuthProviders,
  supportsOAuth,
} from "./oauth";
export type { OAuthTokens, OAuthProviderConfig } from "./oauth";

// Codebase Indexing — FTS5 + embeddings
export { CodebaseIndexer, IndexDatabase, chunkDocument, RecentEditsCache } from "./indexing";
export type { CachedEdit } from "./indexing";
export type { EmbeddingProvider } from "./indexing";
export type { SearchResult, IndexingProgress, IndexStats, ChunkWithMeta } from "./indexing";
