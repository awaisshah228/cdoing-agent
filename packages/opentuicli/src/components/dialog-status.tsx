/**
 * DialogStatus — system status dialog showing provider, tools, config info.
 * Scrollable overlay with sections for Provider, System, and Tools.
 */

import { TextAttributes } from "@opentui/core";
import { useState } from "react";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useTheme } from "../context/theme";
import { useSDK } from "../context/sdk";

export function DialogStatus(props: { onClose: () => void }) {
  const { theme } = useTheme();
  const t = theme;
  const sdk = useSDK();
  const dims = useTerminalDimensions();
  const [scrollOffset, setScrollOffset] = useState(0);

  // Gather status info
  const allTools = sdk.registry.getAll ? sdk.registry.getAll() : [];
  const toolNames = Array.isArray(allTools)
    ? allTools.map((tool: any) =>
        tool.definition?.name || tool.name || "unknown"
      )
    : [];

  const sections: Array<{ title: string; rows: Array<[string, string]> }> = [
    {
      title: "Provider",
      rows: [
        ["Provider", sdk.provider],
        ["Model", sdk.model],
        ["Directory", sdk.workingDir],
      ],
    },
    {
      title: "System",
      rows: [
        ["Node", process.version],
        ["Platform", `${process.platform} ${process.arch}`],
        [
          "Terminal",
          process.env.TERM_PROGRAM || process.env.TERM || "unknown",
        ],
        ["Shell", process.env.SHELL || "unknown"],
      ],
    },
    {
      title: `Tools (${toolNames.length})`,
      rows: toolNames.slice(0, 20).map((name: string) => ["\u2022", name]),
    },
  ];

  // Build flat lines for scrolling
  const lines: Array<{
    type: "header" | "row";
    text: string;
    value?: string;
  }> = [];
  for (const section of sections) {
    lines.push({ type: "header", text: section.title });
    for (const [label, value] of section.rows) {
      lines.push({ type: "row", text: label, value });
    }
    lines.push({ type: "row", text: "", value: "" }); // spacer
  }

  const maxVisible = Math.max(5, (dims.height || 24) - 10);

  useKeyboard((key: any) => {
    if (key.name === "escape" || key.name === "q") props.onClose();
    if (key.name === "up" || key.name === "k")
      setScrollOffset((s) => Math.max(0, s - 1));
    if (key.name === "down" || key.name === "j")
      setScrollOffset((s) => Math.min(lines.length - maxVisible, s + 1));
  });

  const visible = lines.slice(scrollOffset, scrollOffset + maxVisible);

  return (
    <box
      borderStyle="double"
      borderColor={t.primary}
      paddingX={1}
      paddingY={1}
      flexDirection="column"
      position="absolute"
      top="10%"
      left="15%"
      width="70%"
    >
      <text fg={t.primary} attributes={TextAttributes.BOLD}>
        {"  System Status"}
      </text>
      <text>{""}</text>
      {visible.map((line, i) => {
        if (line.type === "header") {
          return (
            <text
              key={`h-${i}`}
              fg={t.secondary}
              attributes={TextAttributes.BOLD}
            >
              {`  ${line.text}`}
            </text>
          );
        }
        if (!line.text && !line.value) return <text key={`s-${i}`}>{""}</text>;
        return (
          <box key={`r-${i}`} flexDirection="row">
            <text fg={t.textMuted}>{`    ${line.text}`}</text>
            {line.value && <text fg={t.text}>{` ${line.value}`}</text>}
          </box>
        );
      })}
      <text>{""}</text>
      <text fg={t.textDim}>
        {"  \u2191\u2193 Scroll  Esc Close"}
      </text>
    </box>
  );
}
