/**
 * Sub-Agent Status Tool — check status and output of spawned sub-agents.
 */

import type { BaseTool, ToolDefinition, ToolResult } from "../types";
import type { SubAgentManager } from "./sub-agent-manager";

export class SubAgentStatusTool implements BaseTool {
  definition: ToolDefinition = {
    name: "sub_agent_status",
    description:
      "Check the status and output of a background sub-agent by its ID, or list all sub-agents. Use this to poll for completion of background sub-agents.",
    inputSchema: {
      type: "object",
      properties: {
        agent_id: {
          type: "string",
          description:
            "The ID of the sub-agent to check. Omit to list all sub-agents.",
        },
      },
      required: [],
    },
    requiresPermission: false,
  };

  private manager: SubAgentManager;

  constructor(manager: SubAgentManager) {
    this.manager = manager;
  }

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const agentId = input.agent_id as string | undefined;

    if (agentId) {
      // Get specific agent status
      const status = this.manager.getStatus(agentId);
      if (!status) {
        return {
          success: false,
          output: "",
          error: `No sub-agent found with ID "${agentId}". Use sub_agent_status without an agent_id to list all agents.`,
        };
      }

      return {
        success: true,
        output: JSON.stringify(status, null, 2),
      };
    }

    // List all agents
    const all = this.manager.listAll();
    if (all.length === 0) {
      return {
        success: true,
        output: "No sub-agents have been spawned yet.",
      };
    }

    return {
      success: true,
      output: JSON.stringify(all, null, 2),
    };
  }
}
