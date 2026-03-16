/**
 * DialogHelp — help dialog showing keyboard shortcuts, slash commands, and @mentions
 *
 * Opens as a centered scrollable modal. Navigate with Up/Down/PgUp/PgDn,
 * close with Esc or q.
 */

import { TextAttributes } from "@opentui/core";
import { useState } from "react";
import { useKeyboard } from "@opentui/react";
import { useTheme } from "../context/theme";

// ── Content Sections ────────────────────────────────────

interface HelpEntry {
  key: string;
  description: string;
}

const KEYBOARD_SHORTCUTS: HelpEntry[] = [
  { key: "Ctrl+N", description: "New session" },
  { key: "Ctrl+P", description: "Switch model" },
  { key: "Ctrl+S", description: "Browse sessions" },
  { key: "Ctrl+X", description: "Command palette" },
  { key: "F1", description: "Show this help" },
  { key: "Ctrl+V", description: "Paste text or image" },
  { key: "Ctrl+U", description: "Clear input line" },
  { key: "Ctrl+W", description: "Delete last word" },
  { key: "Tab / ->", description: "Accept autocomplete" },
  { key: "Up / Down", description: "Navigate suggestions" },
  { key: "Escape", description: "Close dialog / dropdown" },
  { key: "Ctrl+C", description: "Quit" },
];

const SLASH_COMMANDS: HelpEntry[] = [
  { key: "/help", description: "Show help" },
  { key: "/clear", description: "Clear chat history" },
  { key: "/new", description: "Start new conversation" },
  { key: "/compact", description: "Compress context window" },
  { key: "/btw <question>", description: "Ask without adding to history" },
  { key: "/model [name]", description: "Show/change model" },
  { key: "/provider [name]", description: "Show/change provider" },
  { key: "/mode", description: "Show permission mode" },
  { key: "/dir [path]", description: "Show/change working directory" },
  { key: "/config", description: "Show configuration" },
  { key: "/config set k v", description: "Set a config value" },
  { key: "/theme <mode>", description: "Switch theme (dark/light/auto)" },
  { key: "/effort <level>", description: "Set effort level" },
  { key: "/plan <on|off>", description: "Toggle plan mode" },
  { key: "/history", description: "List saved conversations" },
  { key: "/resume <id>", description: "Resume conversation" },
  { key: "/view <id>", description: "View conversation messages" },
  { key: "/fork [id]", description: "Fork conversation" },
  { key: "/delete <id>", description: "Delete conversation" },
  { key: "/bg <prompt>", description: "Run prompt in background" },
  { key: "/jobs [id]", description: "List/inspect background jobs" },
  { key: "/permissions", description: "Show permission rules" },
  { key: "/hooks", description: "Show configured hooks" },
  { key: "/rules", description: "Show project rules" },
  { key: "/context", description: "Show context providers" },
  { key: "/mcp", description: "MCP server management" },
  { key: "/doctor", description: "System health check" },
  { key: "/usage", description: "Show token usage" },
  { key: "/auth-status", description: "Show authentication status" },
  { key: "/setup", description: "Run setup wizard" },
  { key: "/login", description: "Open setup wizard" },
  { key: "/logout", description: "Clear OAuth tokens" },
  { key: "/init", description: "Initialize project config" },
  { key: "/exit", description: "Quit" },
];

const AT_MENTIONS: HelpEntry[] = [
  { key: "@terminal", description: "Recent terminal output" },
  { key: "@url", description: "Fetch URL content" },
  { key: "@tree", description: "Directory tree" },
  { key: "@codebase", description: "Search codebase" },
  { key: "@clip", description: "Clipboard contents" },
  { key: "@file", description: "Include file" },
];

// ── Build Lines ─────────────────────────────────────────

interface HelpLine {
  type: "header" | "entry" | "blank";
  text?: string;
  key?: string;
  description?: string;
}

function buildLines(): HelpLine[] {
  const lines: HelpLine[] = [];

  lines.push({ type: "header", text: "Keyboard Shortcuts" });
  lines.push({ type: "blank" });
  for (const entry of KEYBOARD_SHORTCUTS) {
    lines.push({ type: "entry", key: entry.key, description: entry.description });
  }

  lines.push({ type: "blank" });
  lines.push({ type: "header", text: "Slash Commands" });
  lines.push({ type: "blank" });
  for (const entry of SLASH_COMMANDS) {
    lines.push({ type: "entry", key: entry.key, description: entry.description });
  }

  lines.push({ type: "blank" });
  lines.push({ type: "header", text: "@Mentions" });
  lines.push({ type: "blank" });
  for (const entry of AT_MENTIONS) {
    lines.push({ type: "entry", key: entry.key, description: entry.description });
  }

  return lines;
}

const ALL_LINES = buildLines();
const PAGE_SIZE = 15;

// ── Component ───────────────────────────────────────────

export function DialogHelp(props: {
  onClose: () => void;
}) {
  const { theme } = useTheme();
  const t = theme;
  const [scrollOffset, setScrollOffset] = useState(0);

  const maxOffset = Math.max(0, ALL_LINES.length - PAGE_SIZE);

  useKeyboard((key: any) => {
    if (key.name === "escape" || key.name === "q") {
      props.onClose();
      return;
    }

    if (key.name === "up" || key.name === "k") {
      setScrollOffset((s) => Math.max(0, s - 1));
      return;
    }

    if (key.name === "down" || key.name === "j") {
      setScrollOffset((s) => Math.min(maxOffset, s + 1));
      return;
    }

    if (key.name === "pageup") {
      setScrollOffset((s) => Math.max(0, s - PAGE_SIZE));
      return;
    }

    if (key.name === "pagedown") {
      setScrollOffset((s) => Math.min(maxOffset, s + PAGE_SIZE));
      return;
    }

    // Home / End
    if (key.name === "home") {
      setScrollOffset(0);
      return;
    }
    if (key.name === "end") {
      setScrollOffset(maxOffset);
      return;
    }
  });

  const visibleLines = ALL_LINES.slice(scrollOffset, scrollOffset + PAGE_SIZE);
  const keyColWidth = 20;

  return (
    <box
      borderStyle="double"
      borderColor={t.primary}
      paddingX={2}
      paddingY={1}
      flexDirection="column"
      position="absolute"
      top="10%"
      left="15%"
      width="70%"
      height="80%"
    >
      {/* Title */}
      <text fg={t.primary} attributes={TextAttributes.BOLD}>
        {"  Help"}
      </text>
      <text fg={t.textDim}>{""}</text>

      {/* Scrollable content */}
      {visibleLines.map((line, i) => {
        if (line.type === "blank") {
          return <text key={`line-${scrollOffset + i}`} fg={t.textDim}>{""}</text>;
        }

        if (line.type === "header") {
          return (
            <text
              key={`line-${scrollOffset + i}`}
              fg={t.primary}
              attributes={TextAttributes.BOLD}
            >
              {`  ${line.text}`}
            </text>
          );
        }

        // entry
        const paddedKey = (line.key || "").padEnd(keyColWidth);
        return (
          <box key={`line-${scrollOffset + i}`} flexDirection="row">
            <text fg={t.secondary}>{`    ${paddedKey}`}</text>
            <text fg={t.textMuted}>{line.description || ""}</text>
          </box>
        );
      })}

      {/* Scroll indicator */}
      <text fg={t.textDim}>{""}</text>
      <text fg={t.textDim}>
        {`  ${scrollOffset > 0 ? "..." : "   "} ${scrollOffset + 1}-${Math.min(scrollOffset + PAGE_SIZE, ALL_LINES.length)} of ${ALL_LINES.length} ${scrollOffset < maxOffset ? "..." : "   "}`}
      </text>

      {/* Footer */}
      <text fg={t.textDim}>{"  Up/Down/j/k Scroll  PgUp/PgDn Page  Esc/q Close"}</text>
    </box>
  );
}
