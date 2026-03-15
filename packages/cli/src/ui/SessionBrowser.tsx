/**
 * SessionBrowser — Interactive TUI for browsing and selecting conversations.
 *
 * Triggered by /ls in chat or `cdoing ls` CLI command.
 * Arrow keys to navigate, Enter to load, d to delete, f to fork, Esc to close.
 */

import React, { useState, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import type { Conversation } from "../history";

interface SessionBrowserProps {
  conversations: Conversation[];
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onFork: (id: string) => void;
  onClose: () => void;
}

function formatDate(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export const SessionBrowser: React.FC<SessionBrowserProps> = ({
  conversations,
  onSelect,
  onDelete,
  onFork,
  onClose,
}) => {
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const termHeight = (process.stdout.rows || 24) - 8;
  const maxVisible = Math.max(5, termHeight);

  // Scroll window
  const scrollOffset = Math.max(0, selectedIdx - Math.floor(maxVisible / 2));
  const visible = conversations.slice(scrollOffset, scrollOffset + maxVisible);

  useInput(useCallback((char, key) => {
    if (confirmDelete) {
      if (char === "y" || char === "Y") {
        onDelete(confirmDelete);
        setConfirmDelete(null);
        setSelectedIdx((i) => Math.min(i, Math.max(0, conversations.length - 2)));
      } else {
        setConfirmDelete(null);
      }
      return;
    }

    if (key.escape) { onClose(); return; }

    if (key.upArrow || (key.ctrl && char === "p")) {
      setSelectedIdx((i) => Math.max(0, i - 1));
      return;
    }
    if (key.downArrow || (key.ctrl && char === "n")) {
      setSelectedIdx((i) => Math.min(conversations.length - 1, i + 1));
      return;
    }
    if (key.return && conversations[selectedIdx]) {
      onSelect(conversations[selectedIdx].id);
      return;
    }
    if (char === "d" && conversations[selectedIdx]) {
      setConfirmDelete(conversations[selectedIdx].id);
      return;
    }
    if (char === "f" && conversations[selectedIdx]) {
      onFork(conversations[selectedIdx].id);
      return;
    }
  }, [confirmDelete, conversations, selectedIdx, onSelect, onDelete, onFork, onClose]));

  if (conversations.length === 0) {
    return (
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <Text color="cyan" bold>  📚 Session Browser</Text>
        <Text dimColor>  No saved conversations.</Text>
        <Text dimColor>  Press Esc to close.</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      {/* Header */}
      <Box>
        <Text color="cyan" bold>  📚 Sessions </Text>
        <Text dimColor>{`(${conversations.length} total)`}</Text>
      </Box>
      <Text dimColor>  {"─".repeat(60)}</Text>

      {/* Confirm delete */}
      {confirmDelete ? (
        <Box paddingLeft={2}>
          <Text color="red">Delete this session? </Text>
          <Text color="yellow">[y/N] </Text>
        </Box>
      ) : null}

      {/* Session list */}
      {visible.map((conv, i) => {
        const globalIdx = scrollOffset + i;
        const isSelected = globalIdx === selectedIdx;
        const msgCount = conv.messages.filter((m) => m.role === "user").length;
        const date = formatDate(conv.updatedAt);
        const title = conv.title.length > 42 ? conv.title.substring(0, 39) + "…" : conv.title;

        return (
          <Box key={conv.id} paddingLeft={2}>
            {isSelected ? (
              <Box>
                <Text color="cyan" bold>{"▶ "}</Text>
                <Text backgroundColor="cyan" color="black">{` ${title.padEnd(42)} `}</Text>
                <Text color="yellow">{` ${date.padEnd(8)} `}</Text>
                <Text dimColor>{`${msgCount}msg`}</Text>
              </Box>
            ) : (
              <Box>
                <Text dimColor>{"  "}</Text>
                <Text color="white">{` ${title.padEnd(42)} `}</Text>
                <Text dimColor>{` ${date.padEnd(8)} `}</Text>
                <Text dimColor>{`${msgCount}msg`}</Text>
              </Box>
            )}
          </Box>
        );
      })}

      {/* Scroll indicator */}
      {conversations.length > maxVisible ? (
        <Box paddingLeft={2}>
          <Text dimColor>
            {`  ${scrollOffset + 1}–${Math.min(scrollOffset + maxVisible, conversations.length)} of ${conversations.length}`}
          </Text>
        </Box>
      ) : null}

      {/* Footer controls */}
      <Text dimColor>  {"─".repeat(60)}</Text>
      <Text dimColor>{"  ↑/↓ navigate  Enter=load  f=fork  d=delete  Esc=close"}</Text>
    </Box>
  );
};
