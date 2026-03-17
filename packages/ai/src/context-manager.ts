/**
 * Context Manager — Token counting and conversation compression.
 *
 * Tracks token usage per turn and compresses old messages
 * when approaching the context window limit.
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

/** Pricing per 1M tokens (input, output) */
const PRICING: Record<string, [number, number]> = {
  "claude-sonnet-4-20250514": [3, 15],
  "claude-opus-4-20250514": [15, 75],
  "claude-haiku-4-5-20251001": [1, 5],
  "gpt-4o": [2.5, 10],
  "gpt-4o-mini": [0.15, 0.6],
  "gemini-2.0-flash": [0.075, 0.3],
  // New providers
  "mistral-large": [2, 6],
  "grok-3": [3, 15],
  "llama-3.3-70b": [0.59, 0.79],
  "sonar-pro": [3, 15],
  "command-r-plus": [2.5, 10],
};

export class ContextManager {
  private maxContextTokens: number;
  private turns: TurnUsage[] = [];
  private currentTurn = 0;
  private model: string;

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

  /** Estimate total tokens in a message array */
  estimateMessages(messages: BaseMessage[]): number {
    let total = 0;
    for (const msg of messages) {
      total += estimateTokens(messageContent(msg));
      total += 4; // message overhead
    }
    return total;
  }

  /** Record a turn's token usage */
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
    // Find pricing by matching model name prefix
    for (const [modelPrefix, [inputPrice, outputPrice]] of Object.entries(PRICING)) {
      if (this.model.includes(modelPrefix)) {
        return (inputTokens * inputPrice + outputTokens * outputPrice) / 1_000_000;
      }
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

  reset(): void {
    this.turns = [];
    this.currentTurn = 0;
  }
}
