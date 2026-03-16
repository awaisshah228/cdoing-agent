/**
 * Telegram Channel Plugin
 *
 * Implements the ChannelAdapter interface for Telegram Bot API.
 * Uses native fetch (zero framework dependency) with long-polling.
 *
 * Features:
 *   - Long-polling for message updates
 *   - Message chunking (4096 char limit)
 *   - Typing indicators
 *   - Message editing for "Working..." → result pattern
 *   - Webhook support (via gateway)
 */

import { BaseChannel } from "../base";
import type { ChannelPlugin, SendOptions, IncomingMessage } from "../../types";

const TELEGRAM_API = "https://api.telegram.org/bot";
const MAX_MSG_LEN = 4096;

/** Raw Telegram update (subset). */
interface TgUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from?: { id: number; username?: string; first_name?: string };
    chat: { id: number; type: string };
    text?: string;
    reply_to_message?: { message_id: number };
    date: number;
  };
}

interface TgApiResponse<T = unknown> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
}

export class TelegramChannel extends BaseChannel {
  readonly id = "telegram";
  readonly name = "Telegram";

  private token: string;
  private baseUrl: string;
  private isRunning = false;
  private pollOffset = 0;
  private pollAbort: AbortController | null = null;

  constructor(config: Record<string, unknown>, logLevel: string = "info") {
    super(logLevel);
    this.token = config.botToken as string;
    if (!this.token) throw new Error("Telegram botToken is required");
    this.baseUrl = `${TELEGRAM_API}${this.token}`;
    this.logger = this.logger.child("telegram");
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────

  async start(): Promise<void> {
    const me = await this.callApi<{ id: number; username: string }>("getMe");
    this.logger.info(`Telegram bot connected: @${me.username} (${me.id})`);
    this.setConnected(true);
    this.isRunning = true;
    this.poll();
  }

  async stop(): Promise<void> {
    this.isRunning = false;
    this.setConnected(false);
    if (this.pollAbort) {
      this.pollAbort.abort();
      this.pollAbort = null;
    }
    this.logger.info("Telegram channel stopped");
  }

  // ── Sending ────────────────────────────────────────────────────────────

  async sendMessage(chatId: string, text: string, options?: SendOptions): Promise<string> {
    const chunks = this.chunkMessage(text, MAX_MSG_LEN);
    let lastId = "";

    for (let i = 0; i < chunks.length; i++) {
      const params: Record<string, unknown> = {
        chat_id: chatId,
        text: chunks[i],
      };
      if (options?.replyToMessageId && i === 0) {
        params.reply_to_message_id = options.replyToMessageId;
      }
      if (options?.disableLinkPreview) {
        params.disable_web_page_preview = true;
      }

      const result = await this.callApi<{ message_id: number }>("sendMessage", params);
      lastId = String(result.message_id);
    }

    return lastId;
  }

  async editMessage(chatId: string, messageId: string, text: string): Promise<void> {
    const truncated = text.length > MAX_MSG_LEN
      ? text.substring(0, MAX_MSG_LEN - 20) + "\n\n... [truncated]"
      : text;

    await this.callApi("editMessageText", {
      chat_id: chatId,
      message_id: Number(messageId),
      text: truncated,
    });
  }

  async sendTyping(chatId: string): Promise<void> {
    await this.callApi("sendChatAction", {
      chat_id: chatId,
      action: "typing",
    }).catch(() => {});
  }

  /**
   * Handle a raw webhook update (called by the gateway).
   * This allows the gateway to forward Telegram webhook POSTs.
   */
  async handleWebhookUpdate(body: unknown): Promise<void> {
    if (!body || typeof body !== "object") return;
    const update = body as TgUpdate;
    await this.handleUpdate(update);
  }

  // ── Polling ────────────────────────────────────────────────────────────

  private poll(): void {
    const run = async () => {
      while (this.isRunning) {
        try {
          this.pollAbort = new AbortController();
          const updates = await this.callApi<TgUpdate[]>("getUpdates", {
            offset: this.pollOffset,
            timeout: 30,
            allowed_updates: ["message"],
          }, this.pollAbort.signal);

          for (const update of updates) {
            if (update.update_id >= this.pollOffset) {
              this.pollOffset = update.update_id + 1;
            }
            await this.handleUpdate(update);
          }
        } catch (err) {
          if (!this.isRunning) break;
          const e = err instanceof Error ? err : new Error(String(err));
          if (e.name === "AbortError") continue;
          this.logger.error(`Poll error: ${e.message}`);
          await new Promise((r) => setTimeout(r, 3000));
        }
      }
    };
    run().catch((e) => this.logger.error(`Fatal poll error: ${e}`));
  }

  private async handleUpdate(update: TgUpdate): Promise<void> {
    const msg = update.message;
    if (!msg?.text || !msg.from) return;

    const normalized: IncomingMessage = {
      messageId: String(msg.message_id),
      chatId: String(msg.chat.id),
      userId: String(msg.from.id),
      username: msg.from.username || msg.from.first_name || `user_${msg.from.id}`,
      text: msg.text,
      channel: "telegram",
      isGroup: msg.chat.type !== "private",
      replyToMessageId: msg.reply_to_message ? String(msg.reply_to_message.message_id) : undefined,
      timestamp: msg.date * 1000,
    };

    await this.dispatch(normalized);
  }

  // ── Telegram API ───────────────────────────────────────────────────────

  private async callApi<T>(method: string, params?: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
    const res = await fetch(`${this.baseUrl}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: params ? JSON.stringify(params) : undefined,
      signal,
    });

    const data = (await res.json()) as TgApiResponse<T>;
    if (!data.ok) {
      throw new Error(`Telegram API (${data.error_code}): ${data.description}`);
    }
    return data.result as T;
  }
}

// ── Plugin Export ──────────────────────────────────────────────────────────

export const telegramPlugin: ChannelPlugin = {
  id: "telegram",
  name: "Telegram",
  description: "Telegram Bot API channel — polling or webhook mode",
  configSchema: {
    type: "object",
    properties: {
      botToken: { type: "string", description: "Telegram Bot token from @BotFather" },
      enabled: { type: "boolean" },
    },
    required: ["botToken"],
  },
  create(config, logLevel) {
    return new TelegramChannel(config, logLevel);
  },
};
