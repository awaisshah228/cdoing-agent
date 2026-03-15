import React from "react";
import { Box, Text, Static } from "ink";
import type { ChatMessage, ToolActivity } from "./types";

// ── Tool icons ─────────────────────────────────────────────────────────────

const TOOL_ICONS: Record<string, string> = {
  file_read:       "📖",
  file_write:      "✏️ ",
  file_edit:       "🔧",
  multi_edit:      "🔧",
  file_delete:     "🗑️",
  ast_edit:        "🌳",
  notebook_edit:   "📓",
  glob_search:     "🔍",
  grep_search:     "🔎",
  codebase_search: "🔎",
  shell_exec:      "💻",
  file_run:        "▶",
  web_fetch:       "🌐",
  web_search:      "🔮",
  sub_agent:       "🤖",
  todo:            "📋",
  list_dir:        "📁",
  view_diff:       "📊",
  view_repo_map:   "🗺️",
  code_verify:     "✅",
  system_info:     "ℹ️",
};

function toolIcon(name: string) {
  return TOOL_ICONS[name] || "⚡";
}

// ── Individual message renderers ────────────────────────────────────────────

const UserMessage: React.FC<{ content: string }> = ({ content }) => (
  <Box marginY={0} flexDirection="row">
    <Text color="green" bold>
      {"❯ "}
    </Text>
    <Text color="white">{content}</Text>
  </Box>
);

const AssistantMessage: React.FC<{ content: string }> = ({ content }) => (
  <Box flexDirection="column" marginTop={1} paddingLeft={2}>
    <RenderMarkdown text={content} />
    <Box marginTop={0}>
      <Text color="gray">{"─".repeat(40)}</Text>
    </Box>
  </Box>
);

const SystemMessage: React.FC<{ content: string; isError?: boolean }> = ({
  content,
  isError,
}) => (
  <Box marginY={0} paddingLeft={2}>
    <Text color={isError ? "red" : "yellow"}>{content}</Text>
  </Box>
);

// ── Simple inline markdown renderer ────────────────────────────────────────

const RenderMarkdown: React.FC<{ text: string }> = ({ text }) => {
  const lines = text.split("\n");
  return (
    <Box flexDirection="column">
      {lines.map((line, i) => {
        // Code block fence — handled block-level outside, best effort inline
        if (line.startsWith("```")) {
          return (
            <Text key={i} color="gray">
              {line}
            </Text>
          );
        }
        // Headers
        if (line.startsWith("### ")) {
          return (
            <Text key={i} color="cyan" bold>
              {"  ▸ "}
              {line.slice(4)}
            </Text>
          );
        }
        if (line.startsWith("## ")) {
          return (
            <Text key={i} color="cyan" bold>
              {" ▸▸ "}
              {line.slice(3)}
            </Text>
          );
        }
        if (line.startsWith("# ")) {
          return (
            <Text key={i} color="blueBright" bold>
              {"▸▸▸ "}
              {line.slice(2)}
            </Text>
          );
        }
        // Bullet
        if (line.match(/^(\s*)[-*] /)) {
          const indent = line.match(/^(\s*)/)?.[1] || "";
          const content = line.replace(/^(\s*)[-*] /, "");
          return (
            <Text key={i}>
              {indent}
              <Text color="red">{"● "}</Text>
              {content}
            </Text>
          );
        }
        // Numbered list
        const numMatch = line.match(/^(\s*)(\d+)\. (.*)/);
        if (numMatch) {
          return (
            <Text key={i}>
              {numMatch[1]}
              <Text color="magenta">{numMatch[2] + ". "}</Text>
              {numMatch[3]}
            </Text>
          );
        }
        // Horizontal rule
        if (line.match(/^---+$/)) {
          return (
            <Text key={i} color="gray">
              {"═".repeat(40)}
            </Text>
          );
        }
        // Plain line — render bold/italic inline as plain for simplicity
        const cleaned = line
          .replace(/\*\*([^*]+)\*\*/g, "$1")
          .replace(/\*([^*]+)\*/g, "$1")
          .replace(/`([^`]+)`/g, "$1");
        return <Text key={i}>{cleaned}</Text>;
      })}
    </Box>
  );
};

// ── Streaming message (live, mutable) ──────────────────────────────────────

export const StreamingMessage: React.FC<{ content: string }> = ({
  content,
}) => {
  if (!content) return null;
  return (
    <Box flexDirection="column" paddingLeft={2} marginTop={1}>
      <RenderMarkdown text={content} />
      <Text color="cyan">{"▊"}</Text>
    </Box>
  );
};

// ── Tool activity bar ───────────────────────────────────────────────────────

export const ToolActivityBar: React.FC<{ tool: ToolActivity }> = ({
  tool,
}) => {
  const icon = toolIcon(tool.name);
  const color =
    tool.status === "error"
      ? "red"
      : tool.status === "done"
        ? "green"
        : "yellow";
  const statusChar =
    tool.status === "error" ? "✗" : tool.status === "done" ? "✓" : "…";
  return (
    <Box paddingLeft={2}>
      <Text color={color}>
        {`${statusChar} ${icon} ${tool.name}`}
        <Text color="gray">{tool.preview ? `  ${tool.preview}` : ""}</Text>
      </Text>
    </Box>
  );
};

// ── Message list (committed messages go into <Static>) ─────────────────────

interface MessageListProps {
  messages: ChatMessage[];
}

export const MessageList: React.FC<MessageListProps> = ({ messages }) => (
  <Static items={messages}>
    {(msg) => {
      switch (msg.role) {
        case "user":
          return <UserMessage key={msg.id} content={msg.content} />;
        case "assistant":
          return <AssistantMessage key={msg.id} content={msg.content} />;
        default:
          return (
            <SystemMessage
              key={msg.id}
              content={msg.content}
              isError={msg.isError}
            />
          );
      }
    }}
  </Static>
);
