/**
 * Sub-Agent Terminate Tool — stop a running sub-agent.
 */

import type { BaseTool, ToolDefinition, ToolResult } from "../types";
import type { SubAgentManager } from "./sub-agent-manager";

export class SubAgentTerminateTool implements BaseTool {
  // ── Behavioral flags ──
  isDestructive = () => true; // terminates a running agent
  definition: ToolDefinition = {
    name: "sub_agent_terminate",
    description:
      "Terminate a running sub-agent by its ID. Use this to stop a long-running or stuck background sub-agent.",
    inputSchema: {
      type: "object",
      properties: {
        agent_id: {
          type: "string",
          description: "The ID of the sub-agent to terminate",
        },
      },
      required: ["agent_id"],
    },
    requiresPermission: false,
  };

  private manager: SubAgentManager;

  constructor(manager: SubAgentManager) {
    this.manager = manager;
  }

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const agentId = input.agent_id as string;

    if (!agentId) {
      return { success: false, output: "", error: "agent_id is required" };
    }

    const terminated = this.manager.terminate(agentId);

    if (!terminated) {
      const status = this.manager.getStatus(agentId);
      if (!status) {
        return {
          success: false,
          output: "",
          error: `No sub-agent found with ID "${agentId}".`,
        };
      }
      return {
        success: false,
        output: "",
        error: `Sub-agent "${agentId}" is not running (status: ${status.status}). Only running agents can be terminated.`,
      };
    }

    return {
      success: true,
      output: `Sub-agent "${agentId}" has been terminated.`,
    };
  }
}
