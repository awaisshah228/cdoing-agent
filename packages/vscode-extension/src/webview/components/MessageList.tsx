/**
 * MessageList.tsx — Scrollable Message Area
 *
 * Renders the list of all chat entries (messages + tool calls).
 * Shows the Welcome screen when the list is empty.
 * Auto-scrolls to the bottom when new entries arrive.
 * Shows a "Thinking..." indicator while the agent is processing.
 */

import React, { useRef, useEffect } from "react";
import type { ChatEntry } from "../types";
import { isChatMessage, isToolCallEntry } from "../types";
import { MessageBubble } from "./MessageBubble";
import { ToolCallBubble } from "./ToolCallBubble";
import { Welcome } from "./Welcome";

interface MessageListProps {
  entries: ChatEntry[];                      // All entries to display
  isProcessing: boolean;                     // Show typing indicator?
  onQuickAction: (message: string) => void;  // Called when user clicks a Welcome quick action
}

export const MessageList: React.FC<MessageListProps> = ({
  entries,
  isProcessing,
  onQuickAction,
}) => {
  // Invisible div at the bottom — we scroll to it whenever entries change
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages or tokens arrive
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [entries, isProcessing]);

  return (
    <div className="messages">
      {/* Show Welcome screen when there are no messages yet */}
      {entries.length === 0 && <Welcome onQuickAction={onQuickAction} />}

      {/* Render each entry as either a message bubble or a tool call bubble */}
      {entries.map((entry) => {
        if (isChatMessage(entry)) {
          return <MessageBubble key={entry.id} message={entry} />;
        }
        if (isToolCallEntry(entry)) {
          return <ToolCallBubble key={entry.id} entry={entry} />;
        }
        return null;
      })}

      {/* Animated dots shown while the agent is thinking */}
      {isProcessing && (
        <div className="typing active">
          <div className="typing-dots">
            <span /><span /><span />
          </div>
          <span>Thinking...</span>
        </div>
      )}

      {/* Scroll anchor — we scroll to this element to stay at the bottom */}
      <div ref={bottomRef} />
    </div>
  );
};
