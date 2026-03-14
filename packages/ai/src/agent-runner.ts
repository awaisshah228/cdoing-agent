/**
 * Agent Runner — The Agentic Loop
 *
 * This is how Claude Code works:
 *   1. User sends a message
 *   2. LLM responds with text OR tool calls
 *   3. If tool calls → check permissions → execute → feed results back
 *   4. Repeat until LLM responds with just text
 *
 * Uses invoke() not stream() because streaming returns empty tool args.
 */

import { createModel, type ModelConfig } from "./provider";
import { DynamicStructuredTool } from "@langchain/core/tools";
import {
  HumanMessage,
  AIMessage,
  SystemMessage,
  ToolMessage,
} from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";
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
    this.systemPrompt = systemPrompt || DEFAULT_SYSTEM_PROMPT;
  }

  /**
   * Convert our JSON Schema tools into LangChain's DynamicStructuredTool.
   * LangChain needs Zod schemas so we convert on the fly.
   */
  private buildLangChainTools() {
    return this.toolRegistry.getAll().map((t) => {
      const schema = this.jsonSchemaToZod(t.definition.inputSchema);
      return new DynamicStructuredTool({
        name: t.definition.name,
        description: t.definition.description,
        schema,
        func: async (input: Record<string, unknown>) => {
          const result = await t.execute(input);
          return result.success ? result.output : `ERROR: ${result.error || "Unknown error"}`;
        },
      } as any);
    });
  }

  /** Convert JSON Schema properties to a Zod object schema */
  private jsonSchemaToZod(schema: Record<string, unknown>): z.ZodObject<any> {
    const props = (schema.properties || {}) as Record<string, any>;
    const required = (schema.required || []) as string[];
    const shape: Record<string, z.ZodTypeAny> = {};

    for (const [key, prop] of Object.entries(props)) {
      let field: z.ZodTypeAny;
      switch (prop.type) {
        case "number": field = z.number().describe(prop.description || ""); break;
        case "boolean": field = z.boolean().describe(prop.description || ""); break;
        default: field = z.string().describe(prop.description || ""); break;
      }
      if (!required.includes(key)) field = field.optional();
      shape[key] = field;
    }
    return z.object(shape);
  }

  /** Pull text out of the response content (handles string or array formats) */
  private extractText(content: unknown): string {
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return content.map((b) => {
        if (typeof b === "string") return b;
        if (b?.type === "text" && b?.text) return b.text;
        return "";
      }).join("");
    }
    return "";
  }

  /**
   * Extract tool calls from invoke() response.
   * Checks response.tool_calls first, then falls back to additional_kwargs
   * for maximum provider compatibility.
   */
  private extractToolCalls(response: any): Array<{ id: string; name: string; args: Record<string, unknown> }> {
    // 1. Standard LangChain tool_calls (works for Anthropic + OpenAI)
    if (response.tool_calls?.length > 0) {
      const calls = response.tool_calls
        .filter((tc: any) => tc.name)
        .map((tc: any) => ({
          id: tc.id || `call_${Date.now()}`,
          name: tc.name,
          args: (tc.args || {}) as Record<string, unknown>,
        }));
      // Only use if at least one call has non-empty args
      if (calls.some((c: any) => Object.keys(c.args).length > 0)) return calls;
    }

    // 2. Fallback: raw API response in additional_kwargs (OpenAI format)
    const raw = response.additional_kwargs?.tool_calls;
    if (raw?.length > 0) {
      return raw.map((rtc: any) => {
        let args: Record<string, unknown> = {};
        try { args = JSON.parse(rtc.function?.arguments || "{}"); } catch {}
        return {
          id: rtc.id || `call_${Date.now()}`,
          name: rtc.function?.name || "",
          args,
        };
      }).filter((c: any) => c.name);
    }

    return [];
  }

  /**
   * Run the agentic loop.
   * Send message → get response → if tools, execute them → loop
   */
  async run(userMessage: string, callbacks: AgentCallbacks): Promise<string> {
    this.messages.push(new HumanMessage(userMessage));

    const lcTools = this.buildLangChainTools();
    const modelWithTools = this.model.bindTools(lcTools);
    let fullResponse = "";

    try {
      while (true) {
        // Send full conversation to the LLM
        const allMessages: BaseMessage[] = [
          new SystemMessage(this.systemPrompt),
          ...this.messages,
        ];

        // invoke() gives us complete tool_calls with fully parsed args
        const response = await modelWithTools.invoke(allMessages);

        // Show text to the user
        const text = this.extractText(response.content);
        if (text) callbacks.onToken(text);

        // Check for tool calls
        const toolCalls = this.extractToolCalls(response);

        // No tools → model is done, save response and exit loop
        if (toolCalls.length === 0) {
          this.messages.push(new AIMessage(text));
          fullResponse += text;
          break;
        }

        // Save AI message with tool calls to history
        this.messages.push(new AIMessage({
          content: text,
          tool_calls: toolCalls.map((tc) => ({
            id: tc.id, name: tc.name, args: tc.args, type: "tool_call" as const,
          })),
        }));
        fullResponse += text;

        // Execute each tool
        for (const tc of toolCalls) {
          callbacks.onToolCall(tc.name, tc.args);

          // Permission check
          const tool = this.toolRegistry.get(tc.name);
          if (tool) {
            const allowed = await this.permissionManager.requestPermission(tool.definition, tc.args);
            if (!allowed) {
              this.messages.push(new ToolMessage({ content: "Permission denied by user.", tool_call_id: tc.id }));
              callbacks.onToolResult(tc.name, "Permission denied", true);
              continue;
            }
          }

          // Execute
          const result = await this.toolRegistry.execute(tc.name, tc.args);
          const resultText = result.success ? result.output : `ERROR: ${result.error}`;
          this.messages.push(new ToolMessage({ content: resultText, tool_call_id: tc.id }));
          callbacks.onToolResult(tc.name, resultText, !result.success);
        }
        // Loop back — model sees tool results and decides what's next
      }

      callbacks.onComplete();
    } catch (error) {
      callbacks.onError(error instanceof Error ? error : new Error(String(error)));
    }

    return fullResponse;
  }

  clearHistory(): void {
    this.messages = [];
  }
}

const DEFAULT_SYSTEM_PROMPT = `You are Cdoing Agent, an AI coding assistant running in the user's terminal.

You help developers write, debug, refactor, and understand code. You have tools to read files, write files, edit files, search code, run shell commands, and run programs.

Rules:
- Always read a file before editing it.
- Make precise edits, don't rewrite entire files.
- Explain what you're doing briefly.
- After writing a program, use file_run to test it.
- Use search tools to find code before making changes.
- Keep responses concise.

File paths can be relative to the working directory.`;
