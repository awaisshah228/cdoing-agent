/**
 * SessionBrowser — Interactive TUI for browsing and selecting conversations.
 *
 * Triggered by /ls in chat or `cdoing ls` CLI command.
 * Arrow keys to navigate, Enter to load, v to view messages,
 * d to delete, f to fork, Esc to close/back.
 */

import React, { useState, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import type { Conversation } from "../history";
import { getTheme } from "./theme";

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

function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
}

/** Truncate text to maxLen, adding ellipsis if needed */
function truncate(text: string, maxLen: number): string {
  const clean = text.replace(/\n/g, " ").trim();
  return clean.length > maxLen ? clean.substring(0, maxLen - 1) + "…" : clean;
}

// ── Message Viewer ──────────────────────────────────────────────────────────

const MessageViewer: React.FC<{
  conversation: Conversation;
  onBack: () => void;
  onResume: () => void;
}> = ({ conversation, onBack, onResume }) => {
  const t = getTheme();
  const [scrollIdx, setScrollIdx] = useState(0);

  const messages = conversation.messages.filter((m) => m.role !== "tool");
  const termHeight = (process.stdout.rows || 24) - 8;
  const maxVisible = Math.max(3, termHeight);

  const visibleMessages = messages.slice(scrollIdx, scrollIdx + maxVisible);

  useInput(useCallback((char, key) => {
    if (key.escape) { onBack(); return; }
    if (key.return) { onResume(); return; }

    if (key.upArrow || (key.ctrl && char === "p")) {
      setScrollIdx((i) => Math.max(0, i - 1));
      return;
    }
    if (key.downArrow || (key.ctrl && char === "n")) {
      setScrollIdx((i) => Math.min(Math.max(0, messages.length - maxVisible), i + 1));
      return;
    }
    // Page up/down
    if (key.pageUp || (key.ctrl && char === "u")) {
      setScrollIdx((i) => Math.max(0, i - maxVisible));
      return;
    }
    if (key.pageDown || (key.ctrl && char === "d")) {
      setScrollIdx((i) => Math.min(Math.max(0, messages.length - maxVisible), i + maxVisible));
      return;
    }
  }, [messages.length, maxVisible, onBack, onResume]));

  const termWidth = process.stdout.columns || 80;
  const contentWidth = Math.min(termWidth - 8, 100);

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      {/* Header */}
      <Box>
        <Text color={t.accent} bold>  💬 </Text>
        <Text color={t.text} bold>{truncate(conversation.title, 50)}</Text>
      </Box>
      <Box paddingLeft={2}>
        <Text dimColor={t.useDim} color={t.textDim}>
          {`${messages.length} messages  ·  ${formatDate(conversation.createdAt)}  ·  ${conversation.provider}/${conversation.model}`}
        </Text>
      </Box>
      <Text dimColor={t.useDim} color={t.textDim}>  {"─".repeat(Math.min(60, contentWidth))}</Text>

      {/* Messages */}
      {visibleMessages.map((msg, i) => {
        const globalIdx = scrollIdx + i;
        const time = formatTimestamp(msg.timestamp);
        const isUser = msg.role === "user";

        // Wrap long messages to contentWidth
        const rawContent = msg.content.trim();
        const displayContent = rawContent.length > contentWidth * 3
          ? rawContent.substring(0, contentWidth * 3 - 3) + "..."
          : rawContent;
        const lines = displayContent.split("\n").slice(0, 6); // max 6 lines per message
        const hasMore = displayContent.split("\n").length > 6 || rawContent.length > contentWidth * 3;

        return (
          <Box key={globalIdx} flexDirection="column" paddingLeft={2} marginBottom={0}>
            <Box>
              <Text color={isUser ? t.prompt : t.accent} bold>
                {isUser ? "❯ " : "◆ "}
              </Text>
              <Text dimColor={t.useDim} color={t.textDim}>{time} </Text>
              <Text color={isUser ? t.prompt : t.accent} bold>
                {isUser ? "You" : "Assistant"}
              </Text>
            </Box>
            {lines.map((line, li) => (
              <Box key={li} paddingLeft={4}>
                <Text color={t.text} wrap="truncate">{line}</Text>
              </Box>
            ))}
            {hasMore ? (
              <Box paddingLeft={4}>
                <Text dimColor={t.useDim} color={t.textDim}>{"  ..."}</Text>
              </Box>
            ) : null}
          </Box>
        );
      })}

      {/* Scroll indicator */}
      {messages.length > maxVisible ? (
        <Box paddingLeft={2}>
          <Text dimColor={t.useDim} color={t.textDim}>
            {`  ${scrollIdx + 1}–${Math.min(scrollIdx + maxVisible, messages.length)} of ${messages.length} messages`}
          </Text>
        </Box>
      ) : null}

      {/* Footer */}
      <Text dimColor={t.useDim} color={t.textDim}>  {"─".repeat(Math.min(60, contentWidth))}</Text>
      <Text dimColor={t.useDim} color={t.textDim}>{"  ↑/↓ scroll  Enter=resume this conversation  Esc=back"}</Text>
    </Box>
  );
};

// ── Session List ────────────────────────────────────────────────────────────

export const SessionBrowser: React.FC<SessionBrowserProps> = ({
  conversations,
  onSelect,
  onDelete,
  onFork,
  onClose,
}) => {
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [viewingConv, setViewingConv] = useState<Conversation | null>(null);

  const termHeight = (process.stdout.rows || 24) - 8;
  const maxVisible = Math.max(5, termHeight);

  // Scroll window
  const scrollOffset = Math.max(0, selectedIdx - Math.floor(maxVisible / 2));
  const visible = conversations.slice(scrollOffset, scrollOffset + maxVisible);

  useInput(useCallback((char, key) => {
    // Don't handle input when viewing messages (MessageViewer handles it)
    if (viewingConv) return;

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
    // v = view messages
    if (char === "v" && conversations[selectedIdx]) {
      setViewingConv(conversations[selectedIdx]);
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
  }, [viewingConv, confirmDelete, conversations, selectedIdx, onSelect, onDelete, onFork, onClose]));

  const t = getTheme();

  // ── Message viewer overlay ──────────────────────────────────────────────
  if (viewingConv) {
    return (
      <MessageViewer
        conversation={viewingConv}
        onBack={() => setViewingConv(null)}
        onResume={() => {
          onSelect(viewingConv.id);
          setViewingConv(null);
        }}
      />
    );
  }

  // ── Empty state ─────────────────────────────────────────────────────────
  if (conversations.length === 0) {
    return (
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <Text color={t.accent} bold>  📚 Session Browser</Text>
        <Text dimColor={t.useDim} color={t.textDim}>  No saved conversations.</Text>
        <Text dimColor={t.useDim} color={t.textDim}>  Press Esc to close.</Text>
      </Box>
    );
  }

  // ── Session list ────────────────────────────────────────────────────────
  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      {/* Header */}
      <Box>
        <Text color={t.accent} bold>  📚 Sessions </Text>
        <Text dimColor={t.useDim} color={t.textDim}>{`(${conversations.length} total)`}</Text>
      </Box>
      <Text dimColor={t.useDim} color={t.textDim}>  {"─".repeat(60)}</Text>

      {/* Confirm delete */}
      {confirmDelete ? (
        <Box paddingLeft={2}>
          <Text color={t.error}>Delete this session? </Text>
          <Text color={t.warning}>[y/N] </Text>
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
                <Text color={t.accent} bold>{"▶ "}</Text>
                <Text backgroundColor={t.selectedBg} color={t.selected === "white" ? "black" : t.selected}>{` ${title.padEnd(42)} `}</Text>
                <Text color={t.sessionDate}>{` ${date.padEnd(8)} `}</Text>
                <Text dimColor={t.useDim} color={t.textDim}>{`${msgCount}msg`}</Text>
              </Box>
            ) : (
              <Box>
                <Text dimColor={t.useDim} color={t.textDim}>{"  "}</Text>
                <Text color={t.sessionTitle}>{` ${title.padEnd(42)} `}</Text>
                <Text dimColor={t.useDim} color={t.textDim}>{` ${date.padEnd(8)} `}</Text>
                <Text dimColor={t.useDim} color={t.textDim}>{`${msgCount}msg`}</Text>
              </Box>
            )}
          </Box>
        );
      })}

      {/* Scroll indicator */}
      {conversations.length > maxVisible ? (
        <Box paddingLeft={2}>
          <Text dimColor={t.useDim} color={t.textDim}>
            {`  ${scrollOffset + 1}–${Math.min(scrollOffset + maxVisible, conversations.length)} of ${conversations.length}`}
          </Text>
        </Box>
      ) : null}

      {/* Footer controls */}
      <Text dimColor={t.useDim} color={t.textDim}>  {"─".repeat(60)}</Text>
      <Text dimColor={t.useDim} color={t.textDim}>{"  ↑/↓ navigate  Enter=load  v=view messages  f=fork  d=delete  Esc=close"}</Text>
    </Box>
  );
};
