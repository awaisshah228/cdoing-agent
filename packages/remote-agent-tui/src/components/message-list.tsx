/**
 * MessageList — renders chat messages with tool call indicators, streaming, markdown
 *
 * Adapted from opentuicli's MessageList for the personal assistant TUI.
 * Handles user, assistant, and system messages with proper styling.
 *
 * IMPORTANT: OpenTUI only accepts strings/text in <text> nodes — no React
 * fragments, no boolean expressions that could evaluate to false/0, no null children.
 */

import { TextAttributes } from "@opentui/core";
import { useTheme } from "../context/theme";

// ── Types ──────────────────────────────────────────────

export interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  toolCalls?: string[];
  isError?: boolean;
  timestamp: number;
}

// ── Tool Config ───────────────────────────────────────

interface ToolConfig {
  label: string;
  icon: string;
}

const TOOL_CONFIG: Record<string, ToolConfig> = {
  delegate_to_coder: { label: "Coding Agent", icon: "\u25C6" },
  config_manager:    { label: "Config",       icon: "\u2699" },
  cron_manager:      { label: "Cron",         icon: "\u23F0" },
  skill_manager:     { label: "Skills",       icon: "\u2605" },
  setup_tool:        { label: "Setup Tool",   icon: "\u2692" },
  file_read:         { label: "Read",         icon: "\u25C7" },
  glob_search:       { label: "Search",       icon: "\u25CE" },
  grep_search:       { label: "Search",       icon: "\u25CE" },
  list_dir:          { label: "List",         icon: "\u251C" },
};

// ── Markdown Helpers ─────────────────────────────────────

function stripInlineMarkdown(text: string): string {
  return text
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/(?<!\w)\*([^*]+)\*(?!\w)/g, "$1");
}

function RenderMarkdown(props: { text: string }) {
  const { theme: t } = useTheme();
  const lines = props.text.split("\n");
  const rendered: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block
    if (line.startsWith("```")) {
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      rendered.push(
        <box key={`code-${i}`} paddingX={1}>
          <text fg={t.warning}>{codeLines.join("\n")}</text>
        </box>
      );
      continue;
    }

    // Headers
    if (line.startsWith("### ")) {
      rendered.push(<text key={`h3-${i}`} fg={t.info} attributes={TextAttributes.BOLD}>{`  \u25B8 ${stripInlineMarkdown(line.slice(4))}`}</text>);
      i++; continue;
    }
    if (line.startsWith("## ")) {
      rendered.push(<text key={`h2-${i}`} fg={t.primary} attributes={TextAttributes.BOLD}>{` \u25B8\u25B8 ${stripInlineMarkdown(line.slice(3))}`}</text>);
      i++; continue;
    }
    if (line.startsWith("# ")) {
      rendered.push(<text key={`h1-${i}`} fg={t.primary} attributes={TextAttributes.BOLD}>{`\u25B8\u25B8\u25B8 ${stripInlineMarkdown(line.slice(2))}`}</text>);
      i++; continue;
    }

    // Horizontal rule
    if (/^---+$/.test(line) || /^===+$/.test(line)) {
      rendered.push(<text key={`hr-${i}`} fg={t.textDim}>{"\u2500".repeat(40)}</text>);
      i++; continue;
    }

    // Bullet list
    const bulletMatch = line.match(/^(\s*)[-*] (.*)/);
    if (bulletMatch) {
      rendered.push(<text key={`b-${i}`}>{`${bulletMatch[1]}\u25CF ${stripInlineMarkdown(bulletMatch[2])}`}</text>);
      i++; continue;
    }

    // Numbered list
    const numMatch = line.match(/^(\s*)(\d+)\. (.*)/);
    if (numMatch) {
      rendered.push(<text key={`n-${i}`}>{`${numMatch[1]}${numMatch[2]}. ${stripInlineMarkdown(numMatch[3])}`}</text>);
      i++; continue;
    }

    // Blockquote
    if (line.startsWith("> ")) {
      rendered.push(<text key={`q-${i}`} fg={t.textMuted}>{`\u2502 ${stripInlineMarkdown(line.slice(2))}`}</text>);
      i++; continue;
    }

    // Empty line
    if (!line.trim()) {
      rendered.push(<text key={`e-${i}`}>{" "}</text>);
      i++; continue;
    }

    // Plain text
    rendered.push(<text key={`t-${i}`}>{stripInlineMarkdown(line)}</text>);
    i++;
  }

  return <box flexDirection="column">{rendered}</box>;
}

// ── Timestamp ────────────────────────────────────────────

function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  let h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${m.toString().padStart(2, "0")} ${ampm}`;
}

// ── Tool call summary as string ──────────────────────────

function toolCallsLabel(tools: string[]): string {
  return tools.map((name) => {
    const cfg = TOOL_CONFIG[name];
    return cfg ? `${cfg.icon} ${cfg.label}` : name;
  }).join("  ");
}

// ── Single message renderer ──────────────────────────────

function UserMessage(props: { msg: Message; showTs: boolean }) {
  const { theme: t } = useTheme();
  const ts = props.showTs ? `  ${formatTimestamp(props.msg.timestamp)}` : "";
  return (
    <box paddingX={1} flexDirection="row">
      <text fg={t.primary} attributes={TextAttributes.BOLD}>{"\u276F "}</text>
      <text fg={t.text}>{props.msg.content + ts}</text>
    </box>
  );
}

function AssistantMessage(props: { msg: Message; showTs: boolean }) {
  const { theme: t } = useTheme();
  const tools = props.msg.toolCalls && props.msg.toolCalls.length > 0
    ? toolCallsLabel(props.msg.toolCalls)
    : "";
  const ts = props.showTs ? `  ${formatTimestamp(props.msg.timestamp)}` : "";
  return (
    <box paddingLeft={1} flexShrink={0} flexDirection="column">
      <box flexDirection="row">
        <text fg={t.success} attributes={TextAttributes.BOLD}>{"\u25C6 "}</text>
        <text fg={t.textDim}>{tools + ts}</text>
      </box>
      <box paddingLeft={2}>
        <RenderMarkdown text={props.msg.content.trim()} />
      </box>
    </box>
  );
}

function SystemMessage(props: { msg: Message }) {
  const { theme: t } = useTheme();
  return (
    <box paddingX={1}>
      <text fg={props.msg.isError ? t.error : t.textMuted}>
        {props.msg.isError ? `\u2717 ${props.msg.content}` : `\u26A1 ${props.msg.content}`}
      </text>
    </box>
  );
}

// ── Component ──────────────────────────────────────────

export function MessageList(props: {
  messages: Message[];
  streamingText?: string;
  isStreaming?: boolean;
  showTimestamps?: boolean;
}) {
  const { theme: t } = useTheme();
  const showTs = !!props.showTimestamps;

  // Build message elements
  const messageElements: React.ReactNode[] = [];

  if (props.messages.length === 0 && !props.isStreaming) {
    messageElements.push(
      <box key="empty" paddingX={2} paddingY={1}>
        <text fg={t.textMuted}>
          {"Type a message to start. Use / for commands, @ for context, ! for shell."}
        </text>
      </box>
    );
  }

  for (const msg of props.messages) {
    if (msg.role === "user") {
      messageElements.push(<UserMessage key={msg.id} msg={msg} showTs={showTs} />);
    } else if (msg.role === "assistant") {
      messageElements.push(<AssistantMessage key={msg.id} msg={msg} showTs={showTs} />);
    } else if (msg.role === "system") {
      messageElements.push(<SystemMessage key={msg.id} msg={msg} />);
    }
  }

  // Streaming indicator
  if (props.isStreaming) {
    const streamText = (props.streamingText || "").trim();
    messageElements.push(
      <box key="streaming" paddingLeft={1} flexShrink={0} flexDirection="column">
        <box flexDirection="row">
          <text fg={t.success} attributes={TextAttributes.BOLD}>{"\u25C6 "}</text>
          <text fg={t.primary}>{"\u2588"}</text>
        </box>
        {streamText ? (
          <box paddingLeft={2}>
            <RenderMarkdown text={streamText} />
          </box>
        ) : (
          <box paddingLeft={2}>
            <text fg={t.textMuted}>{"thinking..."}</text>
          </box>
        )}
      </box>
    );
  }

  return (
    <box flexDirection="column">
      {messageElements}
    </box>
  );
}
