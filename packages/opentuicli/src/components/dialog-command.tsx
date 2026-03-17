/**
 * DialogCommand — command palette dialog (Ctrl+X)
 *
 * Uses OpenTUI <select> for the command list with fuzzy search.
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
}

const COMMANDS: Command[] = [
  // Session
  { id: "session:new", label: "New Session", shortcut: "Ctrl+N", category: "Session" },
  { id: "session:browse", label: "Browse Sessions", shortcut: "Ctrl+S", category: "Session" },
  { id: "session:clear", label: "Clear History", shortcut: "", category: "Session" },

  // Model & Provider
  { id: "model:switch", label: "Switch Model", shortcut: "Ctrl+P", category: "Model" },

  // Theme & Appearance
  { id: "theme:picker", label: "Browse Themes", shortcut: "Ctrl+T", category: "Appearance" },
  { id: "theme:dark", label: "Dark Mode", shortcut: "", category: "Appearance" },
  { id: "theme:light", label: "Light Mode", shortcut: "", category: "Appearance" },
  { id: "display:sidebar", label: "Toggle Sidebar", shortcut: "Ctrl+B", category: "Appearance" },

  // System
  { id: "system:status", label: "System Status", shortcut: "", category: "System" },
  { id: "system:help", label: "Help", shortcut: "F1", category: "System" },
  { id: "system:doctor", label: "Doctor", shortcut: "", category: "System" },
  { id: "system:setup", label: "Setup Wizard", shortcut: "", category: "System" },
  { id: "system:exit", label: "Exit", shortcut: "Ctrl+C", category: "System" },
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

  const dialogWidth = Math.min(60, (dims.width || 80) - 4);
  const maxVisible = Math.max(5, Math.floor((dims.height || 24) / 2));

  // Filter commands by fuzzy search across label and category
  const filtered = useMemo(() => {
    return COMMANDS.filter(
      (cmd) => fuzzyMatch(query, cmd.label) || fuzzyMatch(query, cmd.category)
    );
  }, [query]);

  // Convert to SelectOption format
  const selectOptions: SelectOption[] = useMemo(() => {
    return filtered.map((cmd) => ({
      name: cmd.label,
      description: [cmd.category, cmd.shortcut].filter(Boolean).join("  "),
      value: cmd.id,
    }));
  }, [filtered]);

  useKeyboard((key: any) => {
    if (key.name === "escape") {
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
      paddingY={1}
      flexDirection="column"
      position="absolute"
      top={Math.max(2, Math.floor((dims.height || 24) * 0.15))}
      left={Math.max(1, Math.floor(((dims.width || 80) - dialogWidth) / 2))}
      width={dialogWidth}
    >
      {/* Title bar */}
      <box flexDirection="row" flexShrink={0}>
        <text fg={t.primary} attributes={TextAttributes.BOLD} flexGrow={1}>
          {"  Command Palette"}
        </text>
        <text fg={t.textDim}>{"esc"}</text>
      </box>
      <text>{""}</text>

      {/* Search input */}
      <box flexDirection="row" flexShrink={0}>
        <text fg={t.textMuted}>{"  > "}</text>
        <text fg={t.text}>{query || ""}</text>
        <text fg={t.primary} attributes={TextAttributes.BOLD}>{"_"}</text>
      </box>
      <text flexShrink={0}>{""}</text>

      {/* Command list */}
      {selectOptions.length > 0 ? (
        <select
          options={selectOptions}
          focused={true}
          height={Math.min(maxVisible, selectOptions.length)}
          showDescription={true}
          backgroundColor={customBg || undefined}
          textColor={t.text}
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
        <text fg={t.textDim}>{"  No matching commands"}</text>
      )}

      {/* Footer */}
      <text flexShrink={0}>{""}</text>
      <text fg={t.textDim} flexShrink={0}>{"  ↑↓ Navigate  Enter Select  Type to filter  Esc Close"}</text>
    </box>
  );
}
