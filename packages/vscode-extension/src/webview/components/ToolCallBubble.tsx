/**
 * ToolCallBubble.tsx — Collapsible Tool Step (Claude Code style)
 *
 * Shows tool calls as collapsible accordion rows with:
 *   - Chevron for expand/collapse
 *   - Status icon (pending/running/success/error)
 *   - Tool name and summary
 *   - Expandable detail section
 */

import React, { useState, useCallback } from "react";
import type { ToolCallEntry } from "../types";

interface ToolCallBubbleProps {
  entry: ToolCallEntry;
}

/** Friendly display names for tool names */
const toolDisplayNames: Record<string, string> = {
  file_read: "Read",
  file_write: "Write",
  file_edit: "Edit",
  glob_search: "Glob",
  grep_search: "Grep",
  shell_exec: "Shell",
  file_run: "Run",
  web_fetch: "Fetch",
  web_search: "Search",
};

function getStatusClass(entry: ToolCallEntry): string {
  if (entry.kind === "call") return "running";
  return entry.isError ? "error" : "success";
}

function getStatusIcon(entry: ToolCallEntry): string {
  if (entry.kind === "call") return "\u25B6"; // play
  return entry.isError ? "\u2717" : "\u2713"; // cross or check
}

function getSummary(entry: ToolCallEntry): string {
  const detail = entry.detail || "";
  // For calls, try to extract a short summary from the JSON input
  if (entry.kind === "call") {
    try {
      const parsed = JSON.parse(detail);
      // Show the most relevant field
      if (parsed.file_path) return parsed.file_path;
      if (parsed.path) return parsed.path;
      if (parsed.pattern) return parsed.pattern;
      if (parsed.command) return parsed.command.substring(0, 80);
      if (parsed.url) return parsed.url;
      if (parsed.query) return parsed.query;
    } catch {
      // not JSON, show truncated
    }
    return detail.substring(0, 80);
  }
  // For results, show first line
  const firstLine = detail.split("\n")[0] || "";
  return firstLine.substring(0, 80);
}

export const ToolCallBubble: React.FC<ToolCallBubbleProps> = ({ entry }) => {
  const [expanded, setExpanded] = useState(false);

  const toggle = useCallback(() => setExpanded((prev) => !prev), []);

  const statusClass = getStatusClass(entry);
  const displayName = toolDisplayNames[entry.name] || entry.name;
  const summary = getSummary(entry);

  return (
    <div className={`tool-step ${expanded ? "expanded" : ""}`}>
      <div className="tool-step-header" onClick={toggle}>
        <span className="tool-step-chevron">{"\u25B8"}</span>
        <span className={`tool-step-icon ${statusClass}`}>
          {getStatusIcon(entry)}
        </span>
        <span className="tool-step-name">{displayName}</span>
        <span className="tool-step-summary">{summary}</span>
      </div>
      <div className="tool-step-detail">{entry.detail}</div>
    </div>
  );
};
