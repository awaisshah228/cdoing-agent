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
export { SystemInfoTool } from "./tools/system-info";
export { MultiEditTool } from "./tools/multi-edit";
export { FileDeleteTool } from "./tools/file-delete";
export { ListDirTool } from "./tools/list-dir";
export { ViewDiffTool } from "./tools/view-diff";
export { ViewRepoMapTool } from "./tools/view-repo-map";
export { CodebaseSearchTool } from "./tools/codebase-search";
export { ASTEditTool } from "./tools/ast-edit";
export { NotebookEditTool } from "./tools/notebook-edit";
export type { ToolDefinition, ToolResult, BaseTool } from "./tools/types";

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
export type { PermissionRule, PermissionScope, PermissionPromptFn } from "./permissions";

// Sandbox
export { SandboxManager } from "./sandbox";
export { defaultSandboxConfig } from "./sandbox";
export type { SandboxConfig, SandboxMode, SandboxCheckResult, SandboxFilesystemConfig, SandboxNetworkConfig } from "./sandbox/types";

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

// OAuth — shared credential storage, PKCE, token management
export {
  saveOAuthTokens,
  loadOAuthTokens,
  clearOAuthTokens,
  isOAuthExpired,
  refreshAccessToken,
  resolveOAuthToken,
  generateOAuthUrl,
  exchangeOAuthCode,
  getOAuthStatus,
} from "./oauth";
export type { OAuthTokens } from "./oauth";

// Codebase Indexing — FTS5 + embeddings
export { CodebaseIndexer, IndexDatabase, chunkDocument, RecentEditsCache } from "./indexing";
export type { CachedEdit } from "./indexing";
export type { EmbeddingProvider } from "./indexing";
export type { SearchResult, IndexingProgress, IndexStats, ChunkWithMeta } from "./indexing";
