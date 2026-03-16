/**
 * SetupWizard — Interactive setup overlay for configuring provider, model, API key
 *
 * Steps:
 *   1. Select provider
 *   2. Select auth method (API key or OAuth — Anthropic only)
 *   3. Select model
 *   4. Enter API key / OAuth code
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { TextAttributes } from "@opentui/core";
import { useState } from "react";
import { useKeyboard } from "@opentui/react";
import { useTheme } from "../context/theme";

export interface SetupWizardProps {
  onComplete: (config: { provider: string; model: string; apiKey?: string }) => void;
  onClose: () => void;
}

const PROVIDERS = [
  { id: "anthropic", name: "Anthropic (Claude)", hint: "Claude Sonnet, Opus, Haiku" },
  { id: "openai", name: "OpenAI", hint: "GPT-4o, o3" },
  { id: "google", name: "Google AI", hint: "Gemini 2.0 Flash, 2.5 Pro" },
  { id: "ollama", name: "Ollama (Local)", hint: "No API key needed" },
];

const MODELS: Record<string, { id: string; name: string }[]> = {
  anthropic: [
    { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6 (recommended)" },
    { id: "claude-opus-4-6", name: "Claude Opus 4.6" },
    { id: "claude-haiku-4-5-20251001", name: "Claude Haiku 4.5" },
  ],
  openai: [
    { id: "gpt-4o", name: "GPT-4o (recommended)" },
    { id: "gpt-4o-mini", name: "GPT-4o mini" },
    { id: "o3", name: "o3" },
  ],
  google: [
    { id: "gemini-2.0-flash", name: "Gemini 2.0 Flash (recommended)" },
    { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro" },
  ],
  ollama: [
    { id: "llama3.1", name: "Llama 3.1" },
    { id: "codellama", name: "Code Llama" },
    { id: "mistral", name: "Mistral" },
  ],
};

const ENV_VARS: Record<string, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  google: "GOOGLE_API_KEY",
};

type Step = "provider" | "model" | "apikey";

export function SetupWizard(props: SetupWizardProps) {
  const { theme } = useTheme();
  const t = theme;

  const [step, setStep] = useState<Step>("provider");
  const [selectedProvider, setSelectedProvider] = useState(0);
  const [selectedModel, setSelectedModel] = useState(0);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [error, setError] = useState("");

  const provider = PROVIDERS[selectedProvider];
  const models = MODELS[provider.id] || [];

  useKeyboard((key: any) => {
    if (key.name === "escape") {
      if (step === "apikey") {
        setStep("model");
        setError("");
      } else if (step === "model") {
        setStep("provider");
      } else {
        props.onClose();
      }
      return;
    }

    if (step === "provider") {
      if (key.name === "up" || key.name === "k") {
        setSelectedProvider((s) => Math.max(0, s - 1));
      } else if (key.name === "down" || key.name === "j") {
        setSelectedProvider((s) => Math.min(PROVIDERS.length - 1, s + 1));
      } else if (key.name === "return") {
        setSelectedModel(0);
        setStep("model");
      }
      return;
    }

    if (step === "model") {
      if (key.name === "up" || key.name === "k") {
        setSelectedModel((s) => Math.max(0, s - 1));
      } else if (key.name === "down" || key.name === "j") {
        setSelectedModel((s) => Math.min(models.length - 1, s + 1));
      } else if (key.name === "return") {
        if (provider.id === "ollama") {
          // Ollama doesn't need API key
          saveAndComplete(provider.id, models[selectedModel].id, undefined);
        } else {
          setStep("apikey");
          setApiKeyInput("");
          setError("");
        }
      }
      return;
    }

    if (step === "apikey") {
      if (key.name === "return") {
        if (!apiKeyInput.trim()) {
          setError("API key cannot be empty");
          return;
        }
        saveAndComplete(provider.id, models[selectedModel].id, apiKeyInput.trim());
      } else if (key.ctrl && key.name === "s") {
        setShowKey((s) => !s);
      } else if (key.name === "backspace") {
        setApiKeyInput((s) => s.slice(0, -1));
        setError("");
      } else if (key.ctrl && key.name === "u") {
        setApiKeyInput("");
        setError("");
      } else if (key.sequence && key.sequence.length === 1 && !key.ctrl && !key.meta) {
        setApiKeyInput((s) => s + key.sequence);
        setError("");
      }
    }
  });

  const saveAndComplete = (prov: string, model: string, apiKey?: string) => {
    // Save to ~/.cdoing/config.json
    const configDir = path.join(os.homedir(), ".cdoing");
    const configPath = path.join(configDir, "config.json");

    let config: Record<string, any> = {};
    try {
      if (fs.existsSync(configPath)) {
        config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      }
    } catch {}

    config.provider = prov;
    config.model = model;
    if (apiKey) {
      if (!config.apiKeys) config.apiKeys = {};
      config.apiKeys[prov] = apiKey;
    }

    if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");

    props.onComplete({ provider: prov, model, apiKey });
  };

  return (
    <box
      borderStyle="single"
      borderColor={t.primary}
      paddingX={2}
      paddingY={1}
      flexDirection="column"
      flexGrow={1}
    >
      <text fg={t.primary} attributes={TextAttributes.BOLD}>
        {"🔧 Setup Wizard"}
      </text>
      <text>{""}</text>

      {step === "provider" && (
        <box flexDirection="column">
          <text fg={t.text} attributes={TextAttributes.BOLD}>
            {"Step 1: Select Provider"}
          </text>
          <text>{""}</text>
          {PROVIDERS.map((p, i) => (
            <text
              key={p.id}
              fg={selectedProvider === i ? t.primary : t.textMuted}
              attributes={selectedProvider === i ? TextAttributes.BOLD : undefined}
            >
              {`  ${selectedProvider === i ? "❯" : " "} ${p.name}  ${selectedProvider === i ? p.hint : ""}`}
            </text>
          ))}
          <text>{""}</text>
          <text fg={t.textMuted}>{"  ↑↓ Navigate  Enter Select  Esc Cancel"}</text>
        </box>
      )}

      {step === "model" && (
        <box flexDirection="column">
          <text fg={t.text} attributes={TextAttributes.BOLD}>
            {`Step 2: Select Model (${provider.name})`}
          </text>
          <text>{""}</text>
          {models.map((m, i) => (
            <text
              key={m.id}
              fg={selectedModel === i ? t.primary : t.textMuted}
              attributes={selectedModel === i ? TextAttributes.BOLD : undefined}
            >
              {`  ${selectedModel === i ? "❯" : " "} ${m.name}`}
            </text>
          ))}
          <text>{""}</text>
          <text fg={t.textMuted}>{"  ↑↓ Navigate  Enter Select  Esc Back"}</text>
        </box>
      )}

      {step === "apikey" && (
        <box flexDirection="column">
          <text fg={t.text} attributes={TextAttributes.BOLD}>
            {`Step 3: Enter API Key (${provider.name})`}
          </text>
          <text>{""}</text>
          <text fg={t.textDim}>
            {`  Environment variable: ${ENV_VARS[provider.id] || "N/A"}`}
          </text>
          <text fg={t.textDim}>
            {"  Or paste your API key below:"}
          </text>
          <text>{""}</text>
          <text fg={t.text}>
            {`  > ${showKey ? apiKeyInput : apiKeyInput.replace(/./g, "•")}█`}
          </text>
          {error && (
            <text fg={t.error}>{`\n  ${error}`}</text>
          )}
          <text>{""}</text>
          <text fg={t.textMuted}>{"  Enter Save  Ctrl+S Toggle visibility  Ctrl+U Clear  Esc Back"}</text>
        </box>
      )}
    </box>
  );
}
