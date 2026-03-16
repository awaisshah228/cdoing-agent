/**
 * ContextPercentageDisplay — Shows context window usage.
 * Like Continue's ContextPercentageDisplay.
 *
 * Color codes: green (<50%), yellow (50-80%), red (>80%)
 */

import React from "react";
import { Text } from "ink";

interface ContextPercentageDisplayProps {
  percentage: number;
}

export const ContextPercentageDisplay: React.FC<ContextPercentageDisplayProps> = ({
  percentage,
}) => {
  if (percentage <= 0) return null;

  const color = percentage > 80 ? "red" : percentage > 50 ? "yellow" : "green";
  const display = `${Math.round(percentage)}%`;

  return <Text color={color}>{display}</Text>;
};
