/**
 * Base Channel — Abstract base class for channel adapters.
 *
 * Provides common functionality so channel implementations only
 * need to implement the channel-specific parts (API calls, polling, etc.).
 *
 * To add a new channel:
 *   1. Create a file in channels/<name>/index.ts
 *   2. Extend BaseChannel or implement ChannelAdapter directly
 *   3. Export a ChannelPlugin from the file
 *   4. Register it in channels/registry.ts
 */

import type { ChannelAdapter, OnMessageCallback, SendOptions, IncomingMessage } from "../types";
import { Logger } from "../utils/logger";

export abstract class BaseChannel implements ChannelAdapter {
  abstract readonly id: string;
  abstract readonly name: string;

  protected messageHandler: OnMessageCallback | null = null;
  protected logger: Logger;
  private _isConnected = false;

  constructor(logLevel: string = "info") {
    this.logger = new Logger(`Channel`, logLevel);
  }

  get isConnected(): boolean {
    return this._isConnected;
  }

  protected setConnected(value: boolean): void {
    this._isConnected = value;
  }

  onMessage(callback: OnMessageCallback): void {
    this.messageHandler = callback;
  }

  /** Dispatch a normalized message to the registered handler. */
  protected async dispatch(message: IncomingMessage): Promise<void> {
    if (!this.messageHandler) return;
    try {
      await this.messageHandler(message);
    } catch (err) {
      this.logger.error(`Handler error in ${this.id}: ${err}`);
    }
  }

  abstract start(): Promise<void>;
  abstract stop(): Promise<void>;
  abstract sendMessage(chatId: string, text: string, options?: SendOptions): Promise<string>;
  abstract editMessage(chatId: string, messageId: string, text: string): Promise<void>;
  abstract sendTyping(chatId: string): Promise<void>;

  /**
   * Chunk a long message to fit channel limits.
   * Override in subclass if the channel has a different limit.
   */
  protected chunkMessage(text: string, maxLength: number = 4096): string[] {
    if (text.length <= maxLength) return [text];

    const chunks: string[] = [];
    let remaining = text;

    while (remaining.length > 0) {
      if (remaining.length <= maxLength) {
        chunks.push(remaining);
        break;
      }

      let splitAt = remaining.lastIndexOf("\n", maxLength);
      if (splitAt < maxLength * 0.5) {
        splitAt = remaining.lastIndexOf(" ", maxLength);
      }
      if (splitAt < maxLength * 0.3) {
        splitAt = maxLength;
      }

      chunks.push(remaining.substring(0, splitAt));
      remaining = remaining.substring(splitAt).trimStart();
    }

    return chunks;
  }
}
