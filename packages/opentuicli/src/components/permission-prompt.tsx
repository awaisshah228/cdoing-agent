/**
 * PermissionPrompt — asks user to allow/deny a tool action
 */

import { TextAttributes } from "@opentui/core";
import { useState } from "react";
import { useKeyboard } from "@opentui/react";
import { useTheme } from "../context/theme";

export interface PermissionPromptProps {
  toolName: string;
  message: string;
  onDecision: (decision: "allow" | "always" | "deny") => void;
}

const OPTIONS = [
  { key: "1", label: "Allow once", value: "allow" as const },
  { key: "2", label: "Always allow", value: "always" as const },
  { key: "3", label: "Deny", value: "deny" as const },
];

export function PermissionPrompt(props: PermissionPromptProps) {
  const { theme } = useTheme();
  const t = theme;
  const [selected, setSelected] = useState(0);

  useKeyboard((key: any) => {
    if (key.name === "up" || key.name === "k") {
      setSelected((s) => Math.max(0, s - 1));
    } else if (key.name === "down" || key.name === "j") {
      setSelected((s) => Math.min(OPTIONS.length - 1, s + 1));
    } else if (key.name === "return") {
      props.onDecision(OPTIONS[selected].value);
    } else if (key.name === "1") {
      props.onDecision("allow");
    } else if (key.name === "2") {
      props.onDecision("always");
    } else if (key.name === "3") {
      props.onDecision("deny");
    }
  });

  return (
    <box
      borderStyle="single"
      borderColor={t.warning}
      paddingX={1}
      paddingY={0}
      flexDirection="column"
    >
      <text fg={t.warning} attributes={TextAttributes.BOLD}>
        {"🔐 Permission Required"}
      </text>
      <text fg={t.text}>
        {`  ${props.toolName}: ${props.message}`}
      </text>
      <text fg={t.textDim}>{""}</text>
      {OPTIONS.map((opt, i) => (
        <box key={opt.key}>
          <text
            fg={selected === i ? t.primary : t.textMuted}
            attributes={selected === i ? TextAttributes.BOLD : undefined}
          >
            {`  ${selected === i ? "❯" : " "} [${opt.key}] ${opt.label}`}
          </text>
        </box>
      ))}
      <text fg={t.textDim}>{"\n  ↑↓ Navigate  Enter Select  1-3 Quick pick"}</text>
    </box>
  );
}
