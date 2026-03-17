/**
 * DialogModel — model picker dialog (Ctrl+O)
 *
 * Uses OpenTUI <select> for the model list with proper
 * highlight styling and keyboard navigation.
 */

import { TextAttributes } from "@opentui/core";
import type { SelectOption } from "@opentui/core";
import { useState, useMemo } from "react";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
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
  const { theme, customBg } = useTheme();
  const t = theme;
  const dims = useTerminalDimensions();
  const models = MODELS[props.provider] || [];
  const [isCustom, setIsCustom] = useState(false);
  const [customInput, setCustomInput] = useState("");

  // Build SelectOption list: models + "Custom model..." at the end
  const selectOptions: SelectOption[] = useMemo(() => {
    const opts: SelectOption[] = models.map((m) => ({
      name: m.name,
      description: [
        m.hint || "",
        m.id === props.currentModel ? "● current" : "",
      ].filter(Boolean).join("  "),
      value: m.id,
    }));
    opts.push({
      name: "Custom model...",
      description: "type any model name",
      value: "__custom__",
    });
    return opts;
  }, [models, props.currentModel]);

  const initialIndex = Math.max(0, models.findIndex((m) => m.id === props.currentModel));

  useKeyboard((key: any) => {
    if (key.name === "escape" || (key.ctrl && key.name === "c")) {
      if (isCustom) { setIsCustom(false); return; }
      props.onClose();
      return;
    }
    if (!isCustom) return; // Let <select> handle navigation
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
  });

  return (
    <box
      borderStyle="double"
      borderColor={t.primary}
      backgroundColor={customBg || t.bg}
      paddingX={1}
      paddingY={1}
      flexDirection="column"
      position="absolute"
      top={Math.max(2, Math.floor((dims.height || 24) * 0.25))}
      left={Math.max(1, Math.floor(((dims.width || 80) - Math.min(60, (dims.width || 80) - 4)) / 2))}
      width={Math.min(60, (dims.width || 80) - 4)}
    >
      <text fg={t.primary} attributes={TextAttributes.BOLD}>
        {"  Select Model"}
      </text>
      <text fg={t.textDim}>{`  Provider: ${props.provider}`}</text>
      <text>{""}</text>
      {isCustom ? (
        <>
          <text fg={t.text}>{"  Enter custom model ID:"}</text>
          <box flexDirection="row">
            <text fg={t.primary}>{"  > "}</text>
            <text fg={t.text}>{customInput}</text>
            <text fg={t.primary} attributes={TextAttributes.BOLD}>{"_"}</text>
          </box>
          <text>{""}</text>
          <text fg={t.textDim}>{"  Enter Confirm  Ctrl+U Clear  Esc Back"}</text>
        </>
      ) : (
        <>
          <select
            options={selectOptions}
            focused={!isCustom}
            selectedIndex={initialIndex}
            height={Math.min(selectOptions.length, 10)}
            showDescription={true}
            backgroundColor={customBg || undefined}
            focusedBackgroundColor={customBg || undefined}
            textColor={t.text}
            focusedTextColor={t.text}
            selectedBackgroundColor={t.primary}
            selectedTextColor={t.bg}
            descriptionColor={t.textDim}
            selectedDescriptionColor={t.bg}
            showScrollIndicator={selectOptions.length > 10}
            onSelect={(_index: number, option: SelectOption | null) => {
              if (!option) return;
              if (option.value === "__custom__") {
                setIsCustom(true);
                setCustomInput("");
              } else {
                props.onSelect(option.value);
              }
            }}
          />
          <text>{""}</text>
          <text fg={t.textDim}>{"  ↑↓ Navigate  Enter Select  Esc Close"}</text>
        </>
      )}
    </box>
  );
}
