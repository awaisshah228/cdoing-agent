/**
 * Discord Channel Plugin (Stub)
 *
 * Placeholder for Discord integration. Shows the pattern for adding
 * a new channel. To complete:
 *   1. Install discord.js: yarn add discord.js
 *   2. Implement the adapter methods below
 *   3. The rest (session, agent, TUI) works automatically
 */

import { BaseChannel } from "../base";
import type { ChannelPlugin, SendOptions } from "../../types";

export class DiscordChannel extends BaseChannel {
  readonly id = "discord";
  readonly name = "Discord";

  constructor(_config: Record<string, unknown>, logLevel: string = "info") {
    super(logLevel);
    this.logger = this.logger.child("discord");
  }

  async start(): Promise<void> {
    // TODO: Initialize discord.js Client, login with token, register event handlers
    throw new Error("Discord channel not yet implemented. Install discord.js and implement this adapter.");
  }

  async stop(): Promise<void> {
    this.setConnected(false);
  }

  async sendMessage(_chatId: string, _text: string, _options?: SendOptions): Promise<string> {
    throw new Error("Not implemented");
  }

  async editMessage(_chatId: string, _messageId: string, _text: string): Promise<void> {
    throw new Error("Not implemented");
  }

  async sendTyping(_chatId: string): Promise<void> {
    throw new Error("Not implemented");
  }
}

export const discordPlugin: ChannelPlugin = {
  id: "discord",
  name: "Discord",
  description: "Discord bot channel (requires discord.js)",
  configSchema: {
    type: "object",
    properties: {
      botToken: { type: "string", description: "Discord bot token" },
      enabled: { type: "boolean" },
    },
    required: ["botToken"],
  },
  create(config, logLevel) {
    return new DiscordChannel(config, logLevel);
  },
};
