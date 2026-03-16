/**
 * StaticChatContent — Like Continue's approach.
 *
 * Splits messages into:
 *   - staticItems: older messages rendered via <Static> (written once, permanent)
 *   - pendingItems: latest message rendered dynamically (can update as streaming)
 *
 * This prevents Ink from re-rendering the entire chat history on each token,
 * while keeping the latest message live/updatable.
 *
 * Also handles:
 *   - Terminal resize (debounced refresh)
 *   - /clear command (remounts Static via key change)
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Box, Static, useStdout } from "ink";
import { MemoizedMessage } from "./MemoizedMessage";
import type { ChatMessage } from "../types";

interface StaticChatContentProps {
  messages: ChatMessage[];
  refreshTrigger?: number;
}

/** How many items to keep in the dynamic (pending) area */
const PENDING_ITEMS_COUNT = 1;

export const StaticChatContent: React.FC<StaticChatContentProps> = ({
  messages,
  refreshTrigger,
}) => {
  const { stdout } = useStdout();
  const [staticKey, setStaticKey] = useState(0);
  const isInitialMount = useRef(true);
  const [termCols, setTermCols] = useState(process.stdout.columns || 80);

  // Refresh: clear terminal and remount Static (for /clear, terminal resize)
  const refreshStatic = useCallback(() => {
    if (stdout) {
      stdout.write("\x1b[2J\x1b[H");
      setStaticKey((prev) => prev + 1);
      stdout.write("\x1b[3J"); // clear scrollback
    }
  }, [stdout]);

  // Debounced terminal resize handler
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    const handler = setTimeout(() => refreshStatic(), 300);
    return () => clearTimeout(handler);
  }, [termCols, refreshStatic]);

  // Track terminal resize
  useEffect(() => {
    const onResize = () => setTermCols(process.stdout.columns || 80);
    process.stdout.on("resize", onResize);
    return () => { process.stdout.off("resize", onResize); };
  }, []);

  // /clear trigger
  useEffect(() => {
    if (refreshTrigger !== undefined && refreshTrigger > 0) {
      refreshStatic();
    }
  }, [refreshTrigger, refreshStatic]);

  // Split into static (permanent) and pending (live/dynamic)
  const { staticItems, pendingItems } = React.useMemo(() => {
    const stableCount = Math.max(0, messages.length - PENDING_ITEMS_COUNT);
    const stableMessages = messages.slice(0, stableCount);
    const pendingMessages = messages.slice(stableCount);

    const staticItems = stableMessages.map((msg) => (
      <MemoizedMessage key={msg.id} message={msg} />
    ));

    const pendingItems = pendingMessages.map((msg) => (
      <MemoizedMessage key={msg.id} message={msg} />
    ));

    return { staticItems, pendingItems };
  }, [messages]);

  return (
    <Box flexDirection="column">
      {/* Static: permanent, never re-rendered by Ink */}
      <Static key={staticKey} items={staticItems}>
        {(item) => item}
      </Static>

      {/* Pending: dynamic, can update (latest message) */}
      <Box flexDirection="column">
        {pendingItems.map((item, i) => (
          <React.Fragment key={`pending-${i}`}>{item}</React.Fragment>
        ))}
      </Box>
    </Box>
  );
};
