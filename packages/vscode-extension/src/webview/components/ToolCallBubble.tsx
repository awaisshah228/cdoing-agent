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

import React, { useState, useCallback, useMemo } from "react";
import type { ToolCallEntry } from "../types";
import { useVsCode } from "../hooks/useVsCode";

interface ToolCallBubbleProps {
  entry: ToolCallEntry;
}

// ── Tool Config ──────────────────────────────────────

const TOOL_CONFIG: Record<string, { label: string; icon: string }> = {
  file_read: { label: "Read", icon: "📖" },
  file_write: { label: "Write", icon: "✏️" },
  file_edit: { label: "Edit", icon: "🔧" },
  multi_edit: { label: "MultiEdit", icon: "🔧" },
  file_delete: { label: "Delete", icon: "🗑️" },
  ast_edit: { label: "AST Edit", icon: "🌳" },
  glob_search: { label: "Search files", icon: "🔍" },
  grep_search: { label: "Search code", icon: "🔎" },
  codebase_search: { label: "Codebase search", icon: "🔎" },
  shell_exec: { label: "Bash", icon: "💻" },
  file_run: { label: "Execute", icon: "▶" },
  web_fetch: { label: "Fetch", icon: "🌐" },
  web_search: { label: "Search web", icon: "🔮" },
  sub_agent: { label: "Agent", icon: "🤖" },
  todo: { label: "Todo", icon: "📋" },
  list_dir: { label: "List dir", icon: "📁" },
  view_diff: { label: "Diff", icon: "📊" },
  view_repo_map: { label: "Repo map", icon: "🗺️" },
  code_verify: { label: "Verify", icon: "✅" },
  system_info: { label: "System info", icon: "ℹ️" },
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
    case "file_delete": {
      const path = shortPath(String(p.file_path || p.path || ""));
      return path ? `Delete ${path}` : "Delete file";
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
    default:
      return <pre className="tool-io-block">{trimLines(output, 12)}</pre>;
  }
}

// ── Main Component ───────────────────────────────────

const ToolCallBubbleInner: React.FC<ToolCallBubbleProps> = ({ entry }) => {
  const [expanded, setExpanded] = useState(false);
  const vscode = useVsCode();
  const toggle = useCallback(() => setExpanded(p => !p), []);

  const config = TOOL_CONFIG[entry.name] || { label: entry.name, icon: "⚙️" };
  const isRunning = entry.kind === "call";
  const statusClass = isRunning ? "running" : entry.isError ? "error" : "success";
  const statusIcon = isRunning ? "⏳" : entry.isError ? "✗" : "✓";

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
        <span className={`tool-step-icon ${statusClass}`}>{statusIcon}</span>
        <span className="tool-step-name">{config.label}</span>
        <span className="tool-step-summary">
          <span className="tool-step-desc">{description}</span>
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

      {/* Expanded detail — IN + OUT sections */}
      {expanded && (
        <div className="tool-step-detail">
          {entry.input && (
            <div className="tool-io-section">
              <div className="tool-io-header">
                <span className="tool-io-badge tool-io-badge-in">IN</span>
              </div>
              {renderToolInput(entry.name, parsed, openFile)}
            </div>
          )}
          {(entry.output || !isRunning) && (
            <div className="tool-io-section">
              <div className="tool-io-header">
                <span className="tool-io-badge tool-io-badge-out">OUT</span>
              </div>
              {renderToolOutput(entry.name, entry.output, entry.isError, openFile)}
            </div>
          )}
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
