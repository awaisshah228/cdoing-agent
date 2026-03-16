/**
 * DialogModel — model picker dialog (Ctrl+P)
 */

import { TextAttributes } from "@opentui/core";
import { useState } from "react";
import { useKeyboard } from "@opentui/react";
import { useTheme } from "../context/theme";

export interface ModelOption {
  id: string;
  name: string;
  hint?: string;
}

const MODELS: Record<string, ModelOption[]> = {
  anthropic: [
    { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6", hint: "fast & smart" },
    { id: "claude-opus-4-6", name: "Claude Opus 4.6", hint: "most capable" },
    { id: "claude-haiku-4-5", name: "Claude Haiku 4.5", hint: "fastest" },
  ],
  openai: [
    { id: "gpt-4o", name: "GPT-4o", hint: "recommended" },
    { id: "gpt-4o-mini", name: "GPT-4o mini", hint: "fastest" },
    { id: "o3", name: "o3", hint: "reasoning" },
  ],
  google: [
    { id: "gemini-2.0-flash", name: "Gemini 2.0 Flash", hint: "fast" },
    { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro", hint: "most capable" },
  ],
};

export function DialogModel(props: {
  provider: string;
  currentModel: string;
  onSelect: (model: string) => void;
  onClose: () => void;
}) {
  const { theme } = useTheme();
  const t = theme;
  const models = MODELS[props.provider] || [];
  const [selected, setSelected] = useState(
    Math.max(0, models.findIndex((m) => m.id === props.currentModel))
  );

  useKeyboard((key: any) => {
    if (key.name === "escape" || (key.ctrl && key.name === "c")) {
      props.onClose();
    } else if (key.name === "up" || key.name === "k") {
      setSelected((s) => Math.max(0, s - 1));
    } else if (key.name === "down" || key.name === "j") {
      setSelected((s) => Math.min(models.length - 1, s + 1));
    } else if (key.name === "return") {
      const m = models[selected];
      if (m) props.onSelect(m.id);
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
      <text fg={t.textDim}>{"\n  ↑↓ Navigate  Enter Select  Esc Close"}</text>
    </box>
  );
}
