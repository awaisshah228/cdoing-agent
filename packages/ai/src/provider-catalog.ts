/**
 * Provider Catalog — Single source of truth for all provider & model data.
 *
 * Every UI (CLI, TUI, VS Code, OpenTUI) imports from here instead of
 * maintaining its own hardcoded copy.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export interface ModelEntry {
  id: string;
  label: string;
  hint?: string;
  group?: string;
}

export interface ProviderEntry {
  id: string;
  label: string;
  hint: string;
  group?: string;
  keyUrl?: string;
  envVar?: string;
  supportsOAuth: boolean;
  models: ModelEntry[];
}

export interface CustomProviderEntry {
  id: string;
  label: string;
  hint: string;
  group?: string;
  baseUrl: string;
  models: ModelEntry[];
}

// ── Main providers ───────────────────────────────────────────────────────────

const PROVIDERS: ProviderEntry[] = [
  {
    id: "anthropic",
    label: "Anthropic (Claude)",
    hint: "Sonnet, Opus, Haiku",
    group: "Cloud Providers",
    keyUrl: "https://console.anthropic.com/settings/keys",
    envVar: "ANTHROPIC_API_KEY",
    supportsOAuth: true,
    models: [
      { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", hint: "recommended · fast & smart", group: "Claude 4" },
      { id: "claude-opus-4-6", label: "Claude Opus 4.6", hint: "most capable", group: "Claude 4" },
      { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", hint: "fastest · cheapest", group: "Claude 4" },
      { id: "claude-sonnet-4-20250514", label: "Claude Sonnet 4", hint: "previous gen", group: "Claude 3.5/4" },
      { id: "claude-3-5-sonnet-20241022", label: "Claude 3.5 Sonnet", hint: "legacy", group: "Claude 3.5/4" },
      { id: "claude-3-5-haiku-20241022", label: "Claude 3.5 Haiku", hint: "legacy fast", group: "Claude 3.5/4" },
    ],
  },
  {
    id: "openai",
    label: "OpenAI",
    hint: "GPT-4o, o3, o4",
    group: "Cloud Providers",
    keyUrl: "https://platform.openai.com/api-keys",
    envVar: "OPENAI_API_KEY",
    supportsOAuth: false,
    models: [
      { id: "gpt-4o", label: "GPT-4o", hint: "recommended · vision", group: "GPT-4" },
      { id: "gpt-4o-mini", label: "GPT-4o Mini", hint: "fast & cheap", group: "GPT-4" },
      { id: "gpt-4-turbo", label: "GPT-4 Turbo", hint: "128K context", group: "GPT-4" },
      { id: "o3-mini", label: "o3 Mini", hint: "reasoning", group: "Reasoning" },
      { id: "o3", label: "o3", hint: "advanced reasoning", group: "Reasoning" },
      { id: "o4-mini", label: "o4 Mini", hint: "latest reasoning", group: "Reasoning" },
      { id: "gpt-4.1", label: "GPT-4.1", hint: "latest", group: "GPT-4" },
      { id: "gpt-4.1-mini", label: "GPT-4.1 Mini", hint: "latest fast", group: "GPT-4" },
      { id: "gpt-4.1-nano", label: "GPT-4.1 Nano", hint: "ultra fast", group: "GPT-4" },
    ],
  },
  {
    id: "openai-codex",
    label: "OpenAI Codex",
    hint: "free via ChatGPT login",
    group: "Cloud Providers",
    keyUrl: "https://chatgpt.com",
    envVar: "OPENAI_API_KEY",
    supportsOAuth: true,
    models: [
      { id: "gpt-5.1-codex", label: "GPT-5.1 Codex", hint: "recommended", group: "Codex" },
      { id: "gpt-5.1-codex-max", label: "GPT-5.1 Codex Max", hint: "most capable", group: "Codex" },
      { id: "gpt-5.1-codex-mini", label: "GPT-5.1 Codex Mini", hint: "fast", group: "Codex" },
      { id: "gpt-5.2-codex", label: "GPT-5.2 Codex", hint: "latest", group: "Codex" },
      { id: "gpt-5.3-codex", label: "GPT-5.3 Codex", hint: "latest", group: "Codex" },
      { id: "gpt-5.2", label: "GPT-5.2", hint: "general", group: "GPT-5" },
      { id: "gpt-5.4", label: "GPT-5.4", hint: "newest", group: "GPT-5" },
    ],
  },
  {
    id: "google",
    label: "Google (Gemini)",
    hint: "Flash, Pro",
    group: "Cloud Providers",
    keyUrl: "https://aistudio.google.com/apikey",
    envVar: "GOOGLE_API_KEY",
    supportsOAuth: true,
    models: [
      { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", hint: "recommended · fast", group: "Gemini 2" },
      { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", hint: "most capable", group: "Gemini 2" },
      { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash", hint: "stable", group: "Gemini 2" },
      { id: "gemini-1.5-pro", label: "Gemini 1.5 Pro", hint: "1M context", group: "Gemini 1.5" },
      { id: "gemini-1.5-flash", label: "Gemini 1.5 Flash", hint: "fast", group: "Gemini 1.5" },
    ],
  },
  {
    id: "github-copilot",
    label: "GitHub Copilot",
    hint: "free via GitHub login",
    group: "Cloud Providers",
    keyUrl: "https://github.com/settings/copilot",
    supportsOAuth: true,
    models: [
      { id: "claude-sonnet-4", label: "Claude Sonnet 4", hint: "recommended" },
      { id: "gpt-4o", label: "GPT-4o", hint: "OpenAI" },
      { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", hint: "Google" },
      { id: "gpt-4.1", label: "GPT-4.1", hint: "latest" },
    ],
  },
  {
    id: "google-vertex",
    label: "Google Vertex AI",
    hint: "enterprise",
    group: "Cloud Providers",
    keyUrl: "https://console.cloud.google.com/apis/credentials",
    supportsOAuth: false,
    models: [
      { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash", hint: "recommended" },
      { id: "gemini-1.5-pro", label: "Gemini 1.5 Pro", hint: "1M context" },
    ],
  },
  {
    id: "ollama",
    label: "Ollama (Local)",
    hint: "free · runs locally",
    group: "Self-Hosted & Routers",
    keyUrl: "https://ollama.ai",
    supportsOAuth: false,
    models: [
      { id: "llama3.1", label: "Llama 3.1", hint: "general", group: "General" },
      { id: "llama3.1:70b", label: "Llama 3.1 70B", hint: "capable", group: "General" },
      { id: "codellama", label: "Code Llama", hint: "code", group: "Code" },
      { id: "mistral", label: "Mistral 7B", hint: "fast", group: "General" },
      { id: "qwen2.5-coder", label: "Qwen 2.5 Coder", hint: "code", group: "Code" },
      { id: "phi3", label: "Phi-3", hint: "small · fast", group: "General" },
    ],
  },
];

// ── Custom / third-party providers ───────────────────────────────────────────

const CUSTOM_PROVIDERS: CustomProviderEntry[] = [
  {
    id: "openrouter", label: "OpenRouter", hint: "openrouter.ai", group: "Routers",
    baseUrl: "https://openrouter.ai/api/v1",
    models: [
      { id: "anthropic/claude-sonnet-4", label: "Claude Sonnet 4", hint: "Anthropic", group: "Popular" },
      { id: "anthropic/claude-haiku-4", label: "Claude Haiku 4", hint: "Anthropic · fast", group: "Popular" },
      { id: "openai/gpt-4o", label: "GPT-4o", hint: "OpenAI", group: "Popular" },
      { id: "google/gemini-2.0-flash", label: "Gemini 2.0 Flash", hint: "Google", group: "Popular" },
      { id: "meta-llama/llama-4-maverick", label: "Llama 4 Maverick", hint: "open source", group: "Open Source" },
      { id: "deepseek/deepseek-r1", label: "DeepSeek R1", hint: "reasoning", group: "Open Source" },
      { id: "mistralai/mistral-large-latest", label: "Mistral Large", hint: "Mistral", group: "Open Source" },
      { id: "qwen/qwen-2.5-coder-32b", label: "Qwen 2.5 Coder 32B", hint: "code", group: "Open Source" },
    ],
  },
  {
    id: "lmstudio", label: "LM Studio", hint: "localhost:1234", group: "Local",
    baseUrl: "http://localhost:1234/v1",
    models: [
      { id: "llama-3.1-8b", label: "Llama 3.1 8B", hint: "general" },
      { id: "codellama-13b", label: "Code Llama 13B", hint: "code" },
      { id: "mistral-7b", label: "Mistral 7B", hint: "fast" },
    ],
  },
  {
    id: "groq", label: "Groq", hint: "groq.com · ultra fast", group: "Cloud",
    baseUrl: "https://api.groq.com/openai/v1",
    models: [
      { id: "llama-3.3-70b-versatile", label: "Llama 3.3 70B", hint: "fast inference" },
      { id: "llama-3.1-8b-instant", label: "Llama 3.1 8B", hint: "instant" },
      { id: "mixtral-8x7b-32768", label: "Mixtral 8x7B", hint: "32K context" },
      { id: "gemma2-9b-it", label: "Gemma 2 9B", hint: "fast" },
    ],
  },
  {
    id: "together", label: "Together AI", hint: "together.ai", group: "Cloud",
    baseUrl: "https://api.together.xyz/v1",
    models: [
      { id: "meta-llama/Llama-3.1-70B-Instruct", label: "Llama 3.1 70B", hint: "capable" },
      { id: "meta-llama/Llama-3.1-8B-Instruct", label: "Llama 3.1 8B", hint: "fast" },
      { id: "deepseek-ai/DeepSeek-R1", label: "DeepSeek R1", hint: "reasoning" },
      { id: "Qwen/Qwen2.5-Coder-32B-Instruct", label: "Qwen 2.5 Coder 32B", hint: "code" },
    ],
  },
  {
    id: "fireworks", label: "Fireworks AI", hint: "fireworks.ai", group: "Cloud",
    baseUrl: "https://api.fireworks.ai/inference/v1",
    models: [],
  },
  {
    id: "deepseek", label: "DeepSeek", hint: "deepseek.com", group: "Cloud",
    baseUrl: "https://api.deepseek.com/v1",
    models: [
      { id: "deepseek-chat", label: "DeepSeek Chat", hint: "general" },
      { id: "deepseek-coder", label: "DeepSeek Coder", hint: "code" },
      { id: "deepseek-reasoner", label: "DeepSeek Reasoner", hint: "reasoning (R1)" },
    ],
  },
  {
    id: "mistral", label: "Mistral AI", hint: "mistral.ai", group: "Cloud",
    baseUrl: "https://api.mistral.ai/v1",
    models: [
      { id: "mistral-large-latest", label: "Mistral Large", hint: "most capable" },
      { id: "mistral-medium-latest", label: "Mistral Medium", hint: "balanced" },
      { id: "mistral-small-latest", label: "Mistral Small", hint: "fast" },
      { id: "codestral-latest", label: "Codestral", hint: "code" },
    ],
  },
  {
    id: "xai", label: "xAI (Grok)", hint: "x.ai", group: "Cloud",
    baseUrl: "https://api.x.ai/v1",
    models: [
      { id: "grok-3", label: "Grok 3", hint: "most capable" },
      { id: "grok-3-mini", label: "Grok 3 Mini", hint: "fast" },
    ],
  },
  {
    id: "perplexity", label: "Perplexity", hint: "perplexity.ai", group: "Cloud",
    baseUrl: "https://api.perplexity.ai",
    models: [],
  },
  {
    id: "cohere", label: "Cohere", hint: "cohere.com", group: "Cloud",
    baseUrl: "https://api.cohere.ai/v1",
    models: [],
  },
  {
    id: "anyscale", label: "Anyscale", hint: "anyscale.com", group: "Cloud",
    baseUrl: "https://api.endpoints.anyscale.com/v1",
    models: [],
  },
];

// ── Default models per provider ──────────────────────────────────────────────

const DEFAULT_MODELS_MAP: Record<string, string> = {
  anthropic: "claude-sonnet-4-6",
  openai: "gpt-4o",
  "openai-codex": "gpt-5.1-codex",
  google: "gemini-2.5-flash",
  "github-copilot": "claude-sonnet-4",
  "google-vertex": "gemini-2.0-flash",
  ollama: "llama3.1",
};

// ── Public API ───────────────────────────────────────────────────────────────

/** Get all main providers. */
export function getProviders(): ProviderEntry[] {
  return PROVIDERS;
}

/** Get a specific provider by id. */
export function getProvider(id: string): ProviderEntry | undefined {
  return PROVIDERS.find((p) => p.id === id.toLowerCase());
}

/** Get models for a provider (returns empty array if unknown). */
export function getModelsForProvider(providerId: string): ModelEntry[] {
  return getProvider(providerId)?.models || [];
}

/** Get the default model for a provider. */
export function getDefaultModelForProvider(providerId: string): string | undefined {
  return DEFAULT_MODELS_MAP[providerId.toLowerCase()];
}

/** Get all custom/third-party providers. */
export function getCustomProviders(): CustomProviderEntry[] {
  return CUSTOM_PROVIDERS;
}

/** Get a specific custom provider by id. */
export function getCustomProvider(id: string): CustomProviderEntry | undefined {
  return CUSTOM_PROVIDERS.find((p) => p.id === id.toLowerCase());
}

/** Get models for a custom provider. */
export function getCustomProviderModels(providerId: string): ModelEntry[] {
  return getCustomProvider(providerId)?.models || [];
}

/** Get the base URL for a custom provider. */
export function getCustomProviderBaseUrl(providerId: string): string | undefined {
  return getCustomProvider(providerId)?.baseUrl;
}

/**
 * Search models across all providers (main + custom) by query.
 * Useful for autocomplete / fuzzy search.
 */
export function searchModels(query: string): Array<ModelEntry & { provider: string }> {
  const q = query.toLowerCase();
  const results: Array<ModelEntry & { provider: string }> = [];
  for (const p of PROVIDERS) {
    for (const m of p.models) {
      if (
        m.id.toLowerCase().includes(q) ||
        m.label.toLowerCase().includes(q) ||
        (m.hint && m.hint.toLowerCase().includes(q))
      ) {
        results.push({ ...m, provider: p.id });
      }
    }
  }
  for (const p of CUSTOM_PROVIDERS) {
    for (const m of p.models) {
      if (
        m.id.toLowerCase().includes(q) ||
        m.label.toLowerCase().includes(q) ||
        (m.hint && m.hint.toLowerCase().includes(q))
      ) {
        results.push({ ...m, provider: p.id });
      }
    }
  }
  return results;
}

/**
 * Get all model IDs for a provider (flat list, useful for validation).
 */
export function getModelIds(providerId: string): string[] {
  return getModelsForProvider(providerId).map((m) => m.id);
}
