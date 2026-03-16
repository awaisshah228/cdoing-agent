/** Schema for a tool the agent can call */
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>; // JSON Schema
  requiresPermission: boolean;
  permissionMessage?: (input: Record<string, unknown>) => string;
}

/** Result returned after executing a tool */
export interface ToolResult {
  success: boolean;
  output: string;
  error?: string;
}

/** Optional callback for tools that produce streaming output (e.g., shell commands) */
export type ToolProgressCallback = (chunk: string) => void;

/** Every tool implements this interface */
export interface BaseTool {
  definition: ToolDefinition;
  execute(input: Record<string, unknown>, onProgress?: ToolProgressCallback): Promise<ToolResult>;
}
