/**
 * SettingsPanel.tsx — In-Panel Model & Config Settings
 *
 * Local state initializes ONCE from fresh config (stale config is cleared on open).
 * OAuth status is read from Zustand store. Config-file API key detection included.
 */

import React, { useState, useEffect, useCallback, useRef } from "react";
import type { ExtensionConfig } from "../types";
import { useVsCode } from "../hooks/useVsCode";
import { useChatStore } from "../store/chatStore";

interface SettingsPanelProps {
  config: ExtensionConfig | null;
  onSave: (config: Partial<ExtensionConfig>) => void;
  onOpenVscodeSettings: () => void;
  onClose: () => void;
}

const PROVIDERS = [
  { value: "anthropic", label: "Anthropic (Claude)" },
  { value: "openai", label: "OpenAI (GPT)" },
  { value: "google", label: "Google (Gemini)" },
  { value: "custom", label: "Custom Provider" },
];

const DEFAULT_MODELS: Record<string, string> = {
  anthropic: "claude-sonnet-4-20250514",
  openai: "gpt-4o",
  google: "gemini-2.0-flash",
  custom: "",
};

const PERMISSION_MODES = [
  { value: "default",            label: "Default",         desc: "Prompt on first use of each tool" },
  { value: "acceptEdits",        label: "Accept Edits",    desc: "Auto-approve file edits, ask for shell" },
  { value: "plan",               label: "Plan",            desc: "Read-only: block all write and exec tools" },
  { value: "dontAsk",            label: "Don't Ask",       desc: "Deny all tools unless explicitly allowed" },
  { value: "bypassPermissions",  label: "Bypass",          desc: "Skip all permission checks (unsafe)" },
];

export const SettingsPanel: React.FC<SettingsPanelProps> = ({
  config,
  onSave,
  onOpenVscodeSettings,
  onClose,
}) => {
  const vscode = useVsCode();

  // OAuth status from store
  const oauthStatus = useChatStore((s) => s.oauthStatus);
  const oauthExpiresAt = useChatStore((s) => s.oauthExpiresAt);

  // Local form state — starts with defaults, populated from fresh config
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

  const initializedRef = useRef(false);

  // Initialize once from fresh config
  // Initialize form from fresh config (once)
  useEffect(() => {
    if (config && !initializedRef.current) {
      initializedRef.current = true;
      setProvider(config.provider || "anthropic");
      setModel(config.model || "");
      setCustomProviderName(config.customProviderName || "");
      setCustomBaseURL(config.customBaseURL || "");
      setApiKey(config.apiKey || "");
      setHasConfigFileApiKey(!!(config as any).hasConfigFileApiKey);
      // Auth method: prefer whatever is actually active
      if (oauthStatus === "active") {
        setAuthMethod("oauth");
      } else if (config.authMethod === "oauth") {
        setAuthMethod("oauth");
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

  // If oauthStatus arrives late (after config init), auto-switch to OAuth tab
  const prevOauthRef = useRef(oauthStatus);
  useEffect(() => {
    if (oauthStatus === "active" && prevOauthRef.current !== "active") {
      setAuthMethod("oauth");
    }
    prevOauthRef.current = oauthStatus;
  }, [oauthStatus]);

  const handleStartOAuth = useCallback(() => {
    vscode.postMessage({ type: "startOAuth" } as any);
  }, [vscode]);

  const handleOAuthLogout = useCallback(() => {
    vscode.postMessage({ type: "oauthLogout" } as any);
  }, [vscode]);

  const handleSave = () => {
    onSave({
      provider,
      model,
      customProviderName,
      customBaseURL,
      apiKey,
      authMethod,
      temperature,
      maxTokens,
      permissionMode,
      sandboxEnabled,
      sandboxMode,
      indexerEmbeddingModel,
      indexerEmbeddingProvider,
      indexerEmbeddingBaseUrl,
      indexerAutoIndex,
    });
    onClose();
  };

  // Determine API key status text for the hint
  const apiKeyHint = apiKey
    ? "API key set in VS Code settings"
    : hasConfigFileApiKey
    ? "Using API key from ~/.cdoing/config.json"
    : "No API key found. Set one here or in ~/.cdoing/config.json";

  return (
    <div className="settings-overlay">
      <div className="settings-panel">
        <div className="settings-header">
          <span className="settings-title">Settings</span>
          <button className="icon-btn" onClick={onClose} title="Close">&times;</button>
        </div>

        <div className="settings-body">
          {/* Provider */}
          <div className="settings-group">
            <label className="settings-label">Provider</label>
            <div className="settings-provider-grid">
              {PROVIDERS.map((p) => (
                <button
                  key={p.value}
                  className={`settings-provider-btn ${provider === p.value ? "active" : ""}`}
                  onClick={() => setProvider(p.value)}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* Custom provider fields */}
          {provider === "custom" && (
            <>
              <div className="settings-group">
                <label className="settings-label">Provider Name</label>
                <input
                  className="settings-input"
                  value={customProviderName}
                  onChange={(e) => setCustomProviderName(e.target.value)}
                  placeholder="e.g., ollama, together, groq"
                />
              </div>
              <div className="settings-group">
                <label className="settings-label">Base URL</label>
                <input
                  className="settings-input"
                  value={customBaseURL}
                  onChange={(e) => setCustomBaseURL(e.target.value)}
                  placeholder="http://localhost:11434/v1"
                />
              </div>
            </>
          )}

          {/* Model */}
          <div className="settings-group">
            <label className="settings-label">Model</label>
            <input
              className="settings-input"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder={DEFAULT_MODELS[provider] || "model-name"}
            />
            <span className="settings-hint">
              Leave empty for default: {DEFAULT_MODELS[provider] || "—"}
            </span>
          </div>

          {/* Authentication */}
          {provider === "anthropic" ? (
            <div className="settings-group">
              <label className="settings-label">Authentication</label>
              <div className="settings-provider-grid">
                <button
                  className={`settings-provider-btn ${authMethod === "apiKey" ? "active" : ""}`}
                  onClick={() => setAuthMethod("apiKey")}
                >
                  API Key
                </button>
                <button
                  className={`settings-provider-btn ${authMethod === "oauth" ? "active" : ""}`}
                  onClick={() => setAuthMethod("oauth")}
                >
                  OAuth (Free)
                </button>
              </div>

              {authMethod === "apiKey" ? (
                <>
                  <input
                    className="settings-input"
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder={hasConfigFileApiKey ? "Using key from ~/.cdoing/config.json" : "Enter API key or leave empty for env variable"}
                    style={{ marginTop: 8 }}
                  />
                  <span className="settings-hint">
                    {hasConfigFileApiKey && !apiKey ? (
                      <><span style={{ color: "var(--success)" }}>Active</span> — {apiKeyHint}</>
                    ) : apiKey ? (
                      <><span style={{ color: "var(--success)" }}>Active</span> — {apiKeyHint}</>
                    ) : (
                      apiKeyHint
                    )}
                  </span>
                </>
              ) : (
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
                      <button className="oauth-btn oauth-btn-logout" onClick={handleOAuthLogout}>
                        Logout
                      </button>
                    ) : (
                      <button className="oauth-btn oauth-btn-login" onClick={handleStartOAuth}>
                        Login with Claude
                      </button>
                    )}
                  </div>
                  <span className="settings-hint">
                    Sign in with your Claude account. Uses claude-haiku-4-5 (only model supported with OAuth).
                  </span>
                </div>
              )}
            </div>
          ) : (
            <div className="settings-group">
              <label className="settings-label">API Key</label>
              <input
                className="settings-input"
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={hasConfigFileApiKey ? "Using key from ~/.cdoing/config.json" : "Enter API key or leave empty for env variable"}
              />
              <span className="settings-hint">
                {hasConfigFileApiKey && !apiKey ? (
                  <><span style={{ color: "var(--success)" }}>Active</span> — Using API key from ~/.cdoing/config.json</>
                ) : apiKey ? (
                  <><span style={{ color: "var(--success)" }}>Active</span> — API key set in VS Code settings</>
                ) : (
                  "No API key found. Set one here or in ~/.cdoing/config.json"
                )}
              </span>
            </div>
          )}

          {/* Permission Mode */}
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
              <input
                type="checkbox"
                id="sandbox-toggle"
                checked={sandboxEnabled}
                onChange={(e) => setSandboxEnabled(e.target.checked)}
              />
              <label htmlFor="sandbox-toggle" style={{ cursor: "pointer" }}>
                Enable Sandbox
              </label>
            </div>
            {sandboxEnabled && (
              <div className="settings-mode-grid">
                <button
                  className={`settings-mode-btn ${sandboxMode === "auto-allow" ? "active" : ""}`}
                  onClick={() => setSandboxMode("auto-allow")}
                  title="Auto-approve sandboxed commands without permission prompts"
                >
                  <span className="settings-mode-label">Auto-allow</span>
                  <span className="settings-mode-desc">Auto-approve sandboxed commands</span>
                </button>
                <button
                  className={`settings-mode-btn ${sandboxMode === "regular" ? "active" : ""}`}
                  onClick={() => setSandboxMode("regular")}
                  title="Sandbox enforces restrictions but still prompts for permission"
                >
                  <span className="settings-mode-label">Regular</span>
                  <span className="settings-mode-desc">Enforce restrictions, still prompt</span>
                </button>
              </div>
            )}
            <span className="settings-hint">
              Restricts file and network access. Configure paths and domains in .claude/settings.json.
            </span>
          </div>

          {/* Codebase Indexer */}
          <div className="settings-group">
            <label className="settings-label">Codebase Indexer</label>
            <div className="settings-row" style={{ alignItems: "center", gap: "8px", marginBottom: "8px" }}>
              <input
                type="checkbox"
                id="indexer-auto"
                checked={indexerAutoIndex}
                onChange={(e) => setIndexerAutoIndex(e.target.checked)}
              />
              <label htmlFor="indexer-auto" style={{ cursor: "pointer" }}>
                Auto-index on startup
              </label>
            </div>
            <div className="settings-group" style={{ marginBottom: "8px" }}>
              <label className="settings-label" style={{ fontSize: "11px" }}>Embedding Provider</label>
              <div className="settings-provider-grid">
                {[
                  { value: "none", label: "None (FTS only)" },
                  { value: "openai", label: "OpenAI" },
                  { value: "ollama", label: "Ollama" },
                ].map((p) => (
                  <button
                    key={p.value}
                    className={`settings-provider-btn ${indexerEmbeddingProvider === p.value ? "active" : ""}`}
                    onClick={() => setIndexerEmbeddingProvider(p.value)}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
            {indexerEmbeddingProvider !== "none" && (
              <>
                <div className="settings-group" style={{ marginBottom: "8px" }}>
                  <label className="settings-label" style={{ fontSize: "11px" }}>Embedding Model</label>
                  <input
                    className="settings-input"
                    value={indexerEmbeddingModel}
                    onChange={(e) => setIndexerEmbeddingModel(e.target.value)}
                    placeholder={indexerEmbeddingProvider === "openai" ? "text-embedding-3-small" : "nomic-embed-text"}
                  />
                </div>
                {indexerEmbeddingProvider === "ollama" && (
                  <div className="settings-group" style={{ marginBottom: "8px" }}>
                    <label className="settings-label" style={{ fontSize: "11px" }}>Ollama Base URL</label>
                    <input
                      className="settings-input"
                      value={indexerEmbeddingBaseUrl}
                      onChange={(e) => setIndexerEmbeddingBaseUrl(e.target.value)}
                      placeholder="http://localhost:11434"
                    />
                  </div>
                )}
              </>
            )}
            <span className="settings-hint">
              {indexerEmbeddingProvider === "none"
                ? "Uses full-text search (BM25) only. Fast, no external dependencies."
                : "Adds semantic search via embeddings. Requires embedding model API access."}
            </span>
          </div>

          {/* Temperature */}
          <div className="settings-group settings-row">
            <div className="settings-row-item">
              <label className="settings-label">Temperature</label>
              <input
                className="settings-input settings-input-small"
                type="number"
                min={0}
                max={2}
                step={0.1}
                value={temperature}
                onChange={(e) => setTemperature(parseFloat(e.target.value) || 0)}
              />
            </div>
            <div className="settings-row-item">
              <label className="settings-label">Max Tokens</label>
              <input
                className="settings-input settings-input-small"
                type="number"
                min={100}
                max={200000}
                step={100}
                value={maxTokens}
                onChange={(e) => setMaxTokens(parseInt(e.target.value) || 8096)}
              />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="settings-footer">
          <button className="settings-vscode-btn" onClick={onOpenVscodeSettings}>
            Open VS Code Settings
          </button>
          <div className="settings-footer-right">
            <button className="settings-cancel-btn" onClick={onClose}>Cancel</button>
            <button className="settings-save-btn" onClick={handleSave}>Save</button>
          </div>
        </div>
      </div>
    </div>
  );
};
