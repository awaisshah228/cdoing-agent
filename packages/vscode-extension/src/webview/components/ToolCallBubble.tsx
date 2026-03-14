/**
 * ToolCallBubble.tsx — Tool Invocation Display
 *
 * Shows when the agent calls a tool (like file_read or shell_exec) and its result.
 * Two states:
 *   - kind="call"   → shows lightning icon + tool name + input args
 *   - kind="result" → shows check/cross icon + tool name + output preview
 *
 * CSS classes "success" and "error" add colored left borders.
 */

import React from "react";
import type { ToolCallEntry } from "../types";

interface ToolCallBubbleProps {
  entry: ToolCallEntry;
}

export const ToolCallBubble: React.FC<ToolCallBubbleProps> = ({ entry }) => {
  // Determine CSS class: "success" for green border, "error" for red border
  const statusClass = entry.kind === "result" ? (entry.isError ? "error" : "success") : "";
  // Pick icon: lightning for invocation, check/cross for result
  const icon = entry.kind === "result" ? (entry.isError ? "\u2717" : "\u2713") : "\u26A1";

  return (
    <div className={`tool-call ${statusClass}`}>
      <span className="tool-name">
        {icon} {entry.name}
      </span>
      {/* Show truncated input args or output result */}
      <div className="tool-preview">{entry.detail}</div>
    </div>
  );
};
