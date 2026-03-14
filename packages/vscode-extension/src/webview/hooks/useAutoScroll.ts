/**
 * useAutoScroll.ts — ResizeObserver-based auto-scroll (Continue.dev approach)
 *
 * Uses ResizeObserver instead of scroll events for efficiency.
 * Only auto-scrolls if user hasn't manually scrolled up.
 * Resets scroll lock on new user messages.
 */

import { useRef, useEffect, useCallback } from "react";

export function useAutoScroll(deps: unknown[]) {
  const containerRef = useRef<HTMLDivElement>(null);
  const isUserScrolledUp = useRef(false);
  const prevEntriesLength = useRef(0);

  // Check if user has scrolled up from bottom
  const checkScrollPosition = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const threshold = 50; // px from bottom to consider "at bottom"
    isUserScrolledUp.current =
      el.scrollHeight - el.scrollTop - el.clientHeight > threshold;
  }, []);

  // Scroll to bottom
  const scrollToBottom = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, []);

  // Listen for manual scroll
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener("scroll", checkScrollPosition, { passive: true });
    return () => el.removeEventListener("scroll", checkScrollPosition);
  }, [checkScrollPosition]);

  // ResizeObserver — auto-scroll when content grows (new tokens, tool results)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new ResizeObserver(() => {
      if (!isUserScrolledUp.current) {
        scrollToBottom();
      }
    });

    // Observe the container and all direct children
    observer.observe(el);
    for (const child of Array.from(el.children)) {
      observer.observe(child);
    }

    return () => observer.disconnect();
  }, [deps, scrollToBottom]);

  // Reset scroll lock when new entries are added (user sent a message)
  useEffect(() => {
    const currentLength = (deps[0] as unknown[])?.length || 0;
    if (currentLength > prevEntriesLength.current) {
      // New entry added — check if it's a user message (scroll lock reset)
      isUserScrolledUp.current = false;
      scrollToBottom();
    }
    prevEntriesLength.current = currentLength;
  }, [deps, scrollToBottom]);

  return containerRef;
}
