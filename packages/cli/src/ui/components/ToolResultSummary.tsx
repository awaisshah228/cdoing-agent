/**
 * ToolResultSummary — Smart tool output summarization.
 * Like Continue's ToolResultSummary component.
 *
 * Shows compact output for each tool type:
 *   - shell_exec: truncated output (4 lines max)
 *   - file_edit/file_write: diff preview
 *   - file_read: filename + line count
 *   - sub_agent: last lines of output
 *   - default: character/line count
 */

import React from "react";
import { Box, Text } from "ink";

const MAX_OUTPUT_LINES = 4;

interface ToolResultSummaryProps {
  toolName: string;
  output: string;
  isError?: boolean;
}

export const ToolResultSummary: React.FC<ToolResultSummaryProps> = ({
  toolName,
  output,
  isError,
}) => {
  if (!output || !output.trim()) return null;

  const lines = output.trim().split("\n");

  // Error output — show in red
  if (isError) {
    const truncated = lines.slice(0, MAX_OUTPUT_LINES);
    return (
      <Box flexDirection="column" marginLeft={4}>
        {truncated.map((line, i) => (
          <Text key={i} color="red">{line}</Text>
        ))}
        {lines.length > MAX_OUTPUT_LINES && (
          <Text color="dim">{`  ...+${lines.length - MAX_OUTPUT_LINES} lines`}</Text>
        )}
      </Box>
    );
  }

  // Shell output — show truncated
  if (toolName === "shell_exec") {
    const truncated = lines.slice(0, MAX_OUTPUT_LINES);
    return (
      <Box flexDirection="column" marginLeft={4}>
        {truncated.map((line, i) => (
          <Text key={i} color="dim">{line}</Text>
        ))}
        {lines.length > MAX_OUTPUT_LINES && (
          <Text color="dim">{`  ...+${lines.length - MAX_OUTPUT_LINES} lines`}</Text>
        )}
      </Box>
    );
  }

  // File read — show filename and line count
  if (toolName === "file_read") {
    return (
      <Box marginLeft={4}>
        <Text color="dim">{`(${lines.length} lines)`}</Text>
      </Box>
    );
  }

  // Sub-agent — show last lines
  if (toolName === "sub_agent") {
    const tail = lines.slice(-MAX_OUTPUT_LINES);
    return (
      <Box flexDirection="column" marginLeft={4}>
        {lines.length > MAX_OUTPUT_LINES && (
          <Text color="dim">{`  ...${lines.length - MAX_OUTPUT_LINES} lines above`}</Text>
        )}
        {tail.map((line, i) => (
          <Text key={i} color="dim">{line}</Text>
        ))}
      </Box>
    );
  }

  // Default — character count
  if (output.length > 200) {
    return (
      <Box marginLeft={4}>
        <Text color="dim">{`(${lines.length} lines, ${output.length} chars)`}</Text>
      </Box>
    );
  }

  // Short output — show inline
  return (
    <Box flexDirection="column" marginLeft={4}>
      {lines.slice(0, MAX_OUTPUT_LINES).map((line, i) => (
        <Text key={i} color="dim">{line}</Text>
      ))}
    </Box>
  );
};
