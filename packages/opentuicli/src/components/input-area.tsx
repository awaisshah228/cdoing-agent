/**
 * InputArea — rich input with autocomplete, ghost text, image paste
 *
 * Features:
 *   - Slash command autocomplete dropdown (/ prefix)
 *   - @mention autocomplete dropdown (@ prefix)
 *   - Tool subcommand suggestions (npm, git, etc.)
 *   - Ghost text inline completion (Tab/→ to accept)
 *   - Ctrl+V paste text or images (macOS clipboard)
 *   - Ctrl+U clear line, Ctrl+W delete word
 *   - Up/Down navigate suggestions, Enter to select
 *   - Escape to close dropdown
 */

import { TextAttributes } from "@opentui/core";
import { useState, useRef, useMemo } from "react";
import { useKeyboard } from "@opentui/react";
import { execSync } from "child_process";
import { useTheme } from "../context/theme";
import { getCompletions, getGhostText, type Suggestion } from "../lib/autocomplete";
import type { ImageAttachment } from "@cdoing/ai";

export interface InputAreaProps {
  onSubmit: (text: string, images?: ImageAttachment[]) => void;
  placeholder?: string;
  disabled?: boolean;
  workingDir: string;
}

function readClipboard(): string {
  try {
    if (process.platform === "darwin") return execSync("pbpaste", { encoding: "utf-8" });
    try { return execSync("xclip -selection clipboard -o", { encoding: "utf-8" }); }
    catch { return execSync("xsel --clipboard --output", { encoding: "utf-8" }); }
  } catch { return ""; }
}

function readClipboardImage(): ImageAttachment | null {
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

const MAX_VISIBLE = 6;

export function InputArea(props: InputAreaProps) {
  const { theme } = useTheme();
  const t = theme;
  const [value, setValue] = useState("");
  const [pendingImages, setPendingImages] = useState<ImageAttachment[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const valueRef = useRef(value);
  valueRef.current = value;
  const imageCountRef = useRef(0);

  // Compute suggestions based on current input
  const suggestions = useMemo(() => {
    if (!value) return [];
    return getCompletions(value, props.workingDir);
  }, [value, props.workingDir]);

  // Compute ghost text
  const ghost = useMemo(() => {
    if (dropdownOpen && suggestions.length > 0) return "";
    return getGhostText(value, props.workingDir);
  }, [value, props.workingDir, dropdownOpen, suggestions.length]);

  // Auto-open dropdown when suggestions exist
  const showDropdown = dropdownOpen && suggestions.length > 0;

  useKeyboard((key: any) => {
    // Allow typing even when disabled (streaming) — submit handler decides what to do

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
          setValue(s.text + " ");
          setDropdownOpen(false);
          setSelectedIdx(0);
        }
        return;
      }
      if (key.name === "escape") {
        setDropdownOpen(false);
        return;
      }
      if (key.name === "tab") {
        const s = suggestions[selectedIdx];
        if (s) {
          setValue(s.text + " ");
          setDropdownOpen(false);
          setSelectedIdx(0);
        }
        return;
      }
    }

    // ── Ghost text accept ──
    if (ghost && (key.name === "tab" || key.name === "right")) {
      setValue((v) => v + ghost);
      return;
    }

    // Ctrl+V — paste image or text
    if (key.ctrl && key.name === "v") {
      const img = readClipboardImage();
      if (img) {
        imageCountRef.current += 1;
        setPendingImages((prev) => [...prev, img]);
        setValue((v) => v + `[Image #${imageCountRef.current}] `);
        return;
      }
      const clip = readClipboard().trim();
      if (clip) {
        const firstLine = clip.split("\n")[0] || "";
        setValue((v) => v + firstLine);
      }
      return;
    }

    // Ctrl+U — clear line
    if (key.ctrl && key.name === "u") {
      setValue("");
      setPendingImages([]);
      setDropdownOpen(false);
      return;
    }

    // Ctrl+W — delete last word
    if (key.ctrl && key.name === "w") {
      setValue((v) => v.replace(/\S+\s*$/, ""));
      return;
    }

    // Enter — submit
    if (key.name === "return" && !key.shift) {
      const text = valueRef.current.trim();
      if (text || pendingImages.length > 0) {
        props.onSubmit(text || "Describe this image.", pendingImages.length > 0 ? [...pendingImages] : undefined);
        setValue("");
        setPendingImages([]);
        setDropdownOpen(false);
      }
      return;
    }

    // Backspace
    if (key.name === "backspace") {
      setValue((v) => {
        const next = v.slice(0, -1);
        // Re-evaluate dropdown
        if (next.startsWith("/") || next.includes("@")) {
          setDropdownOpen(true);
          setSelectedIdx(0);
        } else {
          setDropdownOpen(false);
        }
        return next;
      });
      return;
    }

    // Escape
    if (key.name === "escape") {
      setDropdownOpen(false);
      return;
    }

    // Space
    if (key.name === "space") {
      setValue((v) => v + " ");
      // Close dropdown on space (command completed)
      if (value.startsWith("/")) setDropdownOpen(false);
      return;
    }

    // Regular character
    if (key.name && key.name.length === 1 && !key.ctrl && !key.meta) {
      setValue((v) => {
        const next = v + key.name;
        // Auto-open dropdown for / and @
        if (next.startsWith("/") || next.includes("@")) {
          setDropdownOpen(true);
          setSelectedIdx(0);
        }
        return next;
      });
    }
  });

  const isSlashCommand = value.startsWith("/");

  // Window the suggestions for display
  const windowStart = Math.max(0, Math.min(selectedIdx - Math.floor(MAX_VISIBLE / 2), suggestions.length - MAX_VISIBLE));
  const visibleSuggestions = suggestions.slice(windowStart, windowStart + MAX_VISIBLE);
  const hasAbove = windowStart > 0;
  const hasBelow = windowStart + MAX_VISIBLE < suggestions.length;

  return (
    <box flexDirection="column" flexShrink={0}>
      {/* Autocomplete dropdown (above input) */}
      {showDropdown && (
        <box flexDirection="column" paddingX={1}>
          {hasAbove && (
            <box><text fg={t.textDim}>{`  ▲ ${windowStart} more`}</text></box>
          )}
          {visibleSuggestions.map((s, i) => {
            const realIdx = windowStart + i;
            const isSelected = realIdx === selectedIdx;
            const color = s.type === "command" ? t.warning
              : s.type === "mention" ? t.info
              : s.type === "file" ? t.success
              : t.textMuted;
            return (
              <box key={s.text} flexDirection="row">
                <text fg={isSelected ? t.primary : color} attributes={isSelected ? TextAttributes.BOLD : undefined}>
                  {isSelected ? " ❯ " : "   "}
                </text>
                <text fg={isSelected ? t.text : color}>{s.text}</text>
                {s.description ? (
                  <text fg={t.textDim}>{`  ${s.description}`}</text>
                ) : null}
              </box>
            );
          })}
          {hasBelow && (
            <box><text fg={t.textDim}>{`  ▼ ${suggestions.length - windowStart - MAX_VISIBLE} more`}</text></box>
          )}
        </box>
      )}

      {/* Pending images indicator */}
      {pendingImages.length > 0 && (
        <box height={1} paddingX={1}>
          <text fg={t.primary}>
            {`  🖼 ${pendingImages.length} image${pendingImages.length > 1 ? "s" : ""} attached`}
          </text>
        </box>
      )}

      {/* Input box */}
      <box
        height={3}
        borderStyle="single"
        borderColor={t.borderFocused}
        flexDirection="row"
        alignItems="center"
        paddingX={1}
      >
        <text
          fg={isSlashCommand ? t.warning : t.primary}
          attributes={TextAttributes.BOLD}
        >
          {isSlashCommand ? " / " : " > "}
        </text>

        {value ? (
          <>
            <text fg={t.text}>{value}</text>
            {ghost ? (
              <text fg={t.textDim}>{ghost}</text>
            ) : (
              <text fg={t.primary}>{"▊"}</text>
            )}
          </>
        ) : (
          <text fg={t.textDim}>
            {props.placeholder || "Type a message... (^V paste, / commands, @ context, Tab accept)"}
          </text>
        )}
      </box>
    </box>
  );
}
