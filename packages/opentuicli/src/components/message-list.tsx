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
  toolInput?: Record<string, any>;
  isError?: boolean;
  timestamp: number;
}

// ── Tool Config ───────────────────────────────────────

interface ToolConfig {
  label: string;
  icon: string;
  verb: string;
}

const TOOL_CONFIG: Record<string, ToolConfig> = {
  // File operations
  file_read:          { label: "Read",            icon: "◇", verb: "Reading" },
  file_write:         { label: "Write",           icon: "◈", verb: "Writing" },
  file_edit:          { label: "Edit",            icon: "◈", verb: "Editing" },
  multi_edit:         { label: "MultiEdit",       icon: "◈", verb: "Editing" },
  apply_patch:        { label: "Patch",           icon: "◈", verb: "Patching" },
  // Search
  glob_search:        { label: "Search files",    icon: "◎", verb: "Searching" },
  grep_search:        { label: "Search",          icon: "◎", verb: "Searching" },
  codebase_search:    { label: "Codebase",        icon: "◎", verb: "Searching" },
  list_dir:           { label: "List Dir",        icon: "├", verb: "Listing" },
  // Execution
  shell_exec:         { label: "Bash",            icon: "$", verb: "Running" },
  file_run:           { label: "Run",             icon: "▶", verb: "Running" },
  code_verify:        { label: "Verify",          icon: "✓", verb: "Verifying" },
  powershell:         { label: "PowerShell",      icon: "$", verb: "Running" },
  repl:               { label: "REPL",            icon: "▶", verb: "Running" },
  // Web
  web_fetch:          { label: "Fetch",           icon: "◌", verb: "Fetching" },
  web_search:         { label: "Web Search",      icon: "◌", verb: "Searching" },
  web_browser:        { label: "Browser",         icon: "◌", verb: "Browsing" },
  // Agents
  sub_agent:          { label: "Agent",           icon: "◆", verb: "Running" },
  sub_agent_status:   { label: "Agent Status",    icon: "◆", verb: "Checking" },
  sub_agent_terminate:{ label: "Agent Stop",      icon: "◆", verb: "Stopping" },
  send_message:       { label: "Message",         icon: "◆", verb: "Sending" },
  task_list:          { label: "Tasks",           icon: "◆", verb: "Listing" },
  task_get:           { label: "Task",            icon: "◆", verb: "Getting" },
  task_stop:          { label: "Task Stop",       icon: "◆", verb: "Stopping" },
  // Session
  todo:               { label: "Todo",            icon: "☐", verb: "Updating" },
  question:           { label: "Question",        icon: "?", verb: "Asking" },
  plan_exit:          { label: "Plan",            icon: "☐", verb: "Planning" },
  batch:              { label: "Batch",           icon: "⊞", verb: "Batching" },
  skill:              { label: "Skill",           icon: "⚡", verb: "Running" },
  memory:             { label: "Memory",          icon: "◉", verb: "Saving" },
  task_complete:      { label: "Done",            icon: "✓", verb: "Completing" },
  send_user_message:  { label: "Message",         icon: "◇", verb: "Sending" },
  enter_worktree:     { label: "Worktree",        icon: "⌥", verb: "Entering" },
  exit_worktree:      { label: "Worktree",        icon: "⌥", verb: "Exiting" },
  cron_create:        { label: "Cron",            icon: "⏲", verb: "Creating" },
  cron_list:          { label: "Cron",            icon: "⏲", verb: "Listing" },
  cron_delete:        { label: "Cron",            icon: "⏲", verb: "Deleting" },
  sleep:              { label: "Sleep",           icon: "◌", verb: "Waiting" },
  snip:               { label: "Snip",            icon: "✂", verb: "Compacting" },
  // Editing
  ast_edit:           { label: "AST Edit",        icon: "⌥", verb: "Editing" },
  notebook_edit:      { label: "Notebook",        icon: "⊡", verb: "Editing" },
  // Viewing
  view_diff:          { label: "Diff",            icon: "±", verb: "Viewing" },
  view_repo_map:      { label: "Repo Map",        icon: "⊞", verb: "Mapping" },
  // System
  system_info:        { label: "System Info",     icon: "i", verb: "Checking" },
  lsp:                { label: "LSP",             icon: "⊡", verb: "Querying" },
  config_update:      { label: "Config",          icon: "⚙", verb: "Updating" },
  terminal_capture:   { label: "Terminal",        icon: "$", verb: "Capturing" },
  list_mcp_resources: { label: "MCP Resources",   icon: "⊡", verb: "Listing" },
  read_mcp_resource:  { label: "MCP Resource",    icon: "⊡", verb: "Reading" },
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
        <text key={i} fg={t.info} attributes={TextAttributes.BOLD} selectable>
          {`  ▸ ${stripInlineMarkdown(line.slice(4))}`}
        </text>
      );
      i++;
      continue;
    }
    if (line.startsWith("## ")) {
      rendered.push(
        <text key={i} fg={t.primary} attributes={TextAttributes.BOLD} selectable>
          {` ▸▸ ${stripInlineMarkdown(line.slice(3))}`}
        </text>
      );
      i++;
      continue;
    }
    if (line.startsWith("# ")) {
      rendered.push(
        <text key={i} fg={t.primary} attributes={TextAttributes.BOLD} selectable>
          {`▸▸▸ ${stripInlineMarkdown(line.slice(2))}`}
        </text>
      );
      i++;
      continue;
    }

    // ── Horizontal rule ──
    if (/^---+$/.test(line) || /^===+$/.test(line) || /^\*\*\*+$/.test(line)) {
      rendered.push(
        <text key={i} fg={t.textDim} selectable>{"─".repeat(40)}</text>
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
        <text key={i} selectable>{`${indent}● ${content}`}</text>
      );
      i++;
      continue;
    }

    // ── Numbered list ──
    const numMatch = line.match(/^(\s*)(\d+)\. (.*)/);
    if (numMatch) {
      const content = stripInlineMarkdown(numMatch[3]);
      rendered.push(
        <text key={i} selectable>{`${numMatch[1]}${numMatch[2]}. ${content}`}</text>
      );
      i++;
      continue;
    }

    // ── Blockquote ──
    if (line.startsWith("> ")) {
      rendered.push(
        <text key={i} fg={t.textMuted} selectable>{`│ ${stripInlineMarkdown(line.slice(2))}`}</text>
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
      <text key={i} selectable>{stripInlineMarkdown(line)}</text>
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
              <text fg={t.userText} flexGrow={1} selectable>{msg.content}</text>
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
              <text fg={t.systemText} flexGrow={1} selectable>{`⚡ ${msg.content}`}</text>
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
              input={msg.toolInput}
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

// ── Tool Helpers ──────────────────────────────────────

function trimText(s: string, max: number): string {
  const first = s.split("\n")[0] || "";
  return first.length > max ? first.substring(0, max) + "…" : first;
}

function shortPath(p: string): string {
  const home = process.env.HOME || "";
  let s = (home && p.startsWith(home)) ? "~" + p.slice(home.length) : p;
  // Show last 2 segments if too long
  if (s.length > 50) {
    const parts = s.split("/");
    s = "…/" + parts.slice(-2).join("/");
  }
  return s;
}

function countLines(s: string): number {
  return s ? s.split("\n").length : 0;
}

/** Extract a short description from tool input, per tool type */
function getToolDescription(name: string, input?: Record<string, any>): string {
  if (!input) return "";
  const fp = () => input.file_path ? shortPath(input.file_path) : (input.path ? shortPath(input.path) : "");
  switch (name) {
    // File operations
    case "file_read":
    case "file_write":
    case "file_edit":
    case "multi_edit":
    case "apply_patch":
    case "ast_edit":
    case "notebook_edit":
      return fp();
    // Search
    case "glob_search":
      return input.pattern ? `"${trimText(input.pattern, 40)}"` : "";
    case "grep_search":
      return input.pattern ? `"${trimText(input.pattern, 30)}"${input.path ? ` in ${shortPath(input.path)}` : ""}` : "";
    case "codebase_search":
      return input.query ? `"${trimText(input.query, 40)}"` : "";
    case "list_dir":
      return input.path ? shortPath(input.path) : (input.directory ? shortPath(input.directory) : "");
    // Execution
    case "shell_exec":
    case "powershell":
      return input.command ? trimText(input.command, 55) : "";
    case "file_run":
      return fp();
    case "repl":
      return input.code ? trimText(input.code, 50) : "";
    case "code_verify":
      return fp();
    // Web
    case "web_fetch":
    case "web_browser":
      return input.url ? trimText(input.url, 50) : "";
    case "web_search":
      return input.query ? `"${trimText(input.query, 40)}"` : "";
    // Agents
    case "sub_agent":
      return input.description || input.task ? trimText(input.description || input.task, 50) : "";
    case "send_message":
      return input.to ? trimText(input.to, 30) : "";
    case "sub_agent_status":
    case "sub_agent_terminate":
    case "task_get":
    case "task_stop":
      return input.id ? String(input.id) : "";
    // Session
    case "memory":
      return `${input.action || ""} ${trimText(input.key || input.query || "", 30)}`.trim();
    case "skill":
      return input.skill ? String(input.skill) : "";
    case "todo":
      return input.action ? String(input.action) : "";
    case "cron_create":
      return input.schedule ? trimText(input.schedule, 30) : "";
    case "cron_delete":
      return input.id ? String(input.id) : "";
    case "sleep":
      return input.seconds ? `${input.seconds}s` : (input.ms ? `${input.ms}ms` : "");
    // Viewing
    case "view_diff":
    case "view_repo_map":
      return input.path ? shortPath(input.path) : "";
    // System
    case "terminal_capture":
      return input.lines ? `${input.lines} lines` : "";
    case "config_update":
      return input.key ? String(input.key) : "";
    default: {
      // Fallback: try common fields
      if (input.description) return trimText(input.description, 50);
      const f = fp();
      if (f) return f;
      const q = input.query || input.command || input.pattern;
      if (q) return trimText(String(q), 40);
      return "";
    }
  }
}

/** Get a summary of the output for the collapsed view */
function getOutputSummary(name: string, output: string, isError?: boolean): string {
  if (!output) return "";
  if (isError) return trimText(output, 50);

  const lines = countLines(output);
  switch (name) {
    case "file_read":
      return `${lines} lines`;
    case "shell_exec":
    case "file_run":
    case "powershell":
    case "repl":
    case "code_verify":
      return lines > 1 ? `${lines} lines` : trimText(output, 40);
    case "grep_search":
    case "glob_search":
    case "codebase_search":
    case "list_dir": {
      const results = output.split("\n").filter((l) => l.trim()).length;
      return `${results} result${results !== 1 ? "s" : ""}`;
    }
    case "file_write":
    case "file_edit":
    case "multi_edit":
    case "apply_patch":
    case "ast_edit":
    case "notebook_edit":
      return output.includes("+") || output.includes("-") ? trimText(output, 40) : "done";
    default:
      return lines > 1 ? `${lines} lines` : trimText(output, 40);
  }
}

// ── Tool Call Row ──────────────────────────────────────

function ToolCallRow(props: {
  name: string;
  content: string;
  status: "running" | "done" | "error";
  input?: Record<string, any>;
}) {
  const { theme } = useTheme();
  const t = theme;

  const config = TOOL_CONFIG[props.name] || { label: props.name.replace(/_/g, " "), icon: "⚙", verb: "Running" };
  const isRunning = props.status === "running";
  const isError = props.status === "error";

  // Status indicator
  const statusIcon = isRunning ? "⟳" : isError ? "✗" : "✓";
  const statusColor = isRunning ? t.toolRunning : isError ? t.toolError : t.toolDone;

  // Description from input args
  const description = getToolDescription(props.name, props.input);

  // Output summary (shown after → arrow)
  const outputSummary = !isRunning ? getOutputSummary(props.name, props.content, isError) : "";

  // For shell commands, show the command inline
  const isShell = ["shell_exec", "file_run", "powershell", "repl"].includes(props.name);
  const shellCmd = isShell && (props.input?.command || props.input?.code) ? trimText(props.input.command || props.input.code, 55) : "";

  // For file ops, show the path
  const isFileOp = ["file_read", "file_write", "file_edit", "multi_edit", "apply_patch", "ast_edit", "notebook_edit"].includes(props.name);
  const filePath = isFileOp && (props.input?.file_path || props.input?.path) ? shortPath(props.input.file_path || props.input.path) : "";

  // For search ops, show the pattern
  const isSearch = ["grep_search", "glob_search", "codebase_search", "list_dir"].includes(props.name);
  const searchPattern = isSearch && (props.input?.pattern || props.input?.query || props.input?.path) ?
    trimText(props.input?.pattern || props.input?.query || props.input?.path, 35) : "";

  // Diff preview for edits
  const hasEditDiff = (props.name === "file_edit" || props.name === "multi_edit" || props.name === "ast_edit") &&
    props.input?.old_string && props.input?.new_string;
  const oldStr = hasEditDiff ? trimText(props.input!.old_string, 50) : "";
  const newStr = hasEditDiff ? trimText(props.input!.new_string, 50) : "";

  // Output content lines (for expanded view)
  const outputLines = props.content ? props.content.split("\n") : [];
  const maxPreviewLines = 6;
  const previewLines = outputLines.slice(0, maxPreviewLines);
  const hasMoreLines = outputLines.length > maxPreviewLines;

  return (
    <box flexDirection="column" paddingLeft={2} paddingRight={1}>
      {/* ── Header row: status + icon + label + description + output summary ── */}
      <box flexDirection="row" height={1}>
        <text fg={statusColor} attributes={isRunning ? TextAttributes.BOLD : undefined}>
          {`${statusIcon} `}
        </text>
        <text fg={t.textMuted}>{`${config.icon} `}</text>
        <text fg={isRunning ? t.toolRunning : t.text} attributes={TextAttributes.BOLD}>
          {isRunning ? `${config.verb}...` : config.label}
        </text>

        {/* Inline detail: file path, command, or search pattern */}
        {filePath && !isRunning ? (
          <text fg={t.info}>{` ${filePath}`}</text>
        ) : shellCmd ? (
          <text fg={isRunning ? t.textDim : t.textMuted}>{` $ ${shellCmd}`}</text>
        ) : searchPattern ? (
          <text fg={t.warning}>{` "${searchPattern}"`}</text>
        ) : description && !filePath && !shellCmd ? (
          <text fg={t.textDim}>{` ${description}`}</text>
        ) : null}

        {/* Output summary after arrow */}
        {outputSummary && !isRunning ? (
          <>
            <text fg={t.textDim}>{" → "}</text>
            <text fg={isError ? t.error : t.toolDone}>{outputSummary}</text>
          </>
        ) : null}
      </box>

      {/* ── Edit diff preview (for file_edit) ── */}
      {hasEditDiff && !isRunning && (
        <box flexDirection="column" paddingLeft={3}>
          <box flexDirection="row" height={1}>
            <text fg={t.diffRemove}>{`  - ${oldStr}`}</text>
          </box>
          <box flexDirection="row" height={1}>
            <text fg={t.diffAdd}>{`  + ${newStr}`}</text>
          </box>
        </box>
      )}

      {/* ── Shell output preview (for bash/run) ── */}
      {isShell && !isRunning && previewLines.length > 0 && (
        <box flexDirection="column" paddingLeft={3}>
          <box height={1}>
            <text fg={t.border}>{"  ┌" + "─".repeat(40)}</text>
          </box>
          {previewLines.map((line, i) => (
            <box key={i} height={1}>
              <text fg={t.textDim} selectable>{`  │ ${trimText(line, 55)}`}</text>
            </box>
          ))}
          {hasMoreLines && (
            <box height={1}>
              <text fg={t.textDim}>{`  │ … ${outputLines.length - maxPreviewLines} more lines`}</text>
            </box>
          )}
          <box height={1}>
            <text fg={t.border}>{"  └" + "─".repeat(40)}</text>
          </box>
        </box>
      )}

      {/* ── Search results preview ── */}
      {isSearch && !isRunning && previewLines.length > 0 && (
        <box flexDirection="column" paddingLeft={3}>
          {previewLines.slice(0, 4).map((line, i) => (
            <box key={i} height={1}>
              <text fg={t.textDim}>{`  ${trimText(line, 60)}`}</text>
            </box>
          ))}
          {outputLines.length > 4 && (
            <box height={1}>
              <text fg={t.textDim}>{`  … ${outputLines.length - 4} more`}</text>
            </box>
          )}
        </box>
      )}

      {/* ── Error output ── */}
      {isError && props.content && (
        <box flexDirection="column" paddingLeft={3}>
          <box height={1}>
            <text fg={t.error}>{`  ✗ ${trimText(props.content, 70)}`}</text>
          </box>
        </box>
      )}

      {/* ── Running indicator for shell commands ── */}
      {isShell && isRunning && (
        <box paddingLeft={3} height={1}>
          <text fg={t.toolRunning}>{"  ▊ Executing command..."}</text>
        </box>
      )}
    </box>
  );
}
