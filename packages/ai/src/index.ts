export { AgentRunner, type AgentCallbacks, type AgentRunnerOptions, type ImageAttachment } from "./agent-runner";
export { buildSystemPrompt } from "./system-prompt";
export { ContextManager, type TokenUsage, type TurnUsage } from "./context-manager";
export {
  createModel,
  resolveModelInfo,
  getProviderCatalog,
  type ProviderCatalogEntry,
  registerCustomProvider,
  getApiKeyEnvVar,
  getDefaultModel,
  getRegisteredProviders,
  getContextWindow,
  ModelProvider,
  type ModelConfig,
  type CustomProviderConfig,
} from "./provider";

// Provider catalog — single source of truth for all provider/model data
export {
  getProviders,
  getProvider,
  getModelsForProvider,
  getDefaultModelForProvider,
  getCustomProviders,
  getCustomProvider,
  getCustomProviderModels,
  getCustomProviderBaseUrl,
  searchModels,
  getModelIds,
  type ModelEntry,
  type ProviderEntry,
  type CustomProviderEntry,
} from "./provider-catalog";
