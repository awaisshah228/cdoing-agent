export type MessageRole = "user" | "assistant" | "system" | "tool" | "shell";

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

export interface ContextUsage {
  /** Current context input tokens (running total for this session) */
  inputTokens: number;
  /** Max tokens for the active model's context window */
  maxTokens: number;
  /** Percentage used (0–100) */
  percent: number;
}

export interface BackgroundJob {
  id: string;
  prompt: string;
  status: "running" | "done" | "error";
  result?: string;
  error?: string;
  startedAt: number;
  completedAt?: number;
}
