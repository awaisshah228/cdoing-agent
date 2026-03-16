/**
 * MessageList — renders chat messages with tool calls, streaming, and markdown
 *
 * Uses OpenTUI's <scrollbox> for smooth scrolling with sticky-to-bottom,
 * <markdown> for assistant message rendering, and custom tool call display.
 */

import { TextAttributes } from "@opentui/core";
import { useTheme } from "../context/theme";

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

// ── Component ──────────────────────────────────────────

function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  let h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${m.toString().padStart(2, "0")} ${ampm}`;
}

export function MessageList(props: {
  messages: Message[];
  streamingText?: string;
  isStreaming?: boolean;
  showTimestamps?: boolean;
}) {
  const { theme } = useTheme();
  const t = theme;

  return (
    <scrollbox
      scrollY={true}
      stickyScroll={true}
      flexGrow={1}
      flexDirection="column"
    >
      <box flexDirection="column">
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
              <box key={msg.id} paddingX={1} paddingY={0} flexDirection="row">
                <text fg={t.primary} attributes={TextAttributes.BOLD}>
                  {"◆ "}
                </text>
                <text fg={t.assistantText} flexGrow={1}>{msg.content}</text>
                {props.showTimestamps && msg.timestamp && (
                  <text fg={t.textDim}>{`  ${formatTimestamp(msg.timestamp)}`}</text>
                )}
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
          <box paddingX={1}>
            <text fg={t.primary} attributes={TextAttributes.BOLD}>
              {"◆ "}
            </text>
            <text fg={t.assistantText}>
              {props.streamingText || ""}
            </text>
            <text fg={t.primary}>{"▊"}</text>
          </box>
        )}
      </box>
    </scrollbox>
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
