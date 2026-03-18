/**
 * ToolCallBubble.tsx — Per-Tool Rendering (Claude Code style)
 *
 * Each tool type has its own rendering logic for:
 *   - Header description (what the tool is doing)
 *   - IN section (trimmed input display)
 *   - OUT section (trimmed output display)
 *
 * Collapsed: [icon] ToolLabel  description
 * Expanded:  IN: trimmed input / OUT: trimmed output
 */

import React, { useState, useCallback, useMemo, useEffect, useRef } from "react";
import type { ToolCallEntry } from "../types";
import { useVsCode } from "../hooks/useVsCode";

interface ToolCallBubbleProps {
  entry: ToolCallEntry;
}

// ── SVG Icon Helper ──────────────────────────────────

const ToolSvg: React.FC<{ d: string }> = ({ d }) => (
  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);

// ── Tool Config ──────────────────────────────────────

const TOOL_CONFIG: Record<string, { label: string; icon: React.ReactNode }> = {
  file_read:       { label: "Read",       icon: <ToolSvg d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2zM22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" /> },
  file_write:      { label: "Write",      icon: <ToolSvg d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" /> },
  file_edit:       { label: "Edit",       icon: <ToolSvg d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /> },
  multi_edit:      { label: "MultiEdit",  icon: <ToolSvg d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /> },
  ast_edit:        { label: "AST Edit",   icon: <ToolSvg d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" /> },
  notebook_edit:   { label: "Notebook",   icon: <ToolSvg d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2zM22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" /> },
  glob_search:     { label: "Find files", icon: <ToolSvg d="M21 21l-6-6m2-5a7 7 0 1 1-14 0 7 7 0 0 1 14 0z" /> },
  grep_search:     { label: "Search",     icon: <ToolSvg d="M21 21l-6-6m2-5a7 7 0 1 1-14 0 7 7 0 0 1 14 0z" /> },
  codebase_search: { label: "Codebase",   icon: <ToolSvg d="M21 21l-6-6m2-5a7 7 0 1 1-14 0 7 7 0 0 1 14 0z" /> },
  shell_exec:      { label: "Bash",       icon: <ToolSvg d="M4 17l6-6-6-6M12 19h8" /> },
  file_run:        { label: "Execute",    icon: <ToolSvg d="M5 3l14 9-14 9V3z" /> },
  web_fetch:       { label: "Fetch",      icon: <ToolSvg d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" /> },
  web_search:      { label: "Web search", icon: <ToolSvg d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM2 12h20" /> },
  sub_agent:       { label: "Agent",      icon: <ToolSvg d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" /> },
  todo:            { label: "Todo",       icon: <ToolSvg d="M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /> },
  plan_exit:       { label: "Plan",      icon: <ToolSvg d="M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /> },
  memory:          { label: "Memory",    icon: <ToolSvg d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM12 8v4l3 3" /> },
  task_complete:   { label: "Done",      icon: <ToolSvg d="M22 11.08V12a10 10 0 1 1-5.93-9.14M22 4L12 14.01l-3-3" /> },
  list_dir:        { label: "List dir",   icon: <ToolSvg d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /> },
  view_diff:       { label: "Diff",       icon: <ToolSvg d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5" /> },
  view_repo_map:   { label: "Repo map",   icon: <ToolSvg d="M1 6v16l7-4 8 4 7-4V2l-7 4-8-4-7 4zM8 2v16M16 6v16" /> },
  code_verify:     { label: "Verify",     icon: <ToolSvg d="M22 11.08V12a10 10 0 1 1-5.93-9.14M22 4L12 14.01l-3-3" /> },
  system_info:     { label: "System",     icon: <ToolSvg d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM12 16v-4M12 8h.01" /> },
};

function parseInput(detail: string): Record<string, unknown> {
  try { return JSON.parse(detail); } catch { return {}; }
}

// ── Per-Tool Description Generators ──────────────────

function getToolDescription(name: string, input: string, description?: string): string {
  if (description) return description;
  const p = parseInput(input);

  switch (name) {
    case "file_read": {
      const path = shortPath(String(p.file_path || p.path || ""));
      return path ? `Read ${path}` : "Read file";
    }
    case "file_write": {
      const path = shortPath(String(p.file_path || p.path || ""));
      return path ? `Write ${path}` : "Write file";
    }
    case "file_edit":
    case "multi_edit": {
      const path = shortPath(String(p.file_path || p.path || ""));
      return path ? `Edit ${path}` : "Edit file";
    }

    case "glob_search": {
      const pattern = String(p.pattern || "");
      return pattern ? `Find files matching "${pattern}"` : "Search files";
    }
    case "grep_search": {
      const pattern = String(p.pattern || "");
      const path = shortPath(String(p.path || ""));
      if (pattern && path) return `Search for "${trim(pattern, 30)}" in ${path}`;
      if (pattern) return `Search for "${trim(pattern, 40)}"`;
      return "Search code";
    }
    case "codebase_search": {
      const query = String(p.query || "");
      return query ? `Search codebase: "${trim(query, 40)}"` : "Search codebase";
    }
    case "shell_exec": {
      const cmd = String(p.command || "");
      if (!cmd) return "Run command";
      // Show first line of command, trimmed
      const firstLine = cmd.split("\n")[0];
      return trim(firstLine, 60);
    }
    case "file_run": {
      const path = shortPath(String(p.file_path || p.path || ""));
      return path ? `Execute ${path}` : "Execute file";
    }
    case "web_fetch": {
      const url = String(p.url || "");
      return url ? `Fetch ${trim(url, 50)}` : "Fetch URL";
    }
    case "web_search": {
      const query = String(p.query || "");
      return query ? `Search web: "${trim(query, 40)}"` : "Search web";
    }
    case "sub_agent": {
      const task = String(p.task || p.prompt || "");
      return task ? `Agent: ${trim(task, 50)}` : "Sub-agent";
    }
    case "list_dir": {
      const path = shortPath(String(p.path || ""));
      return path ? `List ${path}` : "List directory";
    }
    case "ast_edit": {
      const path = shortPath(String(p.file_path || p.path || ""));
      const ops = Array.isArray(p.operations) ? p.operations.length : 0;
      if (path && ops) return `AST edit ${path} (${ops} op${ops > 1 ? "s" : ""})`;
      return path ? `AST edit ${path}` : "AST edit";
    }
    case "view_repo_map": {
      const path = shortPath(String(p.path || ""));
      return path ? `Repo map ${path}` : "Repo map";
    }
    case "todo": {
      const action = String(p.action || "");
      const subject = String(p.subject || "");
      const status = String(p.status || "");
      if (action === "create") return subject ? `Create task: ${trim(subject, 40)}` : "Create task";
      if (action === "update") return status ? `Update task → ${status}` : "Update task";
      if (action === "list") return "List tasks";
      if (action === "delete") return "Delete task";
      return `Todo: ${action}`;
    }
    case "plan_exit": {
      const summary = String(p.summary || "");
      return summary ? `Plan ready: ${trim(summary, 40)}` : "Plan complete";
    }
    case "memory": {
      const action = String(p.action || "");
      const key = String(p.key || p.query || "");
      if (action === "save") return key ? `Save memory: ${key}` : "Save memory";
      if (action === "search") return key ? `Search memories: "${trim(key, 30)}"` : "Search memories";
      if (action === "forget") return key ? `Forget: ${key}` : "Forget memory";
      if (action === "list") return "List memories";
      return `Memory: ${action}`;
    }
    case "task_complete": {
      const summary = String(p.summary || "");
      return summary ? `Done: ${trim(summary, 40)}` : "Task complete";
    }
    default: {
      // Fallback: try to build a description from common input fields
      const fp = String(p.file_path || p.path || "");
      const query = String(p.query || p.pattern || p.command || "");
      if (fp && query) return `${name} ${shortPath(fp)}: ${trim(query, 30)}`;
      if (fp) return `${name} ${shortPath(fp)}`;
      if (query) return `${name}: ${trim(query, 40)}`;
      const config = TOOL_CONFIG[name];
      return config ? config.label : name.replace(/_/g, " ");
    }
  }
}

// ── Per-Tool IN Renderers ────────────────────────────

function renderToolInput(name: string, parsed: Record<string, unknown>, onOpenFile: (fp: string, e: React.MouseEvent) => void): React.ReactNode {
  switch (name) {
    case "shell_exec": {
      const cmd = String(parsed.command || "");
      return (
        <pre className="tool-io-block tool-io-command">{trimLines(cmd, 6)}</pre>
      );
    }
    case "file_read": {
      const path = String(parsed.file_path || parsed.path || "");
      const offset = parsed.offset ? `  offset: ${parsed.offset}` : "";
      const limit = parsed.limit ? `  limit: ${parsed.limit}` : "";
      return (
        <div className="tool-io-block">
          <span className="tool-file-link" onClick={(e) => onOpenFile(path, e)}>{path}</span>
          {(offset || limit) && <span className="tool-io-meta">{offset}{limit}</span>}
        </div>
      );
    }
    case "file_write": {
      const path = String(parsed.file_path || parsed.path || "");
      const content = String(parsed.content || "");
      const lines = content.split("\n");
      return (
        <div className="tool-io-block">
          <span className="tool-file-link" onClick={(e) => onOpenFile(path, e)}>{path}</span>
          <pre className="tool-io-code">{trimLines(content, 8)}</pre>
          {lines.length > 8 && <span className="tool-io-meta">{lines.length} lines total</span>}
        </div>
      );
    }
    case "file_edit":
    case "multi_edit": {
      const path = String(parsed.file_path || parsed.path || "");
      const oldStr = String(parsed.old_string || "");
      const newStr = String(parsed.new_string || "");
      return (
        <div className="tool-io-block">
          <span className="tool-file-link" onClick={(e) => onOpenFile(path, e)}>{path}</span>
          {oldStr && (
            <div className="tool-io-diff-preview">
              <div className="tool-io-diff-label">old_string:</div>
              <pre className="tool-io-code tool-io-removed">{trimLines(oldStr, 4)}</pre>
              <div className="tool-io-diff-label">new_string:</div>
              <pre className="tool-io-code tool-io-added">{trimLines(newStr, 4)}</pre>
            </div>
          )}
        </div>
      );
    }
    case "grep_search": {
      const pattern = String(parsed.pattern || "");
      const path = String(parsed.path || "");
      const include = String(parsed.include || parsed.glob || "");
      return (
        <div className="tool-io-block">
          <span className="tool-io-label">pattern: </span><code className="tool-io-inline-code">{pattern}</code>
          {path && <><br /><span className="tool-io-label">path: </span><span>{path}</span></>}
          {include && <><br /><span className="tool-io-label">glob: </span><span>{include}</span></>}
        </div>
      );
    }
    case "glob_search": {
      const pattern = String(parsed.pattern || "");
      const path = String(parsed.path || "");
      return (
        <div className="tool-io-block">
          <span className="tool-io-label">pattern: </span><code className="tool-io-inline-code">{pattern}</code>
          {path && <><br /><span className="tool-io-label">path: </span><span>{path}</span></>}
        </div>
      );
    }
    case "web_fetch": {
      const url = String(parsed.url || "");
      return <div className="tool-io-block"><code className="tool-io-inline-code">{url}</code></div>;
    }
    case "web_search": {
      const query = String(parsed.query || "");
      return <div className="tool-io-block"><code className="tool-io-inline-code">{query}</code></div>;
    }
    case "sub_agent": {
      const task = String(parsed.task || parsed.prompt || "");
      return <pre className="tool-io-block">{trimLines(task, 4)}</pre>;
    }
    case "todo": {
      const action = String(parsed.action || "");
      const subject = String(parsed.subject || "");
      const parentId = String(parsed.parent_id || "");
      const status = String(parsed.status || "");
      const id = String(parsed.id || "");
      return (
        <div className="tool-io-block tool-todo-input">
          <span className="tool-io-label">{action}</span>
          {subject && <span>: {subject}</span>}
          {parentId && <span className="tool-io-meta"> (under #{parentId})</span>}
          {id && <span className="tool-io-meta"> #{id}</span>}
          {status && <span className="tool-io-meta"> → {status}</span>}
        </div>
      );
    }
    case "ast_edit": {
      const path = String(parsed.file_path || parsed.path || "");
      const ops = Array.isArray(parsed.operations) ? parsed.operations as Array<Record<string, unknown>> : [];
      return (
        <div className="tool-io-block">
          {path && <span className="tool-file-link" onClick={(e) => onOpenFile(path, e)}>{path}</span>}
          {ops.length > 0 && (
            <div className="tool-io-diff-preview">
              {ops.map((op, i) => (
                <div key={i} className="tool-input-row">
                  <span className="tool-io-label">{String(op.action || "?")} </span>
                  <span>{String(op.node_type || "")} </span>
                  <code className="tool-io-inline-code">{String(op.name || "")}</code>
                  {op.new_name ? <span> → <code className="tool-io-inline-code">{String(op.new_name)}</code></span> : null}
                </div>
              ))}
            </div>
          )}
        </div>
      );
    }
    default:
      return <DefaultInputRenderer parsed={parsed} onOpenFile={onOpenFile} />;
  }
}

// ── Per-Tool OUT Renderers ───────────────────────────

function renderToolOutput(name: string, output: string, isError?: boolean, onOpenFile?: (fp: string, e: React.MouseEvent) => void): React.ReactNode {
  if (!output) return <span className="tool-io-empty">(no output)</span>;

  if (isError) {
    return <pre className="tool-io-block tool-io-error">{trimLines(output, 10)}</pre>;
  }

  switch (name) {
    case "shell_exec": {
      if (!output.trim()) return <span className="tool-io-empty">(Bash completed with no output)</span>;
      return <pre className="tool-io-block">{trimLines(output, 12)}</pre>;
    }
    case "file_read": {
      return <pre className="tool-io-block">{trimLines(output, 15)}</pre>;
    }
    case "file_write":
    case "file_edit":
    case "multi_edit":
    case "ast_edit": {
      if (hasDiff(output)) {
        return <DiffRenderer output={output} onOpenFile={onOpenFile} />;
      }
      return <pre className="tool-io-block">{trimLines(output, 10)}</pre>;
    }
    case "grep_search": {
      const lines = output.split("\n").filter(l => l.trim());
      const count = lines.length;
      return (
        <div className="tool-io-block">
          <span className="tool-io-meta">{count} result{count !== 1 ? "s" : ""}</span>
          <pre className="tool-io-results">{trimLines(output, 15)}</pre>
        </div>
      );
    }
    case "glob_search": {
      const lines = output.split("\n").filter(l => l.trim());
      const count = lines.length;
      return (
        <div className="tool-io-block">
          <span className="tool-io-meta">{count} file{count !== 1 ? "s" : ""} found</span>
          <pre className="tool-io-results">{trimLines(output, 15)}</pre>
        </div>
      );
    }
    case "web_fetch":
    case "web_search":
    case "codebase_search": {
      return <pre className="tool-io-block">{trimLines(output, 12)}</pre>;
    }
    case "todo": {
      return <TodoOutputRenderer output={output} />;
    }
    default:
      return <pre className="tool-io-block">{trimLines(output, 12)}</pre>;
  }
}

// ── Main Component ───────────────────────────────────

const ToolCallBubbleInner: React.FC<ToolCallBubbleProps> = ({ entry }) => {
  const isTodo = entry.name === "todo";
  const [expanded, setExpanded] = useState(isTodo);
  const vscode = useVsCode();
  const toggle = useCallback(() => setExpanded(p => !p), []);

  const config = TOOL_CONFIG[entry.name] || { label: entry.name, icon: <ToolSvg d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1.51-1" /> };
  const isRunning = entry.kind === "call";
  const isShell = entry.name === "shell_exec" || entry.name === "file_run";
  const statusClass = isRunning ? "running" : entry.isError ? "error" : "success";
  const statusIcon = isRunning ? "" : entry.isError ? "✗" : "✓";

  // Auto-expand shell tools when streaming output arrives
  // Auto-expand todo tools always (so checklist is visible)
  const autoExpandedRef = useRef(false);
  useEffect(() => {
    if (isShell && isRunning && entry.output && !autoExpandedRef.current) {
      autoExpandedRef.current = true;
      setExpanded(true);
    }
    if (isTodo && !autoExpandedRef.current) {
      autoExpandedRef.current = true;
      setExpanded(true);
    }
  }, [isShell, isTodo, isRunning, entry.output]);

  const description = useMemo(
    () => getToolDescription(entry.name, entry.input, entry.description),
    [entry.name, entry.input, entry.description]
  );

  const parsed = useMemo(() => parseInput(entry.input), [entry.input]);

  const openFile = useCallback((fp: string, e: React.MouseEvent) => {
    e.stopPropagation();
    vscode.postMessage({ type: "command", command: "openFile", args: [fp] } as any);
  }, [vscode]);

  // Output summary for collapsed view
  const outputSummary = useMemo(() => {
    if (isRunning) return "";
    return getOutputSummary(entry.name, entry.output, entry.isError);
  }, [entry.name, entry.output, entry.isError, isRunning]);

  return (
    <div className={`tool-step ${expanded ? "expanded" : ""}`}>
      {/* Header — always visible */}
      <div className="tool-step-header" onClick={toggle}>
        <span className="tool-step-chevron">▸</span>
        <span className={`tool-step-icon ${statusClass}`}>
          {isRunning ? <span className="tool-spinner" /> : statusIcon}
        </span>
        <span className="tool-step-name">{config.label}</span>
        {isShell && isRunning && (
          <span className="tool-mode-badge">Running</span>
        )}
        <span className="tool-step-summary">
          <span className={`tool-step-desc ${isRunning ? "tool-shimmer" : ""}`}>{description}</span>
          {outputSummary && (
            <>
              <span className="tool-arrow"> → </span>
              <span className={`tool-output-hint ${entry.isError ? "tool-output-hint-error" : ""}`}>
                {outputSummary}
              </span>
            </>
          )}
        </span>
      </div>

      {/* Expanded detail */}
      {expanded && isTodo && entry.output && (
        // Todo: show checklist directly, no IN/OUT badges
        <div className="tool-step-detail">
          {renderToolOutput(entry.name, entry.output, entry.isError, openFile)}
        </div>
      )}
      {expanded && !isTodo && (
        <div className="tool-step-detail">
          {entry.input && (
            <div className="tool-io-section">
              <div className="tool-io-header">
                <span className="tool-io-badge tool-io-badge-in">IN</span>
              </div>
              {renderToolInput(entry.name, parsed, openFile)}
            </div>
          )}
          {(entry.output || !isRunning) ? (
            <div className="tool-io-section">
              <div className="tool-io-header">
                <span className={`tool-io-badge ${entry.isError ? "tool-io-badge-error" : "tool-io-badge-out"}`}>
                  {entry.isError ? "ERROR" : "OUT"}
                </span>
              </div>
              {renderToolOutput(entry.name, entry.output, entry.isError, openFile)}
            </div>
          ) : isRunning && isShell ? (
            <div className="tool-io-section tool-io-running">
              {entry.output ? (
                <pre className="tool-io-block tool-io-streaming">{trimLines(entry.output, 20)}<span className="tool-terminal-cursor-inline" /></pre>
              ) : (
                <div className="tool-terminal-running">
                  <span className="tool-terminal-cursor" />
                  <span className="tool-terminal-text">Executing command...</span>
                </div>
              )}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
};

export const ToolCallBubble = React.memo(ToolCallBubbleInner, (prev, next) => {
  return prev.entry.id === next.entry.id
    && prev.entry.kind === next.entry.kind
    && prev.entry.output === next.entry.output;
});

// ── Todo Renderer (Claude Code style) ────────────────

const TodoOutputRenderer: React.FC<{ output: string }> = ({ output }) => {
  // Split on ---TODO_STATE--- marker to get action result + full checklist
  const parts = output.split("---TODO_STATE---");
  const actionResult = parts[0]?.trim() || "";
  const todoState = parts[1]?.trim() || "";

  // No todo state — just show the action result
  if (!todoState) {
    return <div className="tool-io-block tool-todo-result">{actionResult}</div>;
  }

  // Parse checklist lines from the todo state
  const lines = todoState.split("\n").filter(l => l.trim());
  const items = lines.filter(l => /\[[ x~!-]\]/.test(l)).map((line) => {
    const indent = line.match(/^(\s*)/)?.[1]?.length || 0;
    const isCompleted = /\[x\]/.test(line);
    const isInProgress = /\[~\]/.test(line);
    const isBlocked = /\[!\]/.test(line);
    // Remove checkbox and #id prefix to get clean task name
    const text = line.replace(/^\s*\[[ x~!-]\]\s*#\d+\s*/, "").trim();
    const subtaskMatch = line.match(/\((\d+) subtasks?\)/);
    const subtaskCount = subtaskMatch ? parseInt(subtaskMatch[1]) : 0;

    return { indent, isCompleted, isInProgress, isBlocked, text, subtaskCount };
  });

  const summaryLine = lines.find(l => l.startsWith("Summary:"));

  return (
    <div className="tool-todo-checklist">
      {items.map((item, i) => (
        <div
          key={i}
          className={`tool-todo-item ${item.isCompleted ? "completed" : ""} ${item.isInProgress ? "in-progress" : ""} ${item.isBlocked ? "blocked" : ""}`}
          style={{ paddingLeft: `${8 + (item.indent > 0 ? 20 : 0)}px` }}
        >
          <span className="tool-todo-checkbox">
            {item.isCompleted ? "✓" : item.isInProgress ? "◉" : item.isBlocked ? "⊘" : "○"}
          </span>
          <span className="tool-todo-text">{item.text}</span>
          {item.subtaskCount > 0 && (
            <span className="tool-todo-subtask-count"> ({item.subtaskCount})</span>
          )}
        </div>
      ))}
      {summaryLine && (
        <div className="tool-todo-summary">{summaryLine}</div>
      )}
    </div>
  );
};

// ── Helper Components ────────────────────────────────

const DefaultInputRenderer: React.FC<{
  parsed: Record<string, unknown>;
  onOpenFile: (path: string, e: React.MouseEvent) => void;
}> = ({ parsed, onOpenFile }) => {
  const entries = Object.entries(parsed);
  if (entries.length === 0) return null;

  return (
    <div className="tool-io-block">
      {entries.map(([key, value]) => {
        const isPath = (key === "file_path" || key === "path") && typeof value === "string";
        const strValue = typeof value === "string" ? value : JSON.stringify(value);
        return (
          <div key={key} className="tool-input-row">
            <span className="tool-io-label">{key}: </span>
            {isPath ? (
              <span className="tool-file-link" onClick={(e) => onOpenFile(value as string, e)}>{value as string}</span>
            ) : (
              <span>{trim(strValue, 200)}</span>
            )}
          </div>
        );
      })}
    </div>
  );
};

// ── Diff Renderer ────────────────────────────────────

function hasDiff(output: string): boolean {
  return output.includes("--- ") && output.includes("+++ ") && output.includes("@@ ");
}

const DiffRenderer: React.FC<{
  output: string;
  onOpenFile?: (fp: string, e: React.MouseEvent) => void;
}> = ({ output, onOpenFile }) => {
  const lines = output.split("\n");
  const diffStart = lines.findIndex(l => l.startsWith("--- "));
  const summary = diffStart > 0 ? lines.slice(0, diffStart).join("\n").trim() : "";
  const diffLines = diffStart >= 0 ? lines.slice(diffStart) : [];
  const fileMatch = diffLines.find(l => l.startsWith("+++ "));
  const filePath = fileMatch?.replace("+++ b/", "").replace("+++ ", "") || "";

  return (
    <div className="tool-diff-container">
      {summary && <div className="tool-diff-summary">{summary}</div>}
      <div className="tool-diff">
        {diffLines.slice(0, 40).map((line, i) => {
          let cls = "diff-line";
          if (line.startsWith("+") && !line.startsWith("+++")) cls += " diff-add";
          else if (line.startsWith("-") && !line.startsWith("---")) cls += " diff-remove";
          else if (line.startsWith("@@")) cls += " diff-hunk";
          else if (line.startsWith("---") || line.startsWith("+++")) cls += " diff-header";
          return <div key={i} className={cls}>{line}</div>;
        })}
        {diffLines.length > 40 && (
          <div className="diff-line tool-io-meta">… {diffLines.length - 40} more lines</div>
        )}
      </div>
      {filePath && onOpenFile && (
        <button className="tool-diff-open-btn" onClick={(e) => onOpenFile(filePath, e)}>
          Open {shortPath(filePath)}
        </button>
      )}
    </div>
  );
};

// ── Output Summary (for collapsed header) ────────────

function getOutputSummary(name: string, output: string, isError?: boolean): string {
  if (!output) return "";
  if (isError) return trim(output.split("\n")[0] || "Error", 50);

  switch (name) {
    case "shell_exec":
      if (!output.trim()) return "(no output)";
      return trim(output.split("\n")[0], 50) + (output.split("\n").length > 1 ? ` (${output.split("\n").length} lines)` : "");
    case "file_read":
      return `${output.split("\n").length} lines`;
    case "file_write":
    case "file_edit":
    case "multi_edit":
    case "ast_edit":
      return trim(output.split("\n")[0] || "done", 50);
    case "grep_search":
    case "glob_search": {
      const count = output.split("\n").filter(l => l.trim()).length;
      return `${count} result${count !== 1 ? "s" : ""}`;
    }
    default: {
      const firstLine = output.split("\n")[0] || "";
      const lineCount = output.split("\n").length;
      if (lineCount > 1) return `${trim(firstLine, 40)} (${lineCount} lines)`;
      return trim(firstLine, 50);
    }
  }
}

// ── Utilities ────────────────────────────────────────

function trim(s: string, max: number): string {
  return s.length > max ? s.substring(0, max) + "…" : s;
}

function trimLines(text: string, maxLines: number): string {
  const lines = text.split("\n");
  if (lines.length <= maxLines) return text || "(empty)";
  return lines.slice(0, maxLines).join("\n") + `\n… (${lines.length - maxLines} more lines)`;
}

function shortPath(fullPath: string): string {
  if (!fullPath) return "";
  // Show last 2-3 segments for readability
  const parts = fullPath.replace(/\\/g, "/").split("/");
  if (parts.length <= 3) return fullPath;
  return "…/" + parts.slice(-3).join("/");
}
