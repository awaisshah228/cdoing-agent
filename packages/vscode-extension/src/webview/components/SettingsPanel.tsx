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
import {
  getProviders,
  getCustomProviders,
  getDefaultModelForProvider,
  type ModelEntry,
} from "@cdoing/ai/provider-catalog";

interface SettingsPanelProps {
  config: ExtensionConfig | null;
  onSave: (config: Partial<ExtensionConfig>) => void;
  onOpenVscodeSettings: () => void;
  onClose: () => void;
}

interface OAuthModelInfo {
  id: string;
  name: string;
  hint?: string;
}

interface OAuthProviderInfo {
  id: string;
  name: string;
  defaultModel?: string;
  models?: OAuthModelInfo[];
}

// ── Build all UI data from centralized catalog ───────────────────────────────

const _providers = getProviders();
const _custom = getCustomProviders();

function modelToOption(m: ModelEntry): SelectOption {
  return { value: m.id, label: m.label, hint: m.hint, group: m.group };
}

const PROVIDER_OPTIONS: SelectOption[] = [
  ..._providers
    .filter((p) => p.id !== "ollama")
    .map((p) => ({ value: p.id, label: p.label, hint: p.hint, group: p.group || "Cloud Providers" })),
  { value: "custom", label: "Custom / Other", hint: "OpenRouter, Ollama, Groq, Together...", group: "Self-Hosted & Routers" },
];

const MODEL_OPTIONS: Record<string, SelectOption[]> = {};
for (const p of _providers) {
  MODEL_OPTIONS[p.id] = p.models.map(modelToOption);
}
// "custom" gets a merged list of all custom provider models
MODEL_OPTIONS["custom"] = _custom.flatMap((cp) =>
  cp.models.map((m) => ({ value: m.id, label: m.label, hint: m.hint || `via ${cp.label}`, group: cp.label }))
);

/** Custom provider presets with pre-filled base URLs */
const CUSTOM_PROVIDER_OPTIONS: SelectOption[] = _custom.map((cp) => ({
  value: cp.id,
  label: cp.label,
  hint: cp.hint,
  group: cp.group,
}));

const CUSTOM_PROVIDER_URLS: Record<string, string> = {};
for (const cp of _custom) {
  CUSTOM_PROVIDER_URLS[cp.id] = cp.baseUrl;
}

/** Models per custom provider (shown when that provider is selected) */
const CUSTOM_PROVIDER_MODELS: Record<string, SelectOption[]> = {};
for (const cp of _custom) {
  if (cp.models.length > 0) {
    CUSTOM_PROVIDER_MODELS[cp.id] = cp.models.map(modelToOption);
  }
}

const DEFAULT_MODELS: Record<string, string> = { custom: "" };
for (const p of _providers) {
  DEFAULT_MODELS[p.id] = getDefaultModelForProvider(p.id) || "";
}

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
      if (oauthStatus === "active" || config.authMethod === "oauth") {
        setAuthMethod("oauth");
        // Set model to OAuth provider's default if current model isn't an OAuth model
        const oauthProv = ((config as any).oauthProviders || []).find((p: OAuthProviderInfo) => p.id === (config.provider || "anthropic"));
        if (oauthProv?.defaultModel) {
          const oauthModelIds = (oauthProv.models || []).map((m: OAuthModelInfo) => m.id);
          if (!config.model || !oauthModelIds.includes(config.model)) {
            setModel(oauthProv.defaultModel);
          }
        }
      } else {
        setAuthMethod("apiKey");
      }
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
    if (oauthStatus === "active" && prevOauthRef.current !== "active") {
      setAuthMethod("oauth");
      // Auto-set model to OAuth default
      const oauthProv = oauthProviders.find((p) => p.id === provider);
      if (oauthProv?.defaultModel) {
        setModel(oauthProv.defaultModel);
      }
    }
    prevOauthRef.current = oauthStatus;
  }, [oauthStatus, oauthProviders, provider]);

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

  // Unsaved changes detection
  const hasUnsavedChanges = config ? (
    provider !== (config.provider || "anthropic") ||
    model !== (config.model || "") ||
    customProviderName !== (config.customProviderName || "") ||
    customBaseURL !== (config.customBaseURL || "") ||
    apiKey !== (config.apiKey || "") ||
    authMethod !== (config.authMethod || "apiKey") ||
    temperature !== (config.temperature ?? 0) ||
    maxTokens !== (config.maxTokens ?? 8096) ||
    permissionMode !== (config.permissionMode || "ask") ||
    sandboxEnabled !== (config.sandboxEnabled ?? false) ||
    sandboxMode !== (config.sandboxMode || "regular") ||
    indexerEmbeddingModel !== (config.indexerEmbeddingModel || "") ||
    indexerEmbeddingProvider !== (config.indexerEmbeddingProvider || "none") ||
    indexerEmbeddingBaseUrl !== (config.indexerEmbeddingBaseUrl || "") ||
    indexerAutoIndex !== (config.indexerAutoIndex ?? true)
  ) : false;

  // Derived
  const currentOAuthProvider = oauthProviders.find((p) => p.id === provider);
  const providerSupportsOAuth = !!currentOAuthProvider;
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
                  onClick={() => {
                    setAuthMethod("oauth");
                    // Auto-set model to OAuth provider's default
                    if (currentOAuthProvider?.defaultModel) {
                      setModel(currentOAuthProvider.defaultModel);
                    }
                  }}
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
                  {/* Model selector FIRST — user picks model, then logs in */}
                  {currentOAuthProvider?.models && currentOAuthProvider.models.length > 0 && (
                    <div className="oauth-model-select">
                      <label className="settings-label" style={{ fontSize: "11px" }}>Model</label>
                      {currentOAuthProvider.models.length === 1 ? (
                        <div className="settings-model-fixed">
                          {currentOAuthProvider.models[0].name}
                          {currentOAuthProvider.models[0].hint && (
                            <span style={{ opacity: 0.5, marginLeft: 6, fontSize: 10 }}>{currentOAuthProvider.models[0].hint}</span>
                          )}
                        </div>
                      ) : (
                        <SearchableSelect
                          value={model || currentOAuthProvider.defaultModel || ""}
                          options={currentOAuthProvider.models.map((m) => ({
                            value: m.id,
                            label: m.name,
                            hint: m.hint,
                          }))}
                          onChange={setModel}
                          placeholder="Search models..."
                          allowCustom={false}
                        />
                      )}
                    </div>
                  )}
                  {/* Status + login/logout below */}
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

          {/* ═══ Model (only shown for API Key auth — OAuth has its own model selector above) ═══ */}
          {!(authMethod === "oauth" && providerSupportsOAuth) && (
            <div className="settings-group">
              <label className="settings-label">Model</label>
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
            </div>
          )}

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

        {/* Unsaved changes banner */}
        {hasUnsavedChanges && (
          <div className="settings-unsaved-banner">
            <span className="settings-unsaved-dot" />
            <span>You have unsaved changes.</span>
            <button className="settings-unsaved-save-btn" onClick={handleSave}>Save to apply</button>
          </div>
        )}

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
