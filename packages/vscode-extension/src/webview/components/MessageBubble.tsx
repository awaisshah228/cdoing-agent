/**
 * MessageBubble.tsx — Single Chat Message (Claude Code style)
 *
 * Full-width row with role label and content.
 * Assistant/system messages render markdown. User messages show plain text.
 * File paths in messages are clickable (opens in editor).
 */

import React, { useMemo } from "react";
import type { ChatMessage } from "../types";
import { renderMarkdown } from "../utils/markdown";

interface MessageBubbleProps {
  message: ChatMessage;
}

const ROLE_LABELS: Record<string, string> = {
  user: "You",
  assistant: "Assistant",
  system: "System",
  error: "Error",
};

export const MessageBubble: React.FC<MessageBubbleProps> = ({ message }) => {
  const htmlContent = useMemo(() => {
    if (message.role === "assistant" || message.role === "system" || message.role === "error") {
      return renderMarkdown(message.content);
    }
    return null;
  }, [message.content, message.role]);

  return (
    <div className={`message-row ${message.role}`}>
      <div className="message-role">
        {ROLE_LABELS[message.role] || message.role}
      </div>
      {htmlContent ? (
        <div
          className="message-content"
          dangerouslySetInnerHTML={{ __html: htmlContent }}
        />
      ) : (
        <div className="message-content">{message.content}</div>
      )}
    </div>
  );
};
