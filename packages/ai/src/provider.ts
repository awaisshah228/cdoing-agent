/**
 * Model Provider Factory
 *
 * Creates LangChain chat model instances for Anthropic, OpenAI, Google,
 * or any custom OpenAI-compatible endpoint (Ollama, Groq, Together, etc.)
 */

import Anthropic from "@anthropic-ai/sdk";
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
  /** OAuth access token — used with Bearer auth + Anthropic beta headers */
  oauthToken?: string;
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
  [ModelProvider.ANTHROPIC]: "claude-sonnet-4-6",
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
    case ModelProvider.ANTHROPIC: {
      // OAuth token: use Bearer auth with Anthropic beta headers (not x-api-key)
      if (config.oauthToken) {
        const oauthToken = config.oauthToken;
        // OAuth only supports claude-haiku-4-5 — override model if needed
        const oauthModel = "claude-haiku-4-5-20251001";
        if (modelName !== oauthModel) {
          console.log(`[cdoing] OAuth only supports ${oauthModel}, overriding "${modelName}"`);
        }
        const arch = process.arch === "arm64" ? "arm64" : "x64";
        const osPlatform = process.platform === "darwin" ? "Darwin"
          : process.platform === "win32" ? "Windows" : "Linux";
        return new ChatAnthropic({
          model: oauthModel,
          anthropicApiKey: "unused",
          temperature,
          maxTokens,
          createClient: () => new Anthropic({
            apiKey: null as unknown as string,
            authToken: oauthToken,
            dangerouslyAllowBrowser: true,
            defaultHeaders: {
              "anthropic-beta": "oauth-2025-04-20,interleaved-thinking-2025-05-14",
              "user-agent": "claude-cli/2.1.7 (external, cli)",
              "x-app": "cli",
              "anthropic-dangerous-direct-browser-access": "true",
              "x-stainless-arch": arch,
              "x-stainless-lang": "js",
              "x-stainless-os": osPlatform,
              "x-stainless-package-version": "0.70.0",
              "x-stainless-runtime": "node",
              "x-stainless-runtime-version": process.version,
            },
            maxRetries: 0,
            // Strip top_p: -1 and temperature — OAuth API rejects LangChain defaults
            fetch: async (url: string | URL | Request, init?: RequestInit) => {
              if (init?.body && typeof init.body === "string") {
                try {
                  const body = JSON.parse(init.body);
                  if (body.top_p === -1) delete body.top_p;
                  if ("temperature" in body) delete body.temperature;
                  init = { ...init, body: JSON.stringify(body) };
                } catch {}
              }
              const resp = await fetch(url as string, init);
              if (!resp.ok) {
                const text = await resp.text();
                throw new Error(`API error ${resp.status}: ${text.substring(0, 200)}`);
              }
              return resp;
            },
          }),
        } as ConstructorParameters<typeof ChatAnthropic>[0]);
      }
      return new ChatAnthropic({
        model: modelName,
        // Fall back to a placeholder so the constructor doesn't throw when no key
        // is configured yet — the error will surface on the first actual API call
        // with a proper 401, which the TUI handles gracefully.
        anthropicApiKey: config.apiKey || process.env.ANTHROPIC_API_KEY || "no-key-run-setup",
        temperature,
        maxTokens,
        topP: undefined,
        invocationKwargs: { top_p: undefined },
      } as ConstructorParameters<typeof ChatAnthropic>[0]);
    }

    case ModelProvider.OPENAI:
      return new ChatOpenAI({
        model: modelName,
        openAIApiKey: config.apiKey || process.env.OPENAI_API_KEY || "no-key-run-setup",
        temperature,
        maxTokens,
        configuration: config.baseURL ? { baseURL: config.baseURL } : undefined,
      });

    case ModelProvider.GOOGLE:
      return new ChatGoogleGenerativeAI({
        model: modelName,
        apiKey: config.apiKey || process.env.GOOGLE_API_KEY || "no-key-run-setup",
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
