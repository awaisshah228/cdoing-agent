/**
 * Header.tsx — Top Bar with Model Switcher
 *
 * Features branded logo, quick model switcher dropdown, and action buttons.
 * Clicking the model badge opens a searchable model picker (like Cursor).
 */

import React, { useState, useRef, useEffect, useCallback } from "react";

interface ModelOption {
  value: string;
  label: string;
  hint?: string;
}

interface HeaderProps {
  modelLabel: string;
  modelOptions?: ModelOption[];
  onSelectModel: () => void;
  onSwitchModel?: (model: string) => void;
  onNewChat: () => void;
  onOpenSettings: () => void;
  onOpenHistory: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  modelLabel,
  modelOptions = [],
  onSelectModel,
  onSwitchModel,
  onNewChat,
  onOpenSettings,
  onOpenHistory,
}) => {
  const [showPicker, setShowPicker] = useState(false);
  const [search, setSearch] = useState("");
  const [highlightIndex, setHighlightIndex] = useState(0);
  const pickerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!showPicker) return;
    const handler = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setShowPicker(false);
        setSearch("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showPicker]);

  const filtered = search
    ? modelOptions.filter(
        (o) =>
          o.label.toLowerCase().includes(search.toLowerCase()) ||
          o.value.toLowerCase().includes(search.toLowerCase()) ||
          (o.hint && o.hint.toLowerCase().includes(search.toLowerCase()))
      )
    : modelOptions;

  useEffect(() => { setHighlightIndex(0); }, [search]);

  const handleToggle = useCallback(() => {
    if (modelOptions.length > 0 && onSwitchModel) {
      setShowPicker((v) => !v);
      setSearch("");
      setTimeout(() => inputRef.current?.focus(), 0);
    } else {
      onSelectModel();
    }
  }, [modelOptions, onSwitchModel, onSelectModel]);

  const handleSelect = useCallback((val: string) => {
    onSwitchModel?.(val);
    setShowPicker(false);
    setSearch("");
  }, [onSwitchModel]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && filtered[highlightIndex]) {
      e.preventDefault();
      handleSelect(filtered[highlightIndex].value);
    } else if (e.key === "Escape") {
      setShowPicker(false);
      setSearch("");
    }
  }, [filtered, highlightIndex, handleSelect]);

  return (
    <div className="header">
      <div className="header-left">
        <div className="header-logo">
          <div className="header-logo-icon">
            <svg viewBox="0 0 24 24"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" /></svg>
          </div>
          <span className="header-title">Cdoing</span>
        </div>
        <div className="model-switcher" ref={pickerRef}>
          <button
            className="model-badge"
            title={modelOptions.length > 0 ? "Switch model" : "Click to change model"}
            onClick={handleToggle}
          >
            {modelLabel}
            {modelOptions.length > 0 && (
              <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ marginLeft: 4, opacity: 0.5 }}>
                <polyline points="6 9 12 15 18 9" />
              </svg>
            )}
          </button>

          {showPicker && (
            <div className="model-picker">
              <input
                ref={inputRef}
                className="model-picker-search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Switch model..."
                autoFocus
              />
              <div className="model-picker-list">
                {filtered.map((opt, idx) => (
                  <div
                    key={opt.value}
                    className={`model-picker-option ${opt.value === modelLabel ? "selected" : ""} ${idx === highlightIndex ? "highlighted" : ""}`}
                    onClick={() => handleSelect(opt.value)}
                    onMouseEnter={() => setHighlightIndex(idx)}
                  >
                    <span className="model-picker-option-label">{opt.label}</span>
                    {opt.hint && <span className="model-picker-option-hint">{opt.hint}</span>}
                    {opt.value === modelLabel && (
                      <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="3" style={{ flexShrink: 0 }}>
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    )}
                  </div>
                ))}
                {filtered.length === 0 && (
                  <div className="model-picker-empty">No models match "{search}"</div>
                )}
              </div>
              <div className="model-picker-footer" onClick={() => { setShowPicker(false); onOpenSettings(); }}>
                All settings...
              </div>
            </div>
          )}
        </div>
      </div>
      <div className="header-actions">
        <button className="icon-btn" title="History" onClick={onOpenHistory}>
          <svg viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
        </button>
        <button className="icon-btn" title="New Chat" onClick={onNewChat}>
          <svg viewBox="0 0 24 24">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
        <button className="icon-btn" title="Settings" onClick={onOpenSettings}>
          <svg viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
      </div>
    </div>
  );
};
