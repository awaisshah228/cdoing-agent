/**
 * StatusBar — Bottom status bar like Continue's BottomStatusBar.
 *
 * Layout: [ModeIndicator • ContextPercentage • cost] [dir • tokens • hints]
 */

import React from "react";
import { Box, Text } from "ink";
import type { UsageInfo, ContextUsage } from "./types";
import { getTheme } from "./theme";
import { ModeIndicator } from "./components/ModeIndicator";
import { ContextPercentageDisplay } from "./components/ContextPercentageDisplay";

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
  const t = getTheme();
  const dir = workingDir.replace(process.env.HOME || "", "~");
  const modelDisplay = model || "(default)";
  const ctxPercent = contextUsage?.percent ?? 0;

  return (
    <Box
      borderStyle="single"
      borderColor={t.border}
      paddingLeft={1}
      paddingRight={1}
      justifyContent="space-between"
    >
      {/* Left side: provider · model · mode · context */}
      <Box>
        <Text color={t.provider}>{provider}</Text>
        <Text color="dim">{" · "}</Text>
        <Text color={t.model}>{modelDisplay}</Text>

        {/* Mode indicator */}
        <ModeIndicator mode={mode} />

        {/* Context percentage */}
        {ctxPercent > 0 && (
          <>
            <Text color="dim">{" · "}</Text>
            <ContextPercentageDisplay percentage={ctxPercent} />
          </>
        )}

        {/* Background jobs */}
        {backgroundJobs > 0 && (
          <Text color="cyan">{` · ⚡${backgroundJobs} bg`}</Text>
        )}

        {queueLength > 0 && (
          <Text color="yellow">{` · ${queueLength} queued`}</Text>
        )}
      </Box>

      {/* Right side: dir · tokens · hints */}
      <Box>
        <Text color="dim">{dir}</Text>
        {lastUsage && (
          <Text color="dim">
            {` · ${lastUsage.totalTokens.toLocaleString()} tokens`}
          </Text>
        )}
        <Text color="dim">{"  ?=/help  ESC=cancel  ^C^C=exit"}</Text>
      </Box>
    </Box>
  );
};
