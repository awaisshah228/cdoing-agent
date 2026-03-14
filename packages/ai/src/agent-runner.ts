/**
 * agent-runner.ts — The Agentic Loop
 *
 * Orchestrates the AI agent: sends messages to the LLM,
 * streams text tokens live, detects tool calls, parses their
 * complete args, executes tools, and loops until done.
 *
 * Streaming strategy:
 *   - Text tokens → streamed to UI in real-time
 *   - Tool call chunks → collected silently until complete
 *   - Once stream ends → parse accumulated tool call JSON → execute
 */

import { createModel, type ModelConfig } from "./provider";
import { DynamicStructuredTool } from "@langchain/core/tools";
type AnyTool = any;
import {
  HumanMessage,
  AIMessage,
  SystemMessage,
  ToolMessage,
} from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";
import type { ToolRegistry, PermissionManager } from "@cdoing/core";
import { z } from "zod";

/**
 * Callback functions for real-time UI updates.
 */
export interface AgentCallbacks {
  onToken: (token: string) => void;
  onToolCall: (name: string, input: Record<string, unknown>) => void;
  onToolResult: (name: string, result: string, isError: boolean) => void;
  onComplete: () => void;
  onError: (error: Error) => void;
}

/**
 * Accumulator for a single tool call built from streaming chunks.
 * Args arrive as partial JSON strings that we concatenate.
 */
interface ToolCallAccumulator {
  id: string;
  name: string;
  argsJson: string; // Raw JSON string, accumulated from chunks
}

export class AgentRunner {
  private model: ReturnType<typeof createModel>;
  private messages: BaseMessage[] = [];
  private systemPrompt: string;

  constructor(
    modelConfig: Partial<ModelConfig>,
    private toolRegistry: ToolRegistry,
    private permissionManager: PermissionManager,
    systemPrompt?: string
  ) {
    this.model = createModel(modelConfig);
    this.systemPrompt = systemPrompt || this.getDefaultSystemPrompt();
  }

  private getDefaultSystemPrompt(): string {
    return `You are Cdoing Agent, an AI-powered coding assistant running in the user's terminal.

You help developers write, debug, refactor, and understand code. You have access to tools that let you read files, write files, edit files, search the codebase, and run shell commands.

Guidelines:
- Read files before editing them to understand the existing code.
- Make precise, targeted edits rather than rewriting entire files.
- Explain what you're doing and why.
- When running shell commands, prefer safe, non-destructive operations.
- If you're unsure about something, ask the user.
- Keep responses concise and focused on the task.
- Use the search tools to find relevant code before making changes.

The user's working directory is available to all tools. File paths can be relative to this directory.`;
  }

  /**
   * Convert our tools into LangChain DynamicStructuredTool format.
   */
  private buildLangChainTools(): AnyTool[] {
    const allTools = this.toolRegistry.getAll();
    return allTools.map((t) => {
      const schema = this.buildZodSchema(t.definition.inputSchema);
      const toolConfig: any = {
        name: t.definition.name,
        description: t.definition.description,
        schema,
        func: async (input: Record<string, unknown>) => {
          const result = await t.execute(input);
          if (!result.success) {
            return `ERROR: ${result.error || "Unknown error"}`;
          }
          return result.output;
        },
      };
      return new DynamicStructuredTool(toolConfig);
    });
  }

  /**
   * Convert JSON Schema → Zod schema for LangChain.
   */
  private buildZodSchema(inputSchema: Record<string, unknown>): z.ZodObject<any> {
    const properties = (inputSchema.properties || {}) as Record<string, any>;
    const required = (inputSchema.required || []) as string[];
    const shape: Record<string, z.ZodTypeAny> = {};

    for (const [key, prop] of Object.entries(properties)) {
      let field: z.ZodTypeAny;

      switch (prop.type) {
        case "string":
          field = z.string().describe(prop.description || "");
          break;
        case "number":
          field = z.number().describe(prop.description || "");
          break;
        case "boolean":
          field = z.boolean().describe(prop.description || "");
          break;
        default:
          field = z.string().describe(prop.description || "");
      }

      if (!required.includes(key)) {
        field = field.optional();
      }

      shape[key] = field;
    }

    return z.object(shape);
  }

  /**
   * Main entry point — runs the agentic loop.
   *
   * Streams text to the UI live. When tool_call_chunks appear,
   * stops streaming text and silently accumulates tool call args.
   * Once the stream ends, parses the complete args JSON and executes.
   */
  async run(userMessage: string, callbacks: AgentCallbacks): Promise<string> {
    this.messages.push(new HumanMessage(userMessage));

    const lcTools = this.buildLangChainTools();
    const modelWithTools = this.model.bindTools(lcTools);

    let fullResponse = "";

    try {
      // ═══ THE AGENTIC LOOP ═══
      while (true) {
        const allMessages: BaseMessage[] = [
          new SystemMessage(this.systemPrompt),
          ...this.messages,
        ];

        const stream = await modelWithTools.stream(allMessages);

        let currentResponse = "";
        let hasToolCalls = false;

        // Accumulators for tool calls — keyed by index since IDs
        // may not appear until later chunks
        const toolAccumulators = new Map<number, ToolCallAccumulator>();

        // ── Stream and route chunks ──
        for await (const chunk of stream) {
          // 1) Check for tool_call_chunks (raw streaming pieces)
          //    These contain the actual streamed args as partial JSON
          const rawChunks = (chunk as any).tool_call_chunks;
          if (rawChunks && Array.isArray(rawChunks) && rawChunks.length > 0) {
            hasToolCalls = true;

            for (const tcc of rawChunks) {
              const index: number = tcc.index ?? 0;

              if (!toolAccumulators.has(index)) {
                // First chunk for this tool call — capture name and id
                toolAccumulators.set(index, {
                  id: tcc.id || "",
                  name: tcc.name || "",
                  argsJson: tcc.args || "",
                });
              } else {
                // Subsequent chunk — append args JSON fragment
                const acc = toolAccumulators.get(index)!;
                if (tcc.id) acc.id = tcc.id;
                if (tcc.name) acc.name = tcc.name;
                acc.argsJson += tcc.args || "";
              }
            }

            // Don't stream text once tool calls start
            continue;
          }

          // 2) Also check tool_calls (some providers send parsed tool_calls
          //    directly instead of tool_call_chunks)
          if (chunk.tool_calls && chunk.tool_calls.length > 0) {
            hasToolCalls = true;

            for (let i = 0; i < chunk.tool_calls.length; i++) {
              const tc = chunk.tool_calls[i];
              if (tc.name && Object.keys(tc.args || {}).length > 0) {
                // This is a complete tool call (not chunked)
                toolAccumulators.set(i, {
                  id: tc.id || `call_${Date.now()}_${i}`,
                  name: tc.name,
                  argsJson: JSON.stringify(tc.args || {}),
                });
              }
            }
            continue;
          }

          // 3) Stream text tokens to the UI (only if no tool calls yet)
          if (!hasToolCalls) {
            if (typeof chunk.content === "string" && chunk.content) {
              currentResponse += chunk.content;
              callbacks.onToken(chunk.content);
            } else if (Array.isArray(chunk.content)) {
              for (const block of chunk.content) {
                if (typeof block === "string" && block) {
                  currentResponse += block;
                  callbacks.onToken(block);
                } else if (
                  typeof block === "object" &&
                  block !== null &&
                  "type" in block &&
                  block.type === "text" &&
                  "text" in block
                ) {
                  const text = (block as { type: string; text: string }).text;
                  if (text) {
                    currentResponse += text;
                    callbacks.onToken(text);
                  }
                }
              }
            }
          }
        }

        // ── Stream finished — process results ──

        if (!hasToolCalls || toolAccumulators.size === 0) {
          // Pure text response — we're done
          this.messages.push(new AIMessage(currentResponse));
          fullResponse += currentResponse;
          break;
        }

        // Parse accumulated tool calls from their JSON fragments
        const toolCalls: Array<{
          id: string;
          name: string;
          args: Record<string, unknown>;
        }> = [];

        for (const [, acc] of toolAccumulators) {
          let args: Record<string, unknown> = {};
          try {
            args = acc.argsJson ? JSON.parse(acc.argsJson) : {};
          } catch {
            // If JSON parsing fails, try to salvage what we can
            console.error(`  Warning: Failed to parse tool args for ${acc.name}`);
          }

          toolCalls.push({
            id: acc.id || `call_${Date.now()}_${Math.random().toString(36).slice(2)}`,
            name: acc.name,
            args,
          });
        }

        // Save AI message with tool calls to history
        const aiMsg = new AIMessage({
          content: currentResponse,
          tool_calls: toolCalls.map((tc) => ({
            id: tc.id,
            name: tc.name,
            args: tc.args,
            type: "tool_call" as const,
          })),
        });
        this.messages.push(aiMsg);
        fullResponse += currentResponse;

        // Execute each tool call
        for (const tc of toolCalls) {
          callbacks.onToolCall(tc.name, tc.args);

          // Check permissions before executing
          const toolInstance = this.toolRegistry.get(tc.name);
          if (toolInstance) {
            const allowed = await this.permissionManager.requestPermission(
              toolInstance.definition,
              tc.args
            );
            if (!allowed) {
              const deniedMsg = "Permission denied by user.";
              this.messages.push(
                new ToolMessage({ content: deniedMsg, tool_call_id: tc.id })
              );
              callbacks.onToolResult(tc.name, deniedMsg, true);
              continue;
            }
          }

          const result = await this.toolRegistry.execute(tc.name, tc.args);
          const resultText = result.success
            ? result.output
            : `ERROR: ${result.error}`;

          this.messages.push(
            new ToolMessage({ content: resultText, tool_call_id: tc.id })
          );
          callbacks.onToolResult(tc.name, resultText, !result.success);
        }
      }

      callbacks.onComplete();
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      callbacks.onError(err);
    }

    return fullResponse;
  }

  /** Clears conversation history */
  clearHistory(): void {
    this.messages = [];
  }
}
