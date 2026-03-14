/**
 * MessageBubble.tsx — Single Chat Message (Claude Code style)
 *
 * Renders a full-width message row with a role label and content.
 * Assistant messages render basic markdown. User messages show plain text.
 */

import React, { useMemo } from "react";
import type { ChatMessage } from "../types";

interface MessageBubbleProps {
  message: ChatMessage;
}

/** Lightweight markdown-to-HTML for assistant messages */
function renderMarkdown(text: string): string {
  let html = text;

  // Escape HTML entities
  html = html.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  // Code blocks (``` ... ```)
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_m, _lang, code) => {
    return `<pre><code>${code.trimEnd()}</code></pre>`;
  });

  // Inline code
  html = html.replace(/`([^`\n]+)`/g, "<code>$1</code>");

  // Bold
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

  // Italic
  html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");

  // Links [text](url)
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

  // Unordered list items
  html = html.replace(/^- (.+)$/gm, "<li>$1</li>");
  html = html.replace(/(<li>.*<\/li>\n?)+/g, (match) => `<ul>${match}</ul>`);

  // Blockquotes
  html = html.replace(/^> (.+)$/gm, "<blockquote>$1</blockquote>");

  // Paragraphs — split on double newlines
  html = html
    .split(/\n\n+/)
    .map((block) => {
      const trimmed = block.trim();
      if (!trimmed) return "";
      // Don't wrap blocks that are already wrapped in HTML tags
      if (/^<(pre|ul|ol|blockquote|li)/.test(trimmed)) return trimmed;
      return `<p>${trimmed.replace(/\n/g, "<br/>")}</p>`;
    })
    .join("\n");

  return html;
}

const roleLabels: Record<string, string> = {
  user: "You",
  assistant: "Assistant",
  system: "System",
  error: "Error",
};

export const MessageBubble: React.FC<MessageBubbleProps> = ({ message }) => {
  const htmlContent = useMemo(() => {
    if (message.role === "assistant" || message.role === "system") {
      return renderMarkdown(message.content);
    }
    return null;
  }, [message.content, message.role]);

  return (
    <div className={`message-row ${message.role}`}>
      <div className="message-role">
        {roleLabels[message.role] || message.role}
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
