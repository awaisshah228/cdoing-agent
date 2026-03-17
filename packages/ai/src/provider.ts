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
import { getOAuthProvider } from "@cdoing/core";

export enum ModelProvider {
  ANTHROPIC = "anthropic",
  OPENAI = "openai",
  GOOGLE = "google",
  OLLAMA = "ollama",
  AZURE = "azure",
  BEDROCK = "bedrock",
  GITHUB_COPILOT = "github-copilot",
  GOOGLE_VERTEX = "google-vertex",
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
  defaultHeaders?: Record<string, string>;
  extraBodyProperties?: Record<string, unknown>;
}

const DEFAULT_MODELS: Record<string, string> = {
  [ModelProvider.ANTHROPIC]: "claude-sonnet-4-6",
  [ModelProvider.OPENAI]: "gpt-4o",
  [ModelProvider.GOOGLE]: "gemini-2.0-flash",
  [ModelProvider.OLLAMA]: "llama3.1",
  [ModelProvider.GITHUB_COPILOT]: "gpt-4o",
  [ModelProvider.GOOGLE_VERTEX]: "gemini-2.0-flash",
};

const customProviders = new Map<string, CustomProviderConfig>();

export function registerCustomProvider(config: CustomProviderConfig): void {
  customProviders.set(config.name.toLowerCase(), config);
  DEFAULT_MODELS[config.name.toLowerCase()] = config.defaultModel;
}

// ── Context window sizes per provider/model ──────────────────────────────────

const CONTEXT_WINDOWS: Record<string, number> = {
  // Built-in providers
  anthropic: 200_000,
  openai: 128_000,
  google: 1_000_000,
  ollama: 32_000,
  azure: 128_000,
  bedrock: 200_000,
  "github-copilot": 128_000,
  "google-vertex": 1_000_000,
  // Registered providers
  openrouter: 200_000,
  mistral: 128_000,
  xai: 131_072,
  groq: 128_000,
  deepinfra: 128_000,
  together: 128_000,
  perplexity: 128_000,
  github: 128_000,
  cerebras: 128_000,
  cohere: 128_000,
};

/** Get context window size for a provider */
export function getContextWindow(provider: string, _model?: string): number {
  return CONTEXT_WINDOWS[provider.toLowerCase()] || 128_000;
}

// ── Built-in provider registrations ──────────────────────────────────────────
// These are all OpenAI-compatible endpoints, registered via registerCustomProvider.

function registerBuiltinProviders(): void {
  const builtins: CustomProviderConfig[] = [
    { name: "openrouter", baseURL: "https://openrouter.ai/api/v1", apiKeyEnvVar: "OPENROUTER_API_KEY", defaultModel: "anthropic/claude-sonnet-4", defaultHeaders: { "HTTP-Referer": "https://github.com/awaisshah228/cdoing-agent", "X-Title": "Cdoing Agent" } },
    { name: "mistral", baseURL: "https://api.mistral.ai/v1", apiKeyEnvVar: "MISTRAL_API_KEY", defaultModel: "mistral-large-latest" },
    { name: "xai", baseURL: "https://api.x.ai/v1", apiKeyEnvVar: "XAI_API_KEY", defaultModel: "grok-3" },
    { name: "groq", baseURL: "https://api.groq.com/openai/v1", apiKeyEnvVar: "GROQ_API_KEY", defaultModel: "llama-3.3-70b-versatile" },
    { name: "deepinfra", baseURL: "https://api.deepinfra.com/v1/openai", apiKeyEnvVar: "DEEPINFRA_API_KEY", defaultModel: "meta-llama/Llama-3.3-70B-Instruct" },
    { name: "together", baseURL: "https://api.together.xyz/v1", apiKeyEnvVar: "TOGETHER_API_KEY", defaultModel: "meta-llama/Llama-3.3-70B-Instruct-Turbo" },
    { name: "perplexity", baseURL: "https://api.perplexity.ai", apiKeyEnvVar: "PERPLEXITY_API_KEY", defaultModel: "sonar-pro" },
    { name: "github", baseURL: "https://models.inference.ai.azure.com", apiKeyEnvVar: "GITHUB_TOKEN", defaultModel: "gpt-4o" },
    { name: "cerebras", baseURL: "https://api.cerebras.ai/v1", apiKeyEnvVar: "CEREBRAS_API_KEY", defaultModel: "llama-3.3-70b" },
    { name: "cohere", baseURL: "https://api.cohere.com/v2", apiKeyEnvVar: "COHERE_API_KEY", defaultModel: "command-r-plus" },
  ];

  for (const config of builtins) {
    registerCustomProvider(config);
  }
}

// Register built-in providers at module load
registerBuiltinProviders();

export function getRegisteredProviders(): string[] {
  return [ModelProvider.ANTHROPIC, ModelProvider.OPENAI, ModelProvider.GOOGLE, ModelProvider.OLLAMA, ModelProvider.GITHUB_COPILOT, ModelProvider.GOOGLE_VERTEX, ...Array.from(customProviders.keys())];
}

export function getDefaultModel(provider: string): string | undefined {
  return DEFAULT_MODELS[provider.toLowerCase()];
}

/** Provider catalog entry — everything UI needs to render provider/model selection */
export interface ProviderCatalogEntry {
  id: string;
  label: string;
  hint: string;
  keyUrl?: string;
  models: Array<{ value: string; label: string; hint?: string }>;
  supportsOAuth: boolean;
}

/** Get the full provider catalog for UI rendering (CLI, TUI, VS Code) */
export function getProviderCatalog(): ProviderCatalogEntry[] {
  return [
    {
      id: "anthropic", label: "Anthropic (Claude)", hint: "Sonnet, Opus, Haiku",
      keyUrl: "https://console.anthropic.com/settings/keys",
      supportsOAuth: true,
      models: [
        { value: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", hint: "recommended · fast & smart" },
        { value: "claude-opus-4-6", label: "Claude Opus 4.6", hint: "most capable" },
        { value: "claude-haiku-4-5", label: "Claude Haiku 4.5", hint: "fastest · cheapest" },
      ],
    },
    {
      id: "openai", label: "OpenAI", hint: "GPT-4o, o3, o4",
      keyUrl: "https://platform.openai.com/api-keys",
      supportsOAuth: false,
      models: [
        { value: "gpt-4o", label: "GPT-4o", hint: "recommended · vision" },
        { value: "gpt-4o-mini", label: "GPT-4o Mini", hint: "fast & cheap" },
        { value: "o3-mini", label: "o3 Mini", hint: "reasoning" },
        { value: "gpt-4.1", label: "GPT-4.1", hint: "latest" },
      ],
    },
    {
      id: "openai-codex", label: "OpenAI Codex", hint: "free via ChatGPT login",
      keyUrl: "https://chatgpt.com",
      supportsOAuth: true,
      models: [
        { value: "gpt-5.1-codex", label: "GPT-5.1 Codex", hint: "recommended" },
        { value: "gpt-5.1-codex-max", label: "GPT-5.1 Codex Max", hint: "most capable" },
        { value: "gpt-5.1-codex-mini", label: "GPT-5.1 Codex Mini", hint: "fast" },
        { value: "gpt-5.2-codex", label: "GPT-5.2 Codex", hint: "latest" },
      ],
    },
    {
      id: "google", label: "Google (Gemini)", hint: "Flash, Pro",
      keyUrl: "https://aistudio.google.com/apikey",
      supportsOAuth: true,
      models: [
        { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash", hint: "recommended · fast" },
        { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro", hint: "most capable" },
        { value: "gemini-2.0-flash", label: "Gemini 2.0 Flash", hint: "stable" },
      ],
    },
    {
      id: "github-copilot", label: "GitHub Copilot", hint: "free via GitHub login",
      keyUrl: "https://github.com/settings/copilot",
      supportsOAuth: true,
      models: [
        { value: "claude-sonnet-4", label: "Claude Sonnet 4", hint: "recommended" },
        { value: "gpt-4o", label: "GPT-4o", hint: "OpenAI" },
        { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro", hint: "Google" },
        { value: "gpt-4.1", label: "GPT-4.1", hint: "latest" },
      ],
    },
    {
      id: "google-vertex", label: "Google Vertex AI", hint: "enterprise",
      keyUrl: "https://console.cloud.google.com/apis/credentials",
      supportsOAuth: false,
      models: [
        { value: "gemini-2.0-flash", label: "Gemini 2.0 Flash", hint: "recommended" },
        { value: "gemini-1.5-pro", label: "Gemini 1.5 Pro", hint: "1M context" },
      ],
    },
    {
      id: "ollama", label: "Ollama (Local)", hint: "free · runs locally",
      keyUrl: "https://ollama.ai",
      supportsOAuth: false,
      models: [
        { value: "llama3.1", label: "Llama 3.1", hint: "general" },
        { value: "codellama", label: "Code Llama", hint: "code" },
        { value: "mistral", label: "Mistral 7B", hint: "fast" },
        { value: "qwen2.5-coder", label: "Qwen 2.5 Coder", hint: "code" },
      ],
    },
  ];
}

export function getApiKeyEnvVar(provider: string): string {
  switch (provider.toLowerCase()) {
    case ModelProvider.ANTHROPIC: return "ANTHROPIC_API_KEY";
    case ModelProvider.OPENAI: return "OPENAI_API_KEY";
    case ModelProvider.GOOGLE: return "GOOGLE_API_KEY";
    case ModelProvider.OLLAMA: return "OLLAMA_API_KEY"; // not required, but for consistency
    case ModelProvider.AZURE: return "AZURE_OPENAI_API_KEY";
    case ModelProvider.BEDROCK: return "AWS_ACCESS_KEY_ID";
    case ModelProvider.GITHUB_COPILOT: return "GITHUB_COPILOT_TOKEN";
    case ModelProvider.GOOGLE_VERTEX: return "GOOGLE_APPLICATION_CREDENTIALS";
    default: {
      const custom = customProviders.get(provider.toLowerCase());
      return custom?.apiKeyEnvVar || `${provider.toUpperCase()}_API_KEY`;
    }
  }
}

/**
 * Resolve the actual model name and auth method that will be used for a given config.
 * Use this to display the correct model in the UI — no hardcoding needed.
 */
export function resolveModelInfo(config: Partial<ModelConfig> = {}): {
  provider: string;
  model: string;
  authMethod: "oauth" | "apiKey";
} {
  const provider = (config.provider || ModelProvider.ANTHROPIC).toString().toLowerCase();
  let model = config.model || DEFAULT_MODELS[provider] || "";
  let authMethod: "oauth" | "apiKey" = "apiKey";

  if (config.oauthToken) {
    // OAuth active — use the user-selected model if it's in the allowed OAuth models,
    // otherwise fall back to the provider's default OAuth model
    const oauthConfig = getOAuthProvider(provider);
    const allowedModels = oauthConfig?.models?.map(m => m.id) || [];
    if (config.model && allowedModels.includes(config.model)) {
      model = config.model; // User selected a valid OAuth model
    } else if (oauthConfig?.defaultModel) {
      model = oauthConfig.defaultModel;
    }
    authMethod = "oauth";
  } else {
    // Custom providers: resolve default model from registry
    const custom = customProviders.get(provider);
    if (!model && custom) {
      model = custom.defaultModel;
    }
  }

  return { provider, model, authMethod };
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
        // Use the user-selected OAuth model if it's in the allowed list, else default
        const oauthConfig = getOAuthProvider(provider);
        const allowedModels = oauthConfig?.models?.map(m => m.id) || [];
        const oauthModel = (modelName && allowedModels.includes(modelName))
          ? modelName
          : oauthConfig?.defaultModel || modelName;
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

    case ModelProvider.AZURE: {
      const endpoint = config.baseURL || process.env.AZURE_OPENAI_ENDPOINT;
      const deployment = process.env.AZURE_OPENAI_DEPLOYMENT || modelName;
      if (!endpoint) throw new Error("Azure OpenAI requires AZURE_OPENAI_ENDPOINT env var or baseURL in config");
      return new ChatOpenAI({
        model: deployment,
        openAIApiKey: config.apiKey || process.env.AZURE_OPENAI_API_KEY || "no-key-run-setup",
        temperature,
        maxTokens,
        configuration: {
          baseURL: `${endpoint.replace(/\/$/, "")}/openai/deployments/${deployment}`,
          defaultQuery: { "api-version": "2024-08-01-preview" },
        },
      });
    }

    case ModelProvider.BEDROCK: {
      // Amazon Bedrock via OpenAI-compatible gateway
      // Users should set up a Bedrock gateway or use LiteLLM proxy
      const bedrockURL = config.baseURL || process.env.BEDROCK_GATEWAY_URL;
      if (!bedrockURL) {
        throw new Error(
          "Amazon Bedrock requires a gateway URL. Set BEDROCK_GATEWAY_URL env var or baseURL in config. " +
          "Use LiteLLM proxy or AWS Bedrock Access Gateway for OpenAI-compatible access."
        );
      }

      // Auto-prefix region for cross-region inference if model doesn't already have it
      let bedrockModel = modelName || "anthropic.claude-sonnet-4-20250514-v1:0";
      const awsRegion = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1";
      if (bedrockModel.split(".").length <= 2 && !bedrockModel.startsWith("us.") && !bedrockModel.startsWith("eu.")) {
        // Prefix with region shorthand for cross-region inference
        const regionPrefix = awsRegion.startsWith("eu") ? "eu" : "us";
        bedrockModel = `${regionPrefix}.${bedrockModel}`;
      }

      return new ChatOpenAI({
        model: bedrockModel,
        openAIApiKey: config.apiKey || process.env.AWS_ACCESS_KEY_ID || "bedrock",
        temperature,
        maxTokens,
        configuration: { baseURL: bedrockURL },
      });
    }

    case ModelProvider.GITHUB_COPILOT: {
      // GitHub Copilot — uses GitHub's model inference endpoint
      // Token from GitHub Copilot CLI auth or GITHUB_COPILOT_TOKEN env var
      const copilotToken = config.apiKey || process.env.GITHUB_COPILOT_TOKEN || process.env.GITHUB_TOKEN;
      if (!copilotToken) {
        throw new Error(
          "GitHub Copilot requires authentication. Set GITHUB_COPILOT_TOKEN or GITHUB_TOKEN env var. " +
          "You can obtain a token via: gh auth token"
        );
      }
      const copilotBaseURL = config.baseURL || "https://api.githubcopilot.com";

      return new ChatOpenAI({
        model: modelName,
        openAIApiKey: copilotToken,
        temperature,
        maxTokens,
        configuration: {
          baseURL: copilotBaseURL,
          defaultHeaders: {
            "Editor-Version": "cdoing/1.0.0",
            "Copilot-Integration-Id": "cdoing-agent",
          },
        },
      });
    }

    case ModelProvider.GOOGLE_VERTEX: {
      // Google Vertex AI — uses service account or application default credentials
      // Requires GOOGLE_APPLICATION_CREDENTIALS or gcloud auth
      const vertexProject = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT;
      const vertexLocation = process.env.GOOGLE_CLOUD_LOCATION || "us-central1";

      if (!vertexProject) {
        throw new Error(
          "Google Vertex AI requires a project. Set GOOGLE_CLOUD_PROJECT env var. " +
          "Also set GOOGLE_APPLICATION_CREDENTIALS for service account auth, or run: gcloud auth application-default login"
        );
      }

      // Use Google GenAI with Vertex endpoint
      // For full Vertex AI with ADC/service accounts, users can set up a proxy
      // or use GOOGLE_API_KEY with the Vertex endpoint
      const vertexApiKey = config.apiKey || process.env.GOOGLE_API_KEY;
      if (!vertexApiKey) {
        throw new Error(
          "Google Vertex AI requires GOOGLE_API_KEY or --api-key flag. " +
          "For service account auth, use a proxy like litellm."
        );
      }

      return new ChatGoogleGenerativeAI({
        model: modelName,
        apiKey: vertexApiKey,
        temperature,
        maxOutputTokens: maxTokens,
        baseUrl: config.baseURL ||
          `https://${vertexLocation}-aiplatform.googleapis.com/v1/projects/${vertexProject}/locations/${vertexLocation}/publishers/google/models`,
      });
    }

    default: {
      const custom = customProviders.get(provider);
      const baseURL = config.baseURL || custom?.baseURL;
      if (!baseURL) throw new Error(`Custom provider "${provider}" requires a baseURL.`);
      const apiKeyEnv = custom?.apiKeyEnvVar || `${provider.toUpperCase()}_API_KEY`;
      const defaultHeaders = custom?.defaultHeaders;

      return new ChatOpenAI({
        model: modelName,
        openAIApiKey: config.apiKey || process.env[apiKeyEnv],
        temperature,
        maxTokens,
        configuration: {
          baseURL,
          ...(defaultHeaders ? { defaultHeaders } : {}),
        },
        ...(custom?.extraBodyProperties ? { modelKwargs: custom.extraBodyProperties } : {}),
      });
    }
  }
}
