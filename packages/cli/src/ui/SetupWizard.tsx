/**
 * SetupWizard — interactive in-TUI wizard for provider / model / API key.
 * Triggered by /setup.  Arrow keys navigate, Enter selects, Esc cancels.
 */

import React, { useState, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import { loadConfig, saveConfig } from "../config";

// ── Static data ───────────────────────────────────────────────────────────────

const PROVIDERS = [
  { value: "anthropic", label: "Anthropic (Claude)",  hint: "claude-sonnet-4-6, claude-opus-4-6" },
  { value: "openai",    label: "OpenAI (GPT)",        hint: "gpt-4o, gpt-4o-mini" },
  { value: "google",    label: "Google (Gemini)",     hint: "gemini-2.0-flash, gemini-1.5-pro" },
  { value: "ollama",    label: "Ollama (local)",      hint: "llama3.1, mistral, codellama" },
];

const MODELS: Record<string, { value: string; label: string; hint: string }[]> = {
  anthropic: [
    { value: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", hint: "recommended · fast & smart" },
    { value: "claude-opus-4-6",   label: "Claude Opus 4.6",   hint: "most capable" },
    { value: "claude-haiku-4-5",  label: "Claude Haiku 4.5",  hint: "fastest" },
  ],
  openai: [
    { value: "gpt-4o",      label: "GPT-4o",      hint: "recommended" },
    { value: "gpt-4o-mini", label: "GPT-4o mini", hint: "fastest · cheapest" },
    { value: "o3-mini",     label: "o3-mini",      hint: "reasoning" },
  ],
  google: [
    { value: "gemini-2.0-flash", label: "Gemini 2.0 Flash", hint: "recommended · fast" },
    { value: "gemini-1.5-pro",   label: "Gemini 1.5 Pro",   hint: "most capable" },
    { value: "gemini-1.5-flash", label: "Gemini 1.5 Flash", hint: "fastest" },
  ],
  ollama: [
    { value: "llama3.1",    label: "LLaMA 3.1",   hint: "general purpose" },
    { value: "mistral",     label: "Mistral",      hint: "fast & capable" },
    { value: "codellama",   label: "CodeLlama",    hint: "code-focused" },
    { value: "phi3",        label: "Phi-3",        hint: "small & fast" },
  ],
};

const KEY_URLS: Record<string, string> = {
  anthropic: "https://console.anthropic.com/settings/keys",
  openai:    "https://platform.openai.com/api-keys",
  google:    "https://aistudio.google.com/apikey",
};

type Step = "provider" | "model" | "apikey" | "done";

// ── Sub-components ────────────────────────────────────────────────────────────

interface MenuProps<T extends { value: string; label: string; hint?: string }> {
  title: string;
  items: T[];
  selectedIdx: number;
}

function Menu<T extends { value: string; label: string; hint?: string }>({
  title,
  items,
  selectedIdx,
}: MenuProps<T>) {
  return (
    <Box flexDirection="column" paddingLeft={2}>
      <Text color="cyan" bold>{title}</Text>
      <Text dimColor>{"─".repeat(50)}</Text>
      {items.map((item, i) => {
        const isSelected = i === selectedIdx;
        return (
          <Box key={item.value}>
            {isSelected
              ? <Text color="cyan" bold>{"  ❯ "}</Text>
              : <Text dimColor>{"    "}</Text>}
            {isSelected
              ? <Text color="white" bold>{item.label}</Text>
              : <Text color="white">{item.label}</Text>}
            {item.hint
              ? <Text dimColor>{`  ${item.hint}`}</Text>
              : null}
          </Box>
        );
      })}
      <Text dimColor>{"─".repeat(50)}</Text>
      <Text dimColor>{"↑/↓ navigate  Enter select  Esc cancel"}</Text>
    </Box>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export interface SetupWizardProps {
  currentProvider: string;
  currentModel: string;
  onDone: (result: { provider: string; model: string; apiKey?: string }) => void;
  onCancel: () => void;
}

export const SetupWizard: React.FC<SetupWizardProps> = ({
  currentProvider,
  currentModel,
  onDone,
  onCancel,
}) => {
  const initProviderIdx = Math.max(0, PROVIDERS.findIndex(p => p.value === currentProvider));
  const [step, setStep] = useState<Step>("provider");
  const [providerIdx, setProviderIdx] = useState(initProviderIdx);
  const [modelIdx, setModelIdx] = useState(0);
  const [chosenProvider, setChosenProvider] = useState(currentProvider);
  const [chosenModel, setChosenModel] = useState(currentModel);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [showKey, setShowKey] = useState(false);

  useInput(useCallback((char, key) => {
    if (key.escape) { onCancel(); return; }

    // ── Provider step ─────────────────────────────────────────────────────
    if (step === "provider") {
      if (key.upArrow)   { setProviderIdx(i => Math.max(0, i - 1)); return; }
      if (key.downArrow) { setProviderIdx(i => Math.min(PROVIDERS.length - 1, i + 1)); return; }
      if (key.return) {
        const p = PROVIDERS[providerIdx].value;
        setChosenProvider(p);
        // Pre-select current model if it's in the list, else 0
        const models = MODELS[p] || [];
        const mi = Math.max(0, models.findIndex(m => m.value === currentModel));
        setModelIdx(mi);
        setStep("model");
        return;
      }
    }

    // ── Model step ────────────────────────────────────────────────────────
    if (step === "model") {
      const models = MODELS[chosenProvider] || [];
      if (key.upArrow)   { setModelIdx(i => Math.max(0, i - 1)); return; }
      if (key.downArrow) { setModelIdx(i => Math.min(models.length - 1, i + 1)); return; }
      if (key.return) {
        const m = models[modelIdx]?.value || "";
        setChosenModel(m);
        // Ollama doesn't need an API key
        if (chosenProvider === "ollama") {
          _save(chosenProvider, m, undefined);
          onDone({ provider: chosenProvider, model: m });
          setStep("done");
        } else {
          setStep("apikey");
        }
        return;
      }
    }

    // ── API key step ─────────────────────────────────────────────────────
    if (step === "apikey") {
      if (key.return) {
        const trimmed = apiKeyInput.trim();
        if (trimmed) {
          _save(chosenProvider, chosenModel, trimmed);
          onDone({ provider: chosenProvider, model: chosenModel, apiKey: trimmed });
        } else {
          // Skip key — save provider/model only
          _save(chosenProvider, chosenModel, undefined);
          onDone({ provider: chosenProvider, model: chosenModel });
        }
        setStep("done");
        return;
      }
      if (key.backspace || key.delete) {
        setApiKeyInput(k => k.slice(0, -1));
        return;
      }
      // Toggle visibility with Ctrl+S
      if (key.ctrl && char === "s") { setShowKey(v => !v); return; }
      if (char && !key.ctrl && !key.meta) {
        setApiKeyInput(k => k + char);
        return;
      }
    }
  }, [step, providerIdx, modelIdx, chosenProvider, chosenModel, apiKeyInput, onCancel, onDone]));

  // ── Renders ───────────────────────────────────────────────────────────────

  if (step === "provider") {
    return (
      <Box flexDirection="column" paddingY={1}>
        <Text color="cyan" bold>{"  ⚙  Setup Wizard  (1/3 — Provider)"}</Text>
        <Menu
          title={"  Choose a provider"}
          items={PROVIDERS}
          selectedIdx={providerIdx}
        />
      </Box>
    );
  }

  if (step === "model") {
    const models = MODELS[chosenProvider] || [];
    return (
      <Box flexDirection="column" paddingY={1}>
        <Text color="cyan" bold>{"  ⚙  Setup Wizard  (2/3 — Model)"}</Text>
        <Menu
          title={`  Choose a model for ${chosenProvider}`}
          items={models}
          selectedIdx={modelIdx}
        />
      </Box>
    );
  }

  if (step === "apikey") {
    const masked = showKey ? apiKeyInput : apiKeyInput.replace(/./g, "●");
    const url = KEY_URLS[chosenProvider];
    return (
      <Box flexDirection="column" paddingY={1} paddingLeft={2}>
        <Text color="cyan" bold>{"  ⚙  Setup Wizard  (3/3 — API Key)"}</Text>
        <Text dimColor>{"─".repeat(50)}</Text>
        <Text color="white">{`  Provider: ${chosenProvider}   Model: ${chosenModel}`}</Text>
        {url ? <Text dimColor>{`  Get a key: ${url}`}</Text> : null}
        <Text>{" "}</Text>
        <Box>
          <Text color="green">{"  API key: "}</Text>
          <Text color="white">{masked || " "}</Text>
          <Text color="green">{"▊"}</Text>
        </Box>
        <Text>{" "}</Text>
        <Text dimColor>{"  Type key then Enter  ·  Ctrl+S toggle visible  ·  Enter alone to skip"}</Text>
        <Text dimColor>{"  Esc cancel"}</Text>
      </Box>
    );
  }

  return null; // "done" — parent will unmount us
};

// ── Helper ────────────────────────────────────────────────────────────────────

function _save(provider: string, model: string, apiKey: string | undefined) {
  const config = loadConfig();
  config.provider = provider;
  config.model = model || undefined;
  if (apiKey) {
    config.apiKeys = config.apiKeys || {};
    config.apiKeys[provider] = apiKey;
  }
  saveConfig(config);
}
