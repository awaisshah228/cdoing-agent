/**
 * agent-runner.ts — The Agentic Loop
 *
 * Streams text live to the UI. When tool calls appear in the stream,
 * collects their arg chunks until the stream ends, parses the complete
 * JSON, then executes the tools.
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

export interface AgentCallbacks {
  onToken: (token: string) => void;
  onToolCall: (name: string, input: Record<string, unknown>) => void;
  onToolResult: (name: string, result: string, isError: boolean) => void;
  onComplete: () => void;
  onError: (error: Error) => void;
}

/** Raw accumulator for a tool call built from streaming chunks */
interface ToolCallAccumulator {
  id: string;
  name: string;
  argsJson: string;
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
   * Main agentic loop.
   *
   * Phase 1: Stream response — text goes to UI, tool call chunks accumulate
   * Phase 2: Parse complete tool call args from accumulated JSON
   * Phase 3: Execute tools with proper permission checks
   * Repeat until model responds with text only (no tools)
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

        const stream = await modelWithTools.stream(allMessages);

        let currentResponse = "";
        let hasToolCalls = false;
        const toolAccumulators = new Map<number, ToolCallAccumulator>();

        // ── Phase 1: Stream and collect ──
        for await (const chunk of stream) {
          const chunkAny = chunk as any;

          // Check tool_call_chunks first (Anthropic, newer LangChain)
          // These arrive as: { index, id?, name?, args? } where args is
          // a JSON string fragment that we concatenate across chunks
          if (chunkAny.tool_call_chunks?.length > 0) {
            hasToolCalls = true;
            for (const tcc of chunkAny.tool_call_chunks) {
              const idx: number = tcc.index ?? 0;
              const existing = toolAccumulators.get(idx);
              if (existing) {
                if (tcc.id) existing.id = tcc.id;
                if (tcc.name) existing.name = tcc.name;
                existing.argsJson += tcc.args || "";
              } else {
                toolAccumulators.set(idx, {
                  id: tcc.id || "",
                  name: tcc.name || "",
                  argsJson: tcc.args || "",
                });
              }
            }
            continue;
          }

          // Check tool_calls (OpenAI style — may come with partial or full args)
          const tcList = chunk.tool_calls;
          if (tcList && tcList.length > 0) {
            hasToolCalls = true;
            for (let i = 0; i < tcList.length; i++) {
              const tc = tcList[i];
              const idx = i;
              const existing = toolAccumulators.get(idx);
              const argsStr = typeof tc.args === "string"
                ? tc.args
                : JSON.stringify(tc.args || {});

              if (existing) {
                if (tc.id) existing.id = tc.id;
                if (tc.name) existing.name += tc.name;
                existing.argsJson += argsStr;
              } else {
                toolAccumulators.set(idx, {
                  id: tc.id || "",
                  name: tc.name || "",
                  argsJson: argsStr,
                });
              }
            }
            continue;
          }

          // Stream text tokens only while no tool calls detected
          if (!hasToolCalls && chunk.content) {
            if (typeof chunk.content === "string") {
              currentResponse += chunk.content;
              callbacks.onToken(chunk.content);
            } else if (Array.isArray(chunk.content)) {
              for (const block of chunk.content) {
                let text = "";
                if (typeof block === "string") {
                  text = block;
                } else if (block?.type === "text" && block?.text) {
                  text = block.text;
                }
                if (text) {
                  currentResponse += text;
                  callbacks.onToken(text);
                }
              }
            }
          }
        }

        // ── No tool calls → done ──
        if (!hasToolCalls || toolAccumulators.size === 0) {
          this.messages.push(new AIMessage(currentResponse));
          fullResponse += currentResponse;
          break;
        }

        // ── Phase 2: Parse accumulated tool call args ──
        const toolCalls: Array<{
          id: string;
          name: string;
          args: Record<string, unknown>;
        }> = [];

        for (const [, acc] of toolAccumulators) {
          let args: Record<string, unknown> = {};

          // Parse the concatenated JSON string
          const trimmed = acc.argsJson.trim();
          if (trimmed) {
            try {
              args = JSON.parse(trimmed);
            } catch {
              // Try to handle double-encoded JSON like '"{\"key\":\"val\"}"'
              try {
                args = JSON.parse(JSON.parse(trimmed));
              } catch {
                console.error(`  Warning: Could not parse args for ${acc.name}: ${trimmed.substring(0, 100)}`);
              }
            }
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

        // ── Phase 3: Execute tool calls ──
        for (const tc of toolCalls) {
          callbacks.onToolCall(tc.name, tc.args);

          // Permission check
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
