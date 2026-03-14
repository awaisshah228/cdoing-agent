/**
 * SettingsPanel.tsx — In-Panel Model & Config Settings
 *
 * A friendly settings overlay that lets users configure
 * provider, model, API key, and other options without
 * leaving the chat panel.
 */

import React, { useState, useEffect } from "react";
import type { ExtensionConfig } from "../types";

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
  { value: "ask", label: "Ask", desc: "Ask before any tool operation" },
  { value: "auto-edit", label: "Auto Edit", desc: "Auto-approve edits, ask for shell" },
  { value: "auto", label: "Auto", desc: "Auto-approve all operations" },
];

export const SettingsPanel: React.FC<SettingsPanelProps> = ({
  config,
  onSave,
  onOpenVscodeSettings,
  onClose,
}) => {
  const [provider, setProvider] = useState(config?.provider || "anthropic");
  const [model, setModel] = useState(config?.model || "");
  const [customProviderName, setCustomProviderName] = useState(config?.customProviderName || "");
  const [customBaseURL, setCustomBaseURL] = useState(config?.customBaseURL || "");
  const [apiKey, setApiKey] = useState(config?.apiKey || "");
  const [temperature, setTemperature] = useState(config?.temperature ?? 0);
  const [maxTokens, setMaxTokens] = useState(config?.maxTokens ?? 8096);
  const [permissionMode, setPermissionMode] = useState(config?.permissionMode || "ask");

  // Update local state when config comes in
  useEffect(() => {
    if (config) {
      setProvider(config.provider || "anthropic");
      setModel(config.model || "");
      setCustomProviderName(config.customProviderName || "");
      setCustomBaseURL(config.customBaseURL || "");
      setApiKey(config.apiKey || "");
      setTemperature(config.temperature ?? 0);
      setMaxTokens(config.maxTokens ?? 8096);
      setPermissionMode(config.permissionMode || "ask");
    }
  }, [config]);

  const handleSave = () => {
    onSave({
      provider,
      model,
      customProviderName,
      customBaseURL,
      apiKey,
      temperature,
      maxTokens,
      permissionMode,
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

          {/* API Key */}
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
