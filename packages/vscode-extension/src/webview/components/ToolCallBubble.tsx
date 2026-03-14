/**
 * ToolCallBubble.tsx — Merged Tool Step (Claude Code style)
 *
 * Each tool step shows:
 *   Collapsed: [icon] ToolName  input-summary → output-summary
 *   Expanded:  Full input + full output (with diff rendering for file edits)
 */

import React, { useState, useCallback, useMemo } from "react";
import type { ToolCallEntry } from "../types";
import { useVsCode } from "../hooks/useVsCode";

interface ToolCallBubbleProps {
  entry: ToolCallEntry;
}

const TOOL_CONFIG: Record<string, { label: string }> = {
  file_read: { label: "Read" },
  file_write: { label: "Write" },
  file_edit: { label: "Edit" },
  glob_search: { label: "Search files" },
  grep_search: { label: "Search code" },
  shell_exec: { label: "Run" },
  file_run: { label: "Execute" },
  web_fetch: { label: "Fetch" },
  web_search: { label: "Search web" },
  sub_agent: { label: "Sub-agent" },
};

function parseInput(detail: string): Record<string, unknown> {
  try { return JSON.parse(detail); } catch { return {}; }
}

/** Get a short summary of the input */
function getInputSummary(name: string, input: string): string {
  const p = parseInput(input);
  if (p.file_path) return String(p.file_path);
  if (p.path) return String(p.path);
  if (p.command) return `$ ${String(p.command).substring(0, 60)}`;
  if (p.pattern) return String(p.pattern);
  if (p.url) return String(p.url).substring(0, 50);
  if (p.query) return String(p.query);
  if (p.task) return String(p.task).substring(0, 50);
  return input.substring(0, 60);
}

/** Get a short summary of the output */
function getOutputSummary(name: string, output: string, isError?: boolean): string {
  if (!output) return "";
  if (isError) {
    const firstLine = output.split("\n")[0] || "Error";
    return firstLine.substring(0, 60);
  }
  // File ops
  if (name === "file_edit" || name === "file_write") {
    const firstLine = output.split("\n")[0] || "";
    return firstLine.substring(0, 60);
  }
  // Search — count results
  if (name === "grep_search" || name === "glob_search") {
    const lines = output.split("\n").filter((l) => l.trim());
    return `${lines.length} result${lines.length !== 1 ? "s" : ""}`;
  }
  // Shell — first meaningful line
  const lines = output.split("\n");
  const firstLine = lines[0] || "";
  if (lines.length > 1) return `${firstLine.substring(0, 50)}… (${lines.length} lines)`;
  return firstLine.substring(0, 60);
}

const ToolCallBubbleInner: React.FC<ToolCallBubbleProps> = ({ entry }) => {
  const [expanded, setExpanded] = useState(false);
  const vscode = useVsCode();
  const toggle = useCallback(() => setExpanded((p) => !p), []);

  const config = TOOL_CONFIG[entry.name] || { label: entry.name };
  const isRunning = entry.kind === "call";
  const statusClass = isRunning ? "running" : entry.isError ? "error" : "success";
  const statusIcon = isRunning ? "⏳" : entry.isError ? "✗" : "✓";

  const inputSummary = useMemo(() => getInputSummary(entry.name, entry.input), [entry.name, entry.input]);
  const outputSummary = useMemo(() =>
    isRunning ? "" : getOutputSummary(entry.name, entry.output, entry.isError),
    [entry.name, entry.output, entry.isError, isRunning]
  );

  const parsed = useMemo(() => parseInput(entry.input), [entry.input]);
  const filePath = (parsed.file_path || parsed.path) as string | undefined;

  const openFile = useCallback((fp: string, e: React.MouseEvent) => {
    e.stopPropagation();
    vscode.postMessage({ type: "command", command: "openFile", args: [fp] } as any);
  }, [vscode]);

  return (
    <div className={`tool-step ${expanded ? "expanded" : ""}`}>
      {/* Header — always visible */}
      <div className="tool-step-header" onClick={toggle}>
        <span className="tool-step-chevron">▸</span>
        <span className={`tool-step-icon ${statusClass}`}>{statusIcon}</span>
        <span className="tool-step-name">{config.label}</span>
        <span className="tool-step-summary">
          {/* Input summary */}
          {filePath ? (
            <span className="tool-file-link" onClick={(e) => openFile(filePath, e)}>{filePath}</span>
          ) : (
            <span className="tool-input-hint">{inputSummary}</span>
          )}
          {/* Arrow + output summary */}
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

      {/* Expanded detail — input + output */}
      {expanded && (
        <div className="tool-step-detail">
          {/* Input section */}
          {entry.input && (
            <div className="tool-section">
              <div className="tool-section-label">INPUT</div>
              <ToolInputDetail raw={parsed} onOpenFile={openFile} />
            </div>
          )}
          {/* Output section */}
          {entry.output && (
            <div className="tool-section">
              <div className="tool-section-label">OUTPUT</div>
              <ToolOutputDetail output={entry.output} isError={entry.isError} toolName={entry.name} />
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

// ── Sub-components ───────────────────────────────────

const ToolInputDetail: React.FC<{
  raw: Record<string, unknown>;
  onOpenFile: (path: string, e: React.MouseEvent) => void;
}> = ({ raw, onOpenFile }) => {
  const entries = Object.entries(raw);
  if (entries.length === 0) return null;

  return (
    <div className="tool-input-grid">
      {entries.map(([key, value]) => {
        const isPath = (key === "file_path" || key === "path") && typeof value === "string";
        const strValue = typeof value === "string" ? value : JSON.stringify(value);
        const isLong = strValue.length > 200;

        return (
          <div key={key} className="tool-input-row">
            <span className="tool-input-key">{key}:</span>
            <span className="tool-input-value">
              {isPath ? (
                <span className="tool-file-link" onClick={(e) => onOpenFile(value as string, e)}>{value as string}</span>
              ) : (
                isLong ? strValue.substring(0, 200) + "…" : strValue
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
};

/** Check if output contains a unified diff */
function hasDiff(output: string): boolean {
  return output.includes("--- ") && output.includes("+++ ") && output.includes("@@ ");
}

function parseDiffOutput(output: string): { summary: string; diffLines: string[] } {
  const lines = output.split("\n");
  const diffStart = lines.findIndex((l) => l.startsWith("--- "));
  if (diffStart === -1) return { summary: output, diffLines: [] };
  return { summary: lines.slice(0, diffStart).join("\n").trim(), diffLines: lines.slice(diffStart) };
}

const ToolOutputDetail: React.FC<{
  output: string;
  isError?: boolean;
  toolName: string;
}> = ({ output, isError, toolName }) => {
  const vscode = useVsCode();
  const isDiffTool = (toolName === "file_edit" || toolName === "file_write") && hasDiff(output);

  if (isError) {
    return <pre className="tool-output tool-output-error">{truncateText(output, 40)}</pre>;
  }

  if (isDiffTool) {
    const { summary, diffLines } = parseDiffOutput(output);
    const filePathMatch = diffLines.find((l) => l.startsWith("+++ "));
    const filePath = filePathMatch?.replace("+++ b/", "").replace("+++ ", "") || "";

    return (
      <div className="tool-diff-container">
        {summary && <div className="tool-diff-summary">{summary}</div>}
        <div className="tool-diff">
          {diffLines.map((line, i) => {
            let cls = "diff-line";
            if (line.startsWith("+") && !line.startsWith("+++")) cls += " diff-add";
            else if (line.startsWith("-") && !line.startsWith("---")) cls += " diff-remove";
            else if (line.startsWith("@@")) cls += " diff-hunk";
            else if (line.startsWith("---") || line.startsWith("+++")) cls += " diff-header";
            return <div key={i} className={cls}>{line}</div>;
          })}
        </div>
        {filePath && (
          <button className="tool-diff-open-btn" onClick={() => {
            vscode.postMessage({ type: "command", command: "openFile", args: [filePath] } as any);
          }}>
            Open {filePath}
          </button>
        )}
      </div>
    );
  }

  return <pre className="tool-output">{truncateText(output, 40)}</pre>;
};

function truncateText(text: string, maxLines: number): string {
  const lines = text.split("\n");
  if (lines.length <= maxLines) return text || "(empty)";
  return lines.slice(0, maxLines).join("\n") + `\n\n… (${lines.length - maxLines} more lines)`;
}
