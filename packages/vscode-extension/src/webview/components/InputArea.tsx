/**
 * InputArea.tsx — Premium Chat Input (Cursor/Copilot style)
 *
 * Features:
 *   - Polished input box with glow focus state
 *   - SVG toolbar icons
 *   - @ autocomplete with file search
 *   - Context chips with language badges
 *   - Animated permission prompt
 *   - Interrupt/enqueue prompt for concurrent messages
 *   - Image paste support
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
  onInterruptAndSend?: (newMessage: string) => void;
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

/** Slash commands available in the input — matches the VS Code extension command handler */
interface SlashCommand {
  cmd: string;
  hint: string;
  /** Follow-up argument suggestions shown after selecting this command */
  args?: Array<{ value: string; label: string; hint?: string }>;
}

const SLASH_COMMANDS: SlashCommand[] = [
  { cmd: "/model", hint: "View or switch model", args: [
    { value: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", hint: "recommended" },
    { value: "claude-opus-4-6", label: "Claude Opus 4.6", hint: "most capable" },
    { value: "claude-sonnet-4-5", label: "Claude Sonnet 4.5", hint: "balanced" },
    { value: "claude-opus-4-5", label: "Claude Opus 4.5", hint: "powerful" },
    { value: "claude-haiku-4-5", label: "Claude Haiku 4.5", hint: "fastest" },
    { value: "default", label: "default", hint: "reset to provider default" },
  ]},
  { cmd: "/provider", hint: "View or switch provider", args: [
    { value: "anthropic", label: "Anthropic", hint: "Claude models" },
    { value: "openai", label: "OpenAI", hint: "GPT models" },
    { value: "google", label: "Google", hint: "Gemini models" },
    { value: "openai-codex", label: "OpenAI Codex", hint: "Codex models" },
    { value: "ollama", label: "Ollama", hint: "local models" },
    { value: "default", label: "default", hint: "reset to anthropic" },
  ]},
  { cmd: "/mode", hint: "Set permission mode", args: [
    { value: "ask", label: "ask", hint: "ask before each action (default)" },
    { value: "auto-edit", label: "auto-edit", hint: "auto-approve file edits" },
    { value: "auto", label: "auto", hint: "auto-approve everything" },
    { value: "plan", label: "plan", hint: "read-only planning mode" },
  ]},
  { cmd: "/clear", hint: "Clear conversation" },
  { cmd: "/new", hint: "New conversation tab" },
  { cmd: "/compact", hint: "Compress context" },
  { cmd: "/history", hint: "List saved conversations" },
  { cmd: "/resume", hint: "Resume a conversation" },
  { cmd: "/config", hint: "Show configuration" },
  { cmd: "/usage", hint: "Token usage stats" },
  { cmd: "/cost", hint: "Cost breakdown" },
  { cmd: "/permissions", hint: "Manage permissions" },
  { cmd: "/memory", hint: "View persistent memory" },
  { cmd: "/hooks", hint: "View configured hooks" },
  { cmd: "/queue", hint: "View message queue" },
  { cmd: "/help", hint: "Show available commands" },
  { cmd: "/settings", hint: "Open settings panel" },
  { cmd: "/delete", hint: "Delete a conversation" },
];

export const InputArea: React.FC<InputAreaProps> = ({ isProcessing, queueCount, onSend, onCancel, onInterruptAndSend, permissionRequest, onPermissionResponse }) => {
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<ContextAttachment[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [fileResults, setFileResults] = useState<FileResult[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [atQuery, setAtQuery] = useState("");
  const [pendingMessage, setPendingMessage] = useState<string | null>(null);
  // Slash command autocomplete
  const [showSlashMenu, setShowSlashMenu] = useState(false);
  const [slashFiltered, setSlashFiltered] = useState(SLASH_COMMANDS);
  const [slashIndex, setSlashIndex] = useState(0);
  // Arg picker dialog (shown after selecting a command with args like /model)
  const [argPicker, setArgPicker] = useState<{
    cmd: string;
    title: string;
    args: Array<{ value: string; label: string; hint?: string }>;
    search: string;
    index: number;
  } | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const slashRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const vscode = useVsCode();

  // ── Send ──
  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed && attachments.length === 0) return;

    // If processing, show interrupt/enqueue prompt instead of sending directly
    if (isProcessing) {
      setPendingMessage(trimmed);
      setText("");
      setAttachments([]);
      setShowDropdown(false);
      if (textareaRef.current) textareaRef.current.style.height = "auto";
      return;
    }

    onSend(trimmed, attachments.length > 0 ? attachments : undefined);
    setText("");
    setAttachments([]);
    setShowDropdown(false);
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  }, [text, attachments, onSend, isProcessing]);

  const handleEnqueue = useCallback(() => {
    if (pendingMessage) {
      onSend(pendingMessage);
    }
    setPendingMessage(null);
  }, [pendingMessage, onSend]);

  const handleInterrupt = useCallback(() => {
    if (pendingMessage && onInterruptAndSend) {
      onInterruptAndSend(pendingMessage);
    }
    setPendingMessage(null);
  }, [pendingMessage, onInterruptAndSend]);

  const handleDismissPending = useCallback(() => {
    if (pendingMessage) setText(pendingMessage);
    setPendingMessage(null);
  }, [pendingMessage]);

  // If processing ends while the prompt is still showing, auto-send
  useEffect(() => {
    if (!isProcessing && pendingMessage) {
      onSend(pendingMessage);
      setPendingMessage(null);
    }
  }, [isProcessing]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Select a slash command ──
  const selectSlashCommand = useCallback((cmd: string) => {
    const slashCmd = SLASH_COMMANDS.find((c) => c.cmd === cmd);
    setShowSlashMenu(false);
    setSlashIndex(0);
    setText("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";

    if (slashCmd?.args) {
      // Open arg picker dialog
      setArgPicker({
        cmd: slashCmd.cmd,
        title: slashCmd.hint,
        args: slashCmd.args,
        search: "",
        index: 0,
      });
    } else {
      // No args — send the command directly
      onSend(cmd);
    }
  }, [onSend]);

  // ── Arg picker helpers ──
  const selectArg = useCallback((value: string) => {
    if (!argPicker) return;
    const fullCmd = `${argPicker.cmd} ${value}`;
    setArgPicker(null);
    onSend(fullCmd);
  }, [argPicker, onSend]);

  const argPickerFiltered = argPicker
    ? (argPicker.search
        ? argPicker.args.filter((a) =>
            a.value.toLowerCase().includes(argPicker.search.toLowerCase()) ||
            a.label.toLowerCase().includes(argPicker.search.toLowerCase()))
        : argPicker.args)
    : [];

  // ── Keydown ──
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    // Arg picker dialog navigation (takes priority)
    if (argPicker) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setArgPicker((p) => p ? { ...p, index: Math.min(p.index + 1, argPickerFiltered.length - 1) } : p);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setArgPicker((p) => p ? { ...p, index: Math.max(p.index - 1, 0) } : p);
        return;
      }
      if (e.key === "Enter" && argPickerFiltered[argPicker.index]) {
        e.preventDefault();
        selectArg(argPickerFiltered[argPicker.index].value);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setArgPicker(null);
        return;
      }
      return; // Block all other keys from reaching textarea while picker is open
    }
    // Slash command menu navigation
    if (showSlashMenu && slashFiltered.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSlashIndex((i) => Math.min(i + 1, slashFiltered.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSlashIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        selectSlashCommand(slashFiltered[slashIndex].cmd);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setShowSlashMenu(false);
        return;
      }
    }
    // @ file autocomplete navigation
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
    // Handle interrupt/enqueue prompt keyboard shortcuts
    if (pendingMessage !== null) {
      if (e.key === "1") { e.preventDefault(); handleEnqueue(); return; }
      if (e.key === "2" && onInterruptAndSend) { e.preventDefault(); handleInterrupt(); return; }
      if (e.key === "Escape") { e.preventDefault(); handleDismissPending(); return; }
    }
    if (e.key === "Escape" && isProcessing) {
      e.preventDefault();
      onCancel?.();
      return;
    }
    if (e.key === "Enter" && !e.shiftKey && !showDropdown && !showSlashMenu) {
      e.preventDefault();
      handleSend();
    }
  }, [showDropdown, showSlashMenu, slashFiltered, slashIndex, argPicker, argPickerFiltered, selectArg, fileResults, selectedIndex, handleSend, isProcessing, onCancel, selectSlashCommand]);

  // ── Select a file from dropdown ──
  const selectFile = useCallback((file: FileResult) => {
    const atPos = text.lastIndexOf("@");
    const newText = atPos >= 0 ? text.substring(0, atPos) : text;
    setText(newText);

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

  // ── Text change — detect @ trigger and / slash commands ──
  const handleTextChange = useCallback((newText: string) => {
    setText(newText);

    const el = textareaRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
    }

    // Detect slash commands: text starts with "/" and is a single token (no space yet)
    if (newText.startsWith("/") && !newText.includes(" ") && !newText.includes("\n")) {
      const query = newText.toLowerCase();
      const matches = SLASH_COMMANDS.filter(
        (c) => c.cmd.startsWith(query) || c.hint.toLowerCase().includes(query.slice(1)),
      );
      setSlashFiltered(matches);
      setShowSlashMenu(matches.length > 0);
      setSlashIndex(0);
      setShowDropdown(false);
      return;
    }
    setShowSlashMenu(false);

    // Detect @ file mentions
    const atPos = newText.lastIndexOf("@");
    if (atPos >= 0) {
      const charBefore = atPos > 0 ? newText[atPos - 1] : " ";
      if (charBefore === " " || charBefore === "\n" || atPos === 0) {
        const query = newText.substring(atPos + 1);
        if (!query.includes(" ") && !query.includes("\n")) {
          setAtQuery(query);
          setShowDropdown(true);
          setSelectedIndex(0);

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

  useEffect(() => {
    if (showDropdown && dropdownRef.current) {
      const selected = dropdownRef.current.querySelector(".at-dropdown-item.selected");
      if (selected) selected.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex, showDropdown]);

  useEffect(() => {
    if (showSlashMenu && slashRef.current) {
      const selected = slashRef.current.querySelector(".slash-item.selected");
      if (selected) selected.scrollIntoView({ block: "nearest" });
    }
  }, [slashIndex, showSlashMenu]);

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
          const base64 = dataUrl.split(",")[1];
          const mimeType = file.type || "image/png";
          const name = file.name || `pasted-image.${mimeType.split("/")[1]}`;

          setAttachments((prev) => [
            ...prev,
            { type: "image" as const, path: name, base64, mimeType },
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
            { type: "image" as const, path: file.name, base64, mimeType: file.type || "image/png" },
          ]);
        };
        reader.readAsDataURL(file);
      }
    };
    input.click();
  }, []);

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

  const placeholder = isProcessing ? "Type to queue a follow-up..." : "Ask Cdoing anything... (@ to attach files)";

  const argPickerRef = useRef<HTMLInputElement>(null);

  // Auto-focus the arg picker search input when it opens
  useEffect(() => {
    if (argPicker) setTimeout(() => argPickerRef.current?.focus(), 0);
  }, [argPicker]);

  return (
    <div className="input-area">
      {/* Arg picker dialog (e.g. /model → pick a model) */}
      {argPicker && (
        <div className="arg-picker-overlay">
          <div className="arg-picker">
            <div className="arg-picker-header">
              <span className="arg-picker-cmd">{argPicker.cmd}</span>
              <span className="arg-picker-title">{argPicker.title}</span>
              <button className="arg-picker-close" onClick={() => setArgPicker(null)}>
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <input
              ref={argPickerRef}
              className="arg-picker-search"
              value={argPicker.search}
              onChange={(e) => setArgPicker((p) => p ? { ...p, search: e.target.value, index: 0 } : p)}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setArgPicker((p) => p ? { ...p, index: Math.min(p.index + 1, argPickerFiltered.length - 1) } : p);
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setArgPicker((p) => p ? { ...p, index: Math.max(p.index - 1, 0) } : p);
                } else if (e.key === "Enter" && argPickerFiltered[argPicker.index]) {
                  e.preventDefault();
                  selectArg(argPickerFiltered[argPicker.index].value);
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  setArgPicker(null);
                  setTimeout(() => textareaRef.current?.focus(), 0);
                }
              }}
              placeholder="Search..."
              autoFocus
            />
            <div className="arg-picker-list">
              {argPickerFiltered.map((opt, idx) => (
                <div
                  key={opt.value}
                  className={`arg-picker-option ${idx === argPicker.index ? "highlighted" : ""}`}
                  onClick={() => selectArg(opt.value)}
                  onMouseEnter={() => setArgPicker((p) => p ? { ...p, index: idx } : p)}
                >
                  <span className="arg-picker-option-label">{opt.label}</span>
                  {opt.hint && <span className="arg-picker-option-hint">{opt.hint}</span>}
                </div>
              ))}
              {argPickerFiltered.length === 0 && (
                <div className="arg-picker-empty">No matches</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Permission prompt */}
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
                <span>Yes, allow for this project</span>
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

      {/* Interrupt / Enqueue prompt */}
      {pendingMessage && (
        <div className="interrupt-prompt">
          <div className="interrupt-prompt-message">
            <span className="interrupt-prompt-label">Pending:</span> {pendingMessage.length > 60 ? pendingMessage.substring(0, 57) + "..." : pendingMessage}
          </div>
          <div className="interrupt-prompt-actions">
            <button className="interrupt-prompt-btn interrupt-prompt-enqueue" onClick={handleEnqueue} title="Add to queue and process after current response">
              <span className="interrupt-prompt-key">1</span> Enqueue
            </button>
            {onInterruptAndSend && (
              <button className="interrupt-prompt-btn interrupt-prompt-interrupt" onClick={handleInterrupt} title="Stop current response and process this message">
                <span className="interrupt-prompt-key">2</span> Interrupt
              </button>
            )}
            <button className="interrupt-prompt-btn interrupt-prompt-dismiss" onClick={handleDismissPending} title="Cancel and put message back in input">
              <span className="interrupt-prompt-key">Esc</span> Cancel
            </button>
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
                  {file.isDir ? (
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
                      <polyline points="13 2 13 9 20 9" />
                    </svg>
                  )}
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

        {/* Slash command autocomplete */}
        {showSlashMenu && slashFiltered.length > 0 && (
          <div className="slash-dropdown" ref={slashRef}>
            {slashFiltered.map((item, i) => (
              <div
                key={item.cmd}
                className={`slash-item ${i === slashIndex ? "selected" : ""}`}
                onClick={() => selectSlashCommand(item.cmd)}
                onMouseEnter={() => setSlashIndex(i)}
              >
                <span className="slash-cmd">{item.cmd}</span>
                <span className="slash-hint">{item.hint}</span>
              </div>
            ))}
          </div>
        )}

        {/* Toolbar */}
        <div className="input-toolbar">
          <div className="input-toolbar-left">
            <button className="input-tool-btn" onClick={pickFile} title="Attach file">
              <svg viewBox="0 0 24 24">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>
            <button className="input-tool-btn" onClick={pickFolder} title="Attach folder">
              <svg viewBox="0 0 24 24">
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
              </svg>
            </button>
            <button className="input-tool-btn" onClick={pickImage} title="Attach image (or Ctrl+V)">
              <svg viewBox="0 0 24 24">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <polyline points="21 15 16 10 5 21" />
              </svg>
            </button>
          </div>
          <div className="input-toolbar-right">
            {queueCount > 0 && <span className="input-queue-badge">{queueCount} queued</span>}
            {isProcessing && onCancel ? (
              <button
                className="input-stop-btn"
                onClick={onCancel}
                title="Stop generation (Esc)"
              >
                <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor">
                  <rect x="6" y="6" width="12" height="12" rx="1" />
                </svg>
              </button>
            ) : (
              <button
                className="input-send-btn"
                onClick={handleSend}
                disabled={!text.trim() && attachments.length === 0}
                title="Send (Enter)"
              >
                <svg viewBox="0 0 24 24">
                  <path d="M12 19V5M5 12l7-7 7 7" />
                </svg>
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
  const langIcon = LANG_ICONS[attachment.language || ""] || "";

  // Image attachments render as thumbnail previews (like Claude Code)
  if (attachment.type === "image" && attachment.base64 && attachment.mimeType) {
    const src = `data:${attachment.mimeType};base64,${attachment.base64}`;
    return (
      <div className="context-image-preview" title={attachment.path}>
        <img src={src} alt={fileName} />
        <span className="context-image-label">{fileName}</span>
        <button className="context-image-remove" onClick={onRemove}>
          <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
    );
  }

  let label = fileName;
  if (attachment.type === "selection" && attachment.startLine) {
    label = `${fileName}:${attachment.startLine}${attachment.endLine && attachment.endLine !== attachment.startLine ? `-${attachment.endLine}` : ""}`;
  } else if (attachment.type === "folder") {
    label = `${fileName}/`;
  } else if (attachment.type === "image") {
    label = fileName;
  }

  const icon = attachment.type === "folder" ? "DIR" : attachment.type === "image" ? "IMG" : (langIcon || "FILE");

  return (
    <div className="context-chip" title={attachment.path}>
      <span className="context-chip-lang">{icon}</span>
      <span className="context-chip-label">{label}</span>
      <button className="context-chip-remove" onClick={onRemove}>
        <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
          <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  );
};
