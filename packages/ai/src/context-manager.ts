/**
 * Context Manager — Token counting and conversation compression.
 *
 * Tracks token usage per turn and compresses old messages
 * when approaching the context window limit.
 *
 * Compression strategy (inspired by Claude Code):
 *   Phase 1: Prune old tool outputs (lightweight, biggest saver)
 *   Phase 2: Strip media (images/base64)
 *   Phase 3: LLM-powered summarization (falls back to template if LLM unavailable)
 */

import type { BaseMessage } from "@langchain/core/messages";
import { HumanMessage, AIMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";

/**
 * Token counting — uses js-tiktoken for accurate counting across providers.
 *
 * - OpenAI models: cl100k_base / o200k_base (exact)
 * - Anthropic Claude: cl100k_base (close approximation, ~95% accurate)
 * - Others: cl100k_base with fallback to ~3.5 chars/token
 *
 * Using tiktoken for all providers gives much better context window
 * management than the ~3.5 chars/token estimate.
 */
let tiktokenEncoder: any = null;
let tiktokenLoaded = false;

function loadTiktoken(): void {
  if (tiktokenLoaded) return;
  tiktokenLoaded = true;
  try {
    const { getEncoding } = require("js-tiktoken");
    // cl100k_base works well for both OpenAI and Claude models
    tiktokenEncoder = getEncoding("cl100k_base");
  } catch {
    // js-tiktoken not available — use fallback
    tiktokenEncoder = null;
  }
}

function estimateTokens(text: string, _model?: string): number {
  // Try tiktoken for all models (cl100k_base is a good universal approximation)
  loadTiktoken();
  if (tiktokenEncoder) {
    try {
      return tiktokenEncoder.encode(text).length;
    } catch {
      // Fallback on encoding error
    }
  }

  // Fallback: ~3.5 chars per token for English text
  return Math.ceil(text.length / 3.5);
}

function messageContent(msg: BaseMessage): string {
  if (typeof msg.content === "string") return msg.content;
  if (Array.isArray(msg.content)) {
    return msg.content
      .map((b) => {
        if (typeof b === "string") return b;
        if (b && typeof b === "object" && "text" in b) return (b as any).text || "";
        return "";
      })
      .join("");
  }
  return "";
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface TurnUsage {
  turn: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cost?: number;
}

/** Pricing per 1M tokens — matches Claude Code's cost tiers */
interface ModelPricing {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
}

const PRICING: Record<string, ModelPricing> = {
  // Anthropic (Claude Code tiers: 3/15, 5/25, 15/75, 1/5)
  "claude-sonnet-4": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  "claude-opus-4": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  "claude-haiku-4": { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
  // OpenAI
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "gpt-4o": { input: 2.5, output: 10 },
  "gpt-4.1": { input: 2, output: 8 },
  "o3": { input: 2, output: 8 },
  "o4-mini": { input: 1.1, output: 4.4 },
  // Google
  "gemini-2.5-pro": { input: 1.25, output: 10 },
  "gemini-2.0-flash": { input: 0.075, output: 0.3 },
  // Others
  "mistral-large": { input: 2, output: 6 },
  "grok-3": { input: 3, output: 15 },
  "llama-3.3-70b": { input: 0.59, output: 0.79 },
  "deepseek-r1": { input: 0.55, output: 2.19 },
  "sonar-pro": { input: 3, output: 15 },
  "command-r-plus": { input: 2.5, output: 10 },
};

/** Per-model usage accumulator */
interface ModelUsageEntry {
  inputTokens: number;
  outputTokens: number;
  cost: number;
}

export class ContextManager {
  private maxContextTokens: number;
  private turns: TurnUsage[] = [];
  private currentTurn = 0;
  private model: string;
  private modelUsage: Map<string, ModelUsageEntry> = new Map();
  /** Circuit breaker: stop LLM compaction after consecutive failures */
  private compactFailures = 0;
  private static readonly MAX_COMPACT_FAILURES = 3;

  constructor(maxContextTokens: number = 128000, model: string = "") {
    this.maxContextTokens = maxContextTokens;
    this.model = model;
  }

  setModel(model: string): void {
    this.model = model;
  }

  /** Get remaining token capacity (based on current conversation) */
  getRemainingTokens(messages: BaseMessage[], systemPromptTokens: number = 0): number {
    const used = this.estimateMessages(messages) + systemPromptTokens;
    return Math.max(0, this.maxContextTokens - used);
  }

  /** Get remaining chars budget for tool outputs (~4 chars per token, reserve 20% for LLM response) */
  getOutputBudgetChars(messages: BaseMessage[], systemPromptTokens: number = 0): number {
    const remainingTokens = this.getRemainingTokens(messages, systemPromptTokens);
    // Reserve 20% for the LLM's response, convert rest to chars
    const availableTokens = Math.floor(remainingTokens * 0.8);
    return availableTokens * 4; // ~4 chars per token
  }

  getMaxContextTokens(): number {
    return this.maxContextTokens;
  }

  /** Update max context tokens (e.g. after auto-detecting from Ollama /api/show) */
  setMaxContextTokens(tokens: number): void {
    this.maxContextTokens = tokens;
  }

  /** Estimate total tokens in a message array */
  estimateMessages(messages: BaseMessage[]): number {
    let total = 0;
    for (const msg of messages) {
      total += estimateTokens(messageContent(msg));
      total += 4; // message overhead
    }
    return total;
  }

  /** Record a turn's token usage (also accumulates per-model) */
  recordTurn(inputTokens: number, outputTokens: number): TurnUsage {
    this.currentTurn++;
    const total = inputTokens + outputTokens;
    const cost = this.calculateCost(inputTokens, outputTokens);

    const usage: TurnUsage = {
      turn: this.currentTurn,
      inputTokens,
      outputTokens,
      totalTokens: total,
      cost,
    };
    this.turns.push(usage);

    // Accumulate per-model usage
    if (this.model) {
      const existing = this.modelUsage.get(this.model) || { inputTokens: 0, outputTokens: 0, cost: 0 };
      existing.inputTokens += inputTokens;
      existing.outputTokens += outputTokens;
      existing.cost += cost ?? 0;
      this.modelUsage.set(this.model, existing);
    }

    return usage;
  }

  /** Record usage from provider response metadata (if available) */
  recordFromResponse(response: any): TurnUsage | null {
    const usage = response?.usage_metadata || response?.response_metadata?.usage;
    if (usage) {
      const input = usage.input_tokens || usage.prompt_tokens || 0;
      const output = usage.output_tokens || usage.completion_tokens || 0;
      return this.recordTurn(input, output);
    }
    // Fall back to estimation
    const text = typeof response?.content === "string" ? response.content : "";
    return this.recordTurn(0, estimateTokens(text));
  }

  /** Calculate cost in USD */
  private calculateCost(inputTokens: number, outputTokens: number): number | undefined {
    const pricing = this.findPricing();
    if (!pricing) return undefined;
    return (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000;
  }

  /** Find pricing entry for current model */
  private findPricing(): ModelPricing | undefined {
    for (const [prefix, pricing] of Object.entries(PRICING)) {
      if (this.model.includes(prefix)) return pricing;
    }
    return undefined;
  }

  /** Get cumulative usage across all turns */
  getTotalUsage(): { tokens: TokenUsage; cost?: number; turns: number } {
    const tokens: TokenUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
    let cost = 0;
    let hasCost = false;

    for (const turn of this.turns) {
      tokens.inputTokens += turn.inputTokens;
      tokens.outputTokens += turn.outputTokens;
      tokens.totalTokens += turn.totalTokens;
      if (turn.cost !== undefined) {
        cost += turn.cost;
        hasCost = true;
      }
    }

    return { tokens, cost: hasCost ? cost : undefined, turns: this.turns.length };
  }

  /** Get the last turn's usage */
  getLastTurn(): TurnUsage | null {
    return this.turns.length > 0 ? this.turns[this.turns.length - 1] : null;
  }

  // ── Multi-Phase Compaction (inspired by OpenCode) ──────────────────────
  //
  // Phase 1: Prune old tool outputs (biggest token saver — tool results are huge)
  // Phase 2: Strip media from old messages (images/base64 replaced with placeholders)
  // Phase 3: Full compaction — summarize old messages with a structured template
  //
  // Each phase is triggered progressively as context usage increases.

  /** Tokens of tool output to always protect from pruning (most recent tools) */
  private static readonly PRUNE_PROTECT_TOKENS = 40000;
  /** Minimum token savings before pruning is worthwhile */
  private static readonly PRUNE_MINIMUM_SAVINGS = 15000;
  /** Tool names whose output should never be pruned */
  private static readonly PRUNE_PROTECTED_TOOLS = new Set(["skill", "get_tool", "question"]);

  /**
   * Compress messages if approaching the context limit.
   *
   * Three-phase strategy (each phase only runs if still over budget):
   *   1. Prune old tool outputs → saves 20-50k tokens typically
   *   2. Strip media (images/base64) → saves variable, can be huge
   *   3. Summarize old messages → structured compaction of entire history
   */
  compressIfNeeded(messages: BaseMessage[], systemPrompt: string): BaseMessage[] {
    const systemTokens = estimateTokens(systemPrompt);
    const messageTokens = this.estimateMessages(messages);
    const totalTokens = systemTokens + messageTokens;

    // If under 70% of limit, no compression needed
    if (totalTokens < this.maxContextTokens * 0.70) {
      return messages;
    }

    // Phase 1: Prune old tool outputs (most effective, least destructive)
    if (totalTokens >= this.maxContextTokens * 0.70) {
      messages = this.pruneToolOutputs(messages);
      const afterPrune = systemTokens + this.estimateMessages(messages);
      if (afterPrune < this.maxContextTokens * 0.65) {
        return messages;
      }
    }

    // Phase 2: Strip media from old messages
    if (systemTokens + this.estimateMessages(messages) >= this.maxContextTokens * 0.70) {
      messages = this.stripMedia(messages);
      const afterStrip = systemTokens + this.estimateMessages(messages);
      if (afterStrip < this.maxContextTokens * 0.65) {
        return messages;
      }
    }

    // Phase 3: Full compaction — summarize older messages
    if (systemTokens + this.estimateMessages(messages) >= this.maxContextTokens * 0.70) {
      messages = this.compactMessages(messages);
    }

    return messages;
  }

  /**
   * Phase 1: Prune old tool outputs.
   *
   * Walks backwards through messages, replacing old ToolMessage content
   * with a short "[output pruned — N tokens saved]" placeholder.
   * Protects the most recent PRUNE_PROTECT_TOKENS worth of tool results.
   */
  private pruneToolOutputs(messages: BaseMessage[]): BaseMessage[] {
    // Count tokens from the end to find the protection boundary
    let recentTokens = 0;
    let protectionIndex = messages.length;

    for (let i = messages.length - 1; i >= 0; i--) {
      recentTokens += estimateTokens(messageContent(messages[i])) + 4;
      if (recentTokens >= ContextManager.PRUNE_PROTECT_TOKENS) {
        protectionIndex = i;
        break;
      }
    }

    let totalSaved = 0;
    const result = messages.map((msg, i) => {
      // Don't prune messages in the protected zone
      if (i >= protectionIndex) return msg;

      // Only prune ToolMessages
      if (msg._getType() !== "tool") return msg;

      const content = messageContent(msg);
      const contentTokens = estimateTokens(content);

      // Skip small tool outputs (not worth pruning)
      if (contentTokens < 200) return msg;

      // Skip protected tools
      const toolCallId = (msg as any).tool_call_id;
      if (toolCallId) {
        // Check if the preceding AI message has a matching tool_call with a protected name
        const aiMsg = i > 0 ? messages[i - 1] : null;
        if (aiMsg && aiMsg._getType() === "ai") {
          const toolCalls = (aiMsg as any).tool_calls as Array<{ name: string; id: string }> | undefined;
          const matchingCall = toolCalls?.find((tc) => tc.id === toolCallId);
          if (matchingCall && ContextManager.PRUNE_PROTECTED_TOOLS.has(matchingCall.name)) {
            return msg;
          }
        }
      }

      // Prune: replace content with placeholder
      totalSaved += contentTokens;
      const toolMsg = new ToolMessage({
        content: `[output pruned — ${contentTokens} tokens saved. Re-run the tool if you need this output again.]`,
        tool_call_id: (msg as any).tool_call_id || "unknown",
      });
      return toolMsg;
    });

    // Only apply pruning if savings meet minimum threshold
    if (totalSaved < ContextManager.PRUNE_MINIMUM_SAVINGS) {
      return messages;
    }

    return result;
  }

  /**
   * Phase 2: Strip media (images, base64 data) from older messages.
   *
   * Replaces image_url content blocks with text placeholders.
   * Only strips from messages outside the last 4 messages.
   */
  private stripMedia(messages: BaseMessage[]): BaseMessage[] {
    const protectLast = Math.min(4, messages.length);
    const boundary = messages.length - protectLast;

    return messages.map((msg, i) => {
      if (i >= boundary) return msg;
      if (!Array.isArray(msg.content)) return msg;

      const content = msg.content as Array<Record<string, unknown>>;
      let hasMedia = false;

      const stripped = content.map((block) => {
        if (block.type === "image_url" || block.type === "image") {
          hasMedia = true;
          return { type: "text", text: "[image attachment removed to save context]" };
        }
        // Strip base64 data URLs in text blocks
        if (block.type === "text" && typeof block.text === "string") {
          const text = block.text as string;
          if (text.includes("data:image/") || text.includes(";base64,")) {
            hasMedia = true;
            return { type: "text", text: text.replace(/data:[^;]+;base64,[A-Za-z0-9+/=]+/g, "[base64 data removed]") };
          }
        }
        return block;
      });

      if (!hasMedia) return msg;

      // Reconstruct message with stripped content
      const role = msg._getType();
      if (role === "human") return new HumanMessage({ content: stripped });
      if (role === "ai") return new AIMessage({ content: stripped });
      return msg;
    });
  }

  /**
   * Phase 3: Full compaction — summarize older messages with a structured template.
   *
   * Keeps the last N messages intact and compresses everything before them
   * into a structured summary covering: goal, discoveries, accomplished work, and files.
   */
  private compactMessages(messages: BaseMessage[]): BaseMessage[] {
    const keepRecent = Math.min(10, messages.length);
    const recentMessages = messages.slice(-keepRecent);
    const olderMessages = messages.slice(0, -keepRecent);

    if (olderMessages.length === 0) return messages;

    const summary = this.buildStructuredSummary(olderMessages);
    const summaryMessage = new HumanMessage(
      `[Compacted conversation history]\n\n${summary}`
    );

    return [summaryMessage, ...recentMessages];
  }

  /**
   * Build a structured summary of messages (OpenCode-style template).
   * Extracts goals, discoveries, accomplished work, and relevant files.
   */
  private buildStructuredSummary(messages: BaseMessage[]): string {
    const userRequests: string[] = [];
    const assistantActions: string[] = [];
    const filesModified = new Set<string>();
    const filesRead = new Set<string>();
    const errors: string[] = [];

    for (const msg of messages) {
      const content = messageContent(msg);
      if (!content) continue;
      const role = msg._getType();

      if (role === "human") {
        const preview = content.substring(0, 300).replace(/\n/g, " ").trim();
        if (preview) userRequests.push(preview);
      } else if (role === "ai") {
        // Extract file paths from tool calls
        const toolCalls = (msg as any).tool_calls as Array<{ name: string; args: Record<string, unknown> }> | undefined;
        if (toolCalls) {
          for (const tc of toolCalls) {
            const filePath = (tc.args?.file_path || tc.args?.path) as string | undefined;
            if (filePath) {
              if (tc.name === "file_edit" || tc.name === "file_write" || tc.name === "multi_edit" || tc.name === "apply_patch") {
                filesModified.add(filePath);
              } else if (tc.name === "file_read") {
                filesRead.add(filePath);
              }
            }
          }
        }
        const preview = content.substring(0, 200).replace(/\n/g, " ").trim();
        if (preview) assistantActions.push(preview);
      } else if (role === "tool") {
        // Track errors from tool results
        if (content.startsWith("ERROR:")) {
          errors.push(content.substring(0, 150).replace(/\n/g, " "));
        }
      }
    }

    const parts: string[] = [];

    parts.push("## Goal");
    if (userRequests.length > 0) {
      parts.push(userRequests.slice(0, 5).map((r) => `- ${r}`).join("\n"));
    } else {
      parts.push("- General coding assistance");
    }

    if (assistantActions.length > 0) {
      parts.push("\n## Accomplished");
      parts.push(assistantActions.slice(0, 8).map((a) => `- ${a}`).join("\n"));
    }

    if (filesModified.size > 0 || filesRead.size > 0) {
      parts.push("\n## Relevant files");
      if (filesModified.size > 0) {
        parts.push("Modified: " + [...filesModified].slice(0, 15).join(", "));
      }
      if (filesRead.size > 0) {
        parts.push("Read: " + [...filesRead].slice(0, 15).join(", "));
      }
    }

    if (errors.length > 0) {
      parts.push("\n## Errors encountered");
      parts.push(errors.slice(0, 3).map((e) => `- ${e}`).join("\n"));
    }

    return parts.join("\n");
  }

  /** Format usage for display */
  formatUsage(usage: TurnUsage): string {
    const parts: string[] = [];
    if (usage.inputTokens > 0 || usage.outputTokens > 0) {
      parts.push(`${usage.inputTokens.toLocaleString()} in / ${usage.outputTokens.toLocaleString()} out`);
    }
    parts.push(`${usage.totalTokens.toLocaleString()} total`);
    if (usage.cost !== undefined) {
      parts.push(`$${usage.cost.toFixed(4)}`);
    }
    return parts.join(" · ");
  }

  /** Format total session usage */
  formatTotalUsage(): string {
    const { tokens, cost, turns } = this.getTotalUsage();
    let result = `${turns} turn${turns !== 1 ? "s" : ""} · ${tokens.totalTokens.toLocaleString()} tokens`;
    if (tokens.inputTokens > 0) {
      result += ` (${tokens.inputTokens.toLocaleString()} in / ${tokens.outputTokens.toLocaleString()} out)`;
    }
    if (cost !== undefined) {
      result += ` · $${cost.toFixed(4)}`;
    }
    return result;
  }

  /**
   * Format a full cost breakdown like Claude Code's /cost command.
   * Shows total + per-model usage with USD.
   */
  formatCostBreakdown(): string {
    const { tokens, cost, turns } = this.getTotalUsage();
    const lines: string[] = [];

    lines.push(`Total cost:      ${cost !== undefined ? `$${cost.toFixed(4)}` : "N/A"}`);
    lines.push(`Total tokens:    ${tokens.totalTokens.toLocaleString()} (${tokens.inputTokens.toLocaleString()} in / ${tokens.outputTokens.toLocaleString()} out)`);
    lines.push(`Turns:           ${turns}`);

    if (this.modelUsage.size > 0) {
      lines.push("");
      lines.push("Usage by model:");
      for (const [model, usage] of this.modelUsage) {
        const shortName = model.length > 30 ? model.substring(0, 30) + "…" : model;
        const costStr = usage.cost > 0 ? ` ($${usage.cost.toFixed(4)})` : "";
        lines.push(`  ${shortName.padEnd(32)} ${usage.inputTokens.toLocaleString()} in / ${usage.outputTokens.toLocaleString()} out${costStr}`);
      }
    }

    return lines.join("\n");
  }

  // ── LLM-Powered Compaction (Phase 3 upgrade) ──────────────────────────

  /** The summarization prompt sent to the LLM (inspired by Claude Code's compact/prompt.ts) */
  private static readonly COMPACT_PROMPT = `CRITICAL: Respond with TEXT ONLY. Do NOT call any tools. Tool calls will be REJECTED.

Your task is to summarize the following conversation between a user and an AI coding assistant.
Analyze each message chronologically and produce a detailed summary:

- Identify every user request and the intent behind it
- Document key technical decisions and approaches taken
- List ALL file names, paths, function signatures, and code changes mentioned
- Record errors encountered and how they were resolved
- Note what was accomplished and what work remains pending
- Pay special attention to specific values, names, and code snippets — these are critical for continuity

Structure your response EXACTLY as:

<summary>
1. Primary Request and Intent: [What the user wants to achieve]
2. Key Technical Concepts: [Technologies, patterns, libraries, approaches discussed]
3. Files and Code: [Every file path mentioned, what was changed, key code snippets]
4. Errors and Fixes: [Each error encountered and how it was fixed]
5. Accomplished: [What was completed successfully]
6. Pending Tasks: [What still needs to be done]
7. Current State: [What was being actively worked on when this summary was created]
</summary>`;

  /**
   * Async compression — uses the LLM to summarize old messages (Phase 3).
   * Falls back to template-based summary if LLM is unavailable or fails.
   *
   * @param model - A LangChain-compatible model with .invoke() method
   */
  async compressIfNeededAsync(
    messages: BaseMessage[],
    systemPrompt: string,
    model?: { invoke: (messages: BaseMessage[]) => Promise<BaseMessage> },
  ): Promise<BaseMessage[]> {
    const systemTokens = estimateTokens(systemPrompt);
    const messageTokens = this.estimateMessages(messages);
    const totalTokens = systemTokens + messageTokens;

    if (totalTokens < this.maxContextTokens * 0.75) {
      return messages;
    }

    // Phase 1: Prune old tool outputs
    messages = this.pruneToolOutputs(messages);
    if (systemTokens + this.estimateMessages(messages) < this.maxContextTokens * 0.60) {
      return messages;
    }

    // Phase 2: Strip media
    messages = this.stripMedia(messages);
    if (systemTokens + this.estimateMessages(messages) < this.maxContextTokens * 0.60) {
      return messages;
    }

    // Phase 3: LLM-powered compaction (with circuit breaker)
    if (systemTokens + this.estimateMessages(messages) >= this.maxContextTokens * 0.75) {
      if (model && this.compactFailures < ContextManager.MAX_COMPACT_FAILURES) {
        const llmResult = await this.compactWithLLM(messages, model);
        if (llmResult) return llmResult;
      }
      // Fallback to template
      messages = this.compactMessages(messages);
    }

    return messages;
  }

  /**
   * Use the LLM to summarize older messages into a rich summary.
   * Returns null on failure (caller should fall back to template).
   */
  private async compactWithLLM(
    messages: BaseMessage[],
    model: { invoke: (messages: BaseMessage[]) => Promise<BaseMessage> },
  ): Promise<BaseMessage[] | null> {
    const keepRecent = Math.min(10, messages.length);
    const recentMessages = messages.slice(-keepRecent);
    const olderMessages = messages.slice(0, -keepRecent);

    if (olderMessages.length === 0) return null;

    // Build the conversation text for the LLM to summarize
    const conversationText = olderMessages.map((msg) => {
      const role = msg._getType();
      const content = messageContent(msg);
      if (role === "human") return `User: ${content}`;
      if (role === "ai") return `Assistant: ${content.substring(0, 500)}`;
      if (role === "tool") return `Tool result: ${content.substring(0, 300)}`;
      return `${role}: ${content.substring(0, 200)}`;
    }).join("\n\n");

    // Truncate if the conversation text itself is too long for summarization
    const maxSummarizeChars = this.maxContextTokens * 2; // ~half context in chars
    const truncated = conversationText.length > maxSummarizeChars
      ? conversationText.substring(0, maxSummarizeChars) + "\n\n[...truncated for summarization]"
      : conversationText;

    try {
      const response = await model.invoke([
        new SystemMessage(ContextManager.COMPACT_PROMPT),
        new HumanMessage(`Here is the conversation to summarize:\n\n${truncated}`),
      ]);

      const responseText = messageContent(response);
      if (!responseText || responseText.length < 50) {
        this.compactFailures++;
        return null;
      }

      const summary = ContextManager.formatCompactSummary(responseText);
      this.compactFailures = 0; // Reset on success

      return [
        new HumanMessage(`[Compacted conversation history — LLM summary]\n\n${summary}`),
        ...recentMessages,
      ];
    } catch {
      this.compactFailures++;
      return null;
    }
  }

  /**
   * Extract and clean up the LLM's summary response.
   * Strips <analysis> blocks, extracts <summary> content.
   */
  static formatCompactSummary(text: string): string {
    // Strip analysis/scratchpad blocks
    let result = text.replace(/<analysis>[\s\S]*?<\/analysis>/g, "");

    // Extract summary content
    const match = result.match(/<summary>([\s\S]*?)<\/summary>/);
    if (match) {
      result = `Summary:\n${match[1].trim()}`;
    }

    // Clean up whitespace
    result = result.replace(/\n{3,}/g, "\n\n").trim();
    return result || text.trim();
  }

  reset(): void {
    this.turns = [];
    this.currentTurn = 0;
    this.modelUsage.clear();
    this.compactFailures = 0;
  }
}
