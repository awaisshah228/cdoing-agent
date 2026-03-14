/**
 * Model Provider Factory
 *
 * Creates LangChain chat model instances for Anthropic, OpenAI, Google,
 * or any custom OpenAI-compatible endpoint (Ollama, Groq, Together, etc.)
 */

import { ChatAnthropic } from "@langchain/anthropic";
import { ChatOpenAI } from "@langchain/openai";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";

export enum ModelProvider {
  ANTHROPIC = "anthropic",
  OPENAI = "openai",
  GOOGLE = "google",
  OLLAMA = "ollama",
  CUSTOM = "custom",
}

export interface ModelConfig {
  provider: ModelProvider | string;
  model: string;
  apiKey?: string;
  temperature?: number;
  maxTokens?: number;
  baseURL?: string;
}

export interface CustomProviderConfig {
  name: string;
  apiKeyEnvVar?: string;
  baseURL: string;
  defaultModel: string;
}

const DEFAULT_MODELS: Record<string, string> = {
  [ModelProvider.ANTHROPIC]: "claude-sonnet-4-20250514",
  [ModelProvider.OPENAI]: "gpt-4o",
  [ModelProvider.GOOGLE]: "gemini-2.0-flash",
  [ModelProvider.OLLAMA]: "llama3.1",
};

const customProviders = new Map<string, CustomProviderConfig>();

export function registerCustomProvider(config: CustomProviderConfig): void {
  customProviders.set(config.name.toLowerCase(), config);
  DEFAULT_MODELS[config.name.toLowerCase()] = config.defaultModel;
}

export function getRegisteredProviders(): string[] {
  return [ModelProvider.ANTHROPIC, ModelProvider.OPENAI, ModelProvider.GOOGLE, ModelProvider.OLLAMA, ...Array.from(customProviders.keys())];
}

export function getDefaultModel(provider: string): string | undefined {
  return DEFAULT_MODELS[provider.toLowerCase()];
}

export function getApiKeyEnvVar(provider: string): string {
  switch (provider.toLowerCase()) {
    case ModelProvider.ANTHROPIC: return "ANTHROPIC_API_KEY";
    case ModelProvider.OPENAI: return "OPENAI_API_KEY";
    case ModelProvider.GOOGLE: return "GOOGLE_API_KEY";
    case ModelProvider.OLLAMA: return "OLLAMA_API_KEY"; // not required, but for consistency
    default: {
      const custom = customProviders.get(provider.toLowerCase());
      return custom?.apiKeyEnvVar || `${provider.toUpperCase()}_API_KEY`;
    }
  }
}

export function createModel(config: Partial<ModelConfig> = {}) {
  const provider = (config.provider || ModelProvider.ANTHROPIC).toString().toLowerCase();
  const modelName = config.model || DEFAULT_MODELS[provider] || "";
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
        configuration: config.baseURL ? { baseURL: config.baseURL } : undefined,
      });

    case ModelProvider.GOOGLE:
      return new ChatGoogleGenerativeAI({
        model: modelName,
        apiKey: config.apiKey || process.env.GOOGLE_API_KEY,
        temperature,
        maxOutputTokens: maxTokens,
      });

    case ModelProvider.OLLAMA:
      return new ChatOpenAI({
        model: modelName,
        openAIApiKey: config.apiKey || process.env.OLLAMA_API_KEY || "ollama", // Ollama doesn't require a key
        temperature,
        maxTokens,
        configuration: {
          baseURL: config.baseURL || "http://localhost:11434/v1",
        },
      });

    default: {
      const custom = customProviders.get(provider);
      const baseURL = config.baseURL || custom?.baseURL;
      if (!baseURL) throw new Error(`Custom provider "${provider}" requires a baseURL.`);
      const apiKeyEnv = custom?.apiKeyEnvVar || `${provider.toUpperCase()}_API_KEY`;

      return new ChatOpenAI({
        model: modelName,
        openAIApiKey: config.apiKey || process.env[apiKeyEnv],
        temperature,
        maxTokens,
        configuration: { baseURL },
      });
    }
  }
}
