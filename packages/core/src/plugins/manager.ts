/**
 * Plugin Manager — loads and manages cdoing-agent plugins.
 *
 * Plugins are loaded from .cdoing/plugins/ directory.
 * Each plugin is a .js file that exports a CdoingPlugin object.
 */

import * as fs from "fs";
import * as path from "path";
import type { CdoingPlugin, PluginContext } from "./types";
import type { ToolDefinition, ToolResult } from "../tools/types";

export class PluginManager {
  private plugins: CdoingPlugin[] = [];
  private context: PluginContext;

  constructor(context: PluginContext) {
    this.context = context;
  }

  /** Load all plugins from .cdoing/plugins/ directory */
  async loadPlugins(): Promise<void> {
    const pluginDirs = [
      path.join(this.context.workingDir, ".cdoing", "plugins"),
      path.join(this.context.workingDir, ".claude", "plugins"),
    ];

    for (const dir of pluginDirs) {
      if (!fs.existsSync(dir)) continue;

      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        if (!entry.name.endsWith(".js") && !entry.name.endsWith(".mjs")) continue;

        const pluginPath = path.join(dir, entry.name);
        try {
          await this.loadPlugin(pluginPath);
        } catch (err) {
          console.error(`[plugins] Failed to load ${entry.name}: ${err instanceof Error ? err.message : err}`);
        }
      }
    }
  }

  /** Load a single plugin from a file path */
  async loadPlugin(pluginPath: string): Promise<void> {
    const mod = await import(pluginPath);
    const plugin: CdoingPlugin = mod.default || mod;

    if (!plugin.name) {
      throw new Error(`Plugin at ${pluginPath} must export a 'name' property`);
    }

    // Check for duplicates
    if (this.plugins.some((p) => p.name === plugin.name)) {
      console.warn(`[plugins] Skipping duplicate plugin: ${plugin.name}`);
      return;
    }

    // Initialize
    if (plugin.init) {
      await plugin.init(this.context);
    }

    this.plugins.push(plugin);
  }

  /** Register a plugin directly (for built-in plugins) */
  async registerPlugin(plugin: CdoingPlugin): Promise<void> {
    if (this.plugins.some((p) => p.name === plugin.name)) return;
    if (plugin.init) {
      await plugin.init(this.context);
    }
    this.plugins.push(plugin);
  }

  /** Transform tool definitions through all plugins */
  transformTools(tools: ToolDefinition[]): ToolDefinition[] {
    let result = tools;
    for (const plugin of this.plugins) {
      if (plugin.transformTools) {
        result = plugin.transformTools(result);
      }
    }
    return result;
  }

  /** Transform system prompt through all plugins */
  transformSystemPrompt(prompt: string): string {
    let result = prompt;
    for (const plugin of this.plugins) {
      if (plugin.transformSystemPrompt) {
        result = plugin.transformSystemPrompt(result);
      }
    }
    return result;
  }

  /** Notify all plugins of a tool call */
  notifyToolCall(name: string, input: Record<string, unknown>): void {
    for (const plugin of this.plugins) {
      if (plugin.onToolCall) {
        try {
          plugin.onToolCall(name, input);
        } catch { /* don't let plugin errors disrupt flow */ }
      }
    }
  }

  /** Notify all plugins of a tool result */
  notifyToolResult(name: string, result: ToolResult): void {
    for (const plugin of this.plugins) {
      if (plugin.onToolResult) {
        try {
          plugin.onToolResult(name, result);
        } catch { /* don't let plugin errors disrupt flow */ }
      }
    }
  }

  /** Cleanup all plugins */
  async destroy(): Promise<void> {
    for (const plugin of this.plugins) {
      if (plugin.destroy) {
        try {
          await plugin.destroy();
        } catch { /* ignore cleanup errors */ }
      }
    }
    this.plugins = [];
  }

  /** Get list of loaded plugins */
  getLoadedPlugins(): ReadonlyArray<{ name: string }> {
    return this.plugins.map((p) => ({ name: p.name }));
  }

  /** Check if any plugins are loaded */
  hasPlugins(): boolean {
    return this.plugins.length > 0;
  }
}
