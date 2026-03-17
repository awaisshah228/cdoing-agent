/**
 * DialogHelp — help dialog showing keyboard shortcuts, slash commands, and @mentions
 *
 * Uses native <scrollbox> for smooth scrolling. Close with Esc or q.
 */

import { TextAttributes } from "@opentui/core";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
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

const keyColWidth = 20;

function Section(props: { title: string; entries: HelpEntry[]; theme: any }) {
  const t = props.theme;
  return (
    <box flexDirection="column" flexShrink={0}>
      <text fg={t.primary} attributes={TextAttributes.BOLD}>
        {`  ${props.title}`}
      </text>
      <text>{""}</text>
      {props.entries.map((entry) => (
        <box key={entry.key} flexDirection="row">
          <text fg={t.secondary}>{`    ${entry.key.padEnd(keyColWidth)}`}</text>
          <text fg={t.textMuted}>{entry.description}</text>
        </box>
      ))}
      <text>{""}</text>
    </box>
  );
}

// ── Component ───────────────────────────────────────────

export function DialogHelp(props: {
  onClose: () => void;
}) {
  const { theme, customBg } = useTheme();
  const t = theme;
  const dims = useTerminalDimensions();
  const dialogWidth = Math.min(70, (dims.width || 80) - 4);
  const dialogHeight = Math.max(10, (dims.height || 24) - 6);

  useKeyboard((key: any) => {
    if (key.name === "escape" || key.name === "q") {
      props.onClose();
    }
  });

  return (
    <box
      borderStyle="double"
      borderColor={t.primary}
      backgroundColor={customBg || t.bg}
      paddingX={2}
      paddingY={1}
      flexDirection="column"
      position="absolute"
      top={Math.max(1, Math.floor((dims.height || 24) * 0.05))}
      left={Math.max(1, Math.floor(((dims.width || 80) - dialogWidth) / 2))}
      width={dialogWidth}
      height={dialogHeight}
    >
      {/* Title bar */}
      <box flexDirection="row" flexShrink={0}>
        <text fg={t.primary} attributes={TextAttributes.BOLD} flexGrow={1}>
          {"  Help"}
        </text>
        <text fg={t.textDim}>{"esc"}</text>
      </box>
      <text flexShrink={0}>{""}</text>

      {/* Scrollable content */}
      <scrollbox flexGrow={1}>
        <box flexShrink={0}>
          <Section title="Keyboard Shortcuts" entries={KEYBOARD_SHORTCUTS} theme={t} />
          <Section title="Slash Commands" entries={SLASH_COMMANDS} theme={t} />
          <Section title="@Mentions" entries={AT_MENTIONS} theme={t} />
        </box>
      </scrollbox>
    </box>
  );
}
