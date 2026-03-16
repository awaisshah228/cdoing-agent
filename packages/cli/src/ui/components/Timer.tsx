/**
 * Timer — Elapsed time display, updates every second.
 * Shows "Xs" for seconds, "Xm Ys" for minutes.
 */

import React, { useEffect, useState } from "react";
import { Text } from "ink";

interface TimerProps {
  startTime: number;
  color?: string;
}

export const Timer: React.FC<TimerProps> = ({ startTime, color = "dim" }) => {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [startTime]);

  const display = elapsed >= 60
    ? `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`
    : `${elapsed}s`;

  return <Text color={color}>{display}</Text>;
};
