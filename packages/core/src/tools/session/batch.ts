/**
 * Batch Tool — execute up to 25 tools in parallel.
 *
 * Each inner tool still goes through normal permission checks.
 * The batch tool itself doesn't require permission — it's just an orchestrator.
 * Nesting is disallowed (no batch inside batch).
 */

import type { BaseTool, ToolDefinition, ToolResult } from "../types";
import type { ToolRegistry } from "../registry";

const MAX_BATCH_SIZE = 25;
const DISALLOWED_TOOLS = new Set(["batch"]); // prevent nesting

export class BatchTool implements BaseTool {
  // ── Behavioral flags ──
  // Sequential: batch orchestrates inner tools, must not run in parallel with other batches
  definition: ToolDefinition = {
    name: "batch",
    description:
      "Execute multiple tools in parallel. Use this when you need to perform several independent operations at once (e.g., reading multiple files, running searches). Maximum 25 tool calls per batch. Each tool still checks its own permissions.",
    inputSchema: {
      type: "object",
      properties: {
        invocations: {
          type: "array",
          description: "Array of tool calls to execute in parallel",
          items: {
            type: "object",
            properties: {
              tool_name: {
                type: "string",
                description: "Name of the tool to call",
              },
              input: {
                type: "object",
                description: "Input parameters for the tool",
              },
            },
            required: ["tool_name", "input"],
          },
        },
      },
      required: ["invocations"],
    },
    requiresPermission: false,
  };

  private registry: ToolRegistry;

  constructor(registry: ToolRegistry) {
    this.registry = registry;
  }

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const invocations = input.invocations as Array<{
      tool_name: string;
      input: Record<string, unknown>;
    }>;

    if (!Array.isArray(invocations) || invocations.length === 0) {
      return { success: false, output: "", error: "No invocations provided" };
    }

    if (invocations.length > MAX_BATCH_SIZE) {
      return {
        success: false,
        output: "",
        error: `Maximum ${MAX_BATCH_SIZE} tools per batch. Got ${invocations.length}.`,
      };
    }

    // Validate all tools exist and are allowed
    for (const inv of invocations) {
      if (DISALLOWED_TOOLS.has(inv.tool_name)) {
        return {
          success: false,
          output: "",
          error: `Tool "${inv.tool_name}" cannot be used inside batch`,
        };
      }
      if (!this.registry.get(inv.tool_name)) {
        return {
          success: false,
          output: "",
          error: `Unknown tool: ${inv.tool_name}`,
        };
      }
    }

    // Execute all in parallel
    const results = await Promise.allSettled(
      invocations.map(async (inv, index) => {
        const result = await this.registry.execute(inv.tool_name, inv.input);
        return { index, tool: inv.tool_name, result };
      })
    );

    // Collect results
    let successful = 0;
    let failed = 0;
    const details: string[] = [];

    for (const settledResult of results) {
      if (settledResult.status === "fulfilled") {
        const { index, tool, result } = settledResult.value;
        if (result.success) {
          successful++;
          // Truncate individual outputs to keep batch result manageable
          const output = result.output.length > 2000
            ? result.output.substring(0, 2000) + "... [truncated]"
            : result.output;
          details.push(`[${index}] ${tool}: OK\n${output}`);
        } else {
          failed++;
          details.push(`[${index}] ${tool}: ERROR - ${result.error}`);
        }
      } else {
        failed++;
        const reason = settledResult.reason instanceof Error
          ? settledResult.reason.message
          : String(settledResult.reason);
        details.push(`[?] ERROR: ${reason}`);
      }
    }

    const summary = `Batch: ${successful}/${invocations.length} successful${failed > 0 ? `, ${failed} failed` : ""}`;
    return {
      success: failed === 0,
      output: `${summary}\n\n${details.join("\n\n")}`,
      error: failed > 0 ? `${failed} tool(s) failed` : undefined,
    };
  }
}
