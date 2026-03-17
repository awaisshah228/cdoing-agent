/**
 * DialogStatus — system status dialog showing provider, tools, config info.
 * Uses native <scrollbox> for smooth scrolling through sections.
 */

import { TextAttributes } from "@opentui/core";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useTheme } from "../context/theme";
import { useSDK } from "../context/sdk";

export function DialogStatus(props: { onClose: () => void }) {
  const { theme, customBg } = useTheme();
  const t = theme;
  const sdk = useSDK();
  const dims = useTerminalDimensions();

  const dialogWidth = Math.min(60, (dims.width || 80) - 4);
  const dialogHeight = Math.max(10, (dims.height || 24) - 6);

  // Gather status info
  const allTools = sdk.registry.getAll ? sdk.registry.getAll() : [];
  const toolNames = Array.isArray(allTools)
    ? allTools.map((tool: any) =>
        tool.definition?.name || tool.name || "unknown"
      )
    : [];

  useKeyboard((key: any) => {
    if (key.name === "escape" || key.name === "q") props.onClose();
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
      top={Math.max(1, Math.floor((dims.height || 24) * 0.1))}
      left={Math.max(1, Math.floor(((dims.width || 80) - dialogWidth) / 2))}
      width={dialogWidth}
      height={dialogHeight}
    >
      {/* Title bar */}
      <box flexDirection="row" flexShrink={0}>
        <text fg={t.primary} attributes={TextAttributes.BOLD} flexGrow={1}>
          {"  System Status"}
        </text>
        <text fg={t.textDim}>{"esc"}</text>
      </box>
      <text flexShrink={0}>{""}</text>

      <scrollbox flexGrow={1}>
        <box flexShrink={0}>
          {/* Provider */}
          <text fg={t.secondary} attributes={TextAttributes.BOLD}>{"  Provider"}</text>
          <box flexDirection="row"><text fg={t.textMuted}>{"    Provider  "}</text><text fg={t.text}>{sdk.provider}</text></box>
          <box flexDirection="row"><text fg={t.textMuted}>{"    Model     "}</text><text fg={t.text}>{sdk.model}</text></box>
          <box flexDirection="row"><text fg={t.textMuted}>{"    Directory "}</text><text fg={t.text}>{sdk.workingDir}</text></box>
          <text>{""}</text>

          {/* System */}
          <text fg={t.secondary} attributes={TextAttributes.BOLD}>{"  System"}</text>
          <box flexDirection="row"><text fg={t.textMuted}>{"    Node      "}</text><text fg={t.text}>{process.version}</text></box>
          <box flexDirection="row"><text fg={t.textMuted}>{"    Platform  "}</text><text fg={t.text}>{`${process.platform} ${process.arch}`}</text></box>
          <box flexDirection="row"><text fg={t.textMuted}>{"    Terminal  "}</text><text fg={t.text}>{process.env.TERM_PROGRAM || process.env.TERM || "unknown"}</text></box>
          <box flexDirection="row"><text fg={t.textMuted}>{"    Shell     "}</text><text fg={t.text}>{process.env.SHELL || "unknown"}</text></box>
          <text>{""}</text>

          {/* Tools */}
          <text fg={t.secondary} attributes={TextAttributes.BOLD}>{`  Tools (${toolNames.length})`}</text>
          {toolNames.map((name: string) => (
            <box key={name} flexDirection="row">
              <text fg={t.textMuted}>{"    • "}</text>
              <text fg={t.text}>{name}</text>
            </box>
          ))}
        </box>
      </scrollbox>
    </box>
  );
}
