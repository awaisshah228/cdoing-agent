/**
 * SearchableSelect.tsx — Autocomplete dropdown with search
 *
 * Features:
 *   - Filterable dropdown with keyboard navigation
 *   - Preset options with labels + hints
 *   - Custom value input (type anything)
 *   - Grouped options (optional)
 *   - Clean VS Code-native styling
 */

import React, { useState, useRef, useEffect, useCallback } from "react";

export interface SelectOption {
  value: string;
  label: string;
  hint?: string;
  group?: string;
}

interface SearchableSelectProps {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  allowCustom?: boolean;
  customLabel?: string;
}

export const SearchableSelect: React.FC<SearchableSelectProps> = ({
  value,
  options,
  onChange,
  placeholder = "Search or select...",
  allowCustom = true,
  customLabel = "Custom",
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [highlightIndex, setHighlightIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Find the display label for the current value
  const selectedOption = options.find((o) => o.value === value);
  const displayValue = selectedOption ? selectedOption.label : value;

  // Filter options based on search
  const filtered = search
    ? options.filter(
        (o) =>
          o.label.toLowerCase().includes(search.toLowerCase()) ||
          o.value.toLowerCase().includes(search.toLowerCase()) ||
          (o.hint && o.hint.toLowerCase().includes(search.toLowerCase()))
      )
    : options;

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setSearch("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Reset highlight when filtered list changes
  useEffect(() => {
    setHighlightIndex(0);
  }, [search]);

  const handleOpen = useCallback(() => {
    setIsOpen(true);
    setSearch("");
    setHighlightIndex(0);
    setTimeout(() => inputRef.current?.focus(), 0);
  }, []);

  const handleSelect = useCallback(
    (val: string) => {
      onChange(val);
      setIsOpen(false);
      setSearch("");
    },
    [onChange]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const totalItems = filtered.length + (allowCustom && search ? 1 : 0);
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlightIndex((i) => Math.min(i + 1, totalItems - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlightIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (highlightIndex < filtered.length) {
          handleSelect(filtered[highlightIndex].value);
        } else if (allowCustom && search) {
          handleSelect(search);
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        setIsOpen(false);
        setSearch("");
      }
    },
    [filtered, highlightIndex, search, allowCustom, handleSelect]
  );

  // Group options
  const groups = new Map<string, SelectOption[]>();
  for (const opt of filtered) {
    const g = opt.group || "";
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(opt);
  }

  let flatIndex = 0;

  return (
    <div className="ss-container" ref={containerRef}>
      {/* Trigger button */}
      {!isOpen ? (
        <button className="ss-trigger" onClick={handleOpen} type="button">
          <span className="ss-trigger-value">
            {displayValue || <span className="ss-trigger-placeholder">{placeholder}</span>}
          </span>
          {selectedOption?.hint && (
            <span className="ss-trigger-hint">{selectedOption.hint}</span>
          )}
          <svg className="ss-trigger-chevron" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
      ) : (
        /* Search input */
        <input
          ref={inputRef}
          className="ss-search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          autoFocus
        />
      )}

      {/* Dropdown */}
      {isOpen && (
        <div className="ss-dropdown">
          {Array.from(groups.entries()).map(([group, opts]) => (
            <div key={group || "__default"}>
              {group && <div className="ss-group-label">{group}</div>}
              {opts.map((opt) => {
                const idx = flatIndex++;
                return (
                  <div
                    key={opt.value}
                    className={`ss-option ${opt.value === value ? "selected" : ""} ${idx === highlightIndex ? "highlighted" : ""}`}
                    onClick={() => handleSelect(opt.value)}
                    onMouseEnter={() => setHighlightIndex(idx)}
                  >
                    <span className="ss-option-label">{opt.label}</span>
                    {opt.hint && <span className="ss-option-hint">{opt.hint}</span>}
                    {opt.value === value && (
                      <svg className="ss-option-check" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    )}
                  </div>
                );
              })}
            </div>
          ))}

          {/* Custom value option */}
          {allowCustom && search && !filtered.some((o) => o.value === search) && (
            <div
              className={`ss-option ss-option-custom ${flatIndex === highlightIndex ? "highlighted" : ""}`}
              onClick={() => handleSelect(search)}
              onMouseEnter={() => setHighlightIndex(flatIndex)}
            >
              <span className="ss-option-label">Use "{search}"</span>
              <span className="ss-option-hint">{customLabel}</span>
            </div>
          )}

          {filtered.length === 0 && !(allowCustom && search) && (
            <div className="ss-empty">No options found</div>
          )}
        </div>
      )}
    </div>
  );
};
