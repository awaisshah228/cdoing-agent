/**
 * MessageBubble.tsx — Single Chat Message (Memoized, Claude Code style)
 *
 * Wrapped in React.memo — only re-renders when message content changes.
 * Detects clickable file paths in rendered HTML and opens them in the editor.
 */

import React, { useMemo, useCallback, useRef, useEffect } from "react";
import type { ChatMessage } from "../types";
import { renderMarkdown } from "../utils/markdown";
import { useVsCode } from "../hooks/useVsCode";

interface MessageBubbleProps {
  message: ChatMessage;
}

const ROLE_LABELS: Record<string, string> = {
  user: "You",
  assistant: "Assistant",
  system: "System",
  error: "Error",
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

  // Click handler for file links and code copy buttons
  const handleClick = useCallback((e: MouseEvent) => {
    const target = e.target as HTMLElement;

    // Handle clickable file paths in inline code
    if (target.classList.contains("file-link")) {
      const filePath = target.getAttribute("data-path");
      if (filePath) {
        e.preventDefault();
        vscode.postMessage({ type: "command", command: "openFile", args: [filePath] } as any);
      }
    }
  }, [vscode]);

  // Attach click handler to content div
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    el.addEventListener("click", handleClick);
    return () => el.removeEventListener("click", handleClick);
  }, [handleClick]);

  return (
    <div className={`message-row ${message.role}`}>
      <div className="message-role">
        {ROLE_LABELS[message.role] || message.role}
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

/** Memoized — only re-renders when message id or content changes */
export const MessageBubble = React.memo(MessageBubbleInner, (prev, next) => {
  return prev.message.id === next.message.id && prev.message.content === next.message.content;
});
