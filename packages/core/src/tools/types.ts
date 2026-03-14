export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  requiresPermission: boolean;
  permissionMessage?: (input: Record<string, unknown>) => string;
}

export interface ToolResult {
  success: boolean;
  output: string;
  error?: string;
}

export interface BaseTool {
  definition: ToolDefinition;
  execute(input: Record<string, unknown>): Promise<ToolResult>;
}
