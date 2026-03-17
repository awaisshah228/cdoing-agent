/**
 * DialogCommand — command palette (Ctrl+P)
 *
 * Fuzzy-searchable list of commands with keyboard navigation.
 * Follows the opentuicli pattern with absolute positioned overlay.
 */

import { TextAttributes } from "@opentui/core";
import type { SelectOption } from "@opentui/core";
import { useState, useMemo } from "react";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useTheme } from "../context/theme";

// ── Command Definition ───────────────────────────────────────

export interface Command {
  id: string;
  label: string;
  shortcut?: string;
  category: string;
  icon?: string;
}

const COMMANDS: Command[] = [
  // Navigation
  { id: "route:dashboard", label: "Dashboard", shortcut: "1", category: "Navigation", icon: "\u25A0" },
  { id: "route:skills", label: "Skills", shortcut: "2", category: "Navigation", icon: "\u2726" },
  { id: "route:config", label: "Config", shortcut: "3", category: "Navigation", icon: "\u2699" },
  { id: "route:setup", label: "Setup", shortcut: "s", category: "Navigation", icon: "\u2692" },

  // Display
  { id: "display:sidebar", label: "Toggle Sidebar", shortcut: "Ctrl+B", category: "Display", icon: "\u2590" },
  { id: "display:theme", label: "Change Theme", shortcut: "", category: "Display", icon: "\u25C8" },

  // System
  { id: "system:help", label: "Help", shortcut: "F1", category: "System", icon: "?" },
  { id: "system:quit", label: "Quit", shortcut: "q", category: "System", icon: "\u23FB" },
];

// ── Fuzzy Match ──────────────────────────────────────────────

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

// ── Component ────────────────────────────────────────────────

export function DialogCommand(props: {
  onSelect: (commandId: string) => void;
  onClose: () => void;
}) {
  const { theme: t, customBg } = useTheme();
  const dims = useTerminalDimensions();
  const [query, setQuery] = useState("");

  const dialogWidth = Math.min(64, (dims.width || 80) - 4);
  const maxVisible = Math.max(8, Math.floor((dims.height || 24) * 0.6));

  const filtered = useMemo(() => {
    return COMMANDS.filter(
      (cmd) =>
        fuzzyMatch(query, cmd.label) ||
        fuzzyMatch(query, cmd.category) ||
        fuzzyMatch(query, cmd.id),
    );
  }, [query]);

  const selectOptions: SelectOption[] = useMemo(() => {
    return filtered.map((cmd) => {
      const shortcutStr = cmd.shortcut || "";
      return {
        name: `${cmd.icon || " "} ${cmd.label}`,
        description: [cmd.category, shortcutStr].filter(Boolean).join("  "),
        value: cmd.id,
      };
    });
  }, [filtered]);

  useKeyboard((key: any) => {
    if (key.name === "escape" || (key.ctrl && key.name === "p")) {
      props.onClose();
      return;
    }

    if (key.name === "up" || key.name === "down" || key.name === "return") return;

    if (key.name === "backspace") {
      setQuery((q) => q.slice(0, -1));
      return;
    }

    if (key.ctrl && key.name === "u") {
      setQuery("");
      return;
    }

    if (key.sequence && key.sequence.length === 1 && !key.ctrl && !key.meta) {
      setQuery((q) => q + key.sequence);
    }
  });

  return (
    <box
      borderStyle="double"
      borderColor={t.primary}
      backgroundColor={customBg ? t.bg : t.bg}
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
        <text fg={t.border}>{"\u2500".repeat(dialogWidth - 4)}</text>
      </box>
      <box flexDirection="row" flexShrink={0} height={1}>
        <text fg={t.textMuted}>{" > "}</text>
        <text fg={t.text}>{query || ""}</text>
        <text fg={t.primary} attributes={TextAttributes.BOLD}>{"\u2588"}</text>
      </box>
      <box height={1} flexShrink={0}>
        <text fg={t.border}>{"\u2500".repeat(dialogWidth - 4)}</text>
      </box>

      {/* Command list */}
      {selectOptions.length > 0 ? (
        <select
          options={selectOptions}
          focused={true}
          height={Math.min(maxVisible, selectOptions.length)}
          showDescription={true}
          backgroundColor={t.bg}
          focusedBackgroundColor={t.bg}
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
        <text fg={t.border}>{"\u2500".repeat(dialogWidth - 4)}</text>
      </box>
      <box flexDirection="row" height={1} flexShrink={0}>
        <text fg={t.textDim}>{" \u2191\u2193 navigate  "}</text>
        <text fg={t.textDim}>{"enter select  "}</text>
        <text fg={t.textDim}>{"type to filter  "}</text>
        <text fg={t.textDim}>{"esc close"}</text>
      </box>
    </box>
  );
}
