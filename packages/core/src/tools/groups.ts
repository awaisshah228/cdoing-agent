/**
 * Tool Groups — logical groupings of tools for organized registration
 * and smarter token-saving tool selection.
 *
 * Instead of importing 30+ individual tool classes, consumers import
 * category-based registration helpers.
 */

import type { ToolRegistry } from "./registry";
import type { SandboxManager } from "../sandbox";
import type { PermissionManager } from "../permissions";
import type { ProcessManager } from "./execution/process-manager";
import type { SubAgentRunnerFactory } from "./agents/sub-agent";
import type { SubAgentManager } from "./agents/sub-agent-manager";
import type { TodoStore } from "../utils/todo";
import type { QuestionPromptFn } from "./session/question";
import type { PlanExitCallback } from "./session/plan-exit";
import type { DiagnosticsCallback } from "./file/file-write";

// ── Tool Categories ────────────────────────────────────────────────────────

/** Which tool categories to register */
export interface ToolGroupOptions {
  workingDir: string;
  sandboxManager?: SandboxManager;
  permissionManager?: PermissionManager;
  processManager?: ProcessManager;
  subAgentFactory?: SubAgentRunnerFactory;
  subAgentManager?: SubAgentManager;
  todoStore?: TodoStore;
  questionPromptFn?: QuestionPromptFn;
  planExitCallback?: PlanExitCallback;
  diagnosticsCallback?: DiagnosticsCallback;
}

/** Tool category names */
export type ToolCategory =
  | "file"        // file_read, file_write, file_edit, multi_edit, apply_patch, file_delete
  | "search"      // glob_search, grep_search, codebase_search, list_dir
  | "execution"   // shell_exec, file_run, code_verify
  | "web"         // web_fetch, web_search
  | "editing"     // ast_edit, notebook_edit
  | "viewing"     // view_diff, view_repo_map
  | "agents"      // sub_agent, sub_agent_status, sub_agent_terminate
  | "session"     // todo, question, batch, plan_exit, skill
  | "system"      // system_info, lsp
  ;

/** Register file tools: file_read, file_write, file_edit, multi_edit, apply_patch */
export async function registerFileTools(registry: ToolRegistry, opts: ToolGroupOptions): Promise<void> {
  const { FileReadTool } = await import("./file/file-read");
  const { FileWriteTool } = await import("./file/file-write");
  const { FileEditTool } = await import("./file/file-edit");
  const { MultiEditTool } = await import("./file/multi-edit");
  const { ApplyPatchTool } = await import("./file/apply-patch");

  registry.register(new FileReadTool(opts.workingDir, opts.sandboxManager));
  registry.register(new FileWriteTool(opts.workingDir, opts.sandboxManager, opts.diagnosticsCallback));
  registry.register(new FileEditTool(opts.workingDir, opts.sandboxManager));
  registry.register(new MultiEditTool(opts.workingDir, opts.sandboxManager));
  registry.register(new ApplyPatchTool(opts.workingDir, opts.sandboxManager));
}

/** Register search tools: glob_search, grep_search, codebase_search, list_dir */
export async function registerSearchTools(registry: ToolRegistry, opts: ToolGroupOptions): Promise<void> {
  const { GlobSearchTool } = await import("./search/glob-search");
  const { GrepSearchTool } = await import("./search/grep-search");
  const { CodebaseSearchTool } = await import("./search/codebase-search");
  const { ListDirTool } = await import("./search/list-dir");

  registry.register(new GlobSearchTool(opts.workingDir));
  registry.register(new GrepSearchTool(opts.workingDir));
  registry.register(new CodebaseSearchTool(opts.workingDir));
  registry.register(new ListDirTool(opts.workingDir, opts.sandboxManager));
}

/** Register execution tools: shell_exec, file_run, code_verify */
export async function registerExecutionTools(registry: ToolRegistry, opts: ToolGroupOptions): Promise<void> {
  const { ShellExecTool } = await import("./execution/shell-exec");
  const { FileRunTool } = await import("./execution/file-run");
  const { CodeVerifyTool } = await import("./execution/code-verify");
  const { ProcessManager: PM } = await import("./execution/process-manager");

  const pm = opts.processManager || new PM();
  registry.register(new ShellExecTool(opts.workingDir, opts.sandboxManager, opts.permissionManager, pm));
  registry.register(new FileRunTool(opts.workingDir, opts.sandboxManager));
  registry.register(new CodeVerifyTool(opts.workingDir));
}

/** Register web tools: web_fetch, web_search */
export async function registerWebTools(registry: ToolRegistry, opts: ToolGroupOptions): Promise<void> {
  const { WebFetchTool } = await import("./web/web-fetch");
  const { WebSearchTool } = await import("./web/web-search");

  registry.register(new WebFetchTool(opts.sandboxManager));
  registry.register(new WebSearchTool());
}

/** Register specialized editing tools: ast_edit, notebook_edit */
export async function registerEditingTools(registry: ToolRegistry, opts: ToolGroupOptions): Promise<void> {
  const { ASTEditTool } = await import("./editing/ast-edit");
  const { NotebookEditTool } = await import("./editing/notebook-edit");

  registry.register(new ASTEditTool(opts.workingDir, opts.sandboxManager));
  registry.register(new NotebookEditTool(opts.workingDir, opts.sandboxManager));
}

/** Register viewing tools: view_diff, view_repo_map */
export async function registerViewingTools(registry: ToolRegistry, opts: ToolGroupOptions): Promise<void> {
  const { ViewDiffTool } = await import("./viewing/view-diff");
  const { ViewRepoMapTool } = await import("./viewing/view-repo-map");

  registry.register(new ViewDiffTool(opts.workingDir));
  registry.register(new ViewRepoMapTool(opts.workingDir));
}

/** Register sub-agent tools: sub_agent, sub_agent_status, sub_agent_terminate */
export async function registerAgentTools(registry: ToolRegistry, opts: ToolGroupOptions): Promise<void> {
  if (!opts.subAgentFactory) return;

  const { SubAgentTool } = await import("./agents/sub-agent");
  const { SubAgentManager: SAM } = await import("./agents/sub-agent-manager");
  const { SubAgentStatusTool } = await import("./agents/sub-agent-status");
  const { SubAgentTerminateTool } = await import("./agents/sub-agent-terminate");

  const manager = opts.subAgentManager || new SAM();
  registry.register(new SubAgentTool(opts.subAgentFactory, manager));
  registry.register(new SubAgentStatusTool(manager));
  registry.register(new SubAgentTerminateTool(manager));
}

/** Register session tools: todo, question, batch, plan_exit, skill */
export async function registerSessionTools(registry: ToolRegistry, opts: ToolGroupOptions): Promise<void> {
  const { BatchTool } = await import("./session/batch");
  const { SkillTool } = await import("./session/skill");

  registry.register(new BatchTool(registry));
  registry.register(new SkillTool(opts.workingDir));

  if (opts.todoStore) {
    const { TodoTool } = await import("./session/todo");
    registry.register(new TodoTool(opts.todoStore));
  }
  if (opts.questionPromptFn) {
    const { QuestionTool } = await import("./session/question");
    registry.register(new QuestionTool(opts.questionPromptFn));
  }
  if (opts.planExitCallback) {
    const { PlanExitTool } = await import("./session/plan-exit");
    registry.register(new PlanExitTool(opts.planExitCallback));
  }
}

/** Register system tools: system_info, lsp */
export async function registerSystemTools(registry: ToolRegistry, opts: ToolGroupOptions): Promise<void> {
  const { LspTool } = await import("./system/lsp");
  registry.register(new LspTool(opts.workingDir));

  if (opts.permissionManager) {
    const { SystemInfoTool } = await import("./system/system-info");
    registry.register(new SystemInfoTool(opts.permissionManager, registry, opts.sandboxManager));
  }
}

// ── Convenience: register ALL tool groups ──────────────────────────────────

/**
 * Register all tool groups at once. This is the simplest way to set up
 * a full tool registry with all available tools.
 */
export async function registerAllTools(registry: ToolRegistry, opts: ToolGroupOptions): Promise<void> {
  await registerFileTools(registry, opts);
  await registerSearchTools(registry, opts);
  await registerExecutionTools(registry, opts);
  await registerWebTools(registry, opts);
  await registerEditingTools(registry, opts);
  await registerViewingTools(registry, opts);
  await registerAgentTools(registry, opts);
  await registerSessionTools(registry, opts);
  await registerSystemTools(registry, opts);
}

/**
 * Register a subset of tool categories.
 * Useful for lighter-weight setups (e.g., VS Code extension without sub-agents).
 */
export async function registerToolCategories(
  registry: ToolRegistry,
  categories: ToolCategory[],
  opts: ToolGroupOptions,
): Promise<void> {
  const registrars: Record<ToolCategory, (r: ToolRegistry, o: ToolGroupOptions) => Promise<void>> = {
    file: registerFileTools,
    search: registerSearchTools,
    execution: registerExecutionTools,
    web: registerWebTools,
    editing: registerEditingTools,
    viewing: registerViewingTools,
    agents: registerAgentTools,
    session: registerSessionTools,
    system: registerSystemTools,
  };

  for (const cat of categories) {
    await registrars[cat](registry, opts);
  }
}
