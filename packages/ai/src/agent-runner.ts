/**
 * agent-runner.ts — The Agentic Loop
 *
 * Orchestrates the AI agent: sends messages to the LLM,
 * detects tool calls, executes tools, feeds results back, and repeats.
 *
 * The loop:
 *   1. Send user message + history to the LLM
 *   2. Get the response (complete message with tool calls)
 *   3. If the LLM wants to call a tool → execute it, add result to history
 *   4. Go back to step 1 (the LLM sees the tool result and continues)
 *   5. When the LLM responds with just text (no tools) → done
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
 * Callback functions that the caller provides to receive real-time updates.
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
   * Converts our tools into LangChain's DynamicStructuredTool format.
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
   * Extract text content from the AI response.
   * Handles both string and array content formats.
   */
  private extractText(content: unknown): string {
    if (typeof content === "string") return content;

    if (Array.isArray(content)) {
      let text = "";
      for (const block of content) {
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
   * Uses .invoke() for reliable tool call extraction.
   * Tool args from streaming were arriving empty — invoke gives us
   * the complete message with fully parsed arguments every time.
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

        // Use invoke() to get the complete response with proper tool_calls.
        // Streaming had a bug where tool args arrived as empty objects {}.
        const response = await modelWithTools.invoke(allMessages);

        // Extract text content from the response
        const currentResponse = this.extractText(response.content);
        if (currentResponse) {
          callbacks.onToken(currentResponse);
        }

        // Extract tool calls from the complete response
        const toolCalls: Array<{
          id: string;
          name: string;
          args: Record<string, unknown>;
        }> = [];

        if (response.tool_calls && response.tool_calls.length > 0) {
          for (const tc of response.tool_calls) {
            if (tc.name) {
              toolCalls.push({
                id: tc.id || `call_${Date.now()}_${Math.random().toString(36).slice(2)}`,
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

        for (const tc of toolCalls) {
          callbacks.onToolCall(tc.name, tc.args);

          // Check permissions
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

          // Execute the tool
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
