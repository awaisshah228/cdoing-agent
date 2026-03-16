/**
 * ColoredDiff — Word-level diff display with line numbers.
 * Like Continue's ColoredDiff component.
 *
 * Shows additions in green, deletions in red, with line numbers.
 * Truncates at MAX_LINES with "...N more lines" indicator.
 */

import React from "react";
import { Box, Text } from "ink";

const MAX_LINES = 16;

interface ColoredDiffProps {
  oldText: string;
  newText: string;
  filePath?: string;
}

export const ColoredDiff: React.FC<ColoredDiffProps> = ({
  oldText,
  newText,
  filePath,
}) => {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");

  // Simple line-level diff
  const diffLines: Array<{ type: "add" | "del" | "ctx"; content: string; lineNo: number }> = [];

  // Find removed lines
  let lineNo = 1;
  for (const line of oldLines) {
    if (!newLines.includes(line)) {
      diffLines.push({ type: "del", content: line, lineNo });
    }
    lineNo++;
  }

  // Find added lines
  lineNo = 1;
  for (const line of newLines) {
    if (!oldLines.includes(line)) {
      diffLines.push({ type: "add", content: line, lineNo });
    }
    lineNo++;
  }

  // Sort by line number
  diffLines.sort((a, b) => a.lineNo - b.lineNo);

  const truncated = diffLines.length > MAX_LINES;
  const visible = truncated ? diffLines.slice(0, MAX_LINES) : diffLines;

  if (visible.length === 0) return null;

  const gutterWidth = String(Math.max(...visible.map((d) => d.lineNo))).length;

  return (
    <Box flexDirection="column" marginLeft={2}>
      {filePath && (
        <Text bold color="white">{`  📄 ${filePath}`}</Text>
      )}
      {visible.map((line, i) => (
        <Box key={i}>
          <Text color="dim">
            {String(line.lineNo).padStart(gutterWidth)} {line.type === "add" ? "+" : "-"}{" "}
          </Text>
          <Text
            color={line.type === "add" ? "green" : "red"}
          >
            {line.content}
          </Text>
        </Box>
      ))}
      {truncated && (
        <Text color="dim">{`  ...${diffLines.length - MAX_LINES} more lines`}</Text>
      )}
    </Box>
  );
};
