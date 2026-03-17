/**
 * Skills Route — Manage skills for the remote coding agent.
 *
 * Displays all registered skills with toggle controls.
 * Arrow keys to navigate, Enter/Space to toggle enabled state.
 */

import { useState } from "react";
import { TextAttributes } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { useTheme } from "../context/theme";
import { useEngine } from "../context/engine";
import type { Engine } from "@cdoing/remote-coding-agent";

export function Skills() {
  const { theme } = useTheme();
  const t = theme;
  const engine = useEngine();

  const skillRegistry = engine.getSkillRegistry();
  const allSkills = skillRegistry.getAll();

  const [selectedIndex, setSelectedIndex] = useState(0);
  // Force re-render after toggle
  const [, setTick] = useState(0);

  const enabledCount = allSkills.filter((e) => e.enabled).length;
  const totalCount = allSkills.length;

  useKeyboard((key: any) => {
    if (key.name === "up" || key.name === "k") {
      setSelectedIndex((s) => Math.max(0, s - 1));
    } else if (key.name === "down" || key.name === "j") {
      setSelectedIndex((s) => Math.min(allSkills.length - 1, s + 1));
    } else if (key.name === "return" || key.name === "space" || key.sequence === " ") {
      if (allSkills.length === 0) return;
      const entry = allSkills[selectedIndex];
      if (entry.enabled) {
        skillRegistry.disable(entry.skill.id);
      } else {
        skillRegistry.enable(entry.skill.id);
      }
      setTick((t) => t + 1);
    }
  });

  if (allSkills.length === 0) {
    return (
      <box flexDirection="column" flexGrow={1} paddingX={2} paddingY={1}>
        <text fg={t.primary} attributes={TextAttributes.BOLD}>
          {"Skills"}
        </text>
        <text>{""}</text>
        <text fg={t.textMuted}>{"No skills registered."}</text>
      </box>
    );
  }

  return (
    <box flexDirection="column" flexGrow={1} paddingX={2} paddingY={1}>
      <text fg={t.primary} attributes={TextAttributes.BOLD}>
        {`Skills (${enabledCount} enabled / ${totalCount} total)`}
      </text>
      <text>{""}</text>

      {allSkills.map((entry, i) => {
        const skill = entry.skill;
        const marker = entry.enabled ? "[Y]" : "[x]";
        const markerColor = entry.enabled ? t.success : t.textMuted;
        const isCoding = skill.id === "coding-agent";

        return (
          <box key={skill.id} flexDirection="column">
            <text
              fg={selectedIndex === i ? t.primary : t.textMuted}
              attributes={selectedIndex === i ? TextAttributes.BOLD : undefined}
            >
              {`  ${selectedIndex === i ? ">" : " "} `}
              <text fg={markerColor}>{marker}</text>
              {` ${skill.name} — ${skill.description}`}
            </text>
            {isCoding && entry.enabled && selectedIndex === i && (
              <text fg={t.textDim}>
                {"      Note: Configure the coding model in setup or config."}
              </text>
            )}
          </box>
        );
      })}

      <text>{""}</text>
      <text fg={t.textMuted}>{"  Up/Down Navigate  Enter/Space Toggle  Esc Back"}</text>
    </box>
  );
}
