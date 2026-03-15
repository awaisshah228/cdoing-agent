import React, { useState, useEffect } from "react";
import { Box, Text } from "ink";
import { getTheme } from "./theme";

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const INTERVAL_MS = 80;

// Blinking dot frames: pulsing dots for "thinking"
const DOT_FRAMES = ["   ", "·  ", "·· ", "···", " ··", "  ·", "   "];
const DOT_INTERVAL_MS = 200;

interface SpinnerProps {
  label: string;
  color?: string;
  startTime?: number; // show elapsed time if provided
}

export const Spinner: React.FC<SpinnerProps> = ({
  label,
  color,
  startTime,
}) => {
  const t = getTheme();
  const spinnerColor = color || t.spinner;
  const [dotFrame, setDotFrame] = useState(0);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setDotFrame((f) => (f + 1) % DOT_FRAMES.length);
      if (startTime) {
        setElapsed(Math.floor((Date.now() - startTime) / 1000));
      }
    }, DOT_INTERVAL_MS);
    return () => clearInterval(id);
  }, [startTime]);

  const elapsedStr = startTime && elapsed > 0 ? ` (${elapsed}s)` : "";

  return (
    <Box paddingLeft={2}>
      <Text color={spinnerColor as any}>{label}</Text>
      <Text color={spinnerColor as any}>{DOT_FRAMES[dotFrame]}</Text>
      <Text color={t.elapsed} dimColor={t.useDim}>{elapsedStr}</Text>
    </Box>
  );
};

interface ToolSpinnerProps {
  name: string;
  preview: string;
  status: "running" | "done" | "error";
}

const TOOL_ICONS: Record<string, string> = {
  file_read:       "📖",
  file_write:      "✏️ ",
  file_edit:       "🔧",
  multi_edit:      "🔧",
  file_delete:     "🗑️",
  ast_edit:        "🌳",
  notebook_edit:   "📓",
  glob_search:     "🔍",
  grep_search:     "🔎",
  codebase_search: "🔎",
  shell_exec:      "💻",
  file_run:        "▶",
  web_fetch:       "🌐",
  web_search:      "🔮",
  sub_agent:       "🤖",
  todo:            "📋",
  list_dir:        "📁",
  view_diff:       "📊",
  view_repo_map:   "🗺️",
  code_verify:     "✅",
  system_info:     "ℹ️",
};

export const ToolSpinner: React.FC<ToolSpinnerProps> = ({ name, preview, status }) => {
  const t = getTheme();
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    if (status !== "running") return;
    const id = setInterval(() => setFrame((f) => (f + 1) % FRAMES.length), INTERVAL_MS);
    return () => clearInterval(id);
  }, [status]);

  const icon = TOOL_ICONS[name] || "⚡";
  const spinner = status === "running" ? FRAMES[frame] + " " : "";
  const color =
    status === "error" ? t.toolError : status === "done" ? t.toolDone : t.toolRunning;
  const statusMark =
    status === "done" ? "✓ " : status === "error" ? "✗ " : spinner;

  return (
    <Box paddingLeft={2}>
      <Text color={color as any}>{statusMark}{icon} </Text>
      <Text color={color as any}>{name}</Text>
      {preview ? <Text color={t.toolPreview} dimColor={t.useDim}>{"  " + preview.slice(0, 55)}</Text> : null}
    </Box>
  );
};
