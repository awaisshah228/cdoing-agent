/**
 * @cdoing/ai — Public API
 *
 * Exports the AI agent runner and model provider utilities.
 * Used by both the CLI (@cdoing/cli) and the VS Code extension.
 */

// Model provider factory and utilities
export {
  ModelProvider,              // Enum: ANTHROPIC, OPENAI, GOOGLE, CUSTOM
  createModel,                // Creates a LangChain chat model from config
  registerCustomProvider,     // Register a custom OpenAI-compatible provider
  getRegisteredProviders,     // List all available provider names
  getDefaultModel,            // Get default model name for a provider
  getApiKeyEnvVar,            // Get env var name for a provider's API key
  type ModelConfig,           // Config interface for createModel()
  type CustomProviderConfig,  // Config interface for registerCustomProvider()
} from "./provider";

// Agent runner — the agentic loop that connects the LLM to tools
export { AgentRunner, type AgentCallbacks } from "./agent-runner";
