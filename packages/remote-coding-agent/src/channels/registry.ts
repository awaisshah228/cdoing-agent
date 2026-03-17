/**
 * Channel Registry
 *
 * Central registry for all channel plugins. Channels register themselves
 * here, and the engine uses the registry to discover, configure, and
 * manage channels.
 *
 * Adding a new channel:
 *   1. Create channels/<name>/index.ts exporting a ChannelPlugin
 *   2. Call registry.register(plugin) — or it's auto-registered in
 *      the built-in channels section below
 *
 * The registry is the single place that knows about all channels.
 */

import type { ChannelPlugin, ChannelAdapter, ChannelConfig } from "../types";
import { Logger } from "../utils/logger";

export class ChannelRegistry {
  private plugins = new Map<string, ChannelPlugin>();
  private instances = new Map<string, ChannelAdapter>();
  private logger: Logger;

  constructor(logLevel: string = "info") {
    this.logger = new Logger("ChannelRegistry", logLevel);
  }

  /** Register a channel plugin. */
  register(plugin: ChannelPlugin): void {
    if (this.plugins.has(plugin.id)) {
      this.logger.warn(`Channel "${plugin.id}" already registered — overwriting`);
    }
    this.plugins.set(plugin.id, plugin);
    this.logger.debug(`Registered channel: ${plugin.id} (${plugin.name})`);
  }

  /** Get a registered plugin by ID. */
  getPlugin(id: string): ChannelPlugin | undefined {
    return this.plugins.get(id);
  }

  /** Get all registered plugins. */
  getAllPlugins(): ChannelPlugin[] {
    return Array.from(this.plugins.values());
  }

  /**
   * Create and start a channel adapter from its plugin + config.
   * Returns the running adapter instance.
   */
  async createAndStart(
    channelId: string,
    config: ChannelConfig,
    logLevel: string,
  ): Promise<ChannelAdapter> {
    const plugin = this.plugins.get(channelId);
    if (!plugin) {
      throw new Error(`Unknown channel: "${channelId}". Available: ${this.getAvailableIds().join(", ")}`);
    }

    if (!config.enabled) {
      throw new Error(`Channel "${channelId}" is disabled in config`);
    }

    const adapter = plugin.create(config as Record<string, unknown>, logLevel);
    this.instances.set(channelId, adapter);
    return adapter;
  }

  /** Get a running channel instance. */
  getInstance(id: string): ChannelAdapter | undefined {
    return this.instances.get(id);
  }

  /** Get all running channel instances. */
  getAllInstances(): Map<string, ChannelAdapter> {
    return this.instances;
  }

  /** Stop all running channels. */
  async stopAll(): Promise<void> {
    for (const [id, adapter] of this.instances.entries()) {
      try {
        await adapter.stop();
        this.logger.info(`Channel stopped: ${id}`);
      } catch (err) {
        this.logger.error(`Error stopping channel ${id}: ${err}`);
      }
    }
    this.instances.clear();
  }

  /** Get IDs of all registered channels. */
  getAvailableIds(): string[] {
    return Array.from(this.plugins.keys());
  }

  /** Get IDs of all running channels. */
  getRunningIds(): string[] {
    return Array.from(this.instances.keys());
  }

  /** Check if a channel is running. */
  isRunning(id: string): boolean {
    const instance = this.instances.get(id);
    return instance?.isConnected ?? false;
  }
}

/**
 * Create a registry pre-loaded with all built-in channels.
 */
export function createDefaultRegistry(logLevel: string = "info"): ChannelRegistry {
  const registry = new ChannelRegistry(logLevel);

  // Auto-register built-in channels
  try { registry.register(require("./telegram").telegramPlugin); } catch { /* optional */ }

  return registry;
}
