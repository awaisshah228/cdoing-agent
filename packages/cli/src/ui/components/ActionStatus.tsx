/**
 * ActionStatus — Loading indicator with spinner, timer, message, and hints.
 * Like Continue's ActionStatus component.
 *
 * Display: [⠿⠷⠛] Thinking... (5s • esc to interrupt)
 */

import React from "react";
import { Box, Text } from "ink";
import { LoadingAnimation } from "./LoadingAnimation";
import { Timer } from "./Timer";

interface ActionStatusProps {
  visible: boolean;
  startTime: number;
  message?: string;
  showSpinner?: boolean;
  color?: string;
  loadingColor?: string;
  additionalHint?: string;
}

export const ActionStatus: React.FC<ActionStatusProps> = ({
  visible,
  startTime,
  message = "",
  showSpinner = true,
  color = "cyan",
  loadingColor,
  additionalHint,
}) => {
  if (!visible) return null;

  return (
    <Box paddingLeft={2} paddingY={0}>
      {showSpinner && (
        <Box marginRight={1}>
          <LoadingAnimation color={loadingColor || color} />
        </Box>
      )}
      {message && (
        <Text color={color}>{message} </Text>
      )}
      <Text color="dim">(</Text>
      <Timer startTime={startTime} color="dim" />
      <Text color="dim">{" • esc to interrupt"}</Text>
      {additionalHint && (
        <Text color="dim">{` • ${additionalHint}`}</Text>
      )}
      <Text color="dim">)</Text>
    </Box>
  );
};
