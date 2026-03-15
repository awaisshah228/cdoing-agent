import React from "react";
import { Box, Text } from "ink";
import type { UsageInfo, ContextUsage } from "./types";

interface StatusBarProps {
  provider: string;
  model: string;
  mode: string;
  workingDir: string;
  isProcessing: boolean;
  lastUsage: UsageInfo | null;
  queueLength: number;
  contextUsage?: ContextUsage | null;
  backgroundJobs?: number;
}

/** Render a mini progress bar: ████░░ */
function contextBar(percent: number, width = 8): string {
  const filled = Math.round((percent / 100) * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

function contextColor(percent: number): string {
  if (percent >= 90) return "red";
  if (percent >= 75) return "yellow";
  return "green";
}

export const StatusBar: React.FC<StatusBarProps> = ({
  provider,
  model,
  mode,
  workingDir,
  isProcessing,
  lastUsage,
  queueLength,
  contextUsage,
  backgroundJobs = 0,
}) => {
  const dir = workingDir.replace(process.env.HOME || "", "~");
  const modelDisplay = model || "(default)";
  const modeColor =
    mode === "auto" ? "green" : mode === "auto-edit" ? "yellow" : "blue";
  const hasUsage = !!lastUsage;
  const usageText = hasUsage
    ? ` · ${lastUsage!.totalTokens.toLocaleString()} tokens` +
      (lastUsage!.cost !== undefined ? ` · $${lastUsage!.cost.toFixed(4)}` : "")
    : "";

  const ctxPercent = contextUsage?.percent ?? null;

  return (
    <Box
      borderStyle="single"
      borderColor="gray"
      paddingLeft={1}
      paddingRight={1}
      justifyContent="space-between"
    >
      {/* Left side */}
      <Box>
        <Text color="cyan">{provider}</Text>
        <Text color="gray"> · </Text>
        <Text color="white">{modelDisplay}</Text>
        <Text color="gray"> · </Text>
        <Text color={modeColor}>{mode}</Text>

        {/* Context window usage bar */}
        {ctxPercent !== null ? (
          <>
            <Text color="gray"> · </Text>
            <Text color={contextColor(ctxPercent)}>
              {contextBar(ctxPercent)}
            </Text>
            <Text color={contextColor(ctxPercent) as "red" | "yellow" | "green"}>
              {` ${Math.round(ctxPercent)}%`}
            </Text>
          </>
        ) : null}

        {/* Background jobs indicator */}
        {backgroundJobs > 0 ? (
          <Text color="magenta">{` · ⚡${backgroundJobs} bg`}</Text>
        ) : null}

        {queueLength > 0 ? (
          <Text color="yellow"> · {queueLength} queued</Text>
        ) : null}
      </Box>

      {/* Right side */}
      <Box>
        <Text color="gray">{dir}</Text>
        {isProcessing ? (
          <Text color="yellow"> · processing…</Text>
        ) : null}
        {hasUsage ? (
          <Text color="gray" dimColor>{usageText}</Text>
        ) : null}
        <Text color="gray" dimColor>{"  ?=/help  ESC=cancel  ^C^C=exit"}</Text>
      </Box>
    </Box>
  );
};
