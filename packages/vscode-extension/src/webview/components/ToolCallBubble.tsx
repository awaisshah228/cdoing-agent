/**
 * ToolCallBubble.tsx — Collapsible Tool Step (Memoized, Specialized UIs)
 *
 * Different tool types get specialized renderers:
 *   - File tools: clickable path, diff indicator
 *   - Shell: monospace command preview
 *   - Search: pattern + result count
 *   - Web: URL preview
 */

import React, { useState, useCallback, useMemo } from "react";
import type { ToolCallEntry } from "../types";
import { useVsCode } from "../hooks/useVsCode";

interface ToolCallBubbleProps {
  entry: ToolCallEntry;
}

const TOOL_CONFIG: Record<string, { label: string; icon: string }> = {
  file_read: { label: "Read", icon: "📄" },
  file_write: { label: "Write", icon: "📝" },
  file_edit: { label: "Edit", icon: "✏️" },
  glob_search: { label: "Search files", icon: "🔍" },
  grep_search: { label: "Search code", icon: "🔎" },
  shell_exec: { label: "Run", icon: "⚡" },
  file_run: { label: "Execute", icon: "▶" },
  web_fetch: { label: "Fetch", icon: "🌐" },
  web_search: { label: "Search web", icon: "🔍" },
  sub_agent: { label: "Sub-agent", icon: "🤖" },
};

function parseInput(detail: string): Record<string, unknown> {
  try { return JSON.parse(detail); } catch { return {}; }
}

const ToolCallBubbleInner: React.FC<ToolCallBubbleProps> = ({ entry }) => {
  const [expanded, setExpanded] = useState(false);
  const vscode = useVsCode();
  const toggle = useCallback(() => setExpanded((p) => !p), []);

  const config = TOOL_CONFIG[entry.name] || { label: entry.name, icon: "⚙️" };
  const parsed = useMemo(() => entry.kind === "call" ? parseInput(entry.detail) : {}, [entry.detail, entry.kind]);
  const statusClass = entry.kind === "call" ? "running" : entry.isError ? "error" : "success";
  const statusIcon = entry.kind === "call" ? "⏳" : entry.isError ? "✗" : "✓";

  const openFile = useCallback((filePath: string, e: React.MouseEvent) => {
    e.stopPropagation();
    vscode.postMessage({ type: "command", command: "openFile", args: [filePath] } as any);
  }, [vscode]);

  // Specialized summary based on tool type
  const summary = useMemo(() => {
    if (entry.kind === "result") {
      const lines = entry.detail.split("\n");
      const firstLine = lines[0] || "";
      const lineCount = lines.length;
      if (entry.name === "grep_search" || entry.name === "glob_search") {
        return `${lineCount} result${lineCount !== 1 ? "s" : ""}`;
      }
      if (entry.name === "file_edit" || entry.name === "file_write") {
        return entry.isError ? firstLine.substring(0, 80) : "Done";
      }
      return firstLine.substring(0, 100);
    }

    const p = parsed as Record<string, unknown>;
    const filePath = (p.file_path || p.path) as string | undefined;
    const command = p.command as string | undefined;

    if (filePath) {
      return (
        <span className="tool-file-link" onClick={(e) => openFile(filePath, e)} title={`Open ${filePath}`}>
          {filePath}
        </span>
      );
    }
    if (command) return <span className="tool-command">$ {String(command).substring(0, 80)}</span>;
    if (p.pattern) return <span className="tool-command">{String(p.pattern)}</span>;
    if (p.url) return String(p.url).substring(0, 60);
    if (p.query) return String(p.query);
    if (p.task) return String(p.task).substring(0, 60);
    return entry.detail.substring(0, 80);
  }, [entry, parsed, openFile]);

  return (
    <div className={`tool-step ${expanded ? "expanded" : ""}`}>
      <div className="tool-step-header" onClick={toggle}>
        <span className="tool-step-chevron">▸</span>
        <span className={`tool-step-icon ${statusClass}`}>{statusIcon}</span>
        <span className="tool-step-name">{config.label}</span>
        <span className="tool-step-summary">{summary}</span>
      </div>
      {expanded && (
        <div className="tool-step-detail">
          {entry.kind === "call" ? (
            <ToolInputDetail raw={parsed as Record<string, unknown>} toolName={entry.name} onOpenFile={openFile} />
          ) : (
            <ToolOutputDetail output={entry.detail} isError={entry.isError} toolName={entry.name} />
          )}
        </div>
      )}
    </div>
  );
};

export const ToolCallBubble = React.memo(ToolCallBubbleInner, (prev, next) => {
  return prev.entry.id === next.entry.id && prev.entry.detail === next.entry.detail;
});

// ── Specialized Detail Components ────────────────────

/** Structured input display */
const ToolInputDetail: React.FC<{
  raw: Record<string, unknown>;
  toolName: string;
  onOpenFile: (path: string, e: React.MouseEvent) => void;
}> = ({ raw, toolName, onOpenFile }) => {
  const entries = Object.entries(raw);
  if (entries.length === 0) return <span className="tool-empty">No input</span>;

  return (
    <div className="tool-input-grid">
      {entries.map(([key, value]) => {
        const isPath = (key === "file_path" || key === "path") && typeof value === "string";
        const isLongValue = typeof value === "string" && value.length > 300;
        const displayValue = isLongValue ? (value as string).substring(0, 300) + "..." : String(value);

        return (
          <div key={key} className="tool-input-row">
            <span className="tool-input-key">{key}:</span>
            <span className="tool-input-value">
              {isPath ? (
                <span className="tool-file-link" onClick={(e) => onOpenFile(value as string, e)}>
                  {value as string}
                </span>
              ) : (
                displayValue
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
};

/** Formatted output with specialized rendering per tool */
const ToolOutputDetail: React.FC<{
  output: string;
  isError?: boolean;
  toolName: string;
}> = ({ output, isError, toolName }) => {
  const lines = output.split("\n");
  const maxLines = 30;
  const truncated = lines.length > maxLines;
  const displayText = truncated
    ? lines.slice(0, maxLines).join("\n") + `\n\n... (${lines.length - maxLines} more lines)`
    : output;

  return (
    <pre className={`tool-output ${isError ? "tool-output-error" : ""}`}>
      {displayText || "(empty)"}
    </pre>
  );
};
