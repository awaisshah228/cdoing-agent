/**
 * Native Ollama Chat Model
 *
 * Uses Ollama's native /api/chat endpoint instead of the OpenAI-compatible /v1.
 * This ensures tool calls come back as structured data (message.tool_calls),
 * never streamed as raw text tokens — fixing the "JSON flash" rendering issue.
 *
 * Features (inspired by Continue + OpenCode):
 *   - Auto-detects context length via /api/show (no hardcoded 32k)
 *   - Buffers text when tools are active (prevents JSON flash)
 *   - Exposes detected model info for agent-runner context management
 *   - Performance tuning: keep_alive, num_ctx, num_gpu, num_thread, use_mmap
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

/** Model info detected from Ollama's /api/show endpoint */
export interface OllamaModelInfo {
  contextLength: number;
  family: string;
  parameterSize: string;
  quantization: string;
  supportsTools: boolean;
  supportsFim: boolean;
  supportsVision: boolean;
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
  /** Keep model loaded in memory (e.g. "5m", "1h", "-1" for forever). Default: "30m" */
  keepAlive?: string;
  /** Context window size. Overrides auto-detected value from /api/show. */
  numCtx?: number;
  /** Number of GPU layers to offload (-1 = all). */
  numGpu?: number;
  /** Number of CPU threads. */
  numThread?: number;
  /** Use memory-mapped file I/O for model loading. */
  useMmap?: boolean;
}

/**
 * A minimal LangChain-compatible chat model that uses Ollama's native /api/chat.
 *
 * Implements just enough of the LangChain interface for AgentRunner:
 *   - bindTools(tools) → returns a bound model
 *   - stream(messages, options) → async iterable of AIMessageChunk
 *   - getModelInfo() → auto-detected model capabilities from /api/show
 *   - getContextLength() → actual context window (auto-detected or configured)
 */
export class ChatOllamaNative {
  private modelName: string;
  private baseURL: string;
  private temperature: number;
  private maxTokens: number;
  private apiKey: string;
  private keepAlive: string;
  private numCtx: number | undefined;
  private numGpu: number | undefined;
  private numThread: number | undefined;
  private useMmap: boolean | undefined;
  private tools: OllamaTool[] = [];

  /** Model info populated by initModelInfo(). null until resolved. */
  private _modelInfo: OllamaModelInfo | null = null;
  private _modelInfoPromise: Promise<OllamaModelInfo | null> | null = null;

  constructor(options: ChatOllamaNativeOptions) {
    this.modelName = options.model;
    this.baseURL = (options.baseURL || "http://localhost:11434")
      .replace(/\/$/, "")
      .replace(/\/v1\/?$/, ""); // Strip /v1 suffix — Ollama native API uses /api/chat, not OpenAI-compat /v1
    this.temperature = options.temperature ?? 0.3;
    this.maxTokens = options.maxTokens ?? 8096;
    this.apiKey = options.apiKey || "";
    this.keepAlive = options.keepAlive ?? "30m";
    this.numCtx = options.numCtx;
    this.numGpu = options.numGpu;
    this.numThread = options.numThread;
    this.useMmap = options.useMmap;

    // Fire and forget — populates _modelInfo in background.
    // First stream() call awaits it if still pending.
    this._modelInfoPromise = this.fetchModelInfo();
  }

  // ── Model Info Detection (like Continue's /api/show) ──────────────────────

  /**
   * Query Ollama's /api/show for model metadata.
   * Extracts context length, family, quantization, and capability flags.
   */
  private async fetchModelInfo(): Promise<OllamaModelInfo | null> {
    try {
      const res = await fetch(`${this.baseURL}/api/show`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: this.modelName }),
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return null;

      const data = await res.json();
      const details = data.details || {};
      const modelInfo = data.model_info || {};
      const template: string = data.template || "";
      const parameters: string = data.parameters || "";

      // Extract context length from model_info (key varies by family)
      let contextLength = 0;
      for (const key of Object.keys(modelInfo)) {
        if (key.endsWith(".context_length")) {
          contextLength = modelInfo[key] as number;
          break;
        }
      }

      // Fallback: parse num_ctx from Modelfile parameters
      if (!contextLength && parameters) {
        for (const line of parameters.split("\n")) {
          const match = line.match(/^num_ctx\s+(\d+)/);
          if (match) {
            contextLength = parseInt(match[1], 10);
            break;
          }
        }
      }

      // Default fallback (Ollama default is 2048, but most coding models use more)
      if (!contextLength) contextLength = 8192;

      // Detect FIM support from template (like Continue)
      const supportsFim = template.includes(".Suffix");

      // Detect vision support from model families or projector keys
      const supportsVision = !!(details.families?.includes("clip") ||
        Object.keys(modelInfo).some((k: string) => k.includes("vision") || k.includes("projector")));

      // Tool support heuristic (like Continue's toolSupport.ts)
      const family = (details.family || "").toLowerCase();
      const modelLower = this.modelName.toLowerCase();
      const toolFamilies = [
        "qwen2", "qwen3", "llama3.1", "llama3.2", "llama3.3",
        "mixtral", "mistral", "command-r", "command-a", "deepseek",
        "granite", "hermes3", "firefunction", "devstral", "cogito",
      ];
      const toolExclusions = ["vision", "math", "guard", "mistrallite"];
      const supportsTools = !toolExclusions.some(x => modelLower.includes(x))
        && toolFamilies.some(f => family.includes(f) || modelLower.includes(f));

      this._modelInfo = {
        contextLength,
        family: details.family || "unknown",
        parameterSize: details.parameter_size || "unknown",
        quantization: details.quantization_level || "unknown",
        supportsTools,
        supportsFim,
        supportsVision,
      };

      return this._modelInfo;
    } catch {
      // Ollama might not be running yet — not fatal
      return null;
    }
  }

  /**
   * Get auto-detected model info. Waits for /api/show if still pending.
   * Returns null if detection failed.
   */
  async getModelInfo(): Promise<OllamaModelInfo | null> {
    if (this._modelInfo) return this._modelInfo;
    if (this._modelInfoPromise) {
      await this._modelInfoPromise;
    }
    return this._modelInfo;
  }

  /**
   * Get the effective context length for this model.
   * Priority: explicit numCtx option > auto-detected from /api/show > 8192 fallback.
   */
  async getContextLength(): Promise<number> {
    if (this.numCtx) return this.numCtx;
    const info = await this.getModelInfo();
    return info?.contextLength || 8192;
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
      keepAlive: this.keepAlive,
      numCtx: this.numCtx,
      numGpu: this.numGpu,
      numThread: this.numThread,
      useMmap: this.useMmap,
    });
    // Share model info so bound instance doesn't re-fetch
    bound._modelInfo = this._modelInfo;
    bound._modelInfoPromise = this._modelInfoPromise;
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

    // Check if tools are active for this request
    const lastMsg = ollamaMessages[ollamaMessages.length - 1];
    const hasTools = this.tools.length > 0 && lastMsg?.role === "user";

    // Only set num_ctx if explicitly configured — auto-detected values can exceed
    // GPU VRAM and cause Ollama to hang. Let Ollama use its own default otherwise.
    const ollamaOptions: Record<string, unknown> = {
      temperature: this.temperature,
      num_predict: this.maxTokens,
    };
    if (this.numCtx) ollamaOptions.num_ctx = this.numCtx;
    if (this.numGpu !== undefined) ollamaOptions.num_gpu = this.numGpu;
    if (this.numThread !== undefined) ollamaOptions.num_thread = this.numThread;
    if (this.useMmap !== undefined) ollamaOptions.use_mmap = this.useMmap;

    const body: Record<string, unknown> = {
      model: this.modelName,
      messages: ollamaMessages,
      stream: true,
      keep_alive: this.keepAlive,
      options: ollamaOptions,
    };

    // Only include tools when the last message is from user
    // (Ollama requirement — tools only valid with user messages)
    if (hasTools) {
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

    // Parse NDJSON stream — stream text directly for responsive UX.
    // Tool call JSON flash (if any) is handled by agent-runner's
    // onTextToolCallDetected callback which clears it from the UI.
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let parseBuffer = "";
    let finalChunkData: OllamaChatResponseChunk | null = null;
    let hasStructuredToolCalls = false;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        parseBuffer += decoder.decode(value, { stream: true });
        const lines = parseBuffer.split("\n");
        parseBuffer = lines.pop() ?? "";

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

          if (chunk.done) {
            finalChunkData = chunk;
            if (chunk.message?.tool_calls?.length) {
              hasStructuredToolCalls = true;
              yield this.toolCallsToChunk(chunk.message.tool_calls);
            }
            continue;
          }

          // Stream text content immediately
          const content = chunk.message?.content || "";
          if (content) {
            yield new AIMessageChunk({ content });
          }

          // Structured tool calls (non-streamed)
          if (chunk.message?.tool_calls?.length) {
            hasStructuredToolCalls = true;
            yield this.toolCallsToChunk(chunk.message.tool_calls);
          }
        }
      }

      // Process any remaining parse buffer
      if (parseBuffer.trim()) {
        try {
          const chunk: OllamaChatResponseChunk = JSON.parse(parseBuffer);
          if (chunk.error) throw new Error(`Ollama error: ${chunk.error}`);
          if (chunk.done) {
            finalChunkData = chunk;
            if (chunk.message?.tool_calls?.length) {
              hasStructuredToolCalls = true;
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
            finish_reason: hasStructuredToolCalls
              ? "tool_calls"
              : (finalChunkData.done_reason || "stop"),
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
