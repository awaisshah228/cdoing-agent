/**
 * MessageBubble.tsx — Single Chat Message
 *
 * Renders one message bubble. The CSS class changes based on the role:
 *   - "user"      → right-aligned, button-colored background
 *   - "assistant"  → left-aligned, editor background
 *   - "system"     → info style with accent border
 *   - "error"      → red error style
 */

import React from "react";
import type { ChatMessage } from "../types";

interface MessageBubbleProps {
  message: ChatMessage;
}

export const MessageBubble: React.FC<MessageBubbleProps> = ({ message }) => {
  // The role is used as a CSS class: "message user", "message assistant", etc.
  return (
    <div className={`message ${message.role}`}>
      {message.content}
    </div>
  );
};
