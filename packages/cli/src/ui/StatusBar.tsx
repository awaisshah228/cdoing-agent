import React from "react";
import { Box, Text } from "ink";
import type { UsageInfo } from "./types";

interface StatusBarProps {
  provider: string;
  model: string;
  mode: string;
  workingDir: string;
  isProcessing: boolean;
  lastUsage: UsageInfo | null;
  queueLength: number;
}

export const StatusBar: React.FC<StatusBarProps> = ({
  provider,
  model,
  mode,
  workingDir,
  isProcessing,
  lastUsage,
  queueLength,
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
