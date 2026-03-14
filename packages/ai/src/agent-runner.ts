import { createModel, type ModelConfig } from "./provider";
// eslint-disable-next-line @typescript-eslint/no-var-requires
import { DynamicStructuredTool } from "@langchain/core/tools";
type AnyTool = any;
import { HumanMessage, AIMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
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

  async run(userMessage: string, callbacks: AgentCallbacks): Promise<string> {
    this.messages.push(new HumanMessage(userMessage));

    const lcTools = this.buildLangChainTools();
    const modelWithTools = this.model.bindTools(lcTools);

    let fullResponse = "";

    try {
      // Agentic loop — keep going until the model stops calling tools
      while (true) {
        const allMessages: BaseMessage[] = [
          new SystemMessage(this.systemPrompt),
          ...this.messages,
        ];

        const stream = await modelWithTools.stream(allMessages);
        let currentResponse = "";
        let toolCalls: Array<{ id: string; name: string; args: Record<string, unknown> }> = [];

        for await (const chunk of stream) {
          // Handle text content
          if (chunk.content && typeof chunk.content === "string") {
            currentResponse += chunk.content;
            callbacks.onToken(chunk.content);
          } else if (Array.isArray(chunk.content)) {
            for (const block of chunk.content) {
              if (typeof block === "string") {
                currentResponse += block;
                callbacks.onToken(block);
              } else if (typeof block === "object" && block !== null && "type" in block && block.type === "text" && "text" in block) {
                const text = (block as { type: string; text: string }).text;
                currentResponse += text;
                callbacks.onToken(text);
              }
            }
          }

          // Collect tool calls
          if (chunk.tool_calls && chunk.tool_calls.length > 0) {
            for (const tc of chunk.tool_calls) {
              const existing = toolCalls.find((t) => t.id === tc.id);
              if (!existing && tc.id) {
                toolCalls.push({
                  id: tc.id,
                  name: tc.name,
                  args: (tc.args || {}) as Record<string, unknown>,
                });
              } else if (existing) {
                existing.args = { ...existing.args, ...((tc.args || {}) as Record<string, unknown>) };
              }
            }
          }
        }

        // If no tool calls, we're done
        if (toolCalls.length === 0) {
          this.messages.push(new AIMessage(currentResponse));
          fullResponse += currentResponse;
          break;
        }

        // Store the AI message with tool calls
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

        // Continue the loop — model will see tool results and respond
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
