/**
 * SettingsPanel.tsx — In-Panel Model & Config Settings
 *
 * A friendly settings overlay that lets users configure
 * provider, model, API key, and other options without
 * leaving the chat panel.
 */

import React, { useState, useEffect, useCallback } from "react";
import type { ExtensionConfig } from "../types";
import { useVsCode } from "../hooks/useVsCode";

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
  const [provider, setProvider] = useState(config?.provider || "anthropic");
  const [model, setModel] = useState(config?.model || "");
  const [customProviderName, setCustomProviderName] = useState(config?.customProviderName || "");
  const [customBaseURL, setCustomBaseURL] = useState(config?.customBaseURL || "");
  const [apiKey, setApiKey] = useState(config?.apiKey || "");
  const [authMethod, setAuthMethod] = useState(config?.authMethod || "apiKey");
  const [temperature, setTemperature] = useState(config?.temperature ?? 0);
  const [maxTokens, setMaxTokens] = useState(config?.maxTokens ?? 8096);
  const [permissionMode, setPermissionMode] = useState(config?.permissionMode || "ask");
  const [sandboxEnabled, setSandboxEnabled] = useState(config?.sandboxEnabled ?? false);
  const [sandboxMode, setSandboxMode] = useState(config?.sandboxMode || "regular");
  const [indexerEmbeddingModel, setIndexerEmbeddingModel] = useState(config?.indexerEmbeddingModel || "");
  const [indexerEmbeddingProvider, setIndexerEmbeddingProvider] = useState(config?.indexerEmbeddingProvider || "none");
  const [indexerEmbeddingBaseUrl, setIndexerEmbeddingBaseUrl] = useState(config?.indexerEmbeddingBaseUrl || "");
  const [indexerAutoIndex, setIndexerAutoIndex] = useState(config?.indexerAutoIndex ?? true);

  // OAuth status
  const [oauthStatus, setOauthStatus] = useState<"none" | "active" | "expired">("none");
  const [oauthExpiresAt, setOauthExpiresAt] = useState<number | undefined>();

  // Update local state when config comes in
  useEffect(() => {
    if (config) {
      setProvider(config.provider || "anthropic");
      setModel(config.model || "");
      setCustomProviderName(config.customProviderName || "");
      setCustomBaseURL(config.customBaseURL || "");
      setApiKey(config.apiKey || "");
      setAuthMethod(config.authMethod || "apiKey");
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
  }, [config]);

  // Listen for OAuth status messages
  useEffect(() => {
    function handler(event: MessageEvent) {
      const msg = event.data;
      if (msg.type === "oauthStatus") {
        setOauthStatus(msg.status);
        setOauthExpiresAt(msg.expiresAt);
      }
    }
    window.addEventListener("message", handler);
    // Request current OAuth status on mount
    vscode.postMessage({ type: "getOAuthStatus" } as any);
    return () => window.removeEventListener("message", handler);
  }, [vscode]);

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
                    placeholder="Leave empty to use env variable"
                    style={{ marginTop: 8 }}
                  />
                  <span className="settings-hint">
                    Overrides ANTHROPIC_API_KEY environment variable if set
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
                    Sign in with your Claude account. Free tier supports Haiku model only.
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
                placeholder="Leave empty to use env variable"
              />
              <span className="settings-hint">
                Overrides environment variable if set
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
