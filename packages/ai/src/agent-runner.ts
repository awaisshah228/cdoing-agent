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
// eslint-disable-next-line @typescript-eslint/no-var-requires
import { DynamicStructuredTool } from "@langchain/core/tools";
type AnyTool = any;
import { HumanMessage, AIMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";
import type { ToolRegistry, PermissionManager } from "@cdoing/core";
import { z } from "zod";

/**
 * Callback functions that the caller provides to receive real-time updates.
 * The extension host uses these to relay events to the webview UI.
 */
export interface AgentCallbacks {
  onToken: (token: string) => void;                                    // Each streamed text token
  onToolCall: (name: string, input: Record<string, unknown>) => void;  // Tool is being invoked
  onToolResult: (name: string, result: string, isError: boolean) => void; // Tool finished
  onComplete: () => void;                                              // Agent is completely done
  onError: (error: Error) => void;                                     // Something went wrong
}

export class AgentRunner {
  private model: ReturnType<typeof createModel>;  // The LangChain chat model instance
  private messages: BaseMessage[] = [];            // Conversation history (persists across turns)
  private systemPrompt: string;                    // Instructions for the AI agent

  constructor(
    modelConfig: Partial<ModelConfig>,
    private toolRegistry: ToolRegistry,       // All available tools (file_read, shell_exec, etc.)
    private permissionManager: PermissionManager, // Controls which tools need user approval
    systemPrompt?: string
  ) {
    // Create the LLM model (Anthropic, OpenAI, Google, or custom)
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
      // Convert JSON Schema → Zod schema (LangChain requirement)
      const schema = this.buildZodSchema(t.definition.inputSchema);
      const toolConfig: any = {
        name: t.definition.name,
        description: t.definition.description,
        schema,
        // This function is called when the LLM decides to use this tool
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
   * We support string, number, and boolean types with optional fields.
   */
  private buildZodSchema(inputSchema: Record<string, unknown>): z.ZodObject<any> {
    const properties = (inputSchema.properties || {}) as Record<string, any>;
    const required = (inputSchema.required || []) as string[];
    const shape: Record<string, z.ZodTypeAny> = {};

    for (const [key, prop] of Object.entries(properties)) {
      let field: z.ZodTypeAny;

      // Map JSON Schema types to Zod types
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

      // Mark optional fields
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
   * Sends the user's message to the LLM, streams the response, handles tool calls,
   * and continues looping until the LLM responds with just text (no more tools).
   *
   * @param userMessage - The text the user typed
   * @param callbacks   - Functions called for each event (token, tool call, etc.)
   * @returns The full text response from the agent
   */
  async run(userMessage: string, callbacks: AgentCallbacks): Promise<string> {
    // Add the user's message to conversation history
    this.messages.push(new HumanMessage(userMessage));

    // Create LangChain tool wrappers and bind them to the model
    // This tells the LLM what tools are available and their parameter schemas
    const lcTools = this.buildLangChainTools();
    const modelWithTools = this.model.bindTools(lcTools);

    let fullResponse = "";

    try {
      // ═══ THE AGENTIC LOOP ═══
      // Keep looping until the model responds with just text (no tool calls).
      // Each iteration: stream response → execute tools → feed results back → repeat
      while (true) {
        // Build the full message array: system prompt + conversation history
        const allMessages: BaseMessage[] = [
          new SystemMessage(this.systemPrompt),
          ...this.messages,
        ];

        // Stream the model's response — tokens arrive one at a time
        const stream = await modelWithTools.stream(allMessages);
        let currentResponse = "";
        let toolCalls: Array<{ id: string; name: string; args: Record<string, unknown> }> = [];

        // Process each streaming chunk as it arrives
        for await (const chunk of stream) {
          // ── Handle text content ──
          // The model is speaking — send each token to the UI for live display
          if (chunk.content && typeof chunk.content === "string") {
            currentResponse += chunk.content;
            callbacks.onToken(chunk.content);
          } else if (Array.isArray(chunk.content)) {
            // Some providers return content as an array of blocks
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

          // ── Collect tool calls ──
          // The model wants to use a tool — gather the tool name and arguments
          if (chunk.tool_calls && chunk.tool_calls.length > 0) {
            for (const tc of chunk.tool_calls) {
              const existing = toolCalls.find((t) => t.id === tc.id);
              if (!existing && tc.id) {
                // New tool call
                toolCalls.push({
                  id: tc.id,
                  name: tc.name,
                  args: (tc.args || {}) as Record<string, unknown>,
                });
              } else if (existing) {
                // Merge streamed args into existing tool call (args may arrive in chunks)
                existing.args = { ...existing.args, ...((tc.args || {}) as Record<string, unknown>) };
              }
            }
          }
        }

        // ── No tool calls? We're done! ──
        // The model responded with just text — save it and exit the loop
        if (toolCalls.length === 0) {
          this.messages.push(new AIMessage(currentResponse));
          fullResponse += currentResponse;
          break;
        }

        // ── Tool calls found — execute them ──
        // Save the AI message (with tool calls) to history
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

        // Execute each tool call one by one
        for (const tc of toolCalls) {
          // Notify the UI that a tool is being called
          callbacks.onToolCall(tc.name, tc.args);

          // Check if the user needs to approve this tool (depends on permission mode)
          const toolInstance = this.toolRegistry.get(tc.name);
          if (toolInstance) {
            const allowed = await this.permissionManager.requestPermission(
              toolInstance.definition,
              tc.args
            );
            if (!allowed) {
              // User denied — tell the model and skip this tool
              const deniedMsg = "Permission denied by user.";
              this.messages.push(
                new ToolMessage({ content: deniedMsg, tool_call_id: tc.id })
              );
              callbacks.onToolResult(tc.name, deniedMsg, true);
              continue;
            }
          }

          // Run the tool and get the result
          const result = await this.toolRegistry.execute(tc.name, tc.args);
          const resultText = result.success
            ? result.output
            : `ERROR: ${result.error}`;

          // Add the tool result to conversation history
          // The model will see this on the next iteration and can use it
          this.messages.push(
            new ToolMessage({ content: resultText, tool_call_id: tc.id })
          );
          callbacks.onToolResult(tc.name, resultText, !result.success);
        }

        // Continue the loop — the model will see the tool results and respond again
        // It might call more tools or give a final text response
      }

      callbacks.onComplete();
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      callbacks.onError(err);
    }

    return fullResponse;
  }

  /** Clears conversation history — starts a fresh chat while keeping tools and model */
  clearHistory(): void {
    this.messages = [];
  }
}
