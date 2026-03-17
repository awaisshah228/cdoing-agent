/**
 * DialogCommand — command palette (Ctrl+P)
 *
 * Full command palette with categories, fuzzy search, shortcuts,
 * and keyboard navigation. Inspired by OpenCode's command palette.
 */

import { TextAttributes } from "@opentui/core";
import type { SelectOption } from "@opentui/core";
import { useState, useMemo } from "react";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useTheme } from "../context/theme";

// ── Command Definition ───────────────────────────────────

export interface Command {
  id: string;
  label: string;
  shortcut?: string;
  category: string;
  icon?: string;
}

const COMMANDS: Command[] = [
  // Session
  { id: "session:new", label: "New Session", shortcut: "Ctrl+N", category: "Session", icon: "+" },
  { id: "session:browse", label: "Browse Sessions", shortcut: "Ctrl+S", category: "Session", icon: "◦" },
  { id: "session:clear", label: "Clear History", shortcut: "", category: "Session", icon: "✕" },

  // Model & Provider
  { id: "model:switch", label: "Switch Model", shortcut: "Ctrl+O", category: "Model", icon: "◆" },
  { id: "model:provider", label: "Switch Provider", shortcut: "", category: "Model", icon: "◆" },

  // Theme & Appearance
  { id: "theme:picker", label: "Browse Themes", shortcut: "Ctrl+T", category: "Appearance", icon: "◈" },
  { id: "theme:dark", label: "Dark Mode", shortcut: "", category: "Appearance", icon: "●" },
  { id: "theme:light", label: "Light Mode", shortcut: "", category: "Appearance", icon: "○" },
  { id: "display:sidebar", label: "Toggle Sidebar", shortcut: "Ctrl+B", category: "Appearance", icon: "▐" },

  // Tools
  { id: "tool:shell", label: "Run Shell Command", shortcut: "", category: "Tools", icon: "$" },
  { id: "tool:search", label: "Search Codebase", shortcut: "", category: "Tools", icon: "?" },
  { id: "tool:tree", label: "File Tree", shortcut: "", category: "Tools", icon: "├" },

  // System
  { id: "system:status", label: "System Status", shortcut: "", category: "System", icon: "i" },
  { id: "system:help", label: "Help", shortcut: "F1", category: "System", icon: "?" },
  { id: "system:doctor", label: "Doctor (Diagnostics)", shortcut: "", category: "System", icon: "+" },
  { id: "system:setup", label: "Setup Wizard (Connect Provider)", shortcut: "", category: "System", icon: "⚙" },
  { id: "system:exit", label: "Exit", shortcut: "Ctrl+C", category: "System", icon: "⏻" },
];

// ── Fuzzy Match ──────────────────────────────────────────

function fuzzyMatch(query: string, text: string): boolean {
  if (!query) return true;
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  let qi = 0;
  for (let i = 0; i < lower.length && qi < q.length; i++) {
    if (lower[i] === q[qi]) qi++;
  }
  return qi === q.length;
}

// ── Component ────────────────────────────────────────────

export function DialogCommand(props: {
  onSelect: (commandId: string) => void;
  onClose: () => void;
}) {
  const { theme, customBg } = useTheme();
  const t = theme;
  const dims = useTerminalDimensions();
  const [query, setQuery] = useState("");

  const dialogWidth = Math.min(64, (dims.width || 80) - 4);
  const maxVisible = Math.max(8, Math.floor((dims.height || 24) * 0.6));

  // Filter commands by fuzzy search across label, category, and id
  const filtered = useMemo(() => {
    return COMMANDS.filter(
      (cmd) =>
        fuzzyMatch(query, cmd.label) ||
        fuzzyMatch(query, cmd.category) ||
        fuzzyMatch(query, cmd.id)
    );
  }, [query]);

  // Group by category for display (with separators)
  const selectOptions: SelectOption[] = useMemo(() => {
    const opts: SelectOption[] = [];
    let lastCategory = "";
    for (const cmd of filtered) {
      if (cmd.category !== lastCategory) {
        lastCategory = cmd.category;
      }
      const shortcutStr = cmd.shortcut || "";
      opts.push({
        name: `${cmd.icon || " "} ${cmd.label}`,
        description: [cmd.category, shortcutStr].filter(Boolean).join("  "),
        value: cmd.id,
      });
    }
    return opts;
  }, [filtered]);

  useKeyboard((key: any) => {
    if (key.name === "escape" || (key.ctrl && key.name === "p")) {
      props.onClose();
      return;
    }

    // Let <select> handle up/down/return
    if (key.name === "up" || key.name === "down" || key.name === "return") return;

    // Backspace — search
    if (key.name === "backspace") {
      setQuery((q) => q.slice(0, -1));
      return;
    }

    // Ctrl+U — clear search
    if (key.ctrl && key.name === "u") {
      setQuery("");
      return;
    }

    // Printable character — append to query
    if (key.sequence && key.sequence.length === 1 && !key.ctrl && !key.meta) {
      setQuery((q) => q + key.sequence);
    }
  });

  return (
    <box
      borderStyle="double"
      borderColor={t.primary}
      backgroundColor={customBg || t.bg}
      paddingX={1}
      paddingY={0}
      flexDirection="column"
      position="absolute"
      top={Math.max(1, Math.floor((dims.height || 24) * 0.1))}
      left={Math.max(1, Math.floor(((dims.width || 80) - dialogWidth) / 2))}
      width={dialogWidth}
    >
      {/* Title bar */}
      <box flexDirection="row" flexShrink={0} height={1}>
        <text fg={t.primary} attributes={TextAttributes.BOLD} flexGrow={1}>
          {" Commands"}
        </text>
        <text fg={t.textDim}>{"Ctrl+P "}</text>
      </box>

      {/* Search input */}
      <box height={1} flexShrink={0}>
        <text fg={t.border}>{"─".repeat(dialogWidth - 4)}</text>
      </box>
      <box flexDirection="row" flexShrink={0} height={1}>
        <text fg={t.textMuted}>{" > "}</text>
        <text fg={t.text}>{query || ""}</text>
        <text fg={t.primary} attributes={TextAttributes.BOLD}>{"█"}</text>
      </box>
      <box height={1} flexShrink={0}>
        <text fg={t.border}>{"─".repeat(dialogWidth - 4)}</text>
      </box>

      {/* Command list */}
      {selectOptions.length > 0 ? (
        <select
          options={selectOptions}
          focused={true}
          height={Math.min(maxVisible, selectOptions.length)}
          showDescription={true}
          backgroundColor={customBg || undefined}
          focusedBackgroundColor={customBg || undefined}
          textColor={t.text}
          focusedTextColor={t.text}
          selectedBackgroundColor={t.primary}
          selectedTextColor={t.bg}
          descriptionColor={t.textDim}
          selectedDescriptionColor={t.bg}
          showScrollIndicator={selectOptions.length > maxVisible}
          onSelect={(_index: number, option: SelectOption | null) => {
            if (option?.value) props.onSelect(option.value);
          }}
        />
      ) : (
        <box height={1}>
          <text fg={t.textDim}>{"  No matching commands"}</text>
        </box>
      )}

      {/* Footer */}
      <box height={1} flexShrink={0}>
        <text fg={t.border}>{"─".repeat(dialogWidth - 4)}</text>
      </box>
      <box flexDirection="row" height={1} flexShrink={0}>
        <text fg={t.textDim}>{" ↑↓ navigate  "}</text>
        <text fg={t.textDim}>{"enter select  "}</text>
        <text fg={t.textDim}>{"type to filter  "}</text>
        <text fg={t.textDim}>{"esc close"}</text>
      </box>
    </box>
  );
}
