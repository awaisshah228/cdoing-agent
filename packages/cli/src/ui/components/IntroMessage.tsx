/**
 * IntroMessage — Welcome screen shown on startup.
 * Like Continue's IntroMessage component.
 */

import React from "react";
import { Box, Text } from "ink";

interface IntroMessageProps {
  provider: string;
  model: string;
  workingDir: string;
  mode: string;
}

export const IntroMessage: React.FC<IntroMessageProps> = ({
  provider,
  model,
  workingDir,
  mode,
}) => {
  const shortDir = workingDir.replace(process.env.HOME || "", "~");

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Box flexDirection="column" marginBottom={1}>
        <Text color="cyan" bold>
          {"  ╭─────────────────────────────────╮"}
        </Text>
        <Text color="cyan" bold>
          {"  │       Cdoing Agent  v0.1.3      │"}
        </Text>
        <Text color="cyan" bold>
          {"  ╰─────────────────────────────────╯"}
        </Text>
      </Box>

      <Box flexDirection="column" paddingLeft={2}>
        <Box>
          <Text color="dim">{"Provider: "}</Text>
          <Text color="white">{provider}</Text>
          <Text color="dim">{" • Model: "}</Text>
          <Text color="white">{model || "default"}</Text>
        </Box>
        <Box>
          <Text color="dim">{"Directory: "}</Text>
          <Text color="white">{shortDir}</Text>
        </Box>
        <Box>
          <Text color="dim">{"Mode: "}</Text>
          <Text color={mode === "default" ? "green" : "yellow"}>{mode}</Text>
        </Box>
      </Box>

      <Box marginTop={1} paddingLeft={2}>
        <Text color="dim">
          {"💡 Type a message and press Enter to chat\n"}
          {"   /help for commands  •  ! for shell  •  @ for context"}
        </Text>
      </Box>
    </Box>
  );
};
