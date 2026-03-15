/**
 * SetupWizard — interactive in-TUI wizard for provider / model / API key / OAuth.
 * Triggered by /setup.  Arrow keys navigate, Enter selects, Esc cancels.
 */

import React, { useState, useCallback, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import { loadConfig, saveConfig } from "../config";
import { oauthLogin, saveOAuthTokens } from "../oauth";

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

const AUTH_METHODS = [
  { value: "apikey", label: "API key",  hint: "paste from console.anthropic.com" },
  { value: "oauth",  label: "OAuth",    hint: "Claude Pro/Max — opens browser" },
];

const KEY_URLS: Record<string, string> = {
  anthropic: "https://console.anthropic.com/settings/keys",
  openai:    "https://platform.openai.com/api-keys",
  google:    "https://aistudio.google.com/apikey",
};

type Step = "provider" | "model" | "auth-method" | "apikey" | "oauth-waiting" | "done";

// ── Menu sub-component ────────────────────────────────────────────────────────

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
  const [step, setStep]                 = useState<Step>("provider");
  const [providerIdx, setProviderIdx]   = useState(initProviderIdx);
  const [modelIdx, setModelIdx]         = useState(0);
  const [authIdx, setAuthIdx]           = useState(0);
  const [chosenProvider, setChosenProvider] = useState(currentProvider);
  const [chosenModel, setChosenModel]   = useState(currentModel);
  const [apiKeyInput, setApiKeyInput]   = useState("");
  const [showKey, setShowKey]           = useState(false);
  const [oauthStatus, setOauthStatus]   = useState<"waiting" | "success" | "error">("waiting");
  const [oauthError, setOauthError]     = useState("");

  // Kick off OAuth login when we enter that step
  useEffect(() => {
    if (step !== "oauth-waiting") return;
    oauthLogin()
      .then((tokens) => {
        saveOAuthTokens(tokens);
        _save(chosenProvider, chosenModel, tokens.access_token);
        setOauthStatus("success");
        setTimeout(() => {
          onDone({ provider: chosenProvider, model: chosenModel, apiKey: tokens.access_token });
        }, 800);
      })
      .catch((err: Error) => {
        setOauthStatus("error");
        setOauthError(err.message);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  useInput(useCallback((char, key) => {
    if (key.escape) { onCancel(); return; }

    // ── Provider ──────────────────────────────────────────────────────────
    if (step === "provider") {
      if (key.upArrow)   { setProviderIdx(i => Math.max(0, i - 1)); return; }
      if (key.downArrow) { setProviderIdx(i => Math.min(PROVIDERS.length - 1, i + 1)); return; }
      if (key.return) {
        const p = PROVIDERS[providerIdx].value;
        setChosenProvider(p);
        const models = MODELS[p] || [];
        const mi = Math.max(0, models.findIndex(m => m.value === currentModel));
        setModelIdx(mi);
        setStep("model");
        return;
      }
    }

    // ── Model ─────────────────────────────────────────────────────────────
    if (step === "model") {
      const models = MODELS[chosenProvider] || [];
      if (key.upArrow)   { setModelIdx(i => Math.max(0, i - 1)); return; }
      if (key.downArrow) { setModelIdx(i => Math.min(models.length - 1, i + 1)); return; }
      if (key.return) {
        const m = models[modelIdx]?.value || "";
        setChosenModel(m);
        if (chosenProvider === "ollama") {
          _save(chosenProvider, m, undefined);
          onDone({ provider: chosenProvider, model: m });
          setStep("done");
        } else if (chosenProvider === "anthropic") {
          setStep("auth-method");
        } else {
          setStep("apikey");
        }
        return;
      }
    }

    // ── Auth method (Anthropic only) ──────────────────────────────────────
    if (step === "auth-method") {
      if (key.upArrow)   { setAuthIdx(i => Math.max(0, i - 1)); return; }
      if (key.downArrow) { setAuthIdx(i => Math.min(AUTH_METHODS.length - 1, i + 1)); return; }
      if (key.return) {
        if (AUTH_METHODS[authIdx].value === "oauth") {
          setOauthStatus("waiting");
          setStep("oauth-waiting");
        } else {
          setStep("apikey");
        }
        return;
      }
    }

    // ── API key entry ─────────────────────────────────────────────────────
    if (step === "apikey") {
      if (key.return) {
        const trimmed = apiKeyInput.trim();
        _save(chosenProvider, chosenModel, trimmed || undefined);
        onDone({ provider: chosenProvider, model: chosenModel, apiKey: trimmed || undefined });
        setStep("done");
        return;
      }
      if (key.backspace || key.delete) { setApiKeyInput(k => k.slice(0, -1)); return; }
      if (key.ctrl && char === "s")    { setShowKey(v => !v); return; }
      if (char && !key.ctrl && !key.meta) { setApiKeyInput(k => k + char); return; }
    }

    // ── OAuth waiting — only ESC (re-cancel) or retry after error ────────
    if (step === "oauth-waiting" && oauthStatus === "error") {
      if (key.return) {
        // Retry
        setOauthStatus("waiting");
        setStep("auth-method");
        setTimeout(() => setStep("oauth-waiting"), 0);
      }
    }
  }, [step, providerIdx, modelIdx, authIdx, chosenProvider, chosenModel, apiKeyInput, oauthStatus, onCancel, onDone]));

  // ── Step counter helper ───────────────────────────────────────────────────

  const totalSteps = chosenProvider === "anthropic" ? 4 : chosenProvider === "ollama" ? 2 : 3;

  // ── Renders ───────────────────────────────────────────────────────────────

  if (step === "provider") {
    return (
      <Box flexDirection="column" paddingY={1}>
        <Text color="cyan" bold>{"  ⚙  Setup Wizard  (1/" + totalSteps + " — Provider)"}</Text>
        <Menu title={"  Choose a provider"} items={PROVIDERS} selectedIdx={providerIdx} />
      </Box>
    );
  }

  if (step === "model") {
    const models = MODELS[chosenProvider] || [];
    return (
      <Box flexDirection="column" paddingY={1}>
        <Text color="cyan" bold>{"  ⚙  Setup Wizard  (2/" + totalSteps + " — Model)"}</Text>
        <Menu title={`  Choose a model for ${chosenProvider}`} items={models} selectedIdx={modelIdx} />
      </Box>
    );
  }

  if (step === "auth-method") {
    return (
      <Box flexDirection="column" paddingY={1}>
        <Text color="cyan" bold>{"  ⚙  Setup Wizard  (3/4 — Authentication)"}</Text>
        <Menu title={"  How do you want to authenticate?"} items={AUTH_METHODS} selectedIdx={authIdx} />
      </Box>
    );
  }

  if (step === "apikey") {
    const masked = showKey ? apiKeyInput : apiKeyInput.replace(/./g, "●");
    const url = KEY_URLS[chosenProvider];
    const stepNum = chosenProvider === "anthropic" ? "4/4" : "3/3";
    return (
      <Box flexDirection="column" paddingY={1} paddingLeft={2}>
        <Text color="cyan" bold>{`  ⚙  Setup Wizard  (${stepNum} — API Key)`}</Text>
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
        <Text dimColor>{"  Enter key then Enter  ·  Ctrl+S toggle visible  ·  Enter alone to skip"}</Text>
        <Text dimColor>{"  Esc cancel"}</Text>
      </Box>
    );
  }

  if (step === "oauth-waiting") {
    if (oauthStatus === "success") {
      return (
        <Box flexDirection="column" paddingY={1} paddingLeft={2}>
          <Text color="green" bold>{"  ✓ OAuth login successful!"}</Text>
          <Text dimColor>{"  Tokens saved to keychain. Returning to chat…"}</Text>
        </Box>
      );
    }
    if (oauthStatus === "error") {
      return (
        <Box flexDirection="column" paddingY={1} paddingLeft={2}>
          <Text color="red" bold>{"  ✗ OAuth login failed"}</Text>
          <Text color="white">{`  ${oauthError}`}</Text>
          <Text dimColor>{"  Press Enter to retry  ·  Esc to cancel"}</Text>
        </Box>
      );
    }
    return (
      <Box flexDirection="column" paddingY={1} paddingLeft={2}>
        <Text color="cyan" bold>{"  ⚙  Setup Wizard  (4/4 — OAuth)"}</Text>
        <Text dimColor>{"─".repeat(50)}</Text>
        <Text color="white">{"  Opening browser for Claude OAuth login…"}</Text>
        <Text dimColor>{"  If browser doesn't open, check your terminal for a URL."}</Text>
        <Text>{" "}</Text>
        <Text dimColor>{"  Waiting for authorization (timeout: 2 min)  ·  Esc cancel"}</Text>
      </Box>
    );
  }

  return null;
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
