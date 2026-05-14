/**
 * useAutoScroll.ts — Smooth auto-scroll optimized for streaming
 *
 * Uses ResizeObserver + requestAnimationFrame for jitter-free scrolling.
 * Only auto-scrolls if user hasn't manually scrolled up.
 */

import { useRef, useEffect, useCallback } from "react";

export function useAutoScroll(deps: unknown[]) {
  const containerRef = useRef<HTMLDivElement>(null);
  const isUserScrolledUp = useRef(false);
  const prevEntriesLength = useRef(0);
  const rafId = useRef<number>(0);

  // Check if user has scrolled up from bottom
  const checkScrollPosition = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const threshold = 40;
    isUserScrolledUp.current =
      el.scrollHeight - el.scrollTop - el.clientHeight > threshold;
  }, []);

  // Scroll to bottom using rAF to avoid layout thrashing
  const scrollToBottom = useCallback(() => {
    cancelAnimationFrame(rafId.current);
    rafId.current = requestAnimationFrame(() => {
      const el = containerRef.current;
      if (!el) return;
      el.scrollTop = el.scrollHeight;
    });
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

    return () => {
      observer.disconnect();
      cancelAnimationFrame(rafId.current);
    };
  }, [deps, scrollToBottom]);

  // Reset scroll lock when new entries are added
  useEffect(() => {
    const currentLength = (deps[0] as unknown[])?.length || 0;
    if (currentLength > prevEntriesLength.current) {
      isUserScrolledUp.current = false;
      scrollToBottom();
    }
    prevEntriesLength.current = currentLength;
  }, [deps, scrollToBottom]);

  return containerRef;
}
