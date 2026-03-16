/**
 * ScrollBox — Scrollable content area for Ink, inspired by OpenTUI's <scrollbox>.
 *
 * Features:
 *   - Fixed height viewport with vertical scrolling
 *   - Visual scrollbar (track + thumb) on the right
 *   - Sticky scroll: auto-scrolls to bottom on new content
 *   - Pauses auto-scroll when user scrolls up, resumes at bottom
 *   - Keyboard: Ctrl+Up/Down (3 lines), PageUp/Down (page), Ctrl+Home/End
 *   - Exposes ref for programmatic control
 */

import React, { useEffect, useRef, useState, useCallback, useImperativeHandle, forwardRef } from "react";
import { Box, Text, useInput } from "ink";
import { getTheme } from "./theme";

// ── Types ───────────────────────────────────────────────────────────────────

export interface ScrollBoxRef {
  /** Scroll to absolute line offset */
  scrollTo(offset: number): void;
  /** Scroll by relative amount (negative = up) */
  scrollBy(delta: number): void;
  /** Jump to bottom and re-enable sticky scroll */
  scrollToBottom(): void;
  /** Jump to top */
  scrollToTop(): void;
  /** Current scroll offset */
  getOffset(): number;
  /** Whether auto-scroll is active */
  isSticky(): boolean;
}

export interface ScrollBoxProps {
  /** Lines to render in the scrollable area */
  lines: string[];
  /** Height of the viewport in terminal rows */
  height: number;
  /** Show scrollbar. Default: true */
  scrollbar?: boolean;
  /** Lines to scroll per step (Ctrl+Up/Down). Default: 3 */
  scrollStep?: number;
  /** Whether this scrollbox should handle keyboard input. Default: true */
  active?: boolean;
  /** Called when scroll position changes */
  onScroll?: (offset: number, maxOffset: number) => void;
}

// ── Scrollbar characters ────────────────────────────────────────────────────

const TRACK_CHAR = "│";
const THUMB_CHAR = "┃";

// ── Component ───────────────────────────────────────────────────────────────

export const ScrollBox = forwardRef<ScrollBoxRef, ScrollBoxProps>(({
  lines,
  height,
  scrollbar = true,
  scrollStep = 3,
  active = true,
  onScroll,
}, ref) => {
  const [offset, setOffset] = useState(0);
  const stickyRef = useRef(true); // auto-scroll to bottom
  const prevLineCountRef = useRef(0);

  const maxOffset = Math.max(0, lines.length - height);
  const contentWidth = (process.stdout.columns || 80) - (scrollbar ? 2 : 0);

  // ── Sticky scroll: auto-scroll to bottom when new lines arrive ──────────
  useEffect(() => {
    if (lines.length !== prevLineCountRef.current) {
      prevLineCountRef.current = lines.length;
      if (stickyRef.current) {
        const newOffset = Math.max(0, lines.length - height);
        setOffset(newOffset);
        onScroll?.(newOffset, maxOffset);
      }
    }
  }, [lines.length, height, maxOffset, onScroll]);

  // ── Scroll helpers ──────────────────────────────────────────────────────
  const doScroll = useCallback((newOffset: number) => {
    const clamped = Math.max(0, Math.min(maxOffset, newOffset));
    setOffset(clamped);
    stickyRef.current = clamped >= maxOffset;
    onScroll?.(clamped, maxOffset);
  }, [maxOffset, onScroll]);

  // ── Imperative ref ────────────────────────────────────────────────────────
  useImperativeHandle(ref, () => ({
    scrollTo: (off: number) => doScroll(off),
    scrollBy: (delta: number) => doScroll(offset + delta),
    scrollToBottom: () => {
      stickyRef.current = true;
      doScroll(maxOffset);
    },
    scrollToTop: () => {
      stickyRef.current = false;
      doScroll(0);
    },
    getOffset: () => offset,
    isSticky: () => stickyRef.current,
  }), [offset, maxOffset, doScroll]);

  // ── Keyboard input ──────────────────────────────────────────────────────
  useInput((char, key) => {
    if (!active) return;

    // Ctrl+Up — scroll up
    if (key.ctrl && key.upArrow) {
      doScroll(offset - scrollStep);
      return;
    }
    // Ctrl+Down — scroll down
    if (key.ctrl && key.downArrow) {
      doScroll(offset + scrollStep);
      return;
    }
    // PageUp
    if (key.pageUp) {
      doScroll(offset - height);
      return;
    }
    // PageDown
    if (key.pageDown) {
      doScroll(offset + height);
      return;
    }
    // Ctrl+A — top (like Home)
    if (key.ctrl && char === "a" && lines.length > height) {
      stickyRef.current = false;
      doScroll(0);
      return;
    }
    // Ctrl+E — bottom (like End)
    if (key.ctrl && char === "e") {
      stickyRef.current = true;
      doScroll(maxOffset);
      return;
    }
  });

  // ── Render ────────────────────────────────────────────────────────────────
  const t = getTheme();
  const visible = lines.slice(offset, offset + height);
  const showScrollbar = scrollbar && lines.length > height;

  // Calculate scrollbar thumb position and size
  let thumbStart = 0;
  let thumbSize = 1;
  if (showScrollbar && lines.length > 0) {
    const ratio = height / lines.length;
    thumbSize = Math.max(1, Math.round(ratio * height));
    thumbStart = maxOffset > 0
      ? Math.round((offset / maxOffset) * (height - thumbSize))
      : 0;
  }

  return (
    <Box flexDirection="column" height={height}>
      {visible.map((line, i) => (
        <Box key={offset + i} flexDirection="row">
          <Box flexGrow={1} width={contentWidth}>
            <Text wrap="truncate">{line || " "}</Text>
          </Box>
          {showScrollbar ? (
            <Box width={1} marginLeft={1}>
              <Text color={
                i >= thumbStart && i < thumbStart + thumbSize
                  ? t.accent
                  : t.border
              }>
                {i >= thumbStart && i < thumbStart + thumbSize
                  ? THUMB_CHAR
                  : TRACK_CHAR}
              </Text>
            </Box>
          ) : null}
        </Box>
      ))}

      {/* Fill empty space if content is shorter than viewport */}
      {visible.length < height ? (
        Array.from({ length: height - visible.length }, (_, i) => (
          <Box key={`empty-${i}`} flexDirection="row">
            <Box flexGrow={1}>
              <Text>{" "}</Text>
            </Box>
            {showScrollbar ? (
              <Box width={1} marginLeft={1}>
                <Text color={t.border}>{TRACK_CHAR}</Text>
              </Box>
            ) : null}
          </Box>
        ))
      ) : null}
    </Box>
  );
});

ScrollBox.displayName = "ScrollBox";
