/**
 * Native Ollama Chat Model
 *
 * Uses Ollama's native /api/chat endpoint instead of the OpenAI-compatible /v1.
 * This ensures tool calls come back as structured data (message.tool_calls),
 * never streamed as raw text tokens — fixing the "JSON flash" rendering issue.
 *
 * Inspired by Continue's Ollama implementation.
 */

import { AIMessageChunk } from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";

// ── Ollama API types ────────────────────────────────────────────────────────

interface OllamaTool {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

interface OllamaChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  images?: string[];
  tool_calls?: Array<{
    function: {
      name: string;
      arguments: Record<string, unknown>;
    };
  }>;
}

interface OllamaChatResponseChunk {
  model: string;
  created_at: string;
  done: boolean;
  message?: OllamaChatMessage;
  // Final chunk fields (done: true)
  done_reason?: string;
  total_duration?: number;
  prompt_eval_count?: number;
  eval_count?: number;
  // Error
  error?: string;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function langchainToOllama(msg: BaseMessage): OllamaChatMessage {
  const role = msg._getType();

  if (role === "system") {
    return { role: "system", content: typeof msg.content === "string" ? msg.content : "" };
  }

  if (role === "human") {
    // Handle multimodal content (images)
    if (Array.isArray(msg.content)) {
      let text = "";
      const images: string[] = [];
      for (const part of msg.content as Array<Record<string, unknown>>) {
        if (part.type === "text") {
          text += part.text as string;
        } else if (part.type === "image_url") {
          const url = ((part as any).image_url?.url || "") as string;
          // Extract base64 from data URL
          const match = url.match(/^data:[^;]+;base64,(.+)$/);
          if (match) images.push(match[1]);
        }
      }
      return { role: "user", content: text, ...(images.length > 0 ? { images } : {}) };
    }
    return { role: "user", content: typeof msg.content === "string" ? msg.content : "" };
  }

  if (role === "ai") {
    const aiMsg = msg as any;
    const ollamaMsg: OllamaChatMessage = {
      role: "assistant",
      content: typeof msg.content === "string" ? msg.content : "",
    };
    // Include tool calls if present (for conversation history)
    if (aiMsg.tool_calls?.length) {
      ollamaMsg.tool_calls = aiMsg.tool_calls.map((tc: any) => ({
        function: {
          name: tc.name,
          arguments: tc.args || {},
        },
      }));
    }
    return ollamaMsg;
  }

  if (role === "tool") {
    // Ollama expects tool results as role: "tool"
    return { role: "tool", content: typeof msg.content === "string" ? msg.content : "" };
  }

  // Fallback
  return { role: "user", content: typeof msg.content === "string" ? msg.content : "" };
}

// ── ChatOllamaNative ────────────────────────────────────────────────────────

export interface ChatOllamaNativeOptions {
  model: string;
  baseURL?: string;
  temperature?: number;
  maxTokens?: number;
  apiKey?: string;
}

/**
 * A minimal LangChain-compatible chat model that uses Ollama's native /api/chat.
 *
 * Implements just enough of the LangChain interface for AgentRunner:
 *   - bindTools(tools) → returns a bound model
 *   - stream(messages, options) → async iterable of AIMessageChunk
 */
export class ChatOllamaNative {
  private modelName: string;
  private baseURL: string;
  private temperature: number;
  private maxTokens: number;
  private apiKey: string;
  private tools: OllamaTool[] = [];

  constructor(options: ChatOllamaNativeOptions) {
    this.modelName = options.model;
    this.baseURL = (options.baseURL || "http://localhost:11434")
      .replace(/\/$/, "")
      .replace(/\/v1\/?$/, ""); // Strip /v1 suffix — Ollama native API uses /api/chat, not OpenAI-compat /v1
    this.temperature = options.temperature ?? 0.3;
    this.maxTokens = options.maxTokens ?? 8096;
    this.apiKey = options.apiKey || "";
  }

  /**
   * Bind tool definitions (OpenAI format) to the model.
   * Returns a new object with the same interface so AgentRunner can call .stream().
   */
  bindTools(tools: Array<Record<string, unknown>>): ChatOllamaNative {
    const bound = new ChatOllamaNative({
      model: this.modelName,
      baseURL: this.baseURL,
      temperature: this.temperature,
      maxTokens: this.maxTokens,
      apiKey: this.apiKey,
    });
    // Convert OpenAI-format tools to Ollama format
    bound.tools = tools.map((t) => {
      const fn = t.function as Record<string, unknown> | undefined;
      return {
        type: "function" as const,
        function: {
          name: (fn?.name as string) || "",
          description: (fn?.description as string) || undefined,
          parameters: (fn?.parameters as Record<string, unknown>) || undefined,
        },
      };
    });
    return bound;
  }

  /**
   * Stream a chat completion from Ollama's native /api/chat endpoint.
   * Yields AIMessageChunk objects compatible with LangChain's interface.
   */
  async *stream(
    messages: BaseMessage[],
    options?: { signal?: AbortSignal },
  ): AsyncGenerator<AIMessageChunk> {
    const ollamaMessages = messages.map(langchainToOllama);

    const body: Record<string, unknown> = {
      model: this.modelName,
      messages: ollamaMessages,
      stream: true,
      options: {
        temperature: this.temperature,
        num_predict: this.maxTokens,
      },
    };

    // Only include tools when the last message is from user
    // (Ollama requirement — tools only valid with user messages)
    const lastMsg = ollamaMessages[ollamaMessages.length - 1];
    if (this.tools.length > 0 && lastMsg?.role === "user") {
      body.tools = this.tools;
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.apiKey) {
      headers["Authorization"] = `Bearer ${this.apiKey}`;
    }

    const response = await fetch(`${this.baseURL}/api/chat`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: options?.signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      if (response.status === 404) {
        throw new Error(
          `Ollama API error 404: endpoint not found at ${this.baseURL}/api/chat. ` +
          `Make sure Ollama is running and the base URL is correct (e.g., http://localhost:11434 without /v1).`
        );
      }
      throw new Error(`Ollama API error ${response.status}: ${text.substring(0, 200)}`);
    }

    if (!response.body) {
      throw new Error("Ollama returned no response body");
    }

    // Parse NDJSON stream
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let finalChunkData: OllamaChatResponseChunk | null = null;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;

          let chunk: OllamaChatResponseChunk;
          try {
            chunk = JSON.parse(line);
          } catch {
            continue; // skip malformed lines
          }

          if (chunk.error) {
            throw new Error(`Ollama error: ${chunk.error}`);
          }

          // When done, capture final stats for usage metadata
          if (chunk.done) {
            finalChunkData = chunk;

            // Final chunk may also carry tool_calls in the message
            if (chunk.message?.tool_calls?.length) {
              yield this.toolCallsToChunk(chunk.message.tool_calls);
            }
            continue;
          }

          // Stream text content
          const content = chunk.message?.content || "";
          if (content) {
            yield new AIMessageChunk({ content });
          }

          // Tool calls can arrive in a non-streaming fashion (full message)
          if (chunk.message?.tool_calls?.length) {
            yield this.toolCallsToChunk(chunk.message.tool_calls);
          }
        }
      }

      // Process any remaining buffer
      if (buffer.trim()) {
        try {
          const chunk: OllamaChatResponseChunk = JSON.parse(buffer);
          if (chunk.error) throw new Error(`Ollama error: ${chunk.error}`);
          if (chunk.done) {
            finalChunkData = chunk;
            if (chunk.message?.tool_calls?.length) {
              yield this.toolCallsToChunk(chunk.message.tool_calls);
            }
          } else if (chunk.message?.content) {
            yield new AIMessageChunk({ content: chunk.message.content });
          }
        } catch { /* ignore */ }
      }

      // Yield a final empty chunk with usage metadata and response metadata
      if (finalChunkData) {
        yield new AIMessageChunk({
          content: "",
          usage_metadata: {
            input_tokens: finalChunkData.prompt_eval_count || 0,
            output_tokens: finalChunkData.eval_count || 0,
            total_tokens: (finalChunkData.prompt_eval_count || 0) + (finalChunkData.eval_count || 0),
          },
          response_metadata: {
            finish_reason: finalChunkData.done_reason || "stop",
          },
        });
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Convert Ollama tool_calls into an AIMessageChunk with structured tool_calls.
   */
  private toolCallsToChunk(
    toolCalls: Array<{ function: { name: string; arguments: Record<string, unknown> } }>,
  ): AIMessageChunk {
    return new AIMessageChunk({
      content: "",
      tool_calls: toolCalls.map((tc) => ({
        id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        name: tc.function.name,
        args: tc.function.arguments,
      })),
      // Signal to agent-runner that these are native tool calls
      response_metadata: {
        finish_reason: "tool_calls",
      },
    });
  }
}
