import React from "react";
import { Box, Text, Static } from "ink";
import chalk from "chalk";
import type { ChatMessage, ToolActivity } from "./types";
import { getTheme } from "./theme";

// ── Tool icons ─────────────────────────────────────────────────────────────

const TOOL_ICONS: Record<string, string> = {
  file_read:       "📖",
  file_write:      "✏️ ",
  file_edit:       "🔧",
  multi_edit:      "🔧",

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

const UserMessage: React.FC<{ content: string }> = ({ content }) => {
  const t = getTheme();
  return (
    <Box marginY={0} flexDirection="row">
      <Text color={t.prompt} bold>
        {"❯ "}
      </Text>
      <Text color={t.text}>{content}</Text>
    </Box>
  );
};

const AssistantMessage: React.FC<{ content: string }> = ({ content }) => {
  const t = getTheme();
  return (
    <Box flexDirection="column" marginTop={1} paddingLeft={2}>
      <RenderMarkdown text={content} />
      <Box marginTop={0}>
        <Text color={t.separator}>{"─".repeat(40)}</Text>
      </Box>
    </Box>
  );
};

const SystemMessage: React.FC<{ content: string; isError?: boolean }> = ({
  content,
  isError,
}) => {
  const t = getTheme();
  return (
    <Box marginY={0} paddingLeft={2}>
      <Text color={isError ? t.error : t.info}>{content}</Text>
    </Box>
  );
};

// ── Simple inline markdown renderer ────────────────────────────────────────

export const RenderMarkdown: React.FC<{ text: string }> = ({ text }) => {
  const t = getTheme();
  const lines = text.split("\n");
  return (
    <Box flexDirection="column">
      {lines.map((line, i) => {
        // Code block fence
        if (line.startsWith("```")) {
          return (
            <Text key={i} color={t.codeBlock}>
              {line}
            </Text>
          );
        }
        // Headers
        if (line.startsWith("### ")) {
          return (
            <Text key={i} color={t.heading2} bold>
              {"  ▸ "}
              {line.slice(4)}
            </Text>
          );
        }
        if (line.startsWith("## ")) {
          return (
            <Text key={i} color={t.heading2} bold>
              {" ▸▸ "}
              {line.slice(3)}
            </Text>
          );
        }
        if (line.startsWith("# ")) {
          return (
            <Text key={i} color={t.heading1} bold>
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
            <Text key={i} color={t.text}>
              {indent}
              <Text color={t.bullet}>{"● "}</Text>
              {content}
            </Text>
          );
        }
        // Numbered list
        const numMatch = line.match(/^(\s*)(\d+)\. (.*)/);
        if (numMatch) {
          return (
            <Text key={i} color={t.text}>
              {numMatch[1]}
              <Text color={t.listNumber}>{numMatch[2] + ". "}</Text>
              {numMatch[3]}
            </Text>
          );
        }
        // Horizontal rule
        if (line.match(/^---+$/)) {
          return (
            <Text key={i} color={t.horizontalRule}>
              {"═".repeat(40)}
            </Text>
          );
        }
        // Plain line with inline formatting (bold, italic, code)
        const styled = line
          .replace(/`([^`]+)`/g, (_m: string, c: string) => chalk.cyan(c))
          .replace(/\*\*([^*]+)\*\*/g, (_m: string, c: string) => chalk.bold(c))
          .replace(/(?<!\w)\*([^*]+)\*(?!\w)/g, (_m: string, c: string) => chalk.italic(c));
        return <Text key={i} color={t.text}>{styled}</Text>;
      })}
    </Box>
  );
};

// ── Streaming message (live, mutable) ──────────────────────────────────────

export const StreamingMessage: React.FC<{ content: string }> = ({
  content,
}) => {
  const t = getTheme();
  if (!content) return null;
  return (
    <Box flexDirection="column" paddingLeft={2} marginTop={1}>
      <RenderMarkdown text={content} />
      <Text color={t.accent}>{"▊"}</Text>
    </Box>
  );
};

// ── Tool activity bar ───────────────────────────────────────────────────────

export const ToolActivityBar: React.FC<{ tool: ToolActivity }> = ({
  tool,
}) => {
  const t = getTheme();
  const icon = toolIcon(tool.name);
  const color =
    tool.status === "error"
      ? t.toolError
      : tool.status === "done"
        ? t.toolDone
        : t.toolRunning;
  const statusChar =
    tool.status === "error" ? "✗" : tool.status === "done" ? "✓" : "…";
  return (
    <Box paddingLeft={2}>
      <Text color={color}>
        {`${statusChar} ${icon} ${tool.name}`}
        <Text color={t.toolPreview}>{tool.preview ? `  ${tool.preview}` : ""}</Text>
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
