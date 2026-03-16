"use client";

import { useEffect, useState } from "react";
import { Settings, Save, RefreshCw, AlertTriangle } from "lucide-react";
import { fetchConfig, updateConfig, type AppConfig } from "@/lib/api";
import { PageHeader } from "@/components/page-header";

type SectionKey = "agent" | "gateway" | "session" | "security" | "general";

const SECTIONS: { key: SectionKey; label: string }[] = [
  { key: "agent", label: "Agent" },
  { key: "gateway", label: "Gateway" },
  { key: "session", label: "Sessions" },
  { key: "security", label: "Security" },
  { key: "general", label: "General" },
];

export default function ConfigPage() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeSection, setActiveSection] = useState<SectionKey>("agent");
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const data = await fetchConfig();
        setConfig(data);
      } catch { /* ignore */ }
      setLoading(false);
    };
    load();
  }, []);

  const handleSave = async () => {
    if (!config) return;
    setSaving(true);
    setMessage(null);
    try {
      await updateConfig(config);
      setMessage({ type: "success", text: "Configuration saved successfully" });
      setDirty(false);
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Failed to save" });
    }
    setSaving(false);
  };

  const update = (path: string, value: unknown) => {
    if (!config) return;
    const copy = JSON.parse(JSON.stringify(config)) as AppConfig;
    const parts = path.split(".");
    let obj: any = copy;
    for (let i = 0; i < parts.length - 1; i++) obj = obj[parts[i]];
    obj[parts[parts.length - 1]] = value;
    setConfig(copy);
    setDirty(true);
  };

  const reload = async () => {
    setLoading(true);
    try {
      const data = await fetchConfig();
      setConfig(data);
      setDirty(false);
      setMessage(null);
    } catch { /* ignore */ }
    setLoading(false);
  };

  if (loading || !config) {
    return (
      <div>
        <PageHeader title="Configuration" description="Manage agent and system settings" />
        <div className="card animate-pulse">
          <div className="h-6 bg-gray-800 rounded w-48 mb-4" />
          <div className="space-y-3">
            {[...Array(5)].map((_, i) => <div key={i} className="h-10 bg-gray-800 rounded" />)}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Configuration"
        description="Manage agent and system settings"
        actions={
          <div className="flex items-center gap-3">
            {dirty && (
              <span className="badge-yellow flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" /> Unsaved changes
              </span>
            )}
            <button onClick={reload} className="btn-secondary flex items-center gap-2">
              <RefreshCw className="w-4 h-4" /> Reload
            </button>
            <button onClick={handleSave} disabled={saving || !dirty} className="btn-primary flex items-center gap-2">
              <Save className="w-4 h-4" /> {saving ? "Saving..." : "Save"}
            </button>
          </div>
        }
      />

      {message && (
        <div className={`mb-6 p-3 rounded-lg text-sm ${
          message.type === "success" ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400"
        }`}>
          {message.text}
        </div>
      )}

      <div className="flex gap-6">
        {/* Section Nav */}
        <div className="w-48 space-y-1">
          {SECTIONS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setActiveSection(key)}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                activeSection === key
                  ? "bg-blue-600/10 text-blue-400 font-medium"
                  : "text-gray-400 hover:text-gray-200 hover:bg-gray-800"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Config Form */}
        <div className="flex-1 card">
          {activeSection === "agent" && (
            <div className="space-y-5">
              <h3 className="text-lg font-medium text-white flex items-center gap-2">
                <Settings className="w-5 h-5 text-gray-500" /> Agent Settings
              </h3>
              <Field label="Provider" value={config.agent.provider}
                onChange={(v) => update("agent.provider", v)}
                options={["anthropic", "openai", "google", "ollama"]} />
              <Field label="Model" value={config.agent.model}
                onChange={(v) => update("agent.model", v)} />
              <Field label="Max Turns" value={String(config.agent.maxTurns)} type="number"
                onChange={(v) => update("agent.maxTurns", parseInt(v) || 25)} />
              <Field label="Permission Mode" value={config.agent.permissionMode}
                onChange={(v) => update("agent.permissionMode", v)}
                options={["ask", "auto-edit", "auto"]} />
              <Field label="System Prompt" value={config.agent.systemPrompt || ""} multiline
                onChange={(v) => update("agent.systemPrompt", v || undefined)} />
              <Field label="Max Tokens" value={config.agent.maxTokens ? String(config.agent.maxTokens) : ""} type="number"
                onChange={(v) => update("agent.maxTokens", v ? parseInt(v) : undefined)}
                placeholder="Default (provider limit)" />
            </div>
          )}

          {activeSection === "gateway" && (
            <div className="space-y-5">
              <h3 className="text-lg font-medium text-white">Gateway Settings</h3>
              <Field label="Port" value={String(config.gateway.port)} type="number"
                onChange={(v) => update("gateway.port", parseInt(v) || 4567)} />
              <Field label="CORS Origin" value={config.gateway.corsOrigin}
                onChange={(v) => update("gateway.corsOrigin", v)} />
              <div>
                <label className="block text-sm text-gray-400 mb-1">Auth Token</label>
                <p className="text-xs text-gray-600">{config.gateway.authToken || "Not set"}</p>
              </div>
            </div>
          )}

          {activeSection === "session" && (
            <div className="space-y-5">
              <h3 className="text-lg font-medium text-white">Session Settings</h3>
              <Field label="TTL (minutes)" value={String(Math.round(config.session.ttlMs / 60000))} type="number"
                onChange={(v) => update("session.ttlMs", (parseInt(v) || 30) * 60000)} />
              <Field label="Max History Messages" value={String(config.session.maxHistoryMessages)} type="number"
                onChange={(v) => update("session.maxHistoryMessages", parseInt(v) || 50)} />
              <Field label="Max Sessions" value={String(config.session.maxSessions)} type="number"
                onChange={(v) => update("session.maxSessions", parseInt(v) || 100)} />
            </div>
          )}

          {activeSection === "security" && (
            <div className="space-y-5">
              <h3 className="text-lg font-medium text-white">Security Settings</h3>
              <Field label="Rate Limit (per minute)" value={String(config.security.rateLimitPerMinute)} type="number"
                onChange={(v) => update("security.rateLimitPerMinute", parseInt(v) || 20)} />
              <div>
                <label className="block text-sm text-gray-400 mb-1">Allowed Directories</label>
                <textarea
                  className="input-field min-h-[80px]"
                  value={config.security.allowedDirs.join("\n")}
                  onChange={(e) => update("security.allowedDirs", e.target.value.split("\n").filter(Boolean))}
                  placeholder="One directory per line"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Channel Rules</label>
                <pre className="text-xs text-gray-400 bg-gray-800 rounded-lg p-3 overflow-x-auto">
                  {JSON.stringify(config.security.channelRules, null, 2)}
                </pre>
              </div>
            </div>
          )}

          {activeSection === "general" && (
            <div className="space-y-5">
              <h3 className="text-lg font-medium text-white">General Settings</h3>
              <Field label="Working Directory" value={config.workingDir}
                onChange={(v) => update("workingDir", v)} />
              <Field label="Log Level" value={config.logLevel}
                onChange={(v) => update("logLevel", v)}
                options={["debug", "info", "warn", "error"]} />
              <div>
                <label className="block text-sm text-gray-400 mb-1">Channels</label>
                <pre className="text-xs text-gray-400 bg-gray-800 rounded-lg p-3 overflow-x-auto">
                  {JSON.stringify(config.channels, null, 2)}
                </pre>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Field Component ──

interface FieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: "text" | "number";
  options?: string[];
  multiline?: boolean;
  placeholder?: string;
}

function Field({ label, value, onChange, type = "text", options, multiline, placeholder }: FieldProps) {
  return (
    <div>
      <label className="block text-sm text-gray-400 mb-1">{label}</label>
      {options ? (
        <select className="input-field" value={value} onChange={(e) => onChange(e.target.value)}>
          {options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : multiline ? (
        <textarea
          className="input-field min-h-[80px] resize-y"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
        />
      ) : (
        <input
          type={type}
          className="input-field"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
        />
      )}
    </div>
  );
}
