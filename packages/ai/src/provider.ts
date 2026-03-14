/**
 * provider.ts — Model Provider Factory
 *
 * Creates LangChain chat model instances for different AI providers.
 * Supports 3 built-in providers (Anthropic, OpenAI, Google) plus custom
 * providers that speak the OpenAI-compatible API (Ollama, Together, Groq, etc.)
 *
 * Usage:
 *   const model = createModel({ provider: "anthropic", model: "claude-sonnet-4-20250514" });
 *   const model = createModel({ provider: "custom", baseURL: "http://localhost:11434/v1", model: "llama3" });
 */

import { ChatAnthropic } from "@langchain/anthropic";
import { ChatOpenAI } from "@langchain/openai";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";

/** Built-in providers + a "custom" option for any OpenAI-compatible endpoint */
export enum ModelProvider {
  ANTHROPIC = "anthropic",
  OPENAI = "openai",
  GOOGLE = "google",
  CUSTOM = "custom",
}

/** Configuration for creating a model instance */
export interface ModelConfig {
  provider: ModelProvider | string;  // Built-in provider or custom provider name
  model: string;                     // Model ID (e.g. "claude-sonnet-4-20250514", "gpt-4o")
  apiKey?: string;                   // API key (overrides environment variable)
  temperature?: number;              // 0 = deterministic, higher = more creative
  maxTokens?: number;                // Max tokens in the response
  baseURL?: string;                  // Base URL for custom providers
}

/** Configuration for registering a custom provider */
export interface CustomProviderConfig {
  name: string;            // Provider name (e.g. "ollama", "together")
  apiKeyEnvVar?: string;   // Environment variable name for the API key
  baseURL: string;         // API endpoint (e.g. "http://localhost:11434/v1")
  defaultModel: string;    // Default model to use if none specified
}

/** Default model for each built-in provider */
const DEFAULT_MODELS: Record<string, string> = {
  [ModelProvider.ANTHROPIC]: "claude-sonnet-4-20250514",
  [ModelProvider.OPENAI]: "gpt-4o",
  [ModelProvider.GOOGLE]: "gemini-2.0-flash",
};

// Registry for custom providers — populated via registerCustomProvider()
const customProviders = new Map<string, CustomProviderConfig>();

/**
 * Register a custom AI provider (e.g. Ollama, Together, Groq).
 * Custom providers use the OpenAI-compatible API format.
 *
 * Example:
 *   registerCustomProvider({
 *     name: "ollama",
 *     baseURL: "http://localhost:11434/v1",
 *     defaultModel: "llama3",
 *   });
 */
export function registerCustomProvider(config: CustomProviderConfig): void {
  customProviders.set(config.name.toLowerCase(), config);
  DEFAULT_MODELS[config.name.toLowerCase()] = config.defaultModel;
}

/** Returns all available provider names (built-in + custom) */
export function getRegisteredProviders(): string[] {
  return [
    ModelProvider.ANTHROPIC,
    ModelProvider.OPENAI,
    ModelProvider.GOOGLE,
    ...Array.from(customProviders.keys()),
  ];
}

/** Returns the default model name for a provider, or undefined if not found */
export function getDefaultModel(provider: string): string | undefined {
  return DEFAULT_MODELS[provider.toLowerCase()];
}

/**
 * Returns the environment variable name for a provider's API key.
 * Built-in: ANTHROPIC_API_KEY, OPENAI_API_KEY, GOOGLE_API_KEY
 * Custom: uses the registered apiKeyEnvVar, or falls back to PROVIDER_API_KEY
 */
export function getApiKeyEnvVar(provider: string): string {
  switch (provider.toLowerCase()) {
    case ModelProvider.ANTHROPIC:
      return "ANTHROPIC_API_KEY";
    case ModelProvider.OPENAI:
      return "OPENAI_API_KEY";
    case ModelProvider.GOOGLE:
      return "GOOGLE_API_KEY";
    default: {
      const custom = customProviders.get(provider.toLowerCase());
      if (custom?.apiKeyEnvVar) return custom.apiKeyEnvVar;
      return `${provider.toUpperCase()}_API_KEY`;
    }
  }
}

/**
 * Creates a LangChain chat model instance based on the config.
 *
 * For built-in providers, creates the provider-specific class.
 * For custom providers, uses ChatOpenAI with a custom baseURL
 * (most self-hosted and third-party providers are OpenAI-compatible).
 */
export function createModel(config: Partial<ModelConfig> = {}) {
  const provider = (config.provider || ModelProvider.ANTHROPIC).toString().toLowerCase();
  const modelName = config.model || DEFAULT_MODELS[provider] || "";
  const temperature = config.temperature ?? 0;
  const maxTokens = config.maxTokens ?? 8096;

  switch (provider) {
    // Anthropic — Claude models
    case ModelProvider.ANTHROPIC:
      return new ChatAnthropic({
        model: modelName,
        anthropicApiKey: config.apiKey || process.env.ANTHROPIC_API_KEY,
        temperature,
        maxTokens,
      });

    // OpenAI — GPT models (also supports custom baseURL for Azure, etc.)
    case ModelProvider.OPENAI:
      return new ChatOpenAI({
        model: modelName,
        openAIApiKey: config.apiKey || process.env.OPENAI_API_KEY,
        temperature,
        maxTokens,
        configuration: config.baseURL ? { baseURL: config.baseURL } : undefined,
      });

    // Google — Gemini models
    case ModelProvider.GOOGLE:
      return new ChatGoogleGenerativeAI({
        model: modelName,
        apiKey: config.apiKey || process.env.GOOGLE_API_KEY,
        temperature,
        maxOutputTokens: maxTokens,
      });

    // Custom provider — uses OpenAI-compatible API format
    // Works with: Ollama, Together, Groq, LM Studio, vLLM, etc.
    default: {
      const custom = customProviders.get(provider);
      const baseURL = config.baseURL || custom?.baseURL;
      const apiKeyEnv = custom?.apiKeyEnvVar || `${provider.toUpperCase()}_API_KEY`;
      const apiKey = config.apiKey || process.env[apiKeyEnv];

      if (!baseURL) {
        throw new Error(
          `Custom provider "${provider}" requires a baseURL. ` +
          `Register it with registerCustomProvider() or pass baseURL in config.`
        );
      }

      return new ChatOpenAI({
        model: modelName,
        openAIApiKey: apiKey,
        temperature,
        maxTokens,
        configuration: { baseURL },
      });
    }
  }
}
