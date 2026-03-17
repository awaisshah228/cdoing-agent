/**
 * InputArea — rich input with autocomplete, ghost text, shell mode, clipboard paste
 *
 * Modeled after opentuicli's InputArea but adapted for the personal assistant TUI.
 *
 * Features:
 *   - Bordered input box with cursor tracking
 *   - Slash command autocomplete dropdown (/ prefix)
 *   - @mention autocomplete dropdown (@ prefix)
 *   - Tool subcommand suggestions (git, npm, docker, gh, etc.)
 *   - Ghost text inline completion (→ to accept)
 *   - Shell mode (! prefix) — visual $ prompt, border color change
 *   - Ctrl+V paste text or images (macOS clipboard)
 *   - Ctrl+U clear line, Ctrl+W delete word
 *   - Up/Down navigate suggestions or prompt history
 *   - Escape to close dropdown or clear input
 */

import { TextAttributes, RGBA } from "@opentui/core";
import { useState, useRef, useMemo } from "react";
import { useKeyboard } from "@opentui/react";
import { execSync } from "child_process";
import { useTheme } from "../context/theme";
import { getCompletions, getGhostText } from "../lib/autocomplete";
import { createHistoryNavigator, addToHistory } from "../lib/history";

// ── Clipboard helpers ────────────────────────────────────

function readClipboard(): string {
  try {
    if (process.platform === "darwin") return execSync("pbpaste", { encoding: "utf-8" });
    try { return execSync("xclip -selection clipboard -o", { encoding: "utf-8" }); }
    catch { return execSync("xsel --clipboard --output", { encoding: "utf-8" }); }
  } catch { return ""; }
}

function readClipboardImage(): { data: string; mimeType: string } | null {
  if (process.platform !== "darwin") return null;
  try {
    const hasImage = execSync(
      `osascript -e 'clipboard info' 2>/dev/null | grep -q "TIFF\\|PNG\\|JPEG" && echo "yes" || echo "no"`,
      { encoding: "utf-8", timeout: 1000 },
    ).trim();
    if (hasImage !== "yes") return null;
    const base64 = execSync(
      `osascript -e 'set theImage to the clipboard as «class PNGf»' -e 'return theImage' 2>/dev/null | base64`,
      { encoding: "utf-8", timeout: 3000, maxBuffer: 20 * 1024 * 1024 },
    ).trim();
    if (base64 && base64.length > 100) return { data: base64, mimeType: "image/png" };
  } catch {}
  return null;
}

// ── Types ────────────────────────────────────────────────

export interface InputAreaProps {
  /** Called when user submits text (Enter key) */
  onSubmit: (text: string, images?: { data: string; mimeType: string }[]) => void;
  /** Placeholder text when input is empty */
  placeholder?: string;
  /** Disable input (e.g. while processing) */
  disabled?: boolean;
  /** When true, all keyboard input is suppressed (e.g. dialog is open) */
  suppressInput?: boolean;
  /** Working directory for autocomplete path completion */
  workingDir: string;
  /** Label to show on the right side of the input */
  rightLabel?: string;
  /** Hint text below the input */
  hintText?: string;
}

const MAX_VISIBLE = 6;

export function InputArea(props: InputAreaProps) {
  const { theme, customBg } = useTheme();
  const t = theme;
  const [value, setValue] = useState("");
  const [pendingImages, setPendingImages] = useState<{ data: string; mimeType: string }[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const valueRef = useRef(value);
  valueRef.current = value;

  // History navigator
  const histNavRef = useRef(createHistoryNavigator());

  // Compute suggestions
  const suggestions = useMemo(() => {
    if (!value) return [];
    const completions = getCompletions(value, props.workingDir);
    if (completions.length > 0 && completions[0].type === "file") {
      return [{ text: value, description: "submit as typed", type: "file" as const }, ...completions];
    }
    return completions;
  }, [value, props.workingDir]);

  // Compute ghost text
  const ghost = useMemo(() => {
    if (dropdownOpen && suggestions.length > 0) return "";
    return getGhostText(value, props.workingDir);
  }, [value, props.workingDir, dropdownOpen, suggestions.length]);

  const showDropdown = dropdownOpen && suggestions.length > 0;
  const isSlashCommand = value.startsWith("/");
  const isShellMode = value.startsWith("!");

  useKeyboard((key: any) => {
    if (props.suppressInput) return;

    // ── Dropdown navigation ──
    if (showDropdown) {
      if (key.name === "up") {
        setSelectedIdx((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
        return;
      }
      if (key.name === "down") {
        setSelectedIdx((i) => (i >= suggestions.length - 1 ? 0 : i + 1));
        return;
      }
      if (key.name === "return") {
        const s = suggestions[selectedIdx];
        if (s) {
          const text = s.text.trim();
          if (text) {
            addToHistory(text);
            histNavRef.current.reset();
            props.onSubmit(text, pendingImages.length > 0 ? [...pendingImages] : undefined);
            setValue("");
            setPendingImages([]);
          }
          setDropdownOpen(false);
          setSelectedIdx(0);
        }
        return;
      }
      if (key.name === "escape") {
        setDropdownOpen(false);
        return;
      }
      // Arrow right — accept selected autocomplete suggestion inline
      if (key.name === "right") {
        const s = suggestions[selectedIdx];
        if (s) {
          setValue(s.text + " ");
          setDropdownOpen(false);
          setSelectedIdx(0);
        }
        return;
      }
    }

    // ── Ghost text accept (arrow right) ──
    if (ghost && key.name === "right") {
      setValue((v) => v + ghost);
      return;
    }

    // ── History navigation (up/down when no dropdown) ──
    if (!showDropdown && key.name === "up") {
      const entry = histNavRef.current.previous(value);
      if (entry !== null) setValue(entry);
      return;
    }
    if (!showDropdown && key.name === "down") {
      const entry = histNavRef.current.next();
      if (entry !== null) setValue(entry);
      return;
    }

    // Ctrl+V — paste image or text
    if (key.ctrl && key.name === "v") {
      const img = readClipboardImage();
      if (img) {
        setPendingImages((prev) => [...prev, img]);
        setValue((v) => v + `[Image] `);
        return;
      }
      const clip = readClipboard().trim();
      if (clip) {
        const firstLine = clip.split("\n")[0] || "";
        setValue((v) => v + firstLine);
        histNavRef.current.reset();
      }
      return;
    }

    // Ctrl+U — clear line
    if (key.ctrl && key.name === "u") {
      setValue("");
      setPendingImages([]);
      setDropdownOpen(false);
      histNavRef.current.reset();
      return;
    }

    // Ctrl+W — delete last word
    if (key.ctrl && key.name === "w") {
      setValue((v) => v.replace(/\S+\s*$/, ""));
      histNavRef.current.reset();
      return;
    }

    // Let parent handle other Ctrl/Meta combos
    if (key.ctrl || key.meta || key.name === "f1") return;

    // Escape — clear input if has text (parent handles if empty)
    if (key.name === "escape") {
      if (value.trim()) {
        setValue("");
        setPendingImages([]);
        setDropdownOpen(false);
        histNavRef.current.reset();
        return;
      }
      return; // Let parent handle (e.g. switch to dashboard)
    }

    // Enter — submit
    if (key.name === "return" && !key.shift) {
      const text = valueRef.current.trim();
      if (text || pendingImages.length > 0) {
        addToHistory(text || "");
        histNavRef.current.reset();
        props.onSubmit(text || "Describe this image.", pendingImages.length > 0 ? [...pendingImages] : undefined);
        setValue("");
        setPendingImages([]);
        setDropdownOpen(false);
      }
      return;
    }

    // Backspace
    if (key.name === "backspace") {
      histNavRef.current.reset();
      setValue((v) => {
        const next = v.slice(0, -1);
        if (next.startsWith("/") || next.includes("@") || getCompletions(next, props.workingDir).length > 0) {
          setDropdownOpen(true);
          setSelectedIdx(0);
        } else {
          setDropdownOpen(false);
        }
        return next;
      });
      return;
    }

    // Space
    if (key.name === "space") {
      histNavRef.current.reset();
      setValue((v) => {
        const next = v + " ";
        if (v.startsWith("/")) {
          setDropdownOpen(false);
        } else if (getCompletions(next, props.workingDir).length > 0) {
          setDropdownOpen(true);
          setSelectedIdx(0);
        }
        return next;
      });
      return;
    }

    // Regular character
    if (key.sequence && key.sequence.length === 1 && !key.ctrl && !key.meta) {
      histNavRef.current.reset();
      setValue((v) => {
        const next = v + key.sequence;
        if (next.startsWith("/") || next.includes("@") || getCompletions(next, props.workingDir).length > 0) {
          setDropdownOpen(true);
          setSelectedIdx(0);
        }
        return next;
      });
    }
  });

  // Window suggestions for display
  const windowStart = Math.max(0, Math.min(selectedIdx - Math.floor(MAX_VISIBLE / 2), suggestions.length - MAX_VISIBLE));
  const visibleSuggestions = suggestions.slice(windowStart, windowStart + MAX_VISIBLE);
  const hasAbove = windowStart > 0;
  const hasBelow = windowStart + MAX_VISIBLE < suggestions.length;

  const bgColor = customBg ? RGBA.fromHex(customBg) : t.bg;

  return (
    <box flexDirection="column" flexShrink={0} backgroundColor={bgColor}>
      {/* Autocomplete dropdown (above input) */}
      {showDropdown && (
        <box flexDirection="column" paddingX={1} backgroundColor={bgColor}>
          {hasAbove && (
            <box><text fg={t.textDim}>{`  \u25B2 ${windowStart} more`}</text></box>
          )}
          {visibleSuggestions.map((s, i) => {
            const realIdx = windowStart + i;
            const isSelected = realIdx === selectedIdx;
            const color = s.type === "command" ? t.warning
              : s.type === "mention" ? t.info
              : s.type === "file" ? t.success
              : t.textMuted;
            return (
              <box key={s.text + i} flexDirection="row">
                <text fg={isSelected ? t.primary : color} attributes={isSelected ? TextAttributes.BOLD : undefined}>
                  {isSelected ? " \u276F " : "   "}
                </text>
                <text fg={isSelected ? t.text : color}>{s.text + (s.description ? `  ${s.description}` : "")}</text>
              </box>
            );
          })}
          {hasBelow && (
            <box><text fg={t.textDim}>{`  \u25BC ${suggestions.length - windowStart - MAX_VISIBLE} more`}</text></box>
          )}
        </box>
      )}

      {/* Pending images indicator */}
      {pendingImages.length > 0 && (
        <box height={1} paddingX={1}>
          <text fg={t.primary}>
            {`  ${pendingImages.length} image${pendingImages.length > 1 ? "s" : ""} attached`}
          </text>
        </box>
      )}

      {/* Input box — bordered */}
      <box
        height={3}
        borderStyle="single"
        borderColor={isShellMode ? t.error : props.disabled ? t.warning : t.borderFocused}
        backgroundColor={bgColor}
        flexDirection="row"
        alignItems="center"
        paddingX={1}
      >
        <text
          fg={isShellMode ? t.error : isSlashCommand ? t.warning : (props.disabled ? t.warning : t.primary)}
          attributes={TextAttributes.BOLD}
        >
          {isShellMode ? " $ " : isSlashCommand ? " / " : (props.disabled ? " \u27F3 " : " > ")}
        </text>

        {value ? (
          <text fg={isShellMode ? t.warning : t.text}>
            {value + (ghost ? ghost : (props.disabled ? "" : "\u2588"))}
          </text>
        ) : (
          <text fg={t.textDim}>
            {props.disabled ? "thinking..." : (props.placeholder || "Type a message... (/ commands, @ context, ! shell, \u2192 accept)")}
          </text>
        )}
      </box>

      {/* Hint bar below input */}
      <box height={1} flexDirection="row" paddingX={1}>
        <text fg={t.textDim}>{props.hintText || ""}</text>
        <box flexGrow={1} />
        <text fg={t.textMuted}>{props.rightLabel || ""}</text>
      </box>
    </box>
  );
}
