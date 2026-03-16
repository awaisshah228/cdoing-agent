/**
 * LoadingSpinner — animated thinking/tool indicator
 */

import { useState, useEffect } from "react";
import { useTheme } from "../context/theme";

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export function LoadingSpinner(props: { label?: string }) {
  const { theme } = useTheme();
  const t = theme;
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setFrame((f) => (f + 1) % FRAMES.length);
    }, 80);
    return () => clearInterval(interval);
  }, []);

  return (
    <box paddingX={1} height={1} flexDirection="row">
      <text fg={t.primary}>{FRAMES[frame]}</text>
      <text fg={t.textMuted}>{` ${props.label || "Thinking..."}`}</text>
    </box>
  );
}
