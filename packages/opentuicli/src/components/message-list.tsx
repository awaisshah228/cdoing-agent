/**
 * MessageList — renders chat messages with tool calls, streaming, and markdown
 *
 * Uses a custom inline markdown renderer for assistant messages (matching the CLI's
 * RenderMarkdown approach) with OpenTUI's <markdown> component for fenced code blocks.
 * The scrollbox is managed by the parent (session.tsx) to ensure proper flex height
 * calculation (matching OpenCode's pattern).
 */

import { TextAttributes } from "@opentui/core";
import { useTheme, type Theme } from "../context/theme";

// ── Types ──────────────────────────────────────────────

export interface Message {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  toolName?: string;
  toolStatus?: "running" | "done" | "error";
  isError?: boolean;
  timestamp: number;
}

// ── Tool Icons ─────────────────────────────────────────

const TOOL_ICONS: Record<string, string> = {
  file_read: "📖", file_write: "✏️", file_edit: "🔧", multi_edit: "🔧",
  shell_exec: "💻", file_run: "▶", glob_search: "🔍", grep_search: "🔎",
  codebase_search: "🔎", web_fetch: "🌐", web_search: "🔮", sub_agent: "🤖",
  todo: "📋", list_dir: "📁", view_diff: "📊", view_repo_map: "🗺️",
  code_verify: "✅", system_info: "ℹ️", ast_edit: "🌳", notebook_edit: "📓",
};

// ── Inline Markdown Helpers ──────────────────────────────

/** Strip markdown inline syntax markers: **bold** → bold, *italic* → italic, `code` → code */
function stripInlineMarkdown(text: string): string {
  return text
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/(?<!\w)\*([^*]+)\*(?!\w)/g, "$1");
}

// ── Custom Markdown Renderer ─────────────────────────────
// Renders markdown content using OpenTUI primitives with proper styling.
// Strips markdown syntax (##, **, *, `, ---) and renders styled text.
// Uses <markdown> component only for fenced code blocks (syntax highlighting).

function RenderMarkdown(props: { text: string; theme: Theme }) {
  const t = props.theme;
  const { syntaxStyle } = useTheme();
  const lines = props.text.split("\n");

  const rendered: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // ── Fenced code block — use OpenTUI <markdown> for syntax highlighting ──
    if (line.startsWith("```")) {
      const codeLines: string[] = [line];
      i++;
      while (i < lines.length) {
        codeLines.push(lines[i]);
        if (lines[i].startsWith("```")) {
          i++;
          break;
        }
        i++;
      }
      const codeBlock = codeLines.join("\n");
      rendered.push(
        <box key={`code-${i}`} marginY={0}>
          <markdown
            syntaxStyle={syntaxStyle}
            streaming={false}
            content={codeBlock}
            conceal={true}
          />
        </box>
      );
      continue;
    }

    // ── Headers ──
    if (line.startsWith("### ")) {
      rendered.push(
        <text key={i} fg={t.info} attributes={TextAttributes.BOLD}>
          {`  ▸ ${stripInlineMarkdown(line.slice(4))}`}
        </text>
      );
      i++;
      continue;
    }
    if (line.startsWith("## ")) {
      rendered.push(
        <text key={i} fg={t.primary} attributes={TextAttributes.BOLD}>
          {` ▸▸ ${stripInlineMarkdown(line.slice(3))}`}
        </text>
      );
      i++;
      continue;
    }
    if (line.startsWith("# ")) {
      rendered.push(
        <text key={i} fg={t.primary} attributes={TextAttributes.BOLD}>
          {`▸▸▸ ${stripInlineMarkdown(line.slice(2))}`}
        </text>
      );
      i++;
      continue;
    }

    // ── Horizontal rule ──
    if (/^---+$/.test(line) || /^===+$/.test(line) || /^\*\*\*+$/.test(line)) {
      rendered.push(
        <text key={i} fg={t.textDim}>{"─".repeat(40)}</text>
      );
      i++;
      continue;
    }

    // ── Bullet list ──
    const bulletMatch = line.match(/^(\s*)[-*] (.*)/);
    if (bulletMatch) {
      const indent = bulletMatch[1] || "";
      const content = stripInlineMarkdown(bulletMatch[2]);
      rendered.push(
        <text key={i}>{`${indent}● ${content}`}</text>
      );
      i++;
      continue;
    }

    // ── Numbered list ──
    const numMatch = line.match(/^(\s*)(\d+)\. (.*)/);
    if (numMatch) {
      const content = stripInlineMarkdown(numMatch[3]);
      rendered.push(
        <text key={i}>{`${numMatch[1]}${numMatch[2]}. ${content}`}</text>
      );
      i++;
      continue;
    }

    // ── Blockquote ──
    if (line.startsWith("> ")) {
      rendered.push(
        <text key={i} fg={t.textMuted}>{`│ ${stripInlineMarkdown(line.slice(2))}`}</text>
      );
      i++;
      continue;
    }

    // ── Empty line ──
    if (!line.trim()) {
      rendered.push(<text key={i}>{" "}</text>);
      i++;
      continue;
    }

    // ── Plain text — strip markdown syntax ──
    rendered.push(
      <text key={i}>{stripInlineMarkdown(line)}</text>
    );
    i++;
  }

  return <box flexDirection="column">{rendered}</box>;
}

// ── Component ──────────────────────────────────────────

function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  let h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${m.toString().padStart(2, "0")} ${ampm}`;
}

/**
 * Renders message content only (no scrollbox wrapper).
 * Parent should wrap this in a <scrollbox> for proper flex height.
 */
export function MessageList(props: {
  messages: Message[];
  streamingText?: string;
  isStreaming?: boolean;
  showTimestamps?: boolean;
}) {
  const { theme } = useTheme();
  const t = theme;

  return (
    <>
      {/* Empty state */}
      {props.messages.length === 0 && !props.isStreaming && (
        <box paddingX={2} paddingY={1}>
          <text fg={t.textMuted}>
            {"Type a message to start chatting. Use / for commands, @ for context."}
          </text>
        </box>
      )}

      {/* Messages */}
      {props.messages.map((msg) => {
        if (msg.role === "user") {
          return (
            <box key={msg.id} paddingX={1} paddingY={0} flexDirection="row">
              <text fg={t.userText} attributes={TextAttributes.BOLD}>
                {"❯ "}
              </text>
              <text fg={t.userText} flexGrow={1}>{msg.content}</text>
              {props.showTimestamps && msg.timestamp && (
                <text fg={t.textDim}>{`  ${formatTimestamp(msg.timestamp)}`}</text>
              )}
            </box>
          );
        }

        if (msg.role === "assistant") {
          return (
            <box key={msg.id} paddingLeft={1} marginTop={1} flexShrink={0} flexDirection="column">
              <box flexDirection="row">
                <text fg={t.primary} attributes={TextAttributes.BOLD}>
                  {"◆ "}
                </text>
                {props.showTimestamps && msg.timestamp && (
                  <text fg={t.textDim}>{`  ${formatTimestamp(msg.timestamp)}`}</text>
                )}
              </box>
              <box paddingLeft={2}>
                <RenderMarkdown text={msg.content.trim()} theme={t} />
              </box>
            </box>
          );
        }

        if (msg.role === "system") {
          return (
            <box key={msg.id} paddingX={1} flexDirection="row">
              <text fg={t.systemText} flexGrow={1}>{`⚡ ${msg.content}`}</text>
              {props.showTimestamps && msg.timestamp && (
                <text fg={t.textDim}>{`  ${formatTimestamp(msg.timestamp)}`}</text>
              )}
            </box>
          );
        }

        if (msg.role === "tool") {
          return (
            <ToolCallRow
              key={msg.id}
              name={msg.toolName || "unknown"}
              content={msg.content}
              status={msg.toolStatus || (msg.isError ? "error" : "done")}
            />
          );
        }

        return null;
      })}

      {/* Streaming indicator */}
      {props.isStreaming && (
        <box paddingLeft={1} marginTop={1} flexShrink={0} flexDirection="column">
          <box flexDirection="row">
            <text fg={t.primary} attributes={TextAttributes.BOLD}>
              {"◆ "}
            </text>
            <text fg={t.primary}>{"▊"}</text>
          </box>
          {(props.streamingText || "").trim() && (
            <box paddingLeft={2}>
              <RenderMarkdown text={(props.streamingText || "").trim()} theme={t} />
            </box>
          )}
        </box>
      )}
    </>
  );
}

// ── Tool Call Row ──────────────────────────────────────

function ToolCallRow(props: {
  name: string;
  content: string;
  status: "running" | "done" | "error";
}) {
  const { theme } = useTheme();
  const t = theme;

  const icon = TOOL_ICONS[props.name] || "⚙️";
  const statusIcon = (() => {
    switch (props.status) {
      case "running": return "⏳";
      case "done": return "✓";
      case "error": return "✗";
    }
  })();
  const statusColor = (() => {
    switch (props.status) {
      case "running": return t.toolRunning;
      case "done": return t.toolDone;
      case "error": return t.toolError;
    }
  })();

  const shortName = (() => {
    const names: Record<string, string> = {
      file_read: "Read", file_write: "Write", file_edit: "Edit",
      multi_edit: "MultiEdit", shell_exec: "Bash", glob_search: "Search files",
      grep_search: "Search code", web_fetch: "Fetch", sub_agent: "Agent",
      list_dir: "List dir", codebase_search: "Codebase search",
    };
    return names[props.name] || props.name.replace(/_/g, " ");
  })();

  return (
    <box paddingX={2}>
      <text fg={statusColor}>{`${statusIcon} `}</text>
      <text fg={t.toolText}>{`${icon} ${shortName}`}</text>
      {props.content && (
        <text fg={t.textDim}>{` — ${trimText(props.content, 60)}`}</text>
      )}
    </box>
  );
}

function trimText(s: string, max: number): string {
  const first = s.split("\n")[0] || "";
  return first.length > max ? first.substring(0, max) + "…" : first;
}
