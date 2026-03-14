/**
 * ToolCallBubble.tsx — Collapsible Tool Step (Claude Code style)
 *
 * Shows tool calls as collapsible rows with:
 *   - Chevron for expand/collapse
 *   - Status icon (running/success/error)
 *   - Tool name + file path/command summary
 *   - Clickable file paths that open in the editor
 *   - Expandable detail section with formatted output
 */

import React, { useState, useCallback, useMemo } from "react";
import type { ToolCallEntry } from "../types";
import { useVsCode } from "../hooks/useVsCode";

interface ToolCallBubbleProps {
  entry: ToolCallEntry;
}

/** Tool display config */
const TOOL_CONFIG: Record<string, { label: string; icon: string }> = {
  file_read: { label: "Read", icon: "📄" },
  file_write: { label: "Write", icon: "✏️" },
  file_edit: { label: "Edit", icon: "✏️" },
  glob_search: { label: "Search files", icon: "🔍" },
  grep_search: { label: "Search code", icon: "🔍" },
  shell_exec: { label: "Run command", icon: "⚡" },
  file_run: { label: "Run file", icon: "▶️" },
  web_fetch: { label: "Fetch URL", icon: "🌐" },
  web_search: { label: "Web search", icon: "🌐" },
};

/** Parse tool input JSON to extract key info */
function parseInput(detail: string): { filePath?: string; command?: string; summary: string; raw: Record<string, unknown> } {
  try {
    const parsed = JSON.parse(detail);
    return {
      filePath: parsed.file_path || parsed.path,
      command: parsed.command,
      summary: parsed.file_path || parsed.path || parsed.pattern || parsed.command?.substring(0, 80) || parsed.url || parsed.query || detail.substring(0, 80),
      raw: parsed,
    };
  } catch {
    return { summary: detail.substring(0, 80), raw: {} };
  }
}

/** Format tool result for display */
function formatResult(detail: string, maxLines: number = 20): string {
  const lines = detail.split("\n");
  if (lines.length <= maxLines) return detail;
  return lines.slice(0, maxLines).join("\n") + `\n... (${lines.length - maxLines} more lines)`;
}

export const ToolCallBubble: React.FC<ToolCallBubbleProps> = ({ entry }) => {
  const [expanded, setExpanded] = useState(false);
  const vscode = useVsCode();

  const toggle = useCallback(() => setExpanded((prev) => !prev), []);

  const config = TOOL_CONFIG[entry.name] || { label: entry.name, icon: "⚙️" };

  const parsed = useMemo(() => {
    if (entry.kind === "call") return parseInput(entry.detail);
    return { summary: "", raw: {} };
  }, [entry.detail, entry.kind]);

  const statusClass = entry.kind === "call" ? "running" : entry.isError ? "error" : "success";
  const statusIcon = entry.kind === "call" ? "⏳" : entry.isError ? "✗" : "✓";

  /** Open a file path in the editor */
  const handleFileClick = useCallback((filePath: string, e: React.MouseEvent) => {
    e.stopPropagation();
    // Send command to extension host to open the file
    vscode.postMessage({ type: "command", command: "openFile", args: [filePath] } as any);
  }, [vscode]);

  // Build the summary line
  const summaryContent = useMemo(() => {
    if (entry.kind === "result") {
      const firstLine = entry.detail.split("\n")[0] || "";
      return firstLine.substring(0, 100);
    }

    // For calls, show clickable file path or command
    if (parsed.filePath) {
      return (
        <span
          className="tool-file-link"
          onClick={(e) => handleFileClick(parsed.filePath!, e)}
          title={`Open ${parsed.filePath}`}
        >
          {parsed.filePath}
        </span>
      );
    }
    if (parsed.command) {
      return <span className="tool-command">{parsed.command.substring(0, 80)}</span>;
    }
    return parsed.summary;
  }, [entry, parsed, handleFileClick]);

  return (
    <div className={`tool-step ${expanded ? "expanded" : ""}`}>
      <div className="tool-step-header" onClick={toggle}>
        <span className="tool-step-chevron">▸</span>
        <span className={`tool-step-icon ${statusClass}`}>
          {statusIcon}
        </span>
        <span className="tool-step-name">
          {config.label}
        </span>
        <span className="tool-step-summary">
          {typeof summaryContent === "string" ? summaryContent : summaryContent}
        </span>
      </div>
      {expanded && (
        <div className="tool-step-detail">
          {entry.kind === "call" ? (
            <ToolInputDetail raw={parsed.raw} />
          ) : (
            <ToolOutputDetail output={entry.detail} isError={entry.isError} />
          )}
        </div>
      )}
    </div>
  );
};

/** Formatted tool input display */
const ToolInputDetail: React.FC<{ raw: Record<string, unknown> }> = ({ raw }) => {
  const entries = Object.entries(raw);
  if (entries.length === 0) return <span className="tool-empty">No input</span>;

  return (
    <div className="tool-input-grid">
      {entries.map(([key, value]) => (
        <div key={key} className="tool-input-row">
          <span className="tool-input-key">{key}:</span>
          <span className="tool-input-value">
            {typeof value === "string" && value.length > 200
              ? value.substring(0, 200) + "..."
              : String(value)}
          </span>
        </div>
      ))}
    </div>
  );
};

/** Formatted tool output display */
const ToolOutputDetail: React.FC<{ output: string; isError?: boolean }> = ({ output, isError }) => {
  const formatted = formatResult(output);
  return (
    <pre className={`tool-output ${isError ? "tool-output-error" : ""}`}>
      {formatted || "(empty)"}
    </pre>
  );
};
