/**
 * InputArea — rich textarea input with autocomplete, ghost text, image paste
 *
 * Features:
 *   - Full textarea keybindings: cursor movement, selection, word nav,
 *     undo/redo, delete operations, home/end, buffer start/end
 *   - Multi-line input (Shift+Enter or Meta+Enter for newline)
 *   - Slash command autocomplete dropdown (/ prefix)
 *   - @mention autocomplete dropdown (@ prefix)
 *   - Tool subcommand suggestions (npm, git, etc.)
 *   - Ghost text inline completion (→ to accept)
 *   - Ctrl+V paste text or images (macOS clipboard)
 *   - Up/Down navigate suggestions, Enter to select
 *   - Escape to close dropdown
 */

import { TextAttributes, RGBA, type TextareaRenderable } from "@opentui/core";
import { useState, useRef, useMemo, useCallback } from "react";
import { useKeyboard } from "@opentui/react";
import { useTheme } from "../context/theme";
import { readClipboard, readClipboardImage } from "../lib/clipboard";
import { getCompletions, getGhostText } from "../lib/autocomplete";
import { TEXTAREA_KEYBINDINGS } from "./textarea-keybindings";
import type { ImageAttachment } from "@cdoing/ai";

export type AgentMode = "build" | "plan";

export interface InputAreaProps {
  onSubmit: (text: string, images?: ImageAttachment[]) => void;
  placeholder?: string;
  disabled?: boolean;
  /** When true, all keyboard input is suppressed (e.g. dialog is open) */
  suppressInput?: boolean;
  workingDir: string;
  /** Current agent mode (build/plan). If provided, shows mode tabs. */
  mode?: AgentMode;
  /** Callback when mode changes via Tab key */
  onModeChange?: (mode: AgentMode) => void;
  /** Model name to display in the tab bar */
  modelLabel?: string;
}

const MAX_VISIBLE = 6;
const MAX_INPUT_LINES = 8;

export function InputArea(props: InputAreaProps) {
  const { theme, customBg } = useTheme();
  const t = theme;
  const textareaRef = useRef<TextareaRenderable>(null);
  const [value, setValue] = useState("");
  const [pendingImages, setPendingImages] = useState<ImageAttachment[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const imageCountRef = useRef(0);

  // Sync textarea text → React state for autocomplete computation
  const syncText = useCallback(() => {
    const text = textareaRef.current?.plainText ?? "";
    setValue(text);
    return text;
  }, []);

  // Update dropdown state based on current text
  const updateDropdown = useCallback(
    (text: string) => {
      if (
        text.startsWith("/") ||
        text.includes("@") ||
        getCompletions(text, props.workingDir).length > 0
      ) {
        setDropdownOpen(true);
        setSelectedIdx(0);
      } else {
        setDropdownOpen(false);
      }
    },
    [props.workingDir],
  );

  // Compute suggestions based on current input
  const suggestions = useMemo(() => {
    if (!value) return [];
    const completions = getCompletions(value, props.workingDir);
    // Add a "none" option at the top for file/subcommand completions so user can submit as-is
    if (completions.length > 0 && completions[0].type === "file") {
      return [
        { text: value, description: "submit as typed", type: "file" as const },
        ...completions,
      ];
    }
    return completions;
  }, [value, props.workingDir]);

  // Compute ghost text
  const ghost = useMemo(() => {
    if (dropdownOpen && suggestions.length > 0) return "";
    return getGhostText(value, props.workingDir);
  }, [value, props.workingDir, dropdownOpen, suggestions.length]);

  const showDropdown = dropdownOpen && suggestions.length > 0;

  // Called when textarea content changes (via keybindings)
  const handleContentChange = useCallback(() => {
    const text = syncText();
    updateDropdown(text);
  }, [syncText, updateDropdown]);

  // Called when textarea fires "submit" action (Enter key)
  const handleSubmit = useCallback(() => {
    // If dropdown is open, submit is handled by useKeyboard dropdown handler
    if (showDropdown) return;

    const text = (textareaRef.current?.plainText ?? "").trim();
    if (text || pendingImages.length > 0) {
      props.onSubmit(
        text || "Describe this image.",
        pendingImages.length > 0 ? [...pendingImages] : undefined,
      );
      textareaRef.current?.clear();
      setValue("");
      setPendingImages([]);
      setDropdownOpen(false);
    }
  }, [props.onSubmit, pendingImages, showDropdown]);

  // useKeyboard handles: Tab (mode switch), Ctrl+V (paste), dropdown navigation,
  // and text input forwarding when dropdown is open
  useKeyboard((key: any) => {
    if (props.suppressInput) return;

    // ── Tab — always switch mode (build ↔ plan) ──
    if (key.name === "tab" && props.onModeChange && props.mode) {
      props.onModeChange(props.mode === "build" ? "plan" : "build");
      return;
    }

    // ── Ctrl+V — paste image or text ──
    if (key.ctrl && key.name === "v") {
      const img = readClipboardImage();
      if (img) {
        imageCountRef.current += 1;
        setPendingImages((prev) => [...prev, img]);
        textareaRef.current?.insertText(`[Image #${imageCountRef.current}] `);
        syncText();
        return;
      }
      const clip = readClipboard().trim();
      if (clip) {
        textareaRef.current?.insertText(clip);
        const text = syncText();
        updateDropdown(text);
      }
      return;
    }

    // ── Dropdown navigation (only when dropdown is open) ──
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
            props.onSubmit(
              text,
              pendingImages.length > 0 ? [...pendingImages] : undefined,
            );
            textareaRef.current?.clear();
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
      // Arrow right — accept selected autocomplete suggestion into textarea
      if (key.name === "right") {
        const s = suggestions[selectedIdx];
        if (s) {
          textareaRef.current?.clear();
          textareaRef.current?.insertText(s.text + " ");
          syncText();
          setDropdownOpen(false);
          setSelectedIdx(0);
        }
        return;
      }
    }

    // ── Ghost text accept (arrow right when at end of text) ──
    if (ghost && key.name === "right" && !key.ctrl && !key.meta && !key.shift) {
      const ta = textareaRef.current;
      if (ta) {
        // Only accept ghost text if cursor is at end of buffer
        const text = ta.plainText ?? "";
        if (ta.cursorOffset >= text.length) {
          ta.insertText(ghost);
          syncText();
          return;
        }
      }
    }
  });

  const isSlashCommand = value.startsWith("/");

  // Dynamic height: 1 line base + extra lines for multiline, capped
  const lineCount = Math.max(1, (value.match(/\n/g) || []).length + 1);
  const visibleLines = Math.min(lineCount, MAX_INPUT_LINES);
  const inputHeight = visibleLines + 2; // +2 for border

  // Window the suggestions for display
  const windowStart = Math.max(
    0,
    Math.min(
      selectedIdx - Math.floor(MAX_VISIBLE / 2),
      suggestions.length - MAX_VISIBLE,
    ),
  );
  const visibleSuggestions = suggestions.slice(
    windowStart,
    windowStart + MAX_VISIBLE,
  );
  const hasAbove = windowStart > 0;
  const hasBelow = windowStart + MAX_VISIBLE < suggestions.length;

  const bgColor = customBg ? RGBA.fromHex(customBg) : t.bg;

  return (
    <box flexDirection="column" flexShrink={0} backgroundColor={bgColor}>
      {/* Autocomplete dropdown (above input) */}
      {showDropdown && (
        <box flexDirection="column" paddingX={1} backgroundColor={bgColor}>
          {hasAbove && (
            <box>
              <text fg={t.textDim}>{`  ▲ ${windowStart} more`}</text>
            </box>
          )}
          {visibleSuggestions.map((s, i) => {
            const realIdx = windowStart + i;
            const isSelected = realIdx === selectedIdx;
            const color =
              s.type === "command"
                ? t.warning
                : s.type === "mention"
                  ? t.info
                  : s.type === "file"
                    ? t.success
                    : t.textMuted;
            return (
              <box key={s.text} flexDirection="row">
                <text
                  fg={isSelected ? t.primary : color}
                  attributes={isSelected ? TextAttributes.BOLD : undefined}
                >
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
            <box>
              <text fg={t.textDim}>{`  ▼ ${suggestions.length - windowStart - MAX_VISIBLE} more`}</text>
            </box>
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

      {/* Input box with native textarea */}
      <box
        height={inputHeight}
        borderStyle="single"
        borderColor={t.borderFocused}
        backgroundColor={bgColor}
        flexDirection="row"
        paddingX={1}
      >
        <text
          fg={isSlashCommand ? t.warning : t.primary}
          attributes={TextAttributes.BOLD}
        >
          {isSlashCommand ? " / " : " > "}
        </text>

        <textarea
          ref={textareaRef}
          focused={!props.suppressInput}
          keyBindings={TEXTAREA_KEYBINDINGS}
          placeholder={
            props.placeholder ||
            "Type a message... (^V paste, / commands, @ context, → accept)"
          }
          placeholderColor={t.textDim}
          textColor={t.text}
          backgroundColor={bgColor}
          cursorColor={t.primary}
          cursorStyle={{ style: "block", blinking: true }}
          selectionBg={t.primary}
          selectionFg={t.bg}
          wrapMode="word"
          showCursor={true}
          flexGrow={1}
          onContentChange={handleContentChange}
          onSubmit={handleSubmit}
        />

        {/* Ghost text hint (shown after textarea when no dropdown) */}
        {ghost && !showDropdown ? (
          <text fg={t.textDim}>{ghost}</text>
        ) : null}
      </box>

      {/* Mode tab bar (Build / Plan) + model label + shortcuts */}
      {props.mode && (
        <box
          height={1}
          flexDirection="row"
          backgroundColor={bgColor}
          paddingX={1}
        >
          {/* Build tab */}
          <box
            backgroundColor={props.mode === "build" ? t.primary : undefined}
          >
            <text
              fg={props.mode === "build" ? t.bg : t.textMuted}
              attributes={
                props.mode === "build" ? TextAttributes.BOLD : undefined
              }
            >
              {" Build "}
            </text>
          </box>
          <text fg={t.textDim}>{" "}</text>
          {/* Plan tab */}
          <box
            backgroundColor={
              props.mode === "plan" ? t.secondary : undefined
            }
          >
            <text
              fg={props.mode === "plan" ? t.bg : t.textMuted}
              attributes={
                props.mode === "plan" ? TextAttributes.BOLD : undefined
              }
            >
              {" Plan "}
            </text>
          </box>

          {/* Model label */}
          {props.modelLabel && (
            <>
              <text fg={t.textDim}>{" "}</text>
              <text fg={t.textMuted} attributes={TextAttributes.ITALIC}>
                {props.modelLabel}
              </text>
            </>
          )}

          {/* Right-aligned shortcut hints */}
          <box flexGrow={1} />
          <text fg={t.textDim}>{"tab mode  "}</text>
          <text fg={t.textDim}>{"^Z undo  "}</text>
          <text fg={t.textDim}>{"^V paste"}</text>
        </box>
      )}
    </box>
  );
}
