/**
 * Context Manager — Token counting and conversation compression.
 *
 * Tracks token usage per turn and compresses old messages
 * when approaching the context window limit.
 */

import type { BaseMessage } from "@langchain/core/messages";
import { HumanMessage, AIMessage, SystemMessage } from "@langchain/core/messages";

/** Rough token estimation: ~4 chars per token (works across providers) */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
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

  /**
   * Compress messages if we're approaching the context limit.
   * Strategy: summarize older messages, keep recent ones intact.
   */
  compressIfNeeded(messages: BaseMessage[], systemPrompt: string): BaseMessage[] {
    const systemTokens = estimateTokens(systemPrompt);
    const messageTokens = this.estimateMessages(messages);
    const totalTokens = systemTokens + messageTokens;

    // If under 75% of limit, no compression needed
    if (totalTokens < this.maxContextTokens * 0.75) {
      return messages;
    }

    // Keep the last N messages intact (recent context is most valuable)
    const keepRecent = Math.min(10, messages.length);
    const recentMessages = messages.slice(-keepRecent);
    const olderMessages = messages.slice(0, -keepRecent);

    if (olderMessages.length === 0) return messages;

    // Summarize older messages into a single system message
    const summary = this.summarizeMessages(olderMessages);
    const summaryMessage = new HumanMessage(
      `[Previous conversation summary: ${summary}]`
    );

    return [summaryMessage, ...recentMessages];
  }

  /** Create a brief summary of messages */
  private summarizeMessages(messages: BaseMessage[]): string {
    const parts: string[] = [];

    for (const msg of messages) {
      const content = messageContent(msg);
      if (!content) continue;

      const role = msg._getType();
      const preview = content.substring(0, 150).replace(/\n/g, " ");

      if (role === "human") {
        parts.push(`User asked: ${preview}`);
      } else if (role === "ai") {
        parts.push(`Assistant: ${preview}`);
      }
      // Skip tool messages in summary
    }

    return parts.join(". ") || "Earlier conversation about coding tasks.";
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
