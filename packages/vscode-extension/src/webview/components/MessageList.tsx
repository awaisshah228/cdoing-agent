/**
 * MessageList.tsx — Scrollable Message Area with Premium Thinking Indicator
 *
 * Uses ResizeObserver for efficient auto-scrolling.
 * Features a branded animated thinking indicator instead of basic dots.
 */

import React from "react";
import type { ChatEntry } from "../types";
import { isChatMessage, isToolCallEntry } from "../types";
import { MessageBubble } from "./MessageBubble";
import { ToolCallBubble } from "./ToolCallBubble";
import { Welcome } from "./Welcome";
import { useAutoScroll } from "../hooks/useAutoScroll";

interface MessageListProps {
  entries: ChatEntry[];
  isProcessing: boolean;
  onQuickAction: (message: string) => void;
}

export const MessageList: React.FC<MessageListProps> = ({
  entries,
  isProcessing,
  onQuickAction,
}) => {
  const containerRef = useAutoScroll([entries, isProcessing]);

  return (
    <div className="messages" ref={containerRef}>
      {entries.length === 0 && <Welcome onQuickAction={onQuickAction} />}

      {entries.map((entry) => {
        if (isChatMessage(entry)) {
          return <MessageBubble key={entry.id} message={entry} />;
        }
        if (isToolCallEntry(entry)) {
          return <ToolCallBubble key={entry.id} entry={entry} />;
        }
        return null;
      })}

      {isProcessing && (
        <div className="thinking-indicator">
          <div className="thinking-indicator-avatar">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="#fff">
              <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
            </svg>
          </div>
          <div className="thinking-dots">
            <span /><span /><span />
          </div>
          <span className="thinking-label">Thinking...</span>
        </div>
      )}
    </div>
  );
};
