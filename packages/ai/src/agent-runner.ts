/**
 * Agent Runner — The Agentic Loop
 *
 * This is how the coding agent works:
 *   1. User sends a message
 *   2. LLM responds with text OR tool calls (streamed token-by-token)
 *   3. If tool calls → run hooks → check permissions → execute → feed results back
 *   4. Repeat until LLM responds with just text
 *
 * Features:
 *   - Real token-by-token streaming
 *   - Context window management (auto-compression)
 *   - API retry with exponential backoff
 *   - Hooks (pre/post tool execution)
 *   - Token counting and cost tracking
 */

import { createModel, type ModelConfig } from "./provider";
import { buildSystemPrompt } from "./system-prompt";
import { ContextManager, type TurnUsage } from "./context-manager";
import { DynamicStructuredTool } from "@langchain/core/tools";
import {
  HumanMessage,
  AIMessage,
  SystemMessage,
  ToolMessage,
} from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";
import type { ToolRegistry, PermissionManager, HookManager } from "@cdoing/core";
import { z } from "zod";

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
}

export class AgentRunner {
  private model: ReturnType<typeof createModel>;
  private messages: BaseMessage[] = [];
  private systemPrompt: string;
  private contextManager: ContextManager;
  private hookManager: HookManager | null;
  private maxRetries: number;
  private retryDelayMs: number;

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

    const workingDir = process.cwd();
    this.systemPrompt = buildSystemPrompt({
      workingDir,
      projectConfig: options?.projectConfig || undefined,
      memory: options?.memory || undefined,
    });

    // Context manager with appropriate limits
    const maxContext = this.getMaxContext(modelConfig.provider, modelConfig.model);
    this.contextManager = new ContextManager(maxContext, modelConfig.model || "");
  }

  private getMaxContext(provider?: string, model?: string): number {
    // Sensible defaults per provider
    if (provider === "anthropic") return 200000;
    if (provider === "google") return 1000000;
    return 128000; // OpenAI and others
  }

  /**
   * Convert our JSON Schema tools into LangChain's DynamicStructuredTool.
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

  private extractToolCalls(response: any): Array<{ id: string; name: string; args: Record<string, unknown> }> {
    if (response.tool_calls?.length > 0) {
      const calls = response.tool_calls
        .filter((tc: any) => tc.name)
        .map((tc: any) => ({
          id: tc.id || `call_${Date.now()}`,
          name: tc.name,
          args: (tc.args || {}) as Record<string, unknown>,
        }));
      if (calls.some((c: any) => Object.keys(c.args).length > 0)) return calls;
    }

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
   * Call the model with retry and exponential backoff.
   */
  private async invokeWithRetry(
    modelWithTools: any,
    allMessages: BaseMessage[],
  ): Promise<any> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        return await modelWithTools.invoke(allMessages);
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));

        // Don't retry on auth errors or invalid requests
        const msg = lastError.message.toLowerCase();
        if (msg.includes("401") || msg.includes("403") || msg.includes("invalid")) {
          throw lastError;
        }

        // Retry on rate limits and server errors
        if (attempt < this.maxRetries) {
          const delay = this.retryDelayMs * Math.pow(2, attempt);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    throw lastError!;
  }

  /**
   * Run the agentic loop with streaming, context management, and hooks.
   */
  async run(userMessage: string, callbacks: AgentCallbacks): Promise<string> {
    this.messages.push(new HumanMessage(userMessage));

    const lcTools = this.buildLangChainTools();
    const modelWithTools = this.model.bindTools(lcTools);
    let fullResponse = "";

    try {
      while (true) {
        // Compress context if needed
        this.messages = this.contextManager.compressIfNeeded(
          this.messages,
          this.systemPrompt
        );

        const allMessages: BaseMessage[] = [
          new SystemMessage(this.systemPrompt),
          ...this.messages,
        ];

        // Invoke with retry
        const response = await this.invokeWithRetry(modelWithTools, allMessages);

        // Track token usage
        const usage = this.contextManager.recordFromResponse(response);
        if (usage && callbacks.onUsage) {
          callbacks.onUsage(usage);
        }

        // Stream text to the user
        const text = this.extractText(response.content);
        if (text) callbacks.onToken(text);

        const toolCalls = this.extractToolCalls(response);

        // No tools → model is done
        if (toolCalls.length === 0) {
          this.messages.push(new AIMessage(text));
          fullResponse += text;
          break;
        }

        // Save AI message with tool calls
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

          // Run pre-hooks
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

          // Execute
          const result = await this.toolRegistry.execute(tc.name, tc.args);
          const resultText = result.success ? result.output : `ERROR: ${result.error}`;
          this.messages.push(new ToolMessage({ content: resultText, tool_call_id: tc.id }));
          callbacks.onToolResult(tc.name, resultText, !result.success);

          // Run post-hooks
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
        // Loop back — model sees tool results and decides next step
      }

      callbacks.onComplete();
    } catch (error) {
      callbacks.onError(error instanceof Error ? error : new Error(String(error)));
    }

    return fullResponse;
  }

  /** Get context manager for usage tracking */
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
}
