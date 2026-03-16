/**
 * MemoizedMessage — Optimized message renderer with custom memo comparison.
 *
 * Renders messages with role-based styling:
 *   - user: green bullet + dimmed text
 *   - assistant: white bullet + markdown-rendered content
 *   - system: info/error styling
 *   - shell: plain text (streamed chunks, command output)
 *
 * Uses React.memo with custom comparator to avoid re-rendering
 * when message content hasn't changed.
 */

import React, { memo } from "react";
import { Box, Text } from "ink";
import { RenderMarkdown } from "../MessageList";
import { getTheme } from "../theme";
import type { ChatMessage } from "../types";

interface MemoizedMessageProps {
  message: ChatMessage;
}

export const MemoizedMessage = memo<MemoizedMessageProps>(
  ({ message }) => {
    const t = getTheme();

    switch (message.role) {
      case "user":
        return (
          <Box flexDirection="column" marginBottom={0}>
            <Text>{" "}</Text>
            <Box>
              <Text color="blue" bold>{"● "}</Text>
              <Text color="dim">{message.content}</Text>
            </Box>
          </Box>
        );

      case "assistant":
        return (
          <Box flexDirection="column" marginBottom={0}>
            <Text>{" "}</Text>
            <Box>
              <Text color="white">{"● "}</Text>
              <Box flexDirection="column" flexGrow={1}>
                <RenderMarkdown text={message.content} />
              </Box>
            </Box>
            <Text color={t.separator}>
              {"─".repeat(process.stdout.columns > 0 ? Math.min(process.stdout.columns, 60) : 40)}
            </Text>
          </Box>
        );

      case "system":
        return (
          <Box marginBottom={0}>
            {message.isError ? (
              <Text color="red">{"  ✗ "}</Text>
            ) : (
              <Text color={t.info}>{"  ▸ "}</Text>
            )}
            <Text>{message.content}</Text>
          </Box>
        );

      case "shell":
        // Streamed assistant chunks + shell command output
        return (
          <Box flexDirection="column">
            <RenderMarkdown text={message.content} />
          </Box>
        );

      default:
        return <Text>{message.content}</Text>;
    }
  },
  // Custom memo comparator — only re-render if content or role changes
  (prev, next) => {
    return (
      prev.message.id === next.message.id &&
      prev.message.content === next.message.content &&
      prev.message.role === next.message.role
    );
  },
);

MemoizedMessage.displayName = "MemoizedMessage";
