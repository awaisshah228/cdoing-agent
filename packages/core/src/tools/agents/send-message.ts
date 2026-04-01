/**
 * SendMessage Tool — send a message to a running sub-agent.
 *
 * Inspired by Claude Code's SendMessageTool. Allows the coordinator
 * to continue an existing agent with follow-up instructions without
 * spawning a new one (preserves conversation context).
 */

import type { BaseTool, ToolDefinition, ToolResult } from "../types";
import type { SubAgentManager } from "./sub-agent-manager";

export class SendMessageTool implements BaseTool {
  // ── Behavioral flags ──
  concurrencyMode = () => "parallel" as const; // messages to different agents are independent
  definition: ToolDefinition = {
    name: "send_message",
    description:
      "Send a follow-up message to a running or completed sub-agent. " +
      "The agent resumes with its full context preserved. Use this to continue " +
      "a previously spawned agent rather than creating a new one. " +
      'Provide the agent\'s ID (from sub_agent) and the message to send.',
    inputSchema: {
      type: "object",
      properties: {
        to: {
          type: "string",
          description: "The agent ID or name to send the message to.",
        },
        message: {
          type: "string",
          description: "The follow-up message or instructions for the agent.",
        },
        summary: {
          type: "string",
          description: "A 5-10 word preview of what this message is about.",
        },
      },
      required: ["to", "message"],
    },
    requiresPermission: false,
  };

  private manager: SubAgentManager;
  private sendFn?: (agentId: string, message: string) => Promise<string>;

  constructor(
    manager: SubAgentManager,
    sendFn?: (agentId: string, message: string) => Promise<string>,
  ) {
    this.manager = manager;
    this.sendFn = sendFn;
  }

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const to = String(input.to || "");
    const message = String(input.message || "");

    if (!to) {
      return { success: false, output: "Missing 'to' — provide the agent ID or name." };
    }
    if (!message) {
      return { success: false, output: "Missing 'message' — provide the follow-up instructions." };
    }

    // Check if agent exists
    const agent = this.manager.get(to);
    if (!agent) {
      const all = this.manager.listAll();
      const available = all.map((a) => `${a.id} (${a.status})`).join(", ") || "none";
      return {
        success: false,
        output: `Agent "${to}" not found. Available agents: ${available}`,
      };
    }

    if (this.sendFn) {
      try {
        const result = await this.sendFn(to, message);
        return { success: true, output: result };
      } catch (err: any) {
        return { success: false, output: `Failed to send message: ${err.message || err}` };
      }
    }

    return {
      success: false,
      output: "SendMessage not supported in this context — no send function configured.",
    };
  }
}
