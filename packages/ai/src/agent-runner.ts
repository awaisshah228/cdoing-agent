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
import type { DiffChunk } from "@cdoing/core";
import { streamDeterministicDiff } from "@cdoing/core";

export interface AgentCallbacks {
  onToken: (token: string) => void;
  onToolCall: (name: string, input: Record<string, unknown>) => void;
  onToolResult: (name: string, result: string, isError: boolean) => void;
  onComplete: () => void;
  onError: (error: Error) => void;
  onUsage?: (usage: TurnUsage) => void;
  /** Emitted for each diff chunk during file edit/write operations, enabling real-time diff rendering */
  onDiffChunk?: (chunk: DiffChunk) => void;
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
  private isCancelled: boolean = false;
  /** Tools that the LLM has requested via get_tool — kept for all subsequent turns */
  private activatedTools: Set<string> = new Set();
  /** Provider name for provider-specific optimizations (cache_control, etc.) */
  private provider: string;
  /** Model name for model-specific tool selection */
  private modelName: string;
  /** Recent tool call signatures for doom loop detection */
  private recentToolCalls: string[] = [];
  private static readonly DOOM_LOOP_THRESHOLD = 3;

  constructor(
    modelConfig: Partial<ModelConfig>,
    private toolRegistry: ToolRegistry,
    private permissionManager: PermissionManager,
    hookManager?: HookManager,
    options?: AgentRunnerOptions,
  ) {
    this.model = createModel(modelConfig);
    this.provider = (modelConfig.provider as string) || "anthropic";
    this.modelName = modelConfig.model || "";
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
   *
   * Descriptions are compacted to save tokens — the full verbose descriptions
   * are stripped to their first sentence/line. IMPORTANT blocks and usage
   * instructions are removed since the LLM already knows how to use standard
   * coding tools. This saves ~3,000-4,000 tokens per API call.
   */
  private buildToolDefinitions(filterNames?: Set<string>) {
    let tools = this.toolRegistry.getAll();

    // Pre-filter: remove tools denied by permission rules (don't send to LLM what can't be used)
    tools = tools.filter((t) => {
      const denied = this.permissionManager.isDenied(t.definition.name);
      return !denied;
    });

    // Model-specific tool selection: GPT models work better with apply_patch,
    // Claude/Gemini work better with file_edit/file_write
    const isGptModel = this.modelName.startsWith("gpt-") || this.provider === "openai";
    if (isGptModel) {
      // For GPT: prefer apply_patch, remove file_edit/file_write
      const hasApplyPatch = tools.some((t) => t.definition.name === "apply_patch");
      if (hasApplyPatch) {
        tools = tools.filter((t) => t.definition.name !== "file_edit" && t.definition.name !== "file_write");
      }
    } else {
      // For Claude/Gemini: prefer file_edit/file_write, remove apply_patch
      const hasFileEdit = tools.some((t) => t.definition.name === "file_edit");
      if (hasFileEdit) {
        tools = tools.filter((t) => t.definition.name !== "apply_patch");
      }
    }

    if (filterNames) {
      // Always include activated tools (previously fetched via get_tool)
      tools = tools.filter((t) => filterNames.has(t.definition.name) || this.activatedTools.has(t.definition.name));
    }

    const isAnthropic = this.provider === "anthropic";

    const defs = tools.map((t, i) => {
      const def: Record<string, unknown> = {
        type: "function" as const,
        function: {
          name: t.definition.name,
          description: compactDescription(t.definition.description),
          parameters: compactSchema(t.definition.inputSchema),
        },
      };

      // Anthropic prompt caching: mark the LAST tool with cache_control
      // so all tool definitions are cached as a single prefix block.
      // This means tool tokens are only counted on the first request,
      // subsequent requests reuse the cached block (~90% savings on tool tokens).
      if (isAnthropic && i === tools.length - 1) {
        def.cache_control = { type: "ephemeral" };
      }

      return def;
    });

    // Add the get_tool meta-tool when we're filtering (so LLM can request missing tools)
    if (filterNames) {
      const getToolDef = this.buildGetToolDefinition();
      if (isAnthropic) {
        // Move cache_control to get_tool (it's now the last tool)
        if (defs.length > 0) delete (defs[defs.length - 1] as any).cache_control;
        (getToolDef as any).cache_control = { type: "ephemeral" };
      }
      defs.push(getToolDef);
    }

    return defs;
  }

  /** Build the get_tool meta-tool definition — lets LLM fetch any tool on demand */
  private buildGetToolDefinition() {
    const allNames = this.toolRegistry.getAll().map((t) => t.definition.name);
    return {
      type: "function" as const,
      function: {
        name: "get_tool",
        description: `Fetch the full schema of a tool not in your current toolset so you can call it. Available tools: ${allNames.join(", ")}`,
        parameters: {
          type: "object",
          properties: {
            tool_name: {
              type: "string",
              enum: allNames,
              description: "Name of the tool to fetch",
            },
          },
          required: ["tool_name"],
        },
      },
    };
  }

  /** Handle a get_tool call — return the full schema and activate the tool for future turns */
  private handleGetTool(toolName: string): string {
    const tool = this.toolRegistry.get(toolName);
    if (!tool) {
      return `Tool "${toolName}" not found.`;
    }

    // Activate this tool for all future turns in this session
    this.activatedTools.add(toolName);

    // Return full (non-compacted) definition so the LLM has complete info
    return JSON.stringify({
      name: tool.definition.name,
      description: tool.definition.description,
      parameters: tool.definition.inputSchema,
    }, null, 2) + `\n\nTool "${toolName}" is now available. You can call it directly.`;
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
          // Stop mid-stream if cancelled
          if (this.isCancelled) {
            throw new Error("__cancelled__");
          }

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
        // Don't retry on auth errors, invalid requests, or client errors
        const msg = lastError.message.toLowerCase();
        if (msg.includes("401") || msg.includes("403") || msg.includes("400") || msg.includes("invalid_api_key") || msg.includes("authentication") || msg.includes("credit balance")) {
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

  /** Cancel an in-progress run. The current streaming turn will stop gracefully. */
  cancel(): void {
    this.isCancelled = true;
  }

  /**
   * Run the agentic loop with real streaming, context management, and hooks.
   */
  async run(userMessage: string, callbacks: AgentCallbacks): Promise<string> {
    this.isCancelled = false;
    this.messages.push(new HumanMessage(userMessage));
    this.currentTurns = 0;

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

        // Smart tool selection — filter on ALL turns (not just turn 1)
        // Turn 1: core + keyword-matched tools
        // Turn 2+: core + keyword-matched + previously-used tools
        // The get_tool meta-tool lets the LLM fetch anything else on demand
        const selectedTools = selectToolsForMessage(userMessage);
        if (selectedTools.size > 0) {
          // Also include any tools the LLM has already used (they'll likely use them again)
          for (const name of this.activatedTools) selectedTools.add(name);
        }
        const toolDefs = this.buildToolDefinitions(selectedTools.size > 0 ? selectedTools : undefined);
        const modelWithTools = this.model.bindTools(toolDefs);

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

        // Doom loop detection: if last N tool calls are identical, break
        if (toolCalls.length > 0) {
          const callKeys = toolCalls.map(tc => `${tc.name}:${JSON.stringify(tc.args)}`);
          for (const key of callKeys) {
            this.recentToolCalls.push(key);
          }
          // Keep only last 10 entries
          if (this.recentToolCalls.length > 10) {
            this.recentToolCalls = this.recentToolCalls.slice(-10);
          }
          // Check if last DOOM_LOOP_THRESHOLD entries are identical
          const threshold = AgentRunner.DOOM_LOOP_THRESHOLD;
          if (this.recentToolCalls.length >= threshold) {
            const lastN = this.recentToolCalls.slice(-threshold);
            if (lastN.every(k => k === lastN[0])) {
              const loopedTool = toolCalls[0].name;
              callbacks.onToken(
                `\n[Doom loop detected: "${loopedTool}" called ${threshold} times with identical arguments. Breaking loop.]\n`
              );
              // Push a message telling the LLM to stop repeating
              this.messages.push(new AIMessage(fullText));
              for (const tc of toolCalls) {
                this.messages.push(new ToolMessage({
                  content: `Doom loop detected: you have called "${tc.name}" with identical arguments ${threshold} times in a row. Stop repeating and try a different approach or explain what you are trying to achieve.`,
                  tool_call_id: tc.id,
                }));
              }
              this.recentToolCalls = [];
              fullResponse += fullText;
              continue; // Skip execution, let LLM see the error
            }
          }
        }

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

        // Handle get_tool meta-calls (fetch tool schema on demand)
        const realToolCalls: typeof toolCalls = [];
        for (const tc of toolCalls) {
          if (tc.name === "get_tool") {
            const toolName = tc.args.tool_name as string;
            callbacks.onToolCall(tc.name, tc.args);
            const result = this.handleGetTool(toolName);
            this.messages.push(new ToolMessage({ content: result, tool_call_id: tc.id }));
            callbacks.onToolResult(tc.name, result, false);
          } else {
            realToolCalls.push(tc);
            // Auto-activate used tools so they persist across turns
            this.activatedTools.add(tc.name);
          }
        }

        // Execute real tool calls — parallel for reads, sequential for writes
        if (realToolCalls.length > 0) {
          await this.executeToolCalls(realToolCalls, callbacks);
        }
        // Loop: model sees tool results, decides next step
      }

      callbacks.onComplete();
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      if (err.message === "__cancelled__") {
        callbacks.onComplete();
      } else {
        callbacks.onError(err);
      }
    }

    return fullResponse;
  }

  // ── Parallel Tool Execution (Claude Code approach) ──────

  /** Tools that are always safe to run in parallel (read-only, no side effects) */
  private static readonly ALWAYS_PARALLEL = new Set([
    "file_read", "glob_search", "grep_search", "web_fetch", "web_search",
    "sub_agent", "sub_agent_status", "sub_agent_terminate", "lsp",
  ]);

  /** Tools that can run in parallel IF they target different files */
  private static readonly PARALLEL_IF_DIFFERENT_FILES = new Set([
    "file_write", "file_edit", "multi_edit", "ast_edit", "apply_patch",
  ]);

  /** Tools that must always run sequentially (side effects, shared state) */
  private static readonly ALWAYS_SEQUENTIAL = new Set([
    "shell_exec", "file_run", "batch", "question", "skill", "plan_exit",
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
        // Build a descriptive denial message for the LLM so it understands what was blocked and why
        const actionDesc = tool.definition.permissionMessage
          ? tool.definition.permissionMessage(tc.args)
          : `${tc.name}: ${tc.args.command || tc.args.file_path || tc.args.task || JSON.stringify(tc.args).slice(0, 200)}`;
        const isDestructive = actionDesc.includes("DESTRUCTIVE");
        const denialMessage = [
          `Permission denied by user for: ${actionDesc}`,
          "",
          isDestructive
            ? "This was flagged as a DESTRUCTIVE operation. The user chose not to allow it."
            : "The user did not grant permission for this action.",
          "",
          "You MUST respect the user's decision. Do NOT retry this exact command.",
          "Instead, consider:",
          "- Asking the user what they'd like you to do instead",
          "- Using a safer alternative approach",
          isDestructive ? "- Explaining what the destructive operation would do and confirming intent" : "",
          "- Breaking the task into smaller, less risky steps",
        ].filter(Boolean).join("\n");

        this.messages.push(new ToolMessage({ content: denialMessage, tool_call_id: tc.id }));
        callbacks.onToolResult(tc.name, `Permission denied: ${actionDesc}`, true);
        return;
      }
    }

    // Capture file content before edit for streaming diff
    const isFileEdit = tc.name === "file_edit" || tc.name === "multi_edit" || tc.name === "file_write" || tc.name === "apply_patch";
    let preEditContent: string | null = null;
    if (isFileEdit && callbacks.onDiffChunk) {
      const targetPath = (tc.args.file_path || tc.args.path) as string | undefined;
      if (targetPath) {
        try {
          const fs = await import("fs");
          if (fs.existsSync(targetPath)) {
            preEditContent = fs.readFileSync(targetPath, "utf-8");
          }
        } catch { /* ignore — file may not exist yet */ }
      }
    }

    // Execute tool
    const result = await this.toolRegistry.execute(tc.name, tc.args);

    // Stream diff chunks for file edit operations
    if (isFileEdit && result.success && callbacks.onDiffChunk && preEditContent !== null) {
      const targetPath = ((tc.args.file_path || tc.args.path) as string) || "unknown";
      try {
        const fs = await import("fs");
        const postEditContent = fs.readFileSync(targetPath, "utf-8");
        if (preEditContent !== postEditContent) {
          streamDeterministicDiff(preEditContent, postEditContent, targetPath, callbacks.onDiffChunk);
        }
      } catch { /* ignore — streaming diff is best-effort */ }
    }

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

// ── Smart Tool Selection ───────────────────────────────────────────────────
// Analyzes user messages to select only relevant tools per turn.
// Saves ~3,000-5,000 tokens per API call by not sending unused tool schemas.
//
// Strategy:
//   Turn 1: Core tools + keyword-activated tools + get_tool for the rest
//   Turn 2+: Core tools + previously-used tools + keyword-activated + get_tool
// The get_tool meta-tool lets the LLM fetch any tool it needs on demand.

/**
 * Minimal core tools — the absolute essentials for any coding task.
 * Reduced from 10 to 7 to save ~1,500 more tokens vs the old set.
 */
const ALWAYS_INCLUDE = new Set([
  "file_read",       // reading files — needed almost every task
  "file_edit",       // find-and-replace — most common edit action
  "file_write",      // creating new files
  "shell_exec",      // running commands, builds, tests, git
  "glob_search",     // finding files by pattern
  "grep_search",     // searching code content
  "list_dir",        // exploring directory structure
]);

/** Tool groups activated by keyword signals in the user message */
const TOOL_SIGNALS: Array<{ keywords: RegExp; tools: string[] }> = [
  { keywords: /search|find|grep|look for|where is/i, tools: ["codebase_search", "grep_search", "glob_search"] },
  { keywords: /edit|change|replace|rename|refactor|fix|update|modify/i, tools: ["multi_edit", "file_edit"] },
  { keywords: /write|create|new file|generate/i, tools: ["file_write"] },
  { keywords: /run|execute|test|build|install|npm|yarn|pip/i, tools: ["shell_exec", "file_run", "code_verify"] },
  { keywords: /web|fetch|url|http|download|api/i, tools: ["web_fetch", "web_search"] },
  { keywords: /notebook|ipynb|jupyter|cell/i, tools: ["notebook_edit"] },
  { keywords: /ast|tree.?sitter|parse|struct|node|rename func|rename class/i, tools: ["ast_edit"] },
  { keywords: /diff|git|commit|branch|status|log/i, tools: ["view_diff", "shell_exec"] },
  { keywords: /todo|task|plan|track/i, tools: ["todo"] },
  { keywords: /sub.?agent|parallel|background|delegate/i, tools: ["sub_agent", "sub_agent_status", "sub_agent_terminate"] },
  { keywords: /repo|map|structure|overview|architecture/i, tools: ["view_repo_map"] },
  { keywords: /system|info|permission|sandbox/i, tools: ["system_info"] },
  { keywords: /patch|apply.?diff|unified.?diff/i, tools: ["apply_patch"] },
  { keywords: /skill|workflow|recipe|domain/i, tools: ["skill"] },
  { keywords: /lsp|definition|reference|hover|symbol|go.?to.?def/i, tools: ["lsp"] },
  { keywords: /ask|question|choose|confirm|select/i, tools: ["question"] },
  { keywords: /batch|bulk|multiple.?tools/i, tools: ["batch"] },
];

/**
 * Select tools relevant to a user message.
 * Always includes core tools + any activated by keyword signals.
 * Falls back to all tools if the message is ambiguous.
 */
function selectToolsForMessage(message: string): Set<string> {
  const selected = new Set(ALWAYS_INCLUDE);

  let signalMatched = false;
  for (const signal of TOOL_SIGNALS) {
    if (signal.keywords.test(message)) {
      for (const tool of signal.tools) selected.add(tool);
      signalMatched = true;
    }
  }

  // If no specific signals matched, include all tools (ambiguous request)
  if (!signalMatched) return new Set<string>(); // empty = no filter = all tools

  return selected;
}

// ── Tool Definition Compaction ─────────────────────────────────────────────
// Reduces token cost by ~40-50% without losing LLM understanding.

/**
 * Compact a tool description to its essential information.
 * Strips IMPORTANT blocks, usage notes, and verbose instructions
 * that the LLM already knows from training.
 */
function compactDescription(desc: string): string {
  // Take only the first paragraph (before any blank line or IMPORTANT/Note block)
  const lines = desc.split("\n");
  const compacted: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    // Stop at IMPORTANT, Note, Usage, or blank lines that start instruction blocks
    if (trimmed.startsWith("IMPORTANT") || trimmed.startsWith("Note:") || trimmed.startsWith("Usage:")) break;
    // Stop at bullet-point instruction blocks (lines starting with "- ")
    if (trimmed.startsWith("- ") && compacted.length > 0) break;
    // Stop at empty lines after we have content (paragraph break)
    if (!trimmed && compacted.length > 0) break;

    compacted.push(line);
  }

  const result = compacted.join("\n").trim();
  // If we compressed too aggressively, return first 200 chars of original
  if (result.length < 20) {
    return desc.substring(0, 200).trim();
  }
  return result;
}

/**
 * Compact a JSON Schema by removing verbose property descriptions
 * that are obvious from the property name itself.
 * e.g., "file_path" doesn't need "Path to the file to edit"
 */
function compactSchema(schema: Record<string, unknown>): Record<string, unknown> {
  if (!schema || typeof schema !== "object") return schema;

  const result = { ...schema };

  if (result.properties && typeof result.properties === "object") {
    const props = { ...result.properties } as Record<string, Record<string, unknown>>;
    const compactedProps: Record<string, Record<string, unknown>> = {};

    for (const [key, prop] of Object.entries(props)) {
      if (!prop || typeof prop !== "object") {
        compactedProps[key] = prop;
        continue;
      }

      const compactedProp = { ...prop };

      // Remove descriptions that just restate the property name
      if (typeof compactedProp.description === "string") {
        const desc = compactedProp.description as string;
        // Keep short descriptions, compact long ones
        if (desc.length > 60) {
          // Take first sentence only
          const firstSentence = desc.split(/[.!]\s/)[0];
          compactedProp.description = firstSentence.length < desc.length
            ? firstSentence
            : desc.substring(0, 60);
        }
        // Remove descriptions that are just the key name rephrased
        const keyWords = key.replace(/_/g, " ").toLowerCase();
        if (desc.toLowerCase().startsWith(keyWords) || desc.toLowerCase() === `the ${keyWords}`) {
          delete compactedProp.description;
        }
      }

      // Recursively compact nested schemas (e.g., items in arrays)
      if (compactedProp.items && typeof compactedProp.items === "object") {
        compactedProp.items = compactSchema(compactedProp.items as Record<string, unknown>);
      }

      compactedProps[key] = compactedProp;
    }

    result.properties = compactedProps;
  }

  return result;
}
