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
  workingDir?: string;
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

    const workingDir = options?.workingDir || process.cwd();

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
    switch (provider) {
      case "anthropic": return 200000;
      case "google": return 1000000;
      case "ollama": return 32000; // most Ollama models default to 32k
      default: return 128000;
    }
  }

  /**
   * Truncate tool output to fit within a character budget.
   * ~4 chars per token, reserve 50% of context for conversation + system prompt.
   * The budget is split across parallel tool calls.
   */
  private static truncateOutput(text: string, toolName: string, maxChars: number = 30000): string {
    if (text.length <= maxChars) return text;

    // For search results, truncate at a line boundary
    if (toolName === "grep_search" || toolName === "glob_search") {
      const lines = text.split("\n");
      let result = "";
      for (const line of lines) {
        if (result.length + line.length + 1 > maxChars) break;
        result += line + "\n";
      }
      const totalLines = lines.length;
      const shownLines = result.split("\n").length - 1;
      return result + `\n... [${totalLines - shownLines} more lines truncated — use more specific search or offset/limit params]`;
    }

    // For file reads, truncate with context
    if (toolName === "file_read") {
      return text.substring(0, maxChars) + `\n\n... [truncated at ${maxChars} chars — use offset/limit params to read specific sections]`;
    }

    // For shell output, keep head + tail
    if (toolName === "shell_exec" || toolName === "file_run") {
      const headSize = Math.floor(maxChars * 0.7);
      const tailSize = Math.floor(maxChars * 0.25);
      const head = text.substring(0, headSize);
      const tail = text.substring(text.length - tailSize);
      return head + `\n\n... [${text.length - headSize - tailSize} chars truncated] ...\n\n` + tail;
    }

    // Default: simple truncation
    return text.substring(0, maxChars) + `\n\n... [truncated at ${maxChars} chars]`;
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

        // Execute tool calls — parallel for reads, sequential for writes
        // Claude Code approach: split by safety, run safe tools concurrently
        await this.executeToolCalls(toolCalls, callbacks);
        // Loop: model sees tool results, decides next step
      }

      callbacks.onComplete();
    } catch (error) {
      callbacks.onError(error instanceof Error ? error : new Error(String(error)));
    }

    return fullResponse;
  }

  // ── Parallel Tool Execution (Claude Code approach) ──────

  /** Tools that are always safe to run in parallel (read-only, no side effects) */
  private static readonly ALWAYS_PARALLEL = new Set([
    "file_read", "glob_search", "grep_search", "web_fetch", "web_search", "sub_agent",
  ]);

  /** Tools that can run in parallel IF they target different files */
  private static readonly PARALLEL_IF_DIFFERENT_FILES = new Set([
    "file_write", "file_edit",
  ]);

  /** Tools that must always run sequentially (side effects, shared state) */
  private static readonly ALWAYS_SEQUENTIAL = new Set([
    "shell_exec", "file_run",
  ]);

  /** Execute a single tool call with hooks, permissions, and error handling */
  private async executeSingleTool(
    tc: { id: string; name: string; args: Record<string, unknown> },
    callbacks: AgentCallbacks,
    maxOutputChars: number = 30000,
  ): Promise<void> {
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
        return;
      }
    }

    // Execute tool
    const result = await this.toolRegistry.execute(tc.name, tc.args);
    let resultText: string;

    if (result.success) {
      resultText = result.output;
    } else {
      const parts: string[] = [`ERROR: ${result.error}`];
      if (result.output) parts.push(`\nFull output:\n${result.output}`);
      parts.push(
        `\n[Auto-debug]: The command/tool failed. Analyze the error output above carefully. ` +
        `Read the relevant source files if needed, identify the root cause, fix the code, and re-run to verify.`
      );
      resultText = parts.join("\n");
    }

    // Truncate large outputs to protect context window
    resultText = AgentRunner.truncateOutput(resultText, tc.name, maxOutputChars);

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

  /**
   * Get the file path a tool call targets (if any).
   */
  private static getTargetFile(tc: { name: string; args: Record<string, unknown> }): string | null {
    const path = tc.args.file_path || tc.args.path;
    return typeof path === "string" ? path : null;
  }

  /**
   * Execute tool calls with smart parallelism:
   *
   *   1. Always-parallel tools (reads, searches, sub_agent) → all run concurrently
   *   2. File write/edit → parallel IF targeting different files, sequential if same file
   *   3. Shell/run → always sequential (shared state, side effects)
   *
   * Results are matched to calls by tool_call_id — order doesn't matter.
   */
  private async executeToolCalls(
    toolCalls: Array<{ id: string; name: string; args: Record<string, unknown> }>,
    callbacks: AgentCallbacks,
  ): Promise<void> {
    // Compute per-tool output budget from remaining context window
    const systemPromptTokens = Math.ceil(this.systemPrompt.length / 4);
    const totalBudgetChars = this.contextManager.getOutputBudgetChars(this.messages, systemPromptTokens);
    const perToolBudget = Math.max(
      5000, // minimum 5k chars per tool
      Math.floor(totalBudgetChars / Math.max(toolCalls.length, 1))
    );

    if (toolCalls.length === 1) {
      await this.executeSingleTool(toolCalls[0], callbacks, perToolBudget);
      return;
    }

    // Categorize tool calls
    const alwaysParallel: typeof toolCalls = [];
    const fileOps: typeof toolCalls = [];
    const alwaysSequential: typeof toolCalls = [];

    for (const tc of toolCalls) {
      if (AgentRunner.ALWAYS_PARALLEL.has(tc.name)) {
        alwaysParallel.push(tc);
      } else if (AgentRunner.PARALLEL_IF_DIFFERENT_FILES.has(tc.name)) {
        fileOps.push(tc);
      } else {
        alwaysSequential.push(tc);
      }
    }

    // Group file ops by target file — same file = sequential, different files = parallel
    const fileGroups = new Map<string, typeof toolCalls>();
    for (const tc of fileOps) {
      const file = AgentRunner.getTargetFile(tc) || `__unknown_${tc.id}`;
      const group = fileGroups.get(file) || [];
      group.push(tc);
      fileGroups.set(file, group);
    }

    // Build parallel batch: all reads + one op per unique file
    const parallelBatch: Array<Promise<void>> = [];

    // 1. All always-parallel tools run concurrently
    for (const tc of alwaysParallel) {
      parallelBatch.push(this.executeSingleTool(tc, callbacks, perToolBudget));
    }

    // 2. File ops: each file group runs its ops sequentially, but different files run in parallel
    for (const [, group] of fileGroups) {
      parallelBatch.push(
        (async () => {
          for (const tc of group) {
            await this.executeSingleTool(tc, callbacks, perToolBudget);
          }
        })()
      );
    }

    // Run batch 1+2 concurrently
    if (parallelBatch.length > 0) {
      await Promise.all(parallelBatch);
    }

    // 3. Shell/run tools always sequential (after all file ops are done)
    for (const tc of alwaysSequential) {
      await this.executeSingleTool(tc, callbacks, perToolBudget);
    }
  }

  // ── Public API ─────────────────────────────────────────

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
