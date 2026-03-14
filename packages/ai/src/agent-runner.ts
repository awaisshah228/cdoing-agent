/**
 * agent-runner.ts — The Agentic Loop
 *
 * Uses invoke() for reliable tool call parsing.
 * Text is displayed all at once (not streamed token-by-token)
 * to guarantee tool call args are always complete.
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
import type { BaseMessage, AIMessageChunk } from "@langchain/core/messages";
import type { ToolRegistry, PermissionManager } from "@cdoing/core";
import { z } from "zod";

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
   * Extract text from response content (string or array format).
   */
  private extractText(content: unknown): string {
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return content
        .map((block) => {
          if (typeof block === "string") return block;
          if (block?.type === "text" && block?.text) return block.text;
          return "";
        })
        .join("");
    }
    return "";
  }

  /**
   * Extract tool calls from the response, checking multiple possible locations.
   */
  private extractToolCalls(
    response: AIMessageChunk
  ): Array<{ id: string; name: string; args: Record<string, unknown> }> {
    const result: Array<{ id: string; name: string; args: Record<string, unknown> }> = [];
    const responseAny = response as any;

    // 1. Check response.tool_calls (standard LangChain)
    if (response.tool_calls && response.tool_calls.length > 0) {
      for (const tc of response.tool_calls) {
        if (tc.name) {
          result.push({
            id: tc.id || `call_${Date.now()}_${Math.random().toString(36).slice(2)}`,
            name: tc.name,
            args: (tc.args || {}) as Record<string, unknown>,
          });
        }
      }
      // Only use this if args are non-empty
      if (result.length > 0 && result.some((tc) => Object.keys(tc.args).length > 0)) {
        return result;
      }
    }

    // 2. Check additional_kwargs.tool_calls (raw API response)
    const rawToolCalls = responseAny.additional_kwargs?.tool_calls;
    if (rawToolCalls && Array.isArray(rawToolCalls) && rawToolCalls.length > 0) {
      const fromRaw: Array<{ id: string; name: string; args: Record<string, unknown> }> = [];
      for (const rtc of rawToolCalls) {
        let args: Record<string, unknown> = {};
        if (rtc.function?.arguments) {
          try {
            args = JSON.parse(rtc.function.arguments);
          } catch {
            // ignore parse error
          }
        }
        fromRaw.push({
          id: rtc.id || `call_${Date.now()}_${Math.random().toString(36).slice(2)}`,
          name: rtc.function?.name || rtc.name || "",
          args,
        });
      }
      if (fromRaw.length > 0 && fromRaw.some((tc) => Object.keys(tc.args).length > 0)) {
        return fromRaw;
      }
    }

    // 3. Check tool_call_chunks and manually parse
    if (responseAny.tool_call_chunks && responseAny.tool_call_chunks.length > 0) {
      const accumulators = new Map<number, { id: string; name: string; argsJson: string }>();
      for (const tcc of responseAny.tool_call_chunks) {
        const idx = tcc.index ?? 0;
        const existing = accumulators.get(idx);
        if (existing) {
          if (tcc.id) existing.id = tcc.id;
          if (tcc.name) existing.name += tcc.name;
          existing.argsJson += tcc.args || "";
        } else {
          accumulators.set(idx, {
            id: tcc.id || "",
            name: tcc.name || "",
            argsJson: tcc.args || "",
          });
        }
      }
      for (const [, acc] of accumulators) {
        let args: Record<string, unknown> = {};
        try {
          if (acc.argsJson.trim()) args = JSON.parse(acc.argsJson);
        } catch { /* ignore */ }
        result.push({
          id: acc.id || `call_${Date.now()}_${Math.random().toString(36).slice(2)}`,
          name: acc.name,
          args,
        });
      }
    }

    return result;
  }

  /**
   * Main agentic loop using invoke() for reliable tool calls.
   */
  async run(userMessage: string, callbacks: AgentCallbacks): Promise<string> {
    this.messages.push(new HumanMessage(userMessage));

    const lcTools = this.buildLangChainTools();
    const modelWithTools = this.model.bindTools(lcTools);

    let fullResponse = "";

    try {
      while (true) {
        const allMessages: BaseMessage[] = [
          new SystemMessage(this.systemPrompt),
          ...this.messages,
        ];

        // invoke() returns the complete message with fully parsed tool calls
        const response = await modelWithTools.invoke(allMessages);

        const text = this.extractText(response.content);
        if (text) {
          callbacks.onToken(text);
        }

        // Extract tool calls — tries multiple sources for compatibility
        const toolCalls = this.extractToolCalls(response);

        // No tool calls → done
        if (toolCalls.length === 0) {
          this.messages.push(new AIMessage(text));
          fullResponse += text;
          break;
        }

        // Save AI message with tool calls
        const aiMsg = new AIMessage({
          content: text,
          tool_calls: toolCalls.map((tc) => ({
            id: tc.id,
            name: tc.name,
            args: tc.args,
            type: "tool_call" as const,
          })),
        });
        this.messages.push(aiMsg);
        fullResponse += text;

        // Execute each tool
        for (const tc of toolCalls) {
          callbacks.onToolCall(tc.name, tc.args);

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

  clearHistory(): void {
    this.messages = [];
  }
}
