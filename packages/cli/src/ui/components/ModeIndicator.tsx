/**
 * ModeIndicator — Shows current permission mode.
 * Like Continue's ModeIndicator component.
 *
 * Modes: [⏸ plan]  [⏵⏵ auto]  (hidden for default/ask)
 */

import React from "react";
import { Text } from "ink";

interface ModeIndicatorProps {
  mode: string;
}

const MODE_DISPLAY: Record<string, { icon: string; label: string; color: string }> = {
  plan:              { icon: "⏸",   label: "plan",      color: "yellow" },
  bypassPermissions: { icon: "⏵⏵", label: "yolo",      color: "red" },
  dontAsk:           { icon: "⏵⏵", label: "auto",      color: "green" },
  acceptEdits:       { icon: "⏵",   label: "auto-edit", color: "cyan" },
};

export const ModeIndicator: React.FC<ModeIndicatorProps> = ({ mode }) => {
  const display = MODE_DISPLAY[mode];
  if (!display) return null; // "default" / "ask" mode — no indicator

  return (
    <Text color={display.color}>
      {`[${display.icon} ${display.label}]`}
    </Text>
  );
};
