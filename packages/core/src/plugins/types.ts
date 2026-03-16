/**
 * Plugin System Types — extensibility hooks for cdoing-agent.
 */

import type { ToolDefinition, ToolResult } from "../tools/types";

/** Context passed to plugins during initialization */
export interface PluginContext {
  workingDir: string;
  projectDir?: string;
}

/** Plugin interface — implement this to extend cdoing-agent */
export interface CdoingPlugin {
  /** Unique plugin name */
  name: string;

  /** Optional initialization (called once when plugin loads) */
  init?(context: PluginContext): Promise<void>;

  /** Transform tool definitions before they're sent to the LLM */
  transformTools?(tools: ToolDefinition[]): ToolDefinition[];

  /** Transform the system prompt before it's sent to the LLM */
  transformSystemPrompt?(prompt: string): string;

  /** Called before a tool is executed */
  onToolCall?(name: string, input: Record<string, unknown>): void;

  /** Called after a tool is executed */
  onToolResult?(name: string, result: ToolResult): void;

  /** Optional cleanup when plugin is unloaded */
  destroy?(): Promise<void>;
}
