/**
 * MessageBubble.tsx — Premium Chat Message with Avatar
 *
 * Features role avatars, smooth entry animation, and polished typography.
 * Memoized — only re-renders when message content changes.
 */

import React, { useMemo, useCallback, useRef, useEffect } from "react";
import type { ChatMessage } from "../types";
import { renderMarkdown } from "../utils/markdown";
import { useVsCode } from "../hooks/useVsCode";

interface MessageBubbleProps {
  message: ChatMessage;
}

const ROLE_CONFIG: Record<string, { label: string; avatar: string }> = {
  user: { label: "You", avatar: "U" },
  assistant: { label: "Cdoing", avatar: "C" },
  system: { label: "System", avatar: "S" },
  error: { label: "Error", avatar: "!" },
};

const MessageBubbleInner: React.FC<MessageBubbleProps> = ({ message }) => {
  const vscode = useVsCode();
  const contentRef = useRef<HTMLDivElement>(null);

  const htmlContent = useMemo(() => {
    if (message.role === "assistant" || message.role === "system" || message.role === "error") {
      return renderMarkdown(message.content);
    }
    return null;
  }, [message.content, message.role]);

  const handleClick = useCallback((e: MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.classList.contains("file-link")) {
      const filePath = target.getAttribute("data-path");
      if (filePath) {
        e.preventDefault();
        vscode.postMessage({ type: "command", command: "openFile", args: [filePath] } as any);
      }
    }
  }, [vscode]);

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    el.addEventListener("click", handleClick);
    return () => el.removeEventListener("click", handleClick);
  }, [handleClick]);

  const config = ROLE_CONFIG[message.role] || { label: message.role, avatar: "?" };

  return (
    <div className={`message-row ${message.role}`}>
      <div className="message-header">
        <div className="message-avatar">{config.avatar}</div>
        <div className="message-role">{config.label}</div>
      </div>
      {htmlContent ? (
        <div
          ref={contentRef}
          className="message-content"
          dangerouslySetInnerHTML={{ __html: htmlContent }}
        />
      ) : (
        <div className="message-content">{message.content}</div>
      )}
    </div>
  );
};

export const MessageBubble = React.memo(MessageBubbleInner, (prev, next) => {
  return prev.message.id === next.message.id && prev.message.content === next.message.content;
});
