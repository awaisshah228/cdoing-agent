/**
 * MessageBubble.tsx — Premium Chat Message with Avatar & Context Chips
 *
 * Features:
 *   - Role avatars with branded gradient (assistant) or accent (user)
 *   - Smooth entry animation
 *   - Rich context chip rendering (files, folders, selections, images)
 *   - Markdown rendering for all message types
 *   - Clickable file paths
 *
 * Memoized — only re-renders when message content/context changes.
 */

import React, { useMemo, useCallback, useRef, useEffect } from "react";
import type { ChatMessage, ContextAttachment } from "../types";
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

const LANG_ICONS: Record<string, string> = {
  javascript: "JS", typescript: "TS", python: "PY", go: "GO",
  rust: "RS", java: "JA", css: "CSS", html: "HTML", json: "{}",
  yaml: "YML", markdown: "MD", bash: "SH", sql: "SQL",
  cpp: "C++", c: "C", ruby: "RB", php: "PHP", swift: "SW",
};

// ── File Icon SVGs ──

const FileIcon: React.FC = () => (
  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
    <polyline points="13 2 13 9 20 9" />
  </svg>
);

const FolderIcon: React.FC = () => (
  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
  </svg>
);

const ImageIcon: React.FC = () => (
  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
    <circle cx="8.5" cy="8.5" r="1.5" />
    <polyline points="21 15 16 10 5 21" />
  </svg>
);

const CodeIcon: React.FC = () => (
  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="16 18 22 12 16 6" />
    <polyline points="8 6 2 12 8 18" />
  </svg>
);

// ── Context Chip for Messages ──

const MessageContextChip: React.FC<{
  attachment: ContextAttachment;
  onOpen: (path: string) => void;
}> = ({ attachment, onOpen }) => {
  const fileName = attachment.path.split("/").pop() || attachment.path;
  const lang = LANG_ICONS[attachment.language || ""] || "";

  let label: string;
  let icon: React.ReactNode;
  let badge: string | null = null;

  switch (attachment.type) {
    case "folder":
      label = `${fileName}/`;
      icon = <FolderIcon />;
      badge = "DIR";
      break;
    case "image":
      label = fileName;
      icon = <ImageIcon />;
      badge = "IMG";
      break;
    case "selection":
      label = attachment.startLine
        ? `${fileName}:${attachment.startLine}${attachment.endLine && attachment.endLine !== attachment.startLine ? `-${attachment.endLine}` : ""}`
        : fileName;
      icon = <CodeIcon />;
      badge = lang || "SEL";
      break;
    default:
      label = fileName;
      icon = <FileIcon />;
      badge = lang || "FILE";
  }

  return (
    <span
      className="msg-context-chip"
      title={attachment.path}
      onClick={() => attachment.type !== "image" && onOpen(attachment.path)}
    >
      <span className="msg-context-chip-icon">{icon}</span>
      {badge && <span className="msg-context-chip-badge">{badge}</span>}
      <span className="msg-context-chip-label">{label}</span>
    </span>
  );
};

// ── Image Thumbnail for Messages ──

const MessageImageThumb: React.FC<{ attachment: ContextAttachment }> = ({ attachment }) => {
  if (!attachment.base64 || !attachment.mimeType) return null;
  const src = `data:${attachment.mimeType};base64,${attachment.base64}`;
  const fileName = attachment.path.split("/").pop() || "image";

  return (
    <div className="msg-image-thumb">
      <img src={src} alt={fileName} />
      <span className="msg-image-thumb-label">{fileName}</span>
    </div>
  );
};

// ── Main Component ──

const MessageBubbleInner: React.FC<MessageBubbleProps> = ({ message }) => {
  const vscode = useVsCode();
  const contentRef = useRef<HTMLDivElement>(null);

  const htmlContent = useMemo(() => {
    // Render markdown for all roles (including user for formatting)
    if (message.content) {
      return renderMarkdown(message.content);
    }
    return null;
  }, [message.content]);

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

  const openFile = useCallback((path: string) => {
    vscode.postMessage({ type: "command", command: "openFile", args: [path] } as any);
  }, [vscode]);

  const config = ROLE_CONFIG[message.role] || { label: message.role, avatar: "?" };

  // Split context into images vs non-images
  const contextFiles = message.context?.filter((c) => c.type !== "image") || [];
  const contextImages = message.context?.filter((c) => c.type === "image") || [];

  return (
    <div className={`message-row ${message.role}`}>
      <div className="message-header">
        <div className="message-avatar">{config.avatar}</div>
        <div className="message-role">{config.label}</div>
      </div>

      {/* Context attachments — rendered as beautiful chips */}
      {(contextFiles.length > 0 || contextImages.length > 0) && (
        <div className="msg-context-area">
          {contextFiles.length > 0 && (
            <div className="msg-context-chips">
              {contextFiles.map((att, i) => (
                <MessageContextChip key={`${att.path}-${i}`} attachment={att} onOpen={openFile} />
              ))}
            </div>
          )}
          {contextImages.map((att, i) => (
            <MessageImageThumb key={`img-${att.path}-${i}`} attachment={att} />
          ))}
        </div>
      )}

      {/* Message text content */}
      {message.content && (
        htmlContent ? (
          <div
            ref={contentRef}
            className="message-content"
            dangerouslySetInnerHTML={{ __html: htmlContent }}
          />
        ) : (
          <div className="message-content">{message.content}</div>
        )
      )}
    </div>
  );
};

export const MessageBubble = React.memo(MessageBubbleInner, (prev, next) => {
  return prev.message.id === next.message.id
    && prev.message.content === next.message.content
    && prev.message.context === next.message.context;
});
