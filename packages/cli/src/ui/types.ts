export type MessageRole = "user" | "assistant" | "system" | "tool";

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  toolName?: string;
  isError?: boolean;
}

export interface ToolActivity {
  name: string;
  preview: string;
  status: "running" | "done" | "error";
}

export interface UsageInfo {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cost?: number;
}
