import { ChatAnthropic } from "@langchain/anthropic";
import { ChatOpenAI } from "@langchain/openai";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";

export enum ModelProvider {
  ANTHROPIC = "anthropic",
  OPENAI = "openai",
  GOOGLE = "google",
}

export interface ModelConfig {
  provider: ModelProvider;
  model: string;
  apiKey?: string;
  temperature?: number;
  maxTokens?: number;
}

const DEFAULT_MODELS: Record<ModelProvider, string> = {
  [ModelProvider.ANTHROPIC]: "claude-sonnet-4-20250514",
  [ModelProvider.OPENAI]: "gpt-4o",
  [ModelProvider.GOOGLE]: "gemini-2.0-flash",
};

export function createModel(config: Partial<ModelConfig> = {}) {
  const provider = config.provider || ModelProvider.ANTHROPIC;
  const modelName = config.model || DEFAULT_MODELS[provider];
  const temperature = config.temperature ?? 0;
  const maxTokens = config.maxTokens ?? 8096;

  switch (provider) {
    case ModelProvider.ANTHROPIC:
      return new ChatAnthropic({
        model: modelName,
        anthropicApiKey: config.apiKey || process.env.ANTHROPIC_API_KEY,
        temperature,
        maxTokens,
      });

    case ModelProvider.OPENAI:
      return new ChatOpenAI({
        model: modelName,
        openAIApiKey: config.apiKey || process.env.OPENAI_API_KEY,
        temperature,
        maxTokens,
      });

    case ModelProvider.GOOGLE:
      return new ChatGoogleGenerativeAI({
        model: modelName,
        apiKey: config.apiKey || process.env.GOOGLE_API_KEY,
        temperature,
        maxOutputTokens: maxTokens,
      });

    default:
      throw new Error(`Unsupported provider: ${provider}`);
  }
}
