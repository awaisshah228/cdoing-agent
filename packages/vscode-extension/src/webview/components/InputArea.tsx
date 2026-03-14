/**
 * InputArea.tsx — Chat Input Component
 *
 * The textarea + Send button at the bottom of the chat panel.
 * Features:
 *   - Auto-resizes as the user types (up to 150px max height)
 *   - Enter to send, Shift+Enter for new line
 *   - Always enabled — messages are queued if agent is busy
 *   - Shows queue count badge when messages are queued
 *   - Listens for "insertMessage" events (from right-click "Send Selection")
 */

import React, { useState, useRef, useCallback, useEffect } from "react";
import type { IncomingMessage } from "../types";

interface InputAreaProps {
  isProcessing: boolean;             // Shows "queued" hint when true
  queueCount: number;                // Number of messages in queue
  onSend: (text: string) => void;    // Called when user sends a message
}

export const InputArea: React.FC<InputAreaProps> = ({ isProcessing, queueCount, onSend }) => {
  const [text, setText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  /** Sends the current text and clears the input */
  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setText("");
    // Reset textarea height after sending
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [text, onSend]);

  /** Enter sends, Shift+Enter adds a new line */
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  /** Auto-resize the textarea to fit content (capped at 150px) */
  const handleInput = useCallback(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 150)}px`;
    }
  }, []);

  // Listen for "insertMessage" from the extension host.
  useEffect(() => {
    function handler(event: MessageEvent<IncomingMessage>) {
      if (event.data.type === "insertMessage") {
        const msg = (event.data as any).message as string;
        setText(msg);
        setTimeout(() => {
          textareaRef.current?.focus();
          handleInput();
        }, 0);
      }
    }
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [handleInput]);

  const placeholder = isProcessing
    ? "Type to queue next message..."
    : "Ask anything... (/help)";

  return (
    <div className="input-area">
      <div className="input-row">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            handleInput();
          }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          rows={1}
        />
        <button
          className="send-btn"
          onClick={handleSend}
          disabled={!text.trim()}
        >
          {isProcessing ? "Queue" : "Send"}
        </button>
      </div>
      <div className="input-hint">
        {queueCount > 0
          ? `📬 ${queueCount} message${queueCount > 1 ? "s" : ""} queued`
          : "Enter to send, Shift+Enter for new line"}
      </div>
    </div>
  );
};
