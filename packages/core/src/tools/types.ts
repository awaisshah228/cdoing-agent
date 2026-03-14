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

/** Every tool implements this interface */
export interface BaseTool {
  definition: ToolDefinition;
  execute(input: Record<string, unknown>): Promise<ToolResult>;
}
