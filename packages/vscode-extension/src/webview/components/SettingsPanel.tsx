/**
 * SettingsPanel.tsx — In-Panel Model & Config Settings
 *
 * Flow: Provider (searchable select) → Auth Method (tabs) → Model (searchable select with presets)
 * OAuth providers come from core (single source of truth).
 */

import React, { useState, useEffect, useCallback, useRef } from "react";
import type { ExtensionConfig } from "../types";
import { useVsCode } from "../hooks/useVsCode";
import { useChatStore } from "../store/chatStore";
import { SearchableSelect, type SelectOption } from "./SearchableSelect";

interface SettingsPanelProps {
  config: ExtensionConfig | null;
  onSave: (config: Partial<ExtensionConfig>) => void;
  onOpenVscodeSettings: () => void;
  onClose: () => void;
}

interface OAuthProviderInfo {
  id: string;
  name: string;
  defaultModel?: string;
}

const PROVIDER_OPTIONS: SelectOption[] = [
  { value: "anthropic", label: "Anthropic (Claude)", hint: "Sonnet, Opus, Haiku", group: "Cloud Providers" },
  { value: "openai", label: "OpenAI", hint: "GPT-4o, o3, o4", group: "Cloud Providers" },
  { value: "google", label: "Google (Gemini)", hint: "Flash, Pro", group: "Cloud Providers" },
  { value: "custom", label: "Custom / Other", hint: "OpenRouter, Ollama, Groq, Together...", group: "Self-Hosted & Routers" },
];

const MODEL_OPTIONS: Record<string, SelectOption[]> = {
  anthropic: [
    { value: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", hint: "recommended · fast & smart", group: "Claude 4" },
    { value: "claude-opus-4-6", label: "Claude Opus 4.6", hint: "most capable", group: "Claude 4" },
    { value: "claude-haiku-4-5", label: "Claude Haiku 4.5", hint: "fastest · cheapest", group: "Claude 4" },
    { value: "claude-sonnet-4-20250514", label: "Claude Sonnet 4", hint: "previous gen", group: "Claude 3.5/4" },
    { value: "claude-3-5-sonnet-20241022", label: "Claude 3.5 Sonnet", hint: "legacy", group: "Claude 3.5/4" },
    { value: "claude-3-5-haiku-20241022", label: "Claude 3.5 Haiku", hint: "legacy fast", group: "Claude 3.5/4" },
  ],
  openai: [
    { value: "gpt-4o", label: "GPT-4o", hint: "recommended · vision", group: "GPT-4" },
    { value: "gpt-4o-mini", label: "GPT-4o Mini", hint: "fast & cheap", group: "GPT-4" },
    { value: "gpt-4-turbo", label: "GPT-4 Turbo", hint: "128K context", group: "GPT-4" },
    { value: "o3-mini", label: "o3 Mini", hint: "reasoning", group: "Reasoning" },
    { value: "o3", label: "o3", hint: "advanced reasoning", group: "Reasoning" },
    { value: "o4-mini", label: "o4 Mini", hint: "latest reasoning", group: "Reasoning" },
    { value: "gpt-4.1", label: "GPT-4.1", hint: "latest", group: "GPT-4" },
    { value: "gpt-4.1-mini", label: "GPT-4.1 Mini", hint: "latest fast", group: "GPT-4" },
    { value: "gpt-4.1-nano", label: "GPT-4.1 Nano", hint: "ultra fast", group: "GPT-4" },
  ],
  google: [
    { value: "gemini-2.0-flash", label: "Gemini 2.0 Flash", hint: "recommended · fast", group: "Gemini 2" },
    { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro", hint: "most capable", group: "Gemini 2" },
    { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash", hint: "latest fast", group: "Gemini 2" },
    { value: "gemini-1.5-pro", label: "Gemini 1.5 Pro", hint: "1M context", group: "Gemini 1.5" },
    { value: "gemini-1.5-flash", label: "Gemini 1.5 Flash", hint: "fast", group: "Gemini 1.5" },
  ],
  custom: [
    // OpenRouter popular models
    { value: "anthropic/claude-sonnet-4", label: "Claude Sonnet 4", hint: "via OpenRouter", group: "OpenRouter" },
    { value: "anthropic/claude-haiku-4", label: "Claude Haiku 4", hint: "via OpenRouter", group: "OpenRouter" },
    { value: "openai/gpt-4o", label: "GPT-4o", hint: "via OpenRouter", group: "OpenRouter" },
    { value: "google/gemini-2.0-flash", label: "Gemini 2.0 Flash", hint: "via OpenRouter", group: "OpenRouter" },
    { value: "meta-llama/llama-4-maverick", label: "Llama 4 Maverick", hint: "open source", group: "OpenRouter" },
    { value: "deepseek/deepseek-r1", label: "DeepSeek R1", hint: "reasoning", group: "OpenRouter" },
    { value: "mistralai/mistral-large", label: "Mistral Large", hint: "capable", group: "OpenRouter" },
    // Ollama local models
    { value: "llama3.1", label: "Llama 3.1", hint: "local", group: "Ollama / Local" },
    { value: "llama3.1:70b", label: "Llama 3.1 70B", hint: "local · large", group: "Ollama / Local" },
    { value: "codellama", label: "Code Llama", hint: "local · code", group: "Ollama / Local" },
    { value: "mistral", label: "Mistral 7B", hint: "local · fast", group: "Ollama / Local" },
    { value: "deepseek-coder-v2", label: "DeepSeek Coder V2", hint: "local · code", group: "Ollama / Local" },
    { value: "qwen2.5-coder", label: "Qwen 2.5 Coder", hint: "local · code", group: "Ollama / Local" },
    // Groq
    { value: "llama-3.3-70b-versatile", label: "Llama 3.3 70B", hint: "via Groq · fast", group: "Groq" },
    { value: "mixtral-8x7b-32768", label: "Mixtral 8x7B", hint: "via Groq", group: "Groq" },
  ],
};

/** Custom provider presets with pre-filled base URLs */
const CUSTOM_PROVIDER_OPTIONS: SelectOption[] = [
  { value: "openrouter", label: "OpenRouter", hint: "openrouter.ai", group: "Routers" },
  { value: "ollama", label: "Ollama", hint: "localhost:11434", group: "Local" },
  { value: "lmstudio", label: "LM Studio", hint: "localhost:1234", group: "Local" },
  { value: "groq", label: "Groq", hint: "groq.com · ultra fast", group: "Cloud" },
  { value: "together", label: "Together AI", hint: "together.ai", group: "Cloud" },
  { value: "fireworks", label: "Fireworks AI", hint: "fireworks.ai", group: "Cloud" },
  { value: "deepseek", label: "DeepSeek", hint: "deepseek.com", group: "Cloud" },
  { value: "mistral", label: "Mistral AI", hint: "mistral.ai", group: "Cloud" },
  { value: "xai", label: "xAI (Grok)", hint: "x.ai", group: "Cloud" },
  { value: "perplexity", label: "Perplexity", hint: "perplexity.ai", group: "Cloud" },
  { value: "cohere", label: "Cohere", hint: "cohere.com", group: "Cloud" },
  { value: "anyscale", label: "Anyscale", hint: "anyscale.com", group: "Cloud" },
];

const CUSTOM_PROVIDER_URLS: Record<string, string> = {
  openrouter: "https://openrouter.ai/api/v1",
  ollama: "http://localhost:11434/v1",
  lmstudio: "http://localhost:1234/v1",
  groq: "https://api.groq.com/openai/v1",
  together: "https://api.together.xyz/v1",
  fireworks: "https://api.fireworks.ai/inference/v1",
  deepseek: "https://api.deepseek.com/v1",
  mistral: "https://api.mistral.ai/v1",
  xai: "https://api.x.ai/v1",
  perplexity: "https://api.perplexity.ai",
  cohere: "https://api.cohere.ai/v1",
  anyscale: "https://api.endpoints.anyscale.com/v1",
};

/** Models per custom provider (shown when that provider is selected) */
const CUSTOM_PROVIDER_MODELS: Record<string, SelectOption[]> = {
  openrouter: [
    { value: "anthropic/claude-sonnet-4", label: "Claude Sonnet 4", hint: "Anthropic", group: "Popular" },
    { value: "anthropic/claude-haiku-4", label: "Claude Haiku 4", hint: "Anthropic · fast", group: "Popular" },
    { value: "openai/gpt-4o", label: "GPT-4o", hint: "OpenAI", group: "Popular" },
    { value: "google/gemini-2.0-flash", label: "Gemini 2.0 Flash", hint: "Google", group: "Popular" },
    { value: "meta-llama/llama-4-maverick", label: "Llama 4 Maverick", hint: "open source", group: "Open Source" },
    { value: "deepseek/deepseek-r1", label: "DeepSeek R1", hint: "reasoning", group: "Open Source" },
    { value: "mistralai/mistral-large-latest", label: "Mistral Large", hint: "Mistral", group: "Open Source" },
    { value: "qwen/qwen-2.5-coder-32b", label: "Qwen 2.5 Coder 32B", hint: "code", group: "Open Source" },
  ],
  ollama: [
    { value: "llama3.1", label: "Llama 3.1 8B", hint: "general", group: "General" },
    { value: "llama3.1:70b", label: "Llama 3.1 70B", hint: "capable", group: "General" },
    { value: "codellama", label: "Code Llama", hint: "code", group: "Code" },
    { value: "deepseek-coder-v2", label: "DeepSeek Coder V2", hint: "code", group: "Code" },
    { value: "qwen2.5-coder", label: "Qwen 2.5 Coder", hint: "code", group: "Code" },
    { value: "mistral", label: "Mistral 7B", hint: "fast", group: "General" },
    { value: "mixtral", label: "Mixtral 8x7B", hint: "MoE", group: "General" },
    { value: "phi3", label: "Phi-3", hint: "small · fast", group: "General" },
    { value: "gemma2", label: "Gemma 2", hint: "Google", group: "General" },
  ],
  lmstudio: [
    { value: "llama-3.1-8b", label: "Llama 3.1 8B", hint: "general", group: "Models" },
    { value: "codellama-13b", label: "Code Llama 13B", hint: "code", group: "Models" },
    { value: "mistral-7b", label: "Mistral 7B", hint: "fast", group: "Models" },
  ],
  groq: [
    { value: "llama-3.3-70b-versatile", label: "Llama 3.3 70B", hint: "fast inference", group: "Models" },
    { value: "llama-3.1-8b-instant", label: "Llama 3.1 8B", hint: "instant", group: "Models" },
    { value: "mixtral-8x7b-32768", label: "Mixtral 8x7B", hint: "32K context", group: "Models" },
    { value: "gemma2-9b-it", label: "Gemma 2 9B", hint: "fast", group: "Models" },
  ],
  together: [
    { value: "meta-llama/Llama-3.1-70B-Instruct", label: "Llama 3.1 70B", hint: "capable", group: "Models" },
    { value: "meta-llama/Llama-3.1-8B-Instruct", label: "Llama 3.1 8B", hint: "fast", group: "Models" },
    { value: "deepseek-ai/DeepSeek-R1", label: "DeepSeek R1", hint: "reasoning", group: "Models" },
    { value: "Qwen/Qwen2.5-Coder-32B-Instruct", label: "Qwen 2.5 Coder 32B", hint: "code", group: "Models" },
  ],
  deepseek: [
    { value: "deepseek-chat", label: "DeepSeek Chat", hint: "general", group: "Models" },
    { value: "deepseek-coder", label: "DeepSeek Coder", hint: "code", group: "Models" },
    { value: "deepseek-reasoner", label: "DeepSeek Reasoner", hint: "reasoning (R1)", group: "Models" },
  ],
  mistral: [
    { value: "mistral-large-latest", label: "Mistral Large", hint: "most capable", group: "Models" },
    { value: "mistral-medium-latest", label: "Mistral Medium", hint: "balanced", group: "Models" },
    { value: "mistral-small-latest", label: "Mistral Small", hint: "fast", group: "Models" },
    { value: "codestral-latest", label: "Codestral", hint: "code", group: "Models" },
  ],
  xai: [
    { value: "grok-3", label: "Grok 3", hint: "most capable", group: "Models" },
    { value: "grok-3-mini", label: "Grok 3 Mini", hint: "fast", group: "Models" },
  ],
};

const DEFAULT_MODELS: Record<string, string> = {
  anthropic: "claude-sonnet-4-6",
  openai: "gpt-4o",
  google: "gemini-2.0-flash",
  custom: "",
};

const PERMISSION_MODES = [
  { value: "default", label: "Default", desc: "Prompt on first use of each tool" },
  { value: "acceptEdits", label: "Accept Edits", desc: "Auto-approve file edits, ask for shell" },
  { value: "plan", label: "Plan", desc: "Read-only: block all write and exec tools" },
  { value: "dontAsk", label: "Don't Ask", desc: "Deny all tools unless explicitly allowed" },
  { value: "bypassPermissions", label: "Bypass", desc: "Skip all permission checks (unsafe)" },
];

export const SettingsPanel: React.FC<SettingsPanelProps> = ({
  config,
  onSave,
  onOpenVscodeSettings,
  onClose,
}) => {
  const vscode = useVsCode();
  const oauthStatus = useChatStore((s) => s.oauthStatus);
  const oauthExpiresAt = useChatStore((s) => s.oauthExpiresAt);

  // Form state
  const [provider, setProvider] = useState("anthropic");
  const [model, setModel] = useState("");
  const [customProviderName, setCustomProviderName] = useState("");
  const [customBaseURL, setCustomBaseURL] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [authMethod, setAuthMethod] = useState(oauthStatus === "active" ? "oauth" : "apiKey");
  const [temperature, setTemperature] = useState(0);
  const [maxTokens, setMaxTokens] = useState(8096);
  const [permissionMode, setPermissionMode] = useState("ask");
  const [sandboxEnabled, setSandboxEnabled] = useState(false);
  const [sandboxMode, setSandboxMode] = useState("regular");
  const [indexerEmbeddingModel, setIndexerEmbeddingModel] = useState("");
  const [indexerEmbeddingProvider, setIndexerEmbeddingProvider] = useState("none");
  const [indexerEmbeddingBaseUrl, setIndexerEmbeddingBaseUrl] = useState("");
  const [indexerAutoIndex, setIndexerAutoIndex] = useState(true);
  const [hasConfigFileApiKey, setHasConfigFileApiKey] = useState(false);
  const [oauthProviders, setOauthProviders] = useState<OAuthProviderInfo[]>([]);

  const initializedRef = useRef(false);

  useEffect(() => {
    if (config && !initializedRef.current) {
      initializedRef.current = true;
      setProvider(config.provider || "anthropic");
      setModel(config.model || "");
      setCustomProviderName(config.customProviderName || "");
      setCustomBaseURL(config.customBaseURL || "");
      setApiKey(config.apiKey || "");
      setHasConfigFileApiKey(!!(config as any).hasConfigFileApiKey);
      setOauthProviders((config as any).oauthProviders || []);
      if (oauthStatus === "active") setAuthMethod("oauth");
      else if (config.authMethod === "oauth") setAuthMethod("oauth");
      else setAuthMethod("apiKey");
      setTemperature(config.temperature ?? 0);
      setMaxTokens(config.maxTokens ?? 8096);
      setPermissionMode(config.permissionMode || "ask");
      setSandboxEnabled(config.sandboxEnabled ?? false);
      setSandboxMode(config.sandboxMode || "regular");
      setIndexerEmbeddingModel(config.indexerEmbeddingModel || "");
      setIndexerEmbeddingProvider(config.indexerEmbeddingProvider || "none");
      setIndexerEmbeddingBaseUrl(config.indexerEmbeddingBaseUrl || "");
      setIndexerAutoIndex(config.indexerAutoIndex ?? true);
    }
  }, [config]); // eslint-disable-line react-hooks/exhaustive-deps

  const prevOauthRef = useRef(oauthStatus);
  useEffect(() => {
    if (oauthStatus === "active" && prevOauthRef.current !== "active") setAuthMethod("oauth");
    prevOauthRef.current = oauthStatus;
  }, [oauthStatus]);

  const handleStartOAuth = useCallback(() => {
    vscode.postMessage({ type: "startOAuth" } as any);
  }, [vscode]);

  const handleOAuthLogout = useCallback(() => {
    vscode.postMessage({ type: "oauthLogout" } as any);
  }, [vscode]);

  const handleFullLogout = useCallback(() => {
    setApiKey("");
    setHasConfigFileApiKey(false);
    vscode.postMessage({ type: "oauthLogout" } as any);
    vscode.postMessage({ type: "updateConfig", config: { apiKey: "" } } as any);
    setAuthMethod("apiKey");
  }, [vscode]);

  const handleSave = () => {
    onSave({
      provider, model, customProviderName, customBaseURL, apiKey, authMethod,
      temperature, maxTokens, permissionMode, sandboxEnabled, sandboxMode,
      indexerEmbeddingModel, indexerEmbeddingProvider, indexerEmbeddingBaseUrl, indexerAutoIndex,
    });
    onClose();
  };

  // Derived
  const currentOAuthProvider = oauthProviders.find((p) => p.id === provider);
  const providerSupportsOAuth = !!currentOAuthProvider;
  const isOAuthActive = providerSupportsOAuth && authMethod === "oauth" && oauthStatus === "active";
  // For custom providers, use provider-specific model list if available, else the generic custom list
  const modelOptions = provider === "custom" && customProviderName && CUSTOM_PROVIDER_MODELS[customProviderName]
    ? CUSTOM_PROVIDER_MODELS[customProviderName]
    : MODEL_OPTIONS[provider] || [];
  const apiKeyHint = apiKey
    ? "API key set in VS Code settings"
    : hasConfigFileApiKey
    ? "Using API key from ~/.cdoing/config.json"
    : "No API key set";

  return (
    <div className="settings-overlay">
      <div className="settings-panel">
        {/* ── Header ── */}
        <div className="settings-header">
          <span className="settings-title">Settings</span>
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            {(apiKey || hasConfigFileApiKey || oauthStatus === "active") && (
              <button className="settings-logout-btn" onClick={handleFullLogout} title="Clear all credentials">
                Logout
              </button>
            )}
            <button className="icon-btn" onClick={onClose} title="Close">&times;</button>
          </div>
        </div>

        <div className="settings-body">
          {/* ═══ Provider ═══ */}
          <div className="settings-group">
            <label className="settings-label">Provider</label>
            <SearchableSelect
              value={provider}
              options={PROVIDER_OPTIONS}
              onChange={(val) => {
                setProvider(val);
                const newOAuth = oauthProviders.find((p) => p.id === val);
                if (!newOAuth) setAuthMethod("apiKey");
              }}
              placeholder="Search providers..."
              allowCustom={false}
            />
          </div>

          {/* Custom provider fields */}
          {provider === "custom" && (
            <div className="settings-group settings-custom-provider">
              <div style={{ marginBottom: 8 }}>
                <label className="settings-label" style={{ fontSize: "11px" }}>Provider Name</label>
                <SearchableSelect
                  value={customProviderName}
                  options={CUSTOM_PROVIDER_OPTIONS}
                  onChange={(val) => {
                    setCustomProviderName(val);
                    // Auto-fill base URL if we have a preset
                    if (CUSTOM_PROVIDER_URLS[val]) {
                      setCustomBaseURL(CUSTOM_PROVIDER_URLS[val]);
                    }
                  }}
                  placeholder="Search providers (openrouter, ollama, groq...)"
                  allowCustom
                  customLabel="custom provider"
                />
              </div>
              <div>
                <label className="settings-label" style={{ fontSize: "11px" }}>Base URL</label>
                <input
                  className="settings-input"
                  value={customBaseURL}
                  onChange={(e) => setCustomBaseURL(e.target.value)}
                  placeholder="http://localhost:11434/v1"
                />
                {customProviderName && CUSTOM_PROVIDER_URLS[customProviderName] && customBaseURL === CUSTOM_PROVIDER_URLS[customProviderName] && (
                  <span className="settings-hint"><span style={{ color: "var(--success)" }}>●</span> Auto-filled for {customProviderName}</span>
                )}
              </div>
            </div>
          )}

          {/* ═══ Authentication ═══ */}
          <div className="settings-group">
            <label className="settings-label">Authentication</label>
            {providerSupportsOAuth ? (
              <div className="settings-auth-tabs">
                <button
                  className={`settings-auth-tab ${authMethod === "apiKey" ? "active" : ""}`}
                  onClick={() => setAuthMethod("apiKey")}
                >
                  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: 4, verticalAlign: -2 }}>
                    <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
                  </svg>
                  API Key
                </button>
                <button
                  className={`settings-auth-tab ${authMethod === "oauth" ? "active" : ""}`}
                  onClick={() => setAuthMethod("oauth")}
                >
                  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: 4, verticalAlign: -2 }}>
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                  </svg>
                  OAuth (Free)
                </button>
              </div>
            ) : null}

            <div className="settings-auth-content">
              {authMethod === "oauth" && providerSupportsOAuth ? (
                <div className="oauth-section">
                  <div className="oauth-status">
                    <span className={`oauth-status-dot oauth-status-${oauthStatus}`} />
                    <span className="oauth-status-text">
                      {oauthStatus === "active" && "Logged in"}
                      {oauthStatus === "expired" && "Session expired"}
                      {oauthStatus === "none" && "Not logged in"}
                    </span>
                    {oauthStatus === "active" && oauthExpiresAt && (
                      <span className="oauth-status-expires">
                        expires {new Date(oauthExpiresAt).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                  <div className="oauth-actions">
                    {oauthStatus === "active" ? (
                      <button className="oauth-btn oauth-btn-logout" onClick={handleOAuthLogout}>Logout</button>
                    ) : (
                      <button className="oauth-btn oauth-btn-login" onClick={handleStartOAuth}>
                        Login with {currentOAuthProvider?.name || provider}
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <>
                  <input
                    className="settings-input"
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder={hasConfigFileApiKey ? "Using key from config file" : "Enter API key"}
                  />
                  <span className="settings-hint">
                    {apiKey || hasConfigFileApiKey ? (
                      <><span style={{ color: "var(--success)" }}>●</span> {apiKeyHint}</>
                    ) : (
                      <><span style={{ color: "var(--desc-fg)" }}>○</span> {apiKeyHint}. Set one here or via env variable.</>
                    )}
                  </span>
                </>
              )}
            </div>
          </div>

          {/* ═══ Model ═══ */}
          <div className="settings-group">
            <label className="settings-label">Model</label>
            {isOAuthActive ? (
              <>
                <div className="settings-model-fixed">
                  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: 6, verticalAlign: -2, opacity: 0.5 }}>
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                  {currentOAuthProvider?.defaultModel || model || "—"}
                </div>
                <span className="settings-hint">
                  Model is determined by OAuth. Switch to API Key to choose freely.
                </span>
              </>
            ) : (
              <>
                <SearchableSelect
                  value={model}
                  options={modelOptions}
                  onChange={setModel}
                  placeholder={`Search models... (default: ${DEFAULT_MODELS[provider] || "auto"})`}
                  allowCustom
                  customLabel="custom model"
                />
                <span className="settings-hint">
                  {model
                    ? modelOptions.find((m) => m.value === model)
                      ? `Using ${model}`
                      : `Custom model: ${model}`
                    : `Default: ${DEFAULT_MODELS[provider] || "provider default"}`}
                </span>
              </>
            )}
          </div>

          {/* ═══ Permission Mode ═══ */}
          <div className="settings-group">
            <label className="settings-label">Permission Mode</label>
            <div className="settings-mode-grid">
              {PERMISSION_MODES.map((m) => (
                <button
                  key={m.value}
                  className={`settings-mode-btn ${permissionMode === m.value ? "active" : ""}`}
                  onClick={() => setPermissionMode(m.value)}
                  title={m.desc}
                >
                  <span className="settings-mode-label">{m.label}</span>
                  <span className="settings-mode-desc">{m.desc}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Sandbox */}
          <div className="settings-group">
            <label className="settings-label">Sandbox</label>
            <div className="settings-row" style={{ alignItems: "center", gap: "8px", marginBottom: "8px" }}>
              <input type="checkbox" id="sandbox-toggle" checked={sandboxEnabled} onChange={(e) => setSandboxEnabled(e.target.checked)} />
              <label htmlFor="sandbox-toggle" style={{ cursor: "pointer" }}>Enable Sandbox</label>
            </div>
            {sandboxEnabled && (
              <div className="settings-mode-grid">
                <button className={`settings-mode-btn ${sandboxMode === "auto-allow" ? "active" : ""}`} onClick={() => setSandboxMode("auto-allow")}>
                  <span className="settings-mode-label">Auto-allow</span>
                  <span className="settings-mode-desc">Auto-approve sandboxed commands</span>
                </button>
                <button className={`settings-mode-btn ${sandboxMode === "regular" ? "active" : ""}`} onClick={() => setSandboxMode("regular")}>
                  <span className="settings-mode-label">Regular</span>
                  <span className="settings-mode-desc">Enforce restrictions, still prompt</span>
                </button>
              </div>
            )}
            <span className="settings-hint">Restricts file and network access.</span>
          </div>

          {/* Codebase Indexer */}
          <div className="settings-group">
            <label className="settings-label">Codebase Indexer</label>
            <div className="settings-row" style={{ alignItems: "center", gap: "8px", marginBottom: "8px" }}>
              <input type="checkbox" id="indexer-auto" checked={indexerAutoIndex} onChange={(e) => setIndexerAutoIndex(e.target.checked)} />
              <label htmlFor="indexer-auto" style={{ cursor: "pointer" }}>Auto-index on startup</label>
            </div>
            <div className="settings-group" style={{ marginBottom: "8px" }}>
              <label className="settings-label" style={{ fontSize: "11px" }}>Embedding Provider</label>
              <div className="settings-provider-grid">
                {[{ value: "none", label: "None (FTS)" }, { value: "openai", label: "OpenAI" }, { value: "ollama", label: "Ollama" }].map((p) => (
                  <button key={p.value} className={`settings-provider-btn ${indexerEmbeddingProvider === p.value ? "active" : ""}`} onClick={() => setIndexerEmbeddingProvider(p.value)}>
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
            {indexerEmbeddingProvider !== "none" && (
              <>
                <div className="settings-group" style={{ marginBottom: "8px" }}>
                  <label className="settings-label" style={{ fontSize: "11px" }}>Embedding Model</label>
                  <input className="settings-input" value={indexerEmbeddingModel} onChange={(e) => setIndexerEmbeddingModel(e.target.value)} placeholder={indexerEmbeddingProvider === "openai" ? "text-embedding-3-small" : "nomic-embed-text"} />
                </div>
                {indexerEmbeddingProvider === "ollama" && (
                  <div className="settings-group" style={{ marginBottom: "8px" }}>
                    <label className="settings-label" style={{ fontSize: "11px" }}>Ollama Base URL</label>
                    <input className="settings-input" value={indexerEmbeddingBaseUrl} onChange={(e) => setIndexerEmbeddingBaseUrl(e.target.value)} placeholder="http://localhost:11434" />
                  </div>
                )}
              </>
            )}
            <span className="settings-hint">{indexerEmbeddingProvider === "none" ? "Full-text search only." : "Adds semantic search via embeddings."}</span>
          </div>

          {/* Temperature & Max Tokens */}
          <div className="settings-group settings-row">
            <div className="settings-row-item">
              <label className="settings-label">Temperature</label>
              <input className="settings-input settings-input-small" type="number" min={0} max={2} step={0.1} value={temperature} onChange={(e) => setTemperature(parseFloat(e.target.value) || 0)} />
            </div>
            <div className="settings-row-item">
              <label className="settings-label">Max Tokens</label>
              <input className="settings-input settings-input-small" type="number" min={100} max={200000} step={100} value={maxTokens} onChange={(e) => setMaxTokens(parseInt(e.target.value) || 8096)} />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="settings-footer">
          <button className="settings-vscode-btn" onClick={onOpenVscodeSettings}>VS Code Settings</button>
          <div className="settings-footer-right">
            <button className="settings-cancel-btn" onClick={onClose}>Cancel</button>
            <button className="settings-save-btn" onClick={handleSave}>Save</button>
          </div>
        </div>
      </div>
    </div>
  );
};
