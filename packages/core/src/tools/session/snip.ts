/**
 * Snip Tool — manually compress a range of conversation history.
 *
 * Inspired by Claude Code's SnipTool (HISTORY_SNIP). Allows the agent
 * to selectively compress old turns rather than waiting for auto-compaction.
 */

import type { BaseTool, ToolDefinition, ToolResult } from "../types";

export type SnipCallback = (fromTurn: number, toTurn: number) => Promise<number>;

export class SnipTool implements BaseTool {
  definition: ToolDefinition = {
    name: "snip",
    description:
      "Compress a range of conversation history to free up context space. " +
      "Specify which turns to compress. The compressed content is replaced " +
      "with a summary. Use this proactively when you notice the conversation " +
      "is getting long and old turns are no longer relevant.",
    inputSchema: {
      type: "object",
      properties: {
        from_turn: {
          type: "number",
          description: "Start turn number to compress (inclusive). Use 1 for the beginning.",
        },
        to_turn: {
          type: "number",
          description: "End turn number to compress (inclusive). Use -1 for 'all except recent'.",
        },
        reason: {
          type: "string",
          description: "Why this history is being snipped.",
        },
      },
      required: ["from_turn", "to_turn"],
    },
    requiresPermission: false,
  };

  private onSnip?: SnipCallback;

  constructor(onSnip?: SnipCallback) {
    this.onSnip = onSnip;
  }

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const fromTurn = Number(input.from_turn) || 1;
    const toTurn = Number(input.to_turn) || -1;

    if (!this.onSnip) {
      return { success: false, output: "Snip not available — no snip handler configured." };
    }

    try {
      const tokensSaved = await this.onSnip(fromTurn, toTurn);
      return {
        success: true,
        output: `Snipped turns ${fromTurn} to ${toTurn === -1 ? "recent" : toTurn}. Saved ~${tokensSaved.toLocaleString()} tokens.`,
      };
    } catch (err: any) {
      return { success: false, output: `Snip failed: ${err.message || err}` };
    }
  }
}
