import React, { useState, useEffect } from "react";
import { Box, Text } from "ink";

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
  color = "yellow",
  startTime,
}) => {
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
      <Text color={color as any}>{label}</Text>
      <Text color={color as any}>{DOT_FRAMES[dotFrame]}</Text>
      <Text color="gray" dimColor>{elapsedStr}</Text>
    </Box>
  );
};

interface ToolSpinnerProps {
  name: string;
  preview: string;
  status: "running" | "done" | "error";
}

const TOOL_ICONS: Record<string, string> = {
  file_read:   "📖",
  file_write:  "✏️ ",
  file_edit:   "🔧",
  glob_search: "🔍",
  grep_search: "🔎",
  shell_exec:  "💻",
  web_fetch:   "🌐",
  web_search:  "🔮",
  sub_agent:   "🤖",
  todo:        "📋",
};

export const ToolSpinner: React.FC<ToolSpinnerProps> = ({ name, preview, status }) => {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    if (status !== "running") return;
    const id = setInterval(() => setFrame((f) => (f + 1) % FRAMES.length), INTERVAL_MS);
    return () => clearInterval(id);
  }, [status]);

  const icon = TOOL_ICONS[name] || "⚡";
  const spinner = status === "running" ? FRAMES[frame] + " " : "";
  const color =
    status === "error" ? "red" : status === "done" ? "green" : "yellow";
  const statusMark =
    status === "done" ? "✓ " : status === "error" ? "✗ " : spinner;

  return (
    <Box paddingLeft={2}>
      <Text color={color as any}>{statusMark}{icon} </Text>
      <Text color={color as any}>{name}</Text>
      {preview ? <Text color="gray" dimColor>{"  " + preview.slice(0, 55)}</Text> : null}
    </Box>
  );
};
