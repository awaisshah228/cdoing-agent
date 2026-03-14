/**
 * MessageList.tsx — Scrollable Message Area (ResizeObserver-based scroll)
 *
 * Uses ResizeObserver for efficient auto-scrolling (no scroll event polling).
 * User can scroll up to read history — auto-scroll pauses until they scroll back down.
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
        <div className="typing active">
          <div className="typing-dots">
            <span /><span /><span />
          </div>
          <span>Thinking...</span>
        </div>
      )}
    </div>
  );
};
