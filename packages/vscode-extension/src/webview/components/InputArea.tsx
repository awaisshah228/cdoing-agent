/**
 * InputArea.tsx — Chat Input (Copilot style with @ autocomplete)
 *
 * Layout:
 *   ┌──────────────────────────────────────┐
 *   │ TS server.ts:519-520            ×   │  ← context chips
 *   │                                      │
 *   │ @src/app                             │  ← typing triggers dropdown
 *   │ ┌──────────────────────────────┐     │
 *   │ │ 📄 src/app.ts               │     │  ← file suggestions
 *   │ │ 📄 src/app.test.ts          │     │
 *   │ │ 📁 src/api/                 │     │
 *   │ └──────────────────────────────┘     │
 *   │ +  📎                            ↑  │  ← toolbar
 *   └──────────────────────────────────────┘
 */

import React, { useState, useRef, useCallback, useEffect } from "react";
import type { IncomingMessage, ContextAttachment } from "../types";
import { useVsCode } from "../hooks/useVsCode";

interface PermissionRequest {
  id: string;
  toolName: string;
  message: string;
  hasProject: boolean;
}

interface InputAreaProps {
  isProcessing: boolean;
  queueCount: number;
  onSend: (text: string, context?: ContextAttachment[]) => void;
  onCancel?: () => void;
  permissionRequest?: PermissionRequest | null;
  onPermissionResponse?: (decision: string) => void;
}

interface FileResult {
  path: string;
  isDir: boolean;
  language?: string;
}

const LANG_ICONS: Record<string, string> = {
  javascript: "JS", typescript: "TS", python: "PY", go: "GO",
  rust: "RS", java: "JA", css: "CSS", html: "HTML", json: "{}",
  yaml: "YML", markdown: "MD", bash: "SH", sql: "SQL",
  cpp: "C++", c: "C", ruby: "RB", php: "PHP", swift: "SW",
};

export const InputArea: React.FC<InputAreaProps> = ({ isProcessing, queueCount, onSend, onCancel, permissionRequest, onPermissionResponse }) => {
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<ContextAttachment[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [fileResults, setFileResults] = useState<FileResult[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [atQuery, setAtQuery] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const vscode = useVsCode();

  // ── Send ──
  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed && attachments.length === 0) return;
    onSend(trimmed, attachments.length > 0 ? attachments : undefined);
    setText("");
    setAttachments([]);
    setShowDropdown(false);
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  }, [text, attachments, onSend]);

  // ── Keydown ──
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (showDropdown && fileResults.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, fileResults.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        selectFile(fileResults[selectedIndex]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setShowDropdown(false);
        return;
      }
    }
    if (e.key === "Escape" && isProcessing) {
      e.preventDefault();
      onCancel?.();
      return;
    }
    if (e.key === "Enter" && !e.shiftKey && !showDropdown) {
      e.preventDefault();
      handleSend();
    }
  }, [showDropdown, fileResults, selectedIndex, handleSend, isProcessing, onCancel]);

  // ── Select a file from dropdown ──
  const selectFile = useCallback((file: FileResult) => {
    // Remove @query from text
    const atPos = text.lastIndexOf("@");
    const newText = atPos >= 0 ? text.substring(0, atPos) : text;
    setText(newText);

    // Add as context chip
    setAttachments((prev) => {
      if (prev.some((a) => a.path === file.path)) return prev;
      return [...prev, {
        type: file.isDir ? "folder" as const : "file" as const,
        path: file.path,
        language: file.language,
      }];
    });

    setShowDropdown(false);
    setFileResults([]);
    setSelectedIndex(0);
    setTimeout(() => textareaRef.current?.focus(), 0);
  }, [text]);

  // ── Text change — detect @ trigger ──
  const handleTextChange = useCallback((newText: string) => {
    setText(newText);

    // Auto-resize
    const el = textareaRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 150)}px`;
    }

    // Check for @ trigger
    const atPos = newText.lastIndexOf("@");
    if (atPos >= 0) {
      // Make sure @ is at start of word (not in an email)
      const charBefore = atPos > 0 ? newText[atPos - 1] : " ";
      if (charBefore === " " || charBefore === "\n" || atPos === 0) {
        const query = newText.substring(atPos + 1);
        // Don't trigger if there's a space after the query (user moved on)
        if (!query.includes(" ") && !query.includes("\n")) {
          setAtQuery(query);
          setShowDropdown(true);
          setSelectedIndex(0);

          // Debounce the search request
          if (debounceRef.current) clearTimeout(debounceRef.current);
          debounceRef.current = setTimeout(() => {
            vscode.postMessage({ type: "searchFiles", query });
          }, 150);
          return;
        }
      }
    }

    setShowDropdown(false);
  }, [vscode]);

  // ── Listen for messages ──
  useEffect(() => {
    function handler(event: MessageEvent<IncomingMessage>) {
      const data = event.data as any;
      if (data.type === "insertMessage") {
        if (data.message) setText(data.message);
        setTimeout(() => textareaRef.current?.focus(), 0);
      }
      if (data.type === "contextAttached") {
        const att = data.attachment as ContextAttachment;
        setAttachments((prev) => {
          if (prev.some((a) => a.path === att.path && a.type === att.type && a.startLine === att.startLine)) return prev;
          return [...prev, att];
        });
        setTimeout(() => textareaRef.current?.focus(), 0);
      }
      if (data.type === "fileSearchResults") {
        setFileResults(data.results || []);
        setSelectedIndex(0);
      }
    }
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  // Scroll selected dropdown item into view
  useEffect(() => {
    if (showDropdown && dropdownRef.current) {
      const selected = dropdownRef.current.querySelector(".at-dropdown-item.selected");
      if (selected) selected.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex, showDropdown]);

  // ── Image paste (Ctrl+V) ──
  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (const item of Array.from(items)) {
      if (item.type.startsWith("image/")) {
        e.preventDefault();
        const file = item.getAsFile();
        if (!file) continue;

        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = reader.result as string;
          // dataUrl format: "data:image/png;base64,iVBOR..."
          const base64 = dataUrl.split(",")[1];
          const mimeType = file.type || "image/png";
          const name = file.name || `pasted-image.${mimeType.split("/")[1]}`;

          setAttachments((prev) => [
            ...prev,
            {
              type: "image" as const,
              path: name,
              base64,
              mimeType,
            },
          ]);
        };
        reader.readAsDataURL(file);
      }
    }
  }, []);

  // ── Image file picker ──
  const pickImage = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.multiple = true;
    input.onchange = () => {
      if (!input.files) return;
      for (const file of Array.from(input.files)) {
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = reader.result as string;
          const base64 = dataUrl.split(",")[1];
          setAttachments((prev) => [
            ...prev,
            {
              type: "image" as const,
              path: file.name,
              base64,
              mimeType: file.type || "image/png",
            },
          ]);
        };
        reader.readAsDataURL(file);
      }
    };
    input.click();
  }, []);

  // Cleanup debounce
  useEffect(() => {
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, []);

  const removeAttachment = useCallback((index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const pickFile = useCallback(() => {
    vscode.postMessage({ type: "pickFile" });
  }, [vscode]);

  const pickFolder = useCallback(() => {
    vscode.postMessage({ type: "pickFolder" });
  }, [vscode]);

  const placeholder = isProcessing ? "Type to queue..." : "Describe what to build (@ to attach files)";

  return (
    <div className="input-area">
      {/* Permission prompt — Claude Code style */}
      {permissionRequest && onPermissionResponse && (
        <div className="permission-prompt">
          <div className="permission-prompt-header">
            Allow this {permissionRequest.toolName}?
          </div>
          <div className="permission-prompt-command">
            <div className="permission-prompt-command-label">
              {permissionRequest.toolName}
            </div>
            <pre className="permission-prompt-command-text">{permissionRequest.message}</pre>
          </div>
          <div className="permission-prompt-options">
            <button
              className="permission-option permission-option-selected"
              onClick={() => onPermissionResponse("allow")}
            >
              <span className="permission-option-num">1</span>
              <span>Yes</span>
            </button>
            <button
              className="permission-option"
              onClick={() => onPermissionResponse("always")}
            >
              <span className="permission-option-num">2</span>
              <span>Yes, always allow <strong>{permissionRequest.toolName}</strong></span>
            </button>
            {permissionRequest.hasProject && (
              <button
                className="permission-option"
                onClick={() => onPermissionResponse("project")}
              >
                <span className="permission-option-num">3</span>
                <span>Yes, allow for this project (just you)</span>
              </button>
            )}
            <button
              className="permission-option permission-option-deny"
              onClick={() => onPermissionResponse("deny")}
            >
              <span className="permission-option-num">{permissionRequest.hasProject ? "4" : "3"}</span>
              <span>No, deny once</span>
            </button>
            <button
              className="permission-option permission-option-deny"
              onClick={() => onPermissionResponse("deny_always")}
            >
              <span className="permission-option-num">{permissionRequest.hasProject ? "5" : "4"}</span>
              <span>No, always deny <strong>{permissionRequest.toolName}</strong></span>
            </button>
            {permissionRequest.hasProject && (
              <button
                className="permission-option permission-option-deny"
                onClick={() => onPermissionResponse("deny_project")}
              >
                <span className="permission-option-num">6</span>
                <span>No, deny for this project</span>
              </button>
            )}
          </div>
        </div>
      )}
      <div className="input-box">
        {/* Context chips */}
        {attachments.length > 0 && (
          <div className="input-context">
            {attachments.map((a, i) => (
              <ContextChip key={`${a.path}-${i}`} attachment={a} onRemove={() => removeAttachment(i)} />
            ))}
          </div>
        )}

        {/* Textarea */}
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => handleTextChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder={placeholder}
          rows={1}
        />

        {/* @ autocomplete dropdown */}
        {showDropdown && fileResults.length > 0 && (
          <div className="at-dropdown" ref={dropdownRef}>
            {fileResults.map((file, i) => (
              <div
                key={file.path}
                className={`at-dropdown-item ${i === selectedIndex ? "selected" : ""}`}
                onClick={() => selectFile(file)}
                onMouseEnter={() => setSelectedIndex(i)}
              >
                <span className="at-dropdown-icon">
                  {file.isDir ? "📁" : "📄"}
                </span>
                <span className="at-dropdown-path">{file.path}</span>
                {file.language && (
                  <span className="at-dropdown-lang">
                    {LANG_ICONS[file.language] || file.language}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
        {showDropdown && fileResults.length === 0 && atQuery.length > 0 && (
          <div className="at-dropdown">
            <div className="at-dropdown-empty">No files found for "@{atQuery}"</div>
          </div>
        )}

        {/* Toolbar */}
        <div className="input-toolbar">
          <div className="input-toolbar-left">
            <button className="input-tool-btn" onClick={pickFile} title="Attach file (+)">+</button>
            <button className="input-tool-btn" onClick={pickFolder} title="Attach folder">📎</button>
            <button className="input-tool-btn" onClick={pickImage} title="Attach image (or Ctrl+V to paste)">🖼</button>
          </div>
          <div className="input-toolbar-right">
            {queueCount > 0 && <span className="input-queue-badge">{queueCount} queued</span>}
            {isProcessing && onCancel ? (
              <button
                className="input-stop-btn"
                onClick={onCancel}
                title="Stop generation (Esc)"
              >
                ■
              </button>
            ) : (
              <button
                className="input-send-btn"
                onClick={handleSend}
                disabled={!text.trim() && attachments.length === 0}
                title="Send (Enter)"
              >
                ↑
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

// ── Context Chip ──

const ContextChip: React.FC<{ attachment: ContextAttachment; onRemove: () => void }> = ({ attachment, onRemove }) => {
  const fileName = attachment.path.split("/").pop() || attachment.path;
  const langIcon = LANG_ICONS[attachment.language || ""] || "✦";

  let label = fileName;
  if (attachment.type === "selection" && attachment.startLine) {
    label = `${fileName}:${attachment.startLine}${attachment.endLine && attachment.endLine !== attachment.startLine ? `-${attachment.endLine}` : ""}`;
  } else if (attachment.type === "folder") {
    label = `${fileName}/`;
  } else if (attachment.type === "image") {
    label = fileName;
  }

  const icon = attachment.type === "folder" ? "📁" : attachment.type === "image" ? "🖼" : langIcon;

  return (
    <div className="context-chip" title={attachment.path}>
      <span className="context-chip-lang">{icon}</span>
      <span className="context-chip-label">{label}</span>
      <button className="context-chip-remove" onClick={onRemove}>×</button>
    </div>
  );
};
