/**
 * SessionBrowser — Interactive TUI overlay for browsing saved conversations
 *
 * Features:
 *   - Arrow keys to navigate
 *   - Enter to resume a conversation
 *   - d to delete, f to fork, v to view
 *   - Escape to close
 */

import { TextAttributes } from "@opentui/core";
import { useState, useMemo } from "react";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useTheme } from "../context/theme";
import {
  listConversations,
  deleteConversation,
  forkConversation,
  formatRelativeDate,
  type Conversation,
} from "../lib/history";

export interface SessionBrowserProps {
  onResume: (conv: Conversation) => void;
  onClose: () => void;
}

export function SessionBrowser(props: SessionBrowserProps) {
  const { theme } = useTheme();
  const t = theme;
  const dims = useTerminalDimensions();

  const [conversations, setConversations] = useState(() => listConversations());
  const [selected, setSelected] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [viewMode, setViewMode] = useState(false);
  const [viewScroll, setViewScroll] = useState(0);

  const maxVisible = Math.max(5, Math.floor((dims.height || 20) - 10));

  const scrollOffset = useMemo(() => {
    if (selected < maxVisible) return 0;
    return selected - maxVisible + 1;
  }, [selected, maxVisible]);

  const visibleConvs = conversations.slice(scrollOffset, scrollOffset + maxVisible);

  useKeyboard((key: any) => {
    if (viewMode) {
      // View mode controls
      if (key.name === "escape" || key.name === "q") {
        setViewMode(false);
        setViewScroll(0);
      } else if (key.name === "up" || key.name === "k") {
        setViewScroll((s) => Math.max(0, s - 1));
      } else if (key.name === "down" || key.name === "j") {
        const conv = conversations[selected];
        if (conv) {
          const msgs = conv.messages.filter((m) => m.role !== "tool");
          setViewScroll((s) => Math.min(msgs.length - 1, s + 1));
        }
      } else if (key.name === "return") {
        const conv = conversations[selected];
        if (conv) props.onResume(conv);
      }
      return;
    }

    if (confirmDelete) {
      if (key.name === "y") {
        const conv = conversations[selected];
        if (conv) {
          deleteConversation(conv.id);
          const updated = listConversations();
          setConversations(updated);
          setSelected((s) => Math.min(s, updated.length - 1));
        }
        setConfirmDelete(false);
      } else {
        setConfirmDelete(false);
      }
      return;
    }

    if (key.name === "escape" || key.name === "q") {
      props.onClose();
    } else if (key.name === "up" || key.name === "k") {
      setSelected((s) => Math.max(0, s - 1));
    } else if (key.name === "down" || key.name === "j") {
      setSelected((s) => Math.min(conversations.length - 1, s + 1));
    } else if (key.name === "return") {
      const conv = conversations[selected];
      if (conv) props.onResume(conv);
    } else if (key.name === "d") {
      if (conversations.length > 0) setConfirmDelete(true);
    } else if (key.name === "f") {
      const conv = conversations[selected];
      if (conv) {
        const forked = forkConversation(conv);
        if (forked) {
          setConversations(listConversations());
        }
      }
    } else if (key.name === "v") {
      if (conversations.length > 0) {
        setViewMode(true);
        setViewScroll(0);
      }
    }
  });

  if (conversations.length === 0) {
    return (
      <box
        borderStyle="single"
        borderColor={t.primary}
        paddingX={2}
        paddingY={1}
        flexDirection="column"
        flexGrow={1}
      >
        <text fg={t.primary} attributes={TextAttributes.BOLD}>
          {"Sessions"}
        </text>
        <text fg={t.textDim}>{"\nNo saved conversations.\n"}</text>
        <text fg={t.textMuted}>{"Esc  Close"}</text>
      </box>
    );
  }

  // View mode — show messages from selected conversation
  if (viewMode) {
    const conv = conversations[selected];
    const msgs = conv ? conv.messages.filter((m) => m.role !== "tool") : [];
    const visibleMsgs = msgs.slice(viewScroll, viewScroll + maxVisible);
    const total = msgs.length;

    return (
      <box
        borderStyle="single"
        borderColor={t.primary}
        paddingX={1}
        paddingY={0}
        flexDirection="column"
        flexGrow={1}
      >
        <text fg={t.primary} attributes={TextAttributes.BOLD}>
          {`Viewing: ${conv?.title || "Untitled"}`}
        </text>
        <text fg={t.textDim}>
          {`${viewScroll + 1}–${Math.min(viewScroll + maxVisible, total)} of ${total} messages`}
        </text>
        <text>{""}</text>
        {visibleMsgs.map((m, i) => {
          const prefix = m.role === "user" ? "❯" : "◆";
          const color = m.role === "user" ? t.success : t.text;
          const content = m.content.length > 120 ? m.content.substring(0, 117) + "..." : m.content;
          return (
            <text key={`view-${viewScroll + i}`} fg={color}>
              {`  ${prefix} ${content.replace(/\n/g, " ")}`}
            </text>
          );
        })}
        <text>{""}</text>
        <text fg={t.textMuted}>{"  ↑↓ Scroll  Enter Resume  Esc Back"}</text>
      </box>
    );
  }

  // List mode
  return (
    <box
      borderStyle="single"
      borderColor={t.primary}
      paddingX={1}
      paddingY={0}
      flexDirection="column"
      flexGrow={1}
    >
      <text fg={t.primary} attributes={TextAttributes.BOLD}>
        {"Sessions"}
      </text>
      <text fg={t.textDim}>
        {`${conversations.length} conversation${conversations.length !== 1 ? "s" : ""}`}
      </text>
      <text>{""}</text>
      {visibleConvs.map((conv, i) => {
        const idx = scrollOffset + i;
        const isSelected = idx === selected;
        const date = formatRelativeDate(conv.updatedAt);
        const msgCount = conv.messages.filter((m) => m.role === "user").length;
        const title = conv.title.length > 40 ? conv.title.substring(0, 37) + "..." : conv.title;

        return (
          <box key={conv.id} flexDirection="row">
            <text
              fg={isSelected ? t.primary : t.textMuted}
              attributes={isSelected ? TextAttributes.BOLD : undefined}
            >
              {`  ${isSelected ? "❯" : " "} ${title}`}
            </text>
            <text fg={t.textDim}>
              {`  ${date}  (${msgCount} msgs)`}
            </text>
          </box>
        );
      })}
      {confirmDelete && (
        <box>
          <text>{""}</text>
          <text fg={t.warning} attributes={TextAttributes.BOLD}>
            {`  Delete "${conversations[selected]?.title}"? (y/n)`}
          </text>
        </box>
      )}
      <text>{""}</text>
      <text fg={t.textMuted}>{"  ↑↓ Navigate  Enter Resume  v View  d Delete  f Fork  Esc Close"}</text>
    </box>
  );
}
