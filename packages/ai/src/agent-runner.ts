/**
 * Agent Runner — The Agentic Loop
 *
 * This is how the coding agent works:
 *   1. User sends a message
 *   2. LLM responds with text OR tool calls (streamed token-by-token)
 *   3. If tool calls → run hooks → check permissions → execute → feed results back
 *   4. Repeat until LLM responds with just text
 *
 * LangChain improvements:
 *   - Real streaming via .stream() with chunk accumulation
 *   - Raw JSON Schema tool definitions via bindTools() (no Zod, no DynamicStructuredTool)
 *   - Proper token tracking via UsageMetadata on AIMessageChunk
 *   - Retry with exponential backoff
 *   - Context window compression
 */

import { createModel, type ModelConfig } from "./provider";
import { buildSystemPrompt } from "./system-prompt";
import { ContextManager, type TurnUsage } from "./context-manager";
import {
  HumanMessage,
  AIMessage,
  SystemMessage,
  ToolMessage,
} from "@langchain/core/messages";
import { AIMessageChunk } from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";
import type { ToolRegistry, PermissionManager, HookManager } from "@cdoing/core";

export interface AgentCallbacks {
  onToken: (token: string) => void;
  onToolCall: (name: string, input: Record<string, unknown>) => void;
  onToolResult: (name: string, result: string, isError: boolean) => void;
  onComplete: () => void;
  onError: (error: Error) => void;
  onUsage?: (usage: TurnUsage) => void;
}

export interface AgentRunnerOptions {
  maxRetries?: number;
  retryDelayMs?: number;
  projectConfig?: string;
  memory?: string;
  systemPrompt?: string;
  maxTurns?: number;
}

export class AgentRunner {
  private model: ReturnType<typeof createModel>;
  private messages: BaseMessage[] = [];
  private systemPrompt: string;
  private contextManager: ContextManager;
  private hookManager: HookManager | null;
  private maxRetries: number;
  private retryDelayMs: number;
  private maxTurns: number;
  private currentTurns: number = 0;

  constructor(
    modelConfig: Partial<ModelConfig>,
    private toolRegistry: ToolRegistry,
    private permissionManager: PermissionManager,
    hookManager?: HookManager,
    options?: AgentRunnerOptions,
  ) {
    this.model = createModel(modelConfig);
    this.hookManager = hookManager || null;
    this.maxRetries = options?.maxRetries ?? 3;
    this.retryDelayMs = options?.retryDelayMs ?? 1000;
    this.maxTurns = options?.maxTurns ?? Infinity;

    const workingDir = process.cwd();

    // Use custom system prompt if provided, otherwise build default
    if (options?.systemPrompt) {
      this.systemPrompt = options.systemPrompt;
    } else {
      this.systemPrompt = buildSystemPrompt({
        workingDir,
        projectConfig: options?.projectConfig || undefined,
        memory: options?.memory || undefined,
      });
    }

    const maxContext = this.getMaxContext(modelConfig.provider);
    this.contextManager = new ContextManager(maxContext, modelConfig.model || "");
  }

  private getMaxContext(provider?: string): number {
    if (provider === "anthropic") return 200000;
    if (provider === "google") return 1000000;
    return 128000;
  }

  /**
   * Convert our tool definitions to OpenAI-format for bindTools().
   * No Zod, no DynamicStructuredTool — just raw JSON Schema.
   */
  private buildToolDefinitions() {
    return this.toolRegistry.getAll().map((t) => ({
      type: "function" as const,
      function: {
        name: t.definition.name,
        description: t.definition.description,
        parameters: t.definition.inputSchema,
      },
    }));
  }

  /**
   * Extract text content from a message chunk during streaming.
   */
  private extractChunkText(chunk: AIMessageChunk): string {
    if (typeof chunk.content === "string") return chunk.content;
    if (Array.isArray(chunk.content)) {
      return chunk.content
        .map((b) => {
          if (typeof b === "string") return b;
          if (b && typeof b === "object" && "type" in b && b.type === "text" && "text" in b) {
            return (b as { type: "text"; text: string }).text;
          }
          return "";
        })
        .join("");
    }
    return "";
  }

  /**
   * Extract tool calls from the accumulated AIMessageChunk.
   * After streaming is complete, the concatenated chunk has fully-formed tool_calls.
   */
  private extractToolCalls(accumulated: AIMessageChunk): Array<{ id: string; name: string; args: Record<string, unknown> }> {
    // LangChain concatenates tool_call_chunks into tool_calls
    if (accumulated.tool_calls && accumulated.tool_calls.length > 0) {
      return accumulated.tool_calls
        .filter((tc) => tc.name)
        .map((tc) => ({
          id: tc.id || `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          name: tc.name,
          args: (tc.args || {}) as Record<string, unknown>,
        }));
    }

    // Fallback: check additional_kwargs for OpenAI-style raw tool calls
    const raw = (accumulated as any).additional_kwargs?.tool_calls;
    if (raw?.length > 0) {
      return raw.map((rtc: any) => {
        let args: Record<string, unknown> = {};
        try { args = JSON.parse(rtc.function?.arguments || "{}"); } catch {}
        return {
          id: rtc.id || `call_${Date.now()}`,
          name: rtc.function?.name || "",
          args,
        };
      }).filter((c: { name: string }) => c.name);
    }

    return [];
  }

  /**
   * Stream a model response, emitting text tokens as they arrive.
   * Returns the fully accumulated AIMessageChunk with complete tool_calls.
   */
  private async streamWithRetry(
    modelWithTools: ReturnType<typeof this.model.bindTools>,
    allMessages: BaseMessage[],
    callbacks: AgentCallbacks,
  ): Promise<AIMessageChunk> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        let accumulated: AIMessageChunk | null = null;

        const stream = await modelWithTools.stream(allMessages);

        for await (const chunk of stream) {
          // Accumulate chunks for complete tool_calls
          if (accumulated === null) {
            accumulated = chunk as AIMessageChunk;
          } else {
            accumulated = accumulated.concat(chunk as AIMessageChunk);
          }

          // Emit text tokens as they arrive
          const text = this.extractChunkText(chunk as AIMessageChunk);
          if (text) {
            callbacks.onToken(text);
          }
        }

        if (!accumulated) {
          throw new Error("Empty response from model");
        }

        return accumulated;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));

        // Don't retry on auth errors or invalid requests
        const msg = lastError.message.toLowerCase();
        if (msg.includes("401") || msg.includes("403") || msg.includes("invalid_api_key") || msg.includes("authentication")) {
          throw lastError;
        }

        if (attempt < this.maxRetries) {
          const delay = this.retryDelayMs * Math.pow(2, attempt);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    throw lastError!;
  }

  /**
   * Run the agentic loop with real streaming, context management, and hooks.
   */
  async run(userMessage: string, callbacks: AgentCallbacks): Promise<string> {
    this.messages.push(new HumanMessage(userMessage));
    this.currentTurns = 0;

    const toolDefs = this.buildToolDefinitions();
    const modelWithTools = this.model.bindTools(toolDefs);
    let fullResponse = "";

    try {
      while (true) {
        // Check max turns limit
        this.currentTurns++;
        if (this.currentTurns > this.maxTurns) {
          callbacks.onToken(`\n[Max turns (${this.maxTurns}) reached]`);
          break;
        }
        // Compress context if needed
        this.messages = this.contextManager.compressIfNeeded(
          this.messages,
          this.systemPrompt,
        );

        const allMessages: BaseMessage[] = [
          new SystemMessage(this.systemPrompt),
          ...this.messages,
        ];

        // Stream response with retry
        const accumulated = await this.streamWithRetry(modelWithTools, allMessages, callbacks);

        // Track token usage from the accumulated response
        const usageMeta = accumulated.usage_metadata;
        if (usageMeta) {
          const usage = this.contextManager.recordTurn(
            usageMeta.input_tokens,
            usageMeta.output_tokens,
          );
          if (callbacks.onUsage) callbacks.onUsage(usage);
        } else {
          // Estimate if no metadata available
          const usage = this.contextManager.recordFromResponse(accumulated);
          if (usage && callbacks.onUsage) callbacks.onUsage(usage);
        }

        // Extract complete tool calls from accumulated chunks
        const toolCalls = this.extractToolCalls(accumulated);

        // Get full text (already streamed to user, but need for history)
        const fullText = this.extractChunkText(accumulated);

        // No tools → model is done
        if (toolCalls.length === 0) {
          this.messages.push(new AIMessage(fullText));
          fullResponse += fullText;
          break;
        }

        // Save AI message with tool calls to history
        this.messages.push(new AIMessage({
          content: fullText,
          tool_calls: toolCalls.map((tc) => ({
            id: tc.id,
            name: tc.name,
            args: tc.args,
            type: "tool_call" as const,
          })),
        }));
        fullResponse += fullText;

        // Execute each tool call
        for (const tc of toolCalls) {
          callbacks.onToolCall(tc.name, tc.args);

          // Pre-hooks
          if (this.hookManager) {
            await this.hookManager.runHooks(`pre:${tc.name}`, {
              tool_name: tc.name,
              ...Object.fromEntries(
                Object.entries(tc.args).map(([k, v]) => [k, String(v)])
              ),
            });
          }

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

          // Execute tool
          const result = await this.toolRegistry.execute(tc.name, tc.args);
          let resultText: string;

          if (result.success) {
            resultText = result.output;
          } else {
            // On error: include BOTH the output (stdout/stderr) AND the error message
            // so the LLM has full context to debug
            const parts: string[] = [`ERROR: ${result.error}`];
            if (result.output) {
              parts.push(`\nFull output:\n${result.output}`);
            }
            parts.push(
              `\n[Auto-debug]: The command/tool failed. Analyze the error output above carefully. ` +
              `Read the relevant source files if needed, identify the root cause, fix the code, and re-run to verify.`
            );
            resultText = parts.join("\n");
          }

          this.messages.push(new ToolMessage({ content: resultText, tool_call_id: tc.id }));
          callbacks.onToolResult(tc.name, resultText, !result.success);

          // Post-hooks
          if (this.hookManager) {
            await this.hookManager.runHooks(`post:${tc.name}`, {
              tool_name: tc.name,
              success: String(result.success),
              ...Object.fromEntries(
                Object.entries(tc.args).map(([k, v]) => [k, String(v)])
              ),
            });
          }
        }
        // Loop: model sees tool results, decides next step
      }

      callbacks.onComplete();
    } catch (error) {
      callbacks.onError(error instanceof Error ? error : new Error(String(error)));
    }

    return fullResponse;
  }

  getContextManager(): ContextManager {
    return this.contextManager;
  }

  clearHistory(): void {
    this.messages = [];
    this.contextManager.reset();
  }

  addToHistory(role: "user" | "assistant", content: string): void {
    if (role === "user") {
      this.messages.push(new HumanMessage(content));
    } else {
      this.messages.push(new AIMessage(content));
    }
  }

  getHistory(): BaseMessage[] {
    return this.messages;
  }

  setHistory(messages: BaseMessage[]): void {
    this.messages = messages;
  }
}
