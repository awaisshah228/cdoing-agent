/**
 * SetupWizard — interactive in-TUI wizard for provider / model / API key / OAuth.
 * Triggered by /setup.  Arrow keys navigate, Enter selects, Esc cancels.
 *
 * Flow:
 *  Anthropic  →  1. Provider  2. Auth method  3. Model (filtered)  4. API key or OAuth
 *  Others     →  1. Provider  2. Model  3. API key
 *  Ollama     →  1. Provider  2. Model  (no key needed)
 */

import React, { useState, useCallback, useEffect, useRef } from "react";
import { Box, Text, useInput } from "ink";
import { loadConfig, saveConfig } from "../config";
import { generateOAuthUrl, exchangeOAuthCode } from "../oauth";

// ── Static data ───────────────────────────────────────────────────────────────

const PROVIDERS = [
  { value: "anthropic", label: "Anthropic (Claude)",  hint: "claude-sonnet-4-6, claude-opus-4-6" },
  { value: "openai",    label: "OpenAI (GPT)",        hint: "gpt-4o, gpt-4o-mini" },
  { value: "google",    label: "Google (Gemini)",     hint: "gemini-2.0-flash, gemini-1.5-pro" },
  { value: "ollama",    label: "Ollama (local)",      hint: "llama3.1, mistral, codellama" },
];

const AUTH_METHODS = [
  { value: "apikey", label: "API key",  hint: "all models available · console.anthropic.com" },
  { value: "oauth",  label: "OAuth",    hint: "Claude Pro/Max · opens browser" },
];

// All models per provider
const ALL_MODELS: Record<string, { value: string; label: string; hint: string }[]> = {
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

// OAuth only supports Haiku currently
const OAUTH_MODELS = [
  { value: "claude-haiku-4-5", label: "Claude Haiku 4.5", hint: "only model supported with OAuth" },
];

const KEY_URLS: Record<string, string> = {
  anthropic: "https://console.anthropic.com/settings/keys",
  openai:    "https://platform.openai.com/api-keys",
  google:    "https://aistudio.google.com/apikey",
};

type Step =
  | "provider"
  | "auth-method"
  | "model"
  | "apikey"
  | "oauth-paste"
  | "oauth-exchanging"
  | "done";

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
  onDone: (result: { provider: string; model: string; apiKey?: string; oauthToken?: string }) => void;
  onCancel: () => void;
}

export const SetupWizard: React.FC<SetupWizardProps> = ({
  currentProvider,
  currentModel,
  onDone,
  onCancel,
}) => {
  const initProviderIdx = Math.max(0, PROVIDERS.findIndex(p => p.value === currentProvider));

  const [step, setStep]                       = useState<Step>("provider");
  const [providerIdx, setProviderIdx]         = useState(initProviderIdx);
  const [authIdx, setAuthIdx]                 = useState(0);
  const [modelIdx, setModelIdx]               = useState(0);
  const [chosenProvider, setChosenProvider]   = useState(currentProvider);
  const [chosenAuthMethod, setChosenAuthMethod] = useState<"apikey" | "oauth">("apikey");
  const [chosenModel, setChosenModel]         = useState(currentModel);
  // API key step
  const [apiKeyInput, setApiKeyInput]         = useState("");
  const [showKey, setShowKey]                 = useState(false);
  // OAuth paste step
  const [oauthUrl, setOauthUrl]               = useState("");
  const [oauthVerifier, setOauthVerifier]     = useState("");
  const [oauthCodeInput, setOauthCodeInput]   = useState("");
  const [showCode, setShowCode]               = useState(false);
  const [oauthError, setOauthError]           = useState("");
  const exchangingRef                         = useRef(false);

  // Generate OAuth URL and open browser when entering oauth-paste step
  useEffect(() => {
    if (step !== "oauth-paste") return;
    const { url, codeVerifier } = generateOAuthUrl();
    setOauthUrl(url);
    setOauthVerifier(codeVerifier);
    setOauthCodeInput("");
    setOauthError("");
    openBrowser(url);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // Returns the model list for the current provider + auth selection
  const getModels = useCallback((provider: string, authMethod: "apikey" | "oauth") => {
    if (provider === "anthropic" && authMethod === "oauth") return OAUTH_MODELS;
    return ALL_MODELS[provider] || [];
  }, []);

  useInput(useCallback((char, key) => {
    if (key.escape) { onCancel(); return; }

    // ── 1. Provider ───────────────────────────────────────────────────────
    if (step === "provider") {
      if (key.upArrow)   { setProviderIdx(i => Math.max(0, i - 1)); return; }
      if (key.downArrow) { setProviderIdx(i => Math.min(PROVIDERS.length - 1, i + 1)); return; }
      if (key.return) {
        const p = PROVIDERS[providerIdx].value;
        setChosenProvider(p);
        setAuthIdx(0);
        if (p === "anthropic") {
          setStep("auth-method");
        } else {
          // Non-Anthropic: skip auth-method, go straight to model
          const models = ALL_MODELS[p] || [];
          setModelIdx(Math.max(0, models.findIndex(m => m.value === currentModel)));
          setStep("model");
        }
        return;
      }
    }

    // ── 2. Auth method (Anthropic only) ───────────────────────────────────
    if (step === "auth-method") {
      if (key.upArrow)   { setAuthIdx(i => Math.max(0, i - 1)); return; }
      if (key.downArrow) { setAuthIdx(i => Math.min(AUTH_METHODS.length - 1, i + 1)); return; }
      if (key.return) {
        const auth = AUTH_METHODS[authIdx].value as "apikey" | "oauth";
        setChosenAuthMethod(auth);
        const models = getModels("anthropic", auth);
        // Pre-select current model if available, else 0
        setModelIdx(Math.max(0, models.findIndex(m => m.value === currentModel)));
        setStep("model");
        return;
      }
    }

    // ── 3. Model ──────────────────────────────────────────────────────────
    if (step === "model") {
      const models = getModels(chosenProvider, chosenAuthMethod);
      if (key.upArrow)   { setModelIdx(i => Math.max(0, i - 1)); return; }
      if (key.downArrow) { setModelIdx(i => Math.min(models.length - 1, i + 1)); return; }
      if (key.return) {
        const m = models[modelIdx]?.value || "";
        setChosenModel(m);
        if (chosenProvider === "ollama") {
          _save(chosenProvider, m, undefined);
          onDone({ provider: chosenProvider, model: m });
          setStep("done");
        } else if (chosenAuthMethod === "oauth") {
          exchangingRef.current = false;
          setStep("oauth-paste");
        } else {
          setStep("apikey");
        }
        return;
      }
    }

    // ── 4a. API key entry ─────────────────────────────────────────────────
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

    // ── 4b. OAuth paste ───────────────────────────────────────────────────
    if (step === "oauth-paste") {
      if (key.return) {
        const code = oauthCodeInput.trim();
        if (!code || exchangingRef.current) return;
        exchangingRef.current = true;
        setStep("oauth-exchanging");
        exchangeOAuthCode(code, oauthVerifier)
          .then((tokens) => {
            _saveOAuth(chosenProvider, chosenModel);
            setTimeout(() => {
              onDone({ provider: chosenProvider, model: chosenModel, oauthToken: tokens.access_token });
            }, 600);
          })
          .catch((err: Error) => {
            exchangingRef.current = false;
            setOauthError(err.message);
            setStep("oauth-paste");
          });
        return;
      }
      if (key.backspace || key.delete) { setOauthCodeInput(k => k.slice(0, -1)); return; }
      if (key.ctrl && char === "s")    { setShowCode(v => !v); return; }
      if (char && !key.ctrl && !key.meta) { setOauthCodeInput(k => k + char); return; }
    }
  }, [step, providerIdx, authIdx, modelIdx, chosenProvider, chosenAuthMethod,
      chosenModel, apiKeyInput, oauthCodeInput, oauthVerifier,
      getModels, onCancel, onDone]));

  // ── Step label helpers ────────────────────────────────────────────────────

  // Total steps: Anthropic=4, Ollama=2, others=3
  const total = chosenProvider === "anthropic" ? 4 : chosenProvider === "ollama" ? 2 : 3;
  // Step number depends on flow
  const stepNum: Record<Step, string> = {
    "provider":          `1/${total}`,
    "auth-method":       "2/4",
    "model":             chosenProvider === "anthropic" ? "3/4" : chosenProvider === "ollama" ? "2/2" : "2/3",
    "apikey":            chosenProvider === "anthropic" ? "4/4" : "3/3",
    "oauth-paste":       "4/4",
    "oauth-exchanging":  "4/4",
    "done":              "",
  };

  // ── Renders ───────────────────────────────────────────────────────────────

  if (step === "provider") {
    return (
      <Box flexDirection="column" paddingY={1}>
        <Text color="cyan" bold>{`  ⚙  Setup Wizard  (${stepNum.provider} — Provider)`}</Text>
        <Menu title={"  Choose a provider"} items={PROVIDERS} selectedIdx={providerIdx} />
      </Box>
    );
  }

  if (step === "auth-method") {
    return (
      <Box flexDirection="column" paddingY={1}>
        <Text color="cyan" bold>{`  ⚙  Setup Wizard  (${stepNum["auth-method"]} — Authentication)`}</Text>
        <Menu title={"  How do you want to authenticate?"} items={AUTH_METHODS} selectedIdx={authIdx} />
      </Box>
    );
  }

  if (step === "model") {
    const models = getModels(chosenProvider, chosenAuthMethod);
    const title = chosenProvider === "anthropic" && chosenAuthMethod === "oauth"
      ? "  Choose a model  (OAuth supports Haiku only)"
      : `  Choose a model for ${chosenProvider}`;
    return (
      <Box flexDirection="column" paddingY={1}>
        <Text color="cyan" bold>{`  ⚙  Setup Wizard  (${stepNum.model} — Model)`}</Text>
        <Menu title={title} items={models} selectedIdx={modelIdx} />
      </Box>
    );
  }

  if (step === "apikey") {
    const masked = showKey ? apiKeyInput : apiKeyInput.replace(/./g, "●");
    const url = KEY_URLS[chosenProvider];
    return (
      <Box flexDirection="column" paddingY={1} paddingLeft={2}>
        <Text color="cyan" bold>{`  ⚙  Setup Wizard  (${stepNum.apikey} — API Key)`}</Text>
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
        <Text dimColor>{"  Paste key then Enter  ·  Ctrl+S toggle visible  ·  Enter alone to skip"}</Text>
        <Text dimColor>{"  Esc cancel"}</Text>
      </Box>
    );
  }

  if (step === "oauth-paste") {
    const maskedCode = showCode ? oauthCodeInput : oauthCodeInput.replace(/./g, "●");
    return (
      <Box flexDirection="column" paddingY={1} paddingLeft={2}>
        <Text color="cyan" bold>{`  ⚙  Setup Wizard  (${stepNum["oauth-paste"]} — OAuth)`}</Text>
        <Text dimColor>{"─".repeat(50)}</Text>
        <Text color="white">{"  1. Browser opening to Claude login…"}</Text>
        {oauthUrl
          ? <Text dimColor>{`     If it didn't open: ${oauthUrl.substring(0, 72)}…`}</Text>
          : null}
        <Text color="white">{"  2. Approve → you'll land on a page with a code in the URL"}</Text>
        <Text color="white">{"  3. Copy the code= value from the URL and paste below"}</Text>
        {oauthError
          ? <Text color="red">{`\n  ✗ ${oauthError}`}</Text>
          : null}
        <Text>{" "}</Text>
        <Box>
          <Text color="green">{"  Code: "}</Text>
          <Text color="white">{maskedCode || " "}</Text>
          <Text color="green">{"▊"}</Text>
        </Box>
        <Text>{" "}</Text>
        <Text dimColor>{"  Paste code then Enter  ·  Ctrl+S toggle visible  ·  Esc cancel"}</Text>
      </Box>
    );
  }

  if (step === "oauth-exchanging") {
    return (
      <Box flexDirection="column" paddingY={1} paddingLeft={2}>
        <Text color="cyan" bold>{`  ⚙  Setup Wizard  (${stepNum["oauth-exchanging"]} — OAuth)`}</Text>
        <Text dimColor>{"─".repeat(50)}</Text>
        <Text color="yellow">{"  Exchanging code for tokens…"}</Text>
      </Box>
    );
  }

  return null;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

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

/** OAuth: save provider/model only — token is already in keychain via exchangeOAuthCode */
function _saveOAuth(provider: string, model: string) {
  const config = loadConfig();
  config.provider = provider;
  config.model = model || undefined;
  saveConfig(config);
}

function openBrowser(url: string): void {
  const { exec } = require("child_process") as typeof import("child_process");
  const cmd = process.platform === "darwin" ? `open "${url}"`
    : process.platform === "win32" ? `start "" "${url}"`
    : `xdg-open "${url}"`;
  exec(cmd, () => {});
}
