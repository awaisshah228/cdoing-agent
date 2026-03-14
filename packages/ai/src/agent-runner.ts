/**
 * agent-runner.ts — The Agentic Loop
 *
 * Orchestrates the AI agent: sends messages to the LLM, streams the response,
 * detects tool calls, executes tools, feeds results back, and repeats.
 *
 * The loop:
 *   1. Send user message + history to the LLM
 *   2. Stream the response (tokens arrive one at a time)
 *   3. If the LLM wants to call a tool → execute it, add result to history
 *   4. Go back to step 1 (the LLM sees the tool result and continues)
 *   5. When the LLM responds with just text (no tools) → done
 *
 * This is the core "agent" behavior: the LLM can read files, search code,
 * edit files, and run commands by calling tools in a loop until it's done.
 */

import { createModel, type ModelConfig } from "./provider";
import { DynamicStructuredTool } from "@langchain/core/tools";
type AnyTool = any;
import {
  HumanMessage,
  AIMessage,
  AIMessageChunk,
  SystemMessage,
  ToolMessage,
} from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";
import type { ToolRegistry, PermissionManager } from "@cdoing/core";
import { z } from "zod";

/**
 * Callback functions that the caller provides to receive real-time updates.
 * The CLI and extension use these to relay events to their UIs.
 */
export interface AgentCallbacks {
  onToken: (token: string) => void;
  onToolCall: (name: string, input: Record<string, unknown>) => void;
  onToolResult: (name: string, result: string, isError: boolean) => void;
  onComplete: () => void;
  onError: (error: Error) => void;
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

  /** Default instructions that tell the AI how to behave */
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
   * Converts our tools (from @cdoing/core) into LangChain's DynamicStructuredTool format.
   * LangChain needs Zod schemas, but our tools use JSON Schema — so we convert them.
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
   * Converts a JSON Schema object to a Zod schema.
   * LangChain uses Zod for tool parameter validation.
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
   * Extract text content from a streaming chunk.
   * Handles both string and array content formats from different providers.
   */
  private extractTextFromChunk(chunk: AIMessageChunk): string {
    if (typeof chunk.content === "string") {
      return chunk.content;
    }

    if (Array.isArray(chunk.content)) {
      let text = "";
      for (const block of chunk.content) {
        if (typeof block === "string") {
          text += block;
        } else if (
          typeof block === "object" &&
          block !== null &&
          "type" in block &&
          block.type === "text" &&
          "text" in block
        ) {
          text += (block as { type: string; text: string }).text;
        }
      }
      return text;
    }

    return "";
  }

  /**
   * Main entry point — runs the agentic loop.
   *
   * Streams the response for text tokens, then uses the aggregated final message
   * to reliably extract tool calls with their complete arguments.
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

        // Stream the response and accumulate chunks.
        // We stream for live text display, but aggregate the full message
        // to get reliable tool_calls with complete args.
        const stream = await modelWithTools.stream(allMessages);
        let currentResponse = "";
        let aggregated: AIMessageChunk | null = null;

        for await (const chunk of stream) {
          // Aggregate all chunks — this gives us the final message with
          // properly merged tool_calls and their complete arguments
          aggregated = aggregated ? aggregated.concat(chunk) : chunk;

          // Stream text tokens to the UI in real-time
          const text = this.extractTextFromChunk(chunk);
          if (text) {
            currentResponse += text;
            callbacks.onToken(text);
          }
        }

        // Extract tool calls from the fully aggregated message.
        // This is the key fix: streaming chunks have partial/empty args,
        // but the aggregated message has the complete, parsed arguments.
        const toolCalls: Array<{
          id: string;
          name: string;
          args: Record<string, unknown>;
        }> = [];

        if (aggregated?.tool_calls && aggregated.tool_calls.length > 0) {
          for (const tc of aggregated.tool_calls) {
            if (tc.name && tc.id) {
              toolCalls.push({
                id: tc.id,
                name: tc.name,
                args: (tc.args || {}) as Record<string, unknown>,
              });
            }
          }
        }

        // ── No tool calls? We're done! ──
        if (toolCalls.length === 0) {
          this.messages.push(new AIMessage(currentResponse));
          fullResponse += currentResponse;
          break;
        }

        // ── Tool calls found — execute them ──
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

          // Run the tool
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
