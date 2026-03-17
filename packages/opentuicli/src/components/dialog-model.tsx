/**
 * DialogModel — model picker dialog (Ctrl+P)
 */

import { TextAttributes } from "@opentui/core";
import { useState } from "react";
import { useKeyboard } from "@opentui/react";
import { useTheme } from "../context/theme";
import { getProviders } from "@cdoing/ai";

export interface ModelOption {
  id: string;
  name: string;
  hint?: string;
}

// Build model map from centralized catalog
const MODELS: Record<string, ModelOption[]> = {};
for (const p of getProviders() as Array<{ id: string; models: Array<{ id: string; label: string; hint?: string }> }>) {
  MODELS[p.id] = p.models.map((m) => ({ id: m.id, name: m.label, hint: m.hint }));
}

export function DialogModel(props: {
  provider: string;
  currentModel: string;
  onSelect: (model: string) => void;
  onClose: () => void;
}) {
  const { theme } = useTheme();
  const t = theme;
  const models = MODELS[props.provider] || [];
  const totalItems = models.length + 1; // +1 for custom option
  const [selected, setSelected] = useState(
    Math.max(0, models.findIndex((m) => m.id === props.currentModel))
  );
  const [isCustom, setIsCustom] = useState(false);
  const [customInput, setCustomInput] = useState("");

  useKeyboard((key: any) => {
    if (key.name === "escape" || (key.ctrl && key.name === "c")) {
      if (isCustom) { setIsCustom(false); return; }
      props.onClose();
    } else if (isCustom) {
      // Custom model text input mode
      if (key.name === "return") {
        const m = customInput.trim();
        if (m) props.onSelect(m);
      } else if (key.name === "backspace") {
        setCustomInput((s) => s.slice(0, -1));
      } else if (key.ctrl && key.name === "u") {
        setCustomInput("");
      } else if (key.sequence && key.sequence.length === 1 && !key.ctrl && !key.meta) {
        setCustomInput((s) => s + key.sequence);
      }
    } else if (key.name === "up" || key.name === "k") {
      setSelected((s) => Math.max(0, s - 1));
    } else if (key.name === "down" || key.name === "j") {
      setSelected((s) => Math.min(totalItems - 1, s + 1));
    } else if (key.name === "return") {
      if (selected === models.length) {
        setIsCustom(true);
        setCustomInput("");
      } else {
        const m = models[selected];
        if (m) props.onSelect(m.id);
      }
    }
  });

  return (
    <box
      borderStyle="double"
      borderColor={t.primary}
      paddingX={1}
      paddingY={1}
      flexDirection="column"
      position="absolute"
      top="30%"
      left="20%"
      width="60%"
    >
      <text fg={t.primary} attributes={TextAttributes.BOLD}>
        {"  Select Model"}
      </text>
      <text fg={t.textDim}>{`  Provider: ${props.provider}`}</text>
      <text fg={t.textDim}>{""}</text>
      {isCustom ? (
        <>
          <text fg={t.text}>{"  Enter custom model ID:"}</text>
          <text fg={t.primary}>{`  > ${customInput}|`}</text>
          <text fg={t.textDim}>{"\n  Enter Confirm  Esc Back"}</text>
        </>
      ) : (
        <>
          {models.map((model, i) => (
            <box key={model.id}>
              <text
                fg={i === selected ? t.primary : t.text}
                attributes={i === selected ? TextAttributes.BOLD : undefined}
              >
                {`  ${i === selected ? "❯" : " "} ${model.name}`}
              </text>
              <text fg={t.textDim}>{model.hint ? `  ${model.hint}` : ""}</text>
              <text fg={model.id === props.currentModel ? t.success : t.textDim}>
                {model.id === props.currentModel ? " ●" : ""}
              </text>
            </box>
          ))}
          <box>
            <text
              fg={selected === models.length ? t.primary : t.text}
              attributes={selected === models.length ? TextAttributes.BOLD : undefined}
            >
              {`  ${selected === models.length ? "❯" : " "} Custom model...`}
            </text>
            <text fg={t.textDim}>{"  type any model name"}</text>
          </box>
          <text fg={t.textDim}>{"\n  ↑↓ Navigate  Enter Select  Esc Close"}</text>
        </>
      )}
    </box>
  );
}
