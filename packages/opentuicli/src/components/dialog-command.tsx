/**
 * DialogCommand — command palette dialog (Ctrl+X)
 *
 * A centered modal with all available commands grouped by category,
 * fuzzy search/filtering, keyboard shortcuts, and vim-style navigation.
 */

import { TextAttributes } from "@opentui/core";
import { useState, useMemo, type ReactNode } from "react";
import { useKeyboard } from "@opentui/react";
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
  const { theme } = useTheme();
  const t = theme;
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);

  // Filter commands by fuzzy search across label and category
  const filtered = useMemo(() => {
    return COMMANDS.filter(
      (cmd) => fuzzyMatch(query, cmd.label) || fuzzyMatch(query, cmd.category)
    );
  }, [query]);

  // Group filtered commands by category, preserving order
  const groups = useMemo(() => {
    const map = new Map<string, Command[]>();
    for (const cmd of filtered) {
      const list = map.get(cmd.category);
      if (list) {
        list.push(cmd);
      } else {
        map.set(cmd.category, [cmd]);
      }
    }
    return map;
  }, [filtered]);

  // Flat list for index-based navigation
  const flatList = filtered;

  // Clamp selected when list shrinks
  const clampedSelected = Math.min(selected, Math.max(0, flatList.length - 1));

  useKeyboard((key: any) => {
    if (key.name === "escape") {
      props.onClose();
      return;
    }

    if (key.name === "return") {
      const cmd = flatList[clampedSelected];
      if (cmd) props.onSelect(cmd.id);
      return;
    }

    if (key.name === "up" || (key.name === "k" && !query)) {
      setSelected((s) => Math.max(0, s - 1));
      return;
    }

    if (key.name === "down" || (key.name === "j" && !query)) {
      setSelected((s) => Math.min(flatList.length - 1, s + 1));
      return;
    }

    // Backspace
    if (key.name === "backspace") {
      setQuery((q) => q.slice(0, -1));
      setSelected(0);
      return;
    }

    // Printable character — append to query
    if (key.sequence && key.sequence.length === 1 && !key.ctrl && !key.meta) {
      setQuery((q) => q + key.sequence);
      setSelected(0);
    }
  });

  // Build rows: category headers + command items
  let flatIndex = 0;
  const rows: ReactNode[] = [];

  for (const [category, cmds] of groups) {
    // Category header
    rows.push(
      <text key={`cat-${category}`} fg={t.secondary} attributes={TextAttributes.BOLD}>
        {`  ${category}`}
      </text>
    );

    for (const cmd of cmds) {
      const isSel = flatIndex === clampedSelected;
      const shortcutText = cmd.shortcut ? `  ${cmd.shortcut}` : "";
      rows.push(
        <box key={cmd.id} flexDirection="row">
          <text
            fg={isSel ? t.primary : t.text}
            attributes={isSel ? TextAttributes.BOLD : undefined}
          >
            {`    ${isSel ? ">" : " "} ${cmd.label}`}
          </text>
          <text fg={t.textDim}>{shortcutText}</text>
        </box>
      );
      flatIndex++;
    }

    // Spacer between groups
    rows.push(
      <text key={`spacer-${category}`} fg={t.textDim}>{""}</text>
    );
  }

  return (
    <box
      borderStyle="double"
      borderColor={t.primary}
      paddingX={1}
      paddingY={1}
      flexDirection="column"
      position="absolute"
      top="15%"
      left="15%"
      width="70%"
    >
      {/* Title */}
      <text fg={t.primary} attributes={TextAttributes.BOLD}>
        {"  Command Palette"}
      </text>
      <text fg={t.textDim}>{""}</text>

      {/* Search input */}
      <box flexDirection="row">
        <text fg={t.textMuted}>{"  > "}</text>
        <text fg={t.text}>{query || ""}</text>
        <text fg={t.primary} attributes={TextAttributes.BOLD}>{"_"}</text>
      </box>
      <text fg={t.textDim}>{""}</text>

      {/* Command list */}
      {flatList.length > 0 ? (
        rows
      ) : (
        <text fg={t.textDim}>{"  No matching commands"}</text>
      )}

      {/* Footer */}
      <text fg={t.textDim}>{"  ↑↓/jk Navigate  Enter Select  Esc Close"}</text>
    </box>
  );
}
