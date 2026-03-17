/**
 * AgentPanel — dual-agent display showing assistant and coding model info.
 *
 * Tree layout:
 *   + Agents
 *   +-- Assistant: provider/model
 *   |   2 active
 *   +-- Coding: provider/model
 *       1 active
 */

import { TextAttributes } from "@opentui/core";
import { useTheme } from "../context/theme";
import type { EngineState } from "../hooks/use-engine-state";

export interface AgentPanelProps {
  state: EngineState;
}

function shortModel(model: string): string {
  return model.replace("claude-", "").replace("gpt-", "").substring(0, 20);
}

export function AgentPanel(props: AgentPanelProps) {
  const { theme: t } = useTheme();
  const { stats, agentStats } = props.state;

  return (
    <box flexDirection="column" flexShrink={0}>
      <text fg={t.primary} attributes={TextAttributes.BOLD}>
        {"\u25CF Agents"}
      </text>
      <box flexDirection="column" paddingLeft={2}>
        <text fg={t.info}>
          {`\u251C Assistant: ${stats.assistantProvider}/${shortModel(stats.assistantModel)}`}
        </text>
        <text fg={t.textMuted}>
          {`\u2502  ${agentStats.assistant} active`}
        </text>
        <text fg={t.secondary}>
          {`\u2514 Coding: ${stats.codingProvider}/${shortModel(stats.codingModel)}`}
        </text>
        <text fg={t.textMuted}>
          {`   ${agentStats.coding} active`}
        </text>
      </box>
    </box>
  );
}
