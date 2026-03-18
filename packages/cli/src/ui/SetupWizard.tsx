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
import open from "open";
import { loadConfig, saveConfig } from "../config";
import { exchangeOAuthCode, startLocalOAuthServer } from "../oauth";
import { getOAuthProvider, supportsOAuth } from "@cdoing/core";
import { getProviders, type ProviderEntry } from "@cdoing/ai";
import { getTheme } from "./theme";

// ── Data from centralized catalog ─────────────────────────────────────────────

const _catalog = getProviders();

const PROVIDERS = _catalog.map((p) => ({
  value: p.id,
  label: p.label,
  hint: p.hint,
}));

const AUTH_METHODS = [
  { value: "apikey", label: "API key",  hint: "all models available · console.anthropic.com" },
  { value: "oauth",  label: "OAuth",    hint: "Claude Pro/Max · opens browser" },
];

// All models per provider — from catalog
const ALL_MODELS: Record<string, { value: string; label: string; hint: string }[]> = {};
for (const p of _catalog) {
  ALL_MODELS[p.id] = p.models.map((m) => ({ value: m.id, label: m.label, hint: m.hint || "" }));
}

/** Get available OAuth models for a provider (from core config) */
function getOAuthModels(provider: string) {
  const config = getOAuthProvider(provider);
  if (!config?.models || config.models.length === 0) {
    return config?.defaultModel
      ? [{ value: config.defaultModel, label: config.defaultModel, hint: "OAuth" }]
      : [];
  }
  return config.models.map(m => ({ value: m.id, label: m.name, hint: m.hint || "OAuth" }));
}

// Key URLs from catalog
const KEY_URLS: Record<string, string> = {};
for (const p of _catalog) {
  if (p.keyUrl) KEY_URLS[p.id] = p.keyUrl;
}

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
  const t = getTheme();
  return (
    <Box flexDirection="column" paddingLeft={2}>
      <Text color={t.accent} bold>{title}</Text>
      <Text dimColor={t.useDim} color={t.textDim}>{"─".repeat(50)}</Text>
      {items.map((item, i) => {
        const isSelected = i === selectedIdx;
        return (
          <Box key={item.value}>
            {isSelected
              ? <Text color={t.accent} bold>{"  ❯ "}</Text>
              : <Text dimColor={t.useDim} color={t.textDim}>{"    "}</Text>}
            {isSelected
              ? <Text color={t.text} bold>{item.label}</Text>
              : <Text color={t.text}>{item.label}</Text>}
            {item.hint
              ? <Text dimColor={t.useDim} color={t.textDim}>{`  ${item.hint}`}</Text>
              : null}
          </Box>
        );
      })}
      <Text dimColor={t.useDim} color={t.textDim}>{"─".repeat(50)}</Text>
      <Text dimColor={t.useDim} color={t.textDim}>{"↑/↓ navigate  Enter select  Esc go back"}</Text>
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
  // Custom model input
  const [customModelInput, setCustomModelInput] = useState("");
  const [isCustomModel, setIsCustomModel]     = useState(false);
  // API key step
  const [apiKeyInput, setApiKeyInput]         = useState("");
  const [showKey, setShowKey]                 = useState(false);
  // OAuth paste step
  const [oauthUrl, setOauthUrl]               = useState("");
  const [consoleUrl, setConsoleUrl]           = useState("");
  const [oauthVerifier, setOauthVerifier]     = useState("");
  const [oauthState, setOauthState]           = useState("");
  const [oauthRedirectUri, setOauthRedirectUri] = useState("");
  const [oauthAutoCapturing, setOauthAutoCapturing] = useState(false);
  const [oauthCodeInput, setOauthCodeInput]   = useState("");
  const [showCode, setShowCode]               = useState(false);
  const [oauthError, setOauthError]           = useState("");
  const exchangingRef                         = useRef(false);

  // Start local OAuth server and open browser when entering oauth-paste step.
  // Mode 1 (auto): local server captures the code from browser redirect → auto-exchanges.
  // Mode 2 (fallback): if server fails, user pastes code manually.
  useEffect(() => {
    if (step !== "oauth-paste") return;
    let cancelled = false;
    let serverClose: (() => void) | undefined;

    setOauthCodeInput("");
    setOauthError("");
    setOauthAutoCapturing(false);

    (async () => {
      try {
        const server = await startLocalOAuthServer(chosenProvider);
        if (cancelled) { server.close(); return; }

        serverClose = server.close;
        const localRedirectUri = `http://localhost:${server.port}/callback`;

        setOauthUrl(server.url);
        setOauthVerifier(server.codeVerifier);
        setOauthState(server.state);
        setOauthRedirectUri(localRedirectUri);
        setOauthAutoCapturing(true);
        openBrowser(server.url);

        // Also generate console callback URL as fallback for manual paste
        if (chosenProvider === "anthropic") {
          const { generateOAuthUrl } = require("@cdoing/core");
          const fallback = generateOAuthUrl(chosenProvider);
          const fallbackUrl = new URL(fallback.url);
          fallbackUrl.searchParams.set("redirect_uri", "https://console.anthropic.com/oauth/code/callback");
          setConsoleUrl(fallbackUrl.toString());
        }

        // Auto-capture: wait for browser to redirect to localhost callback
        const code = await server.codePromise;
        if (cancelled) return;

        // Code received automatically — skip manual paste, go straight to exchange
        setOauthAutoCapturing(false);
        if (exchangingRef.current) return;
        exchangingRef.current = true;
        setStep("oauth-exchanging");
        exchangeOAuthCode(code, server.codeVerifier, chosenProvider, localRedirectUri, server.state)
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
      } catch {
        if (cancelled) return;
        // Server failed to start — fall back to manual code paste
        setOauthAutoCapturing(false);
        setOauthState("");
        setOauthRedirectUri("");
        // generateOAuthUrl not needed — oauthUrl stays empty, user sees the fallback hint
      }
    })();

    return () => {
      cancelled = true;
      serverClose?.();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // Returns the model list for the current provider + auth selection
  const getModels = useCallback((provider: string, authMethod: "apikey" | "oauth") => {
    if (authMethod === "oauth" && supportsOAuth(provider)) return getOAuthModels(provider);
    return ALL_MODELS[provider] || [];
  }, []);

  useInput(useCallback((char, key) => {
    // ── Go back (Esc) — step by step, cancel only from first step ─────
    if (key.escape) {
      if (step === "oauth-paste" || step === "oauth-exchanging") {
        setStep("model"); setOauthError(""); return;
      }
      if (step === "apikey") {
        setStep("model"); setApiKeyInput(""); return;
      }
      if (step === "model") {
        if (isCustomModel) { setIsCustomModel(false); return; }
        setStep(supportsOAuth(chosenProvider) ? "auth-method" : "provider"); return;
      }
      if (step === "auth-method") { setStep("provider"); return; }
      onCancel(); return;
    }

    // ── 1. Provider ───────────────────────────────────────────────────────
    if (step === "provider") {
      if (key.upArrow)   { setProviderIdx(i => Math.max(0, i - 1)); return; }
      if (key.downArrow) { setProviderIdx(i => Math.min(PROVIDERS.length - 1, i + 1)); return; }
      if (key.return) {
        const p = PROVIDERS[providerIdx].value;
        setChosenProvider(p);
        setAuthIdx(0);
        setIsCustomModel(false);
        setCustomModelInput("");
        if (supportsOAuth(p)) {
          setStep("auth-method");
        } else {
          const models = ALL_MODELS[p] || [];
          setModelIdx(Math.max(0, models.findIndex(m => m.value === currentModel)));
          setStep("model");
        }
        return;
      }
    }

    // ── 2. Auth method (any OAuth-capable provider) ─────────────────────
    if (step === "auth-method") {
      if (key.upArrow)   { setAuthIdx(i => Math.max(0, i - 1)); return; }
      if (key.downArrow) { setAuthIdx(i => Math.min(AUTH_METHODS.length - 1, i + 1)); return; }
      if (key.return) {
        const auth = AUTH_METHODS[authIdx].value as "apikey" | "oauth";
        setChosenAuthMethod(auth);
        const models = getModels(chosenProvider, auth);
        setModelIdx(Math.max(0, models.findIndex(m => m.value === currentModel)));
        setIsCustomModel(false);
        setCustomModelInput("");
        setStep("model");
        return;
      }
    }

    // ── 3. Model (presets + custom input) ──────────────────────────────
    if (step === "model") {
      // Custom model text input mode
      if (isCustomModel) {
        if (key.return) {
          const m = customModelInput.trim();
          if (!m) return;
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
        if (key.backspace || key.delete) { setCustomModelInput(k => k.slice(0, -1)); return; }
        if (char && !key.ctrl && !key.meta) { setCustomModelInput(k => k + char); return; }
        return;
      }

      // Preset model selection mode
      const models = getModels(chosenProvider, chosenAuthMethod);
      // Last item is "Custom model..." — enter custom input mode
      const totalItems = models.length + 1; // +1 for custom option
      if (key.upArrow)   { setModelIdx(i => Math.max(0, i - 1)); return; }
      if (key.downArrow) { setModelIdx(i => Math.min(totalItems - 1, i + 1)); return; }
      if (key.return) {
        if (modelIdx === models.length) {
          // Selected "Custom model..."
          setIsCustomModel(true);
          setCustomModelInput("");
          return;
        }
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

    // ── 4b. OAuth paste (manual fallback) ────────────────────────────────
    if (step === "oauth-paste") {
      if (key.return) {
        const code = oauthCodeInput.trim();
        if (!code || exchangingRef.current) return;
        exchangingRef.current = true;
        setStep("oauth-exchanging");
        // If user pasted manually and we have a console URL, use console callback redirect
        const redirectUri = consoleUrl
          ? "https://console.anthropic.com/oauth/code/callback"
          : oauthRedirectUri || undefined;
        exchangeOAuthCode(
          code,
          oauthVerifier,
          chosenProvider,
          redirectUri,
          consoleUrl ? undefined : oauthState || undefined,
        )
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
        <Text color={getTheme().accent} bold>{`  ⚙  Setup Wizard  (${stepNum.provider} — Provider)`}</Text>
        <Menu title={"  Choose a provider"} items={PROVIDERS} selectedIdx={providerIdx} />
      </Box>
    );
  }

  if (step === "auth-method") {
    return (
      <Box flexDirection="column" paddingY={1}>
        <Text color={getTheme().accent} bold>{`  ⚙  Setup Wizard  (${stepNum["auth-method"]} — Authentication)`}</Text>
        <Menu title={"  How do you want to authenticate?"} items={AUTH_METHODS} selectedIdx={authIdx} />
      </Box>
    );
  }

  if (step === "model") {
    const models = getModels(chosenProvider, chosenAuthMethod);
    const title = chosenProvider === "anthropic" && chosenAuthMethod === "oauth"
      ? "  Choose a model  (OAuth supports Haiku only)"
      : `  Choose a model for ${chosenProvider}`;
    const t = getTheme();

    // Custom model text input mode
    if (isCustomModel) {
      return (
        <Box flexDirection="column" paddingY={1} paddingLeft={2}>
          <Text color={t.accent} bold>{`  ⚙  Setup Wizard  (${stepNum.model} — Custom Model)`}</Text>
          <Text dimColor={t.useDim} color={t.textDim}>{"─".repeat(50)}</Text>
          <Text color={t.text}>{`  Provider: ${chosenProvider}`}</Text>
          <Text>{" "}</Text>
          <Box>
            <Text color={t.prompt}>{"  Model name: "}</Text>
            <Text color={t.text}>{customModelInput || " "}</Text>
            <Text color={t.cursor}>{"▊"}</Text>
          </Box>
          <Text>{" "}</Text>
          <Text dimColor={t.useDim} color={t.textDim}>{"  Type model ID then Enter  ·  Esc go back"}</Text>
        </Box>
      );
    }

    // Preset model selection with "Custom..." option at bottom
    const allItems = [
      ...models,
      { value: "__custom__", label: "Custom model...", hint: "type any model name" },
    ];
    return (
      <Box flexDirection="column" paddingY={1}>
        <Text color={t.accent} bold>{`  ⚙  Setup Wizard  (${stepNum.model} — Model)`}</Text>
        <Menu title={title} items={allItems} selectedIdx={modelIdx} />
      </Box>
    );
  }

  if (step === "apikey") {
    const tt = getTheme();
    const masked = showKey ? apiKeyInput : apiKeyInput.replace(/./g, "●");
    const url = KEY_URLS[chosenProvider];
    return (
      <Box flexDirection="column" paddingY={1} paddingLeft={2}>
        <Text color={tt.accent} bold>{`  ⚙  Setup Wizard  (${stepNum.apikey} — API Key)`}</Text>
        <Text dimColor={tt.useDim} color={tt.textDim}>{"─".repeat(50)}</Text>
        <Text color={tt.text}>{`  Provider: ${chosenProvider}   Model: ${chosenModel}`}</Text>
        {url ? <Text dimColor={tt.useDim} color={tt.textDim}>{`  Get a key: ${url}`}</Text> : null}
        <Text>{" "}</Text>
        <Box>
          <Text color={tt.prompt}>{"  API key: "}</Text>
          <Text color={tt.text}>{masked || " "}</Text>
          <Text color={tt.cursor}>{"▊"}</Text>
        </Box>
        <Text>{" "}</Text>
        <Text dimColor={tt.useDim} color={tt.textDim}>{"  Paste key then Enter  ·  Ctrl+S toggle visible  ·  Enter alone to skip"}</Text>
        <Text dimColor={tt.useDim} color={tt.textDim}>{"  Esc cancel"}</Text>
      </Box>
    );
  }

  if (step === "oauth-paste") {
    const tt = getTheme();
    const maskedCode = showCode ? oauthCodeInput : oauthCodeInput.replace(/./g, "●");
    return (
      <Box flexDirection="column" paddingY={1} paddingLeft={2}>
        <Text color={tt.accent} bold>{`  ⚙  Setup Wizard  (${stepNum["oauth-paste"]} — OAuth)`}</Text>
        <Text dimColor={tt.useDim} color={tt.textDim}>{"─".repeat(50)}</Text>
        <Text color={tt.text}>{"  1. Browser opening to Claude login…"}</Text>
        {oauthUrl
          ? <Text dimColor={tt.useDim} color={tt.textDim}>{`     If it didn't open: ${oauthUrl.substring(0, 72)}…`}</Text>
          : null}
        <Text color={tt.text}>{"  2. Log in and approve access"}</Text>
        <Text color={tt.text}>{"  3. Copy the code and paste below"}</Text>
        {oauthAutoCapturing && (
          <Text color={tt.warning}>{"     (or wait — code will be captured automatically)"}</Text>
        )}
        {consoleUrl ? (
          <>
            <Text>{" "}</Text>
            <Text dimColor={tt.useDim} color={tt.textDim}>{"  If browser didn't open, copy this link:"}</Text>
            <Text dimColor={tt.useDim} color={tt.textDim}>{`  ${consoleUrl.substring(0, 72)}…`}</Text>
          </>
        ) : null}
        {oauthError
          ? <Text color={tt.error}>{`\n  ✗ ${oauthError}`}</Text>
          : null}
        <Text>{" "}</Text>
        <Box>
          <Text color={tt.prompt}>{"  Code: "}</Text>
          <Text color={tt.text}>{maskedCode || " "}</Text>
          <Text color={tt.cursor}>{"▊"}</Text>
        </Box>
        <Text>{" "}</Text>
        <Text dimColor={tt.useDim} color={tt.textDim}>{"  Paste code then Enter  ·  Ctrl+S toggle visible  ·  Esc cancel"}</Text>
      </Box>
    );
  }

  if (step === "oauth-exchanging") {
    const tt = getTheme();
    return (
      <Box flexDirection="column" paddingY={1} paddingLeft={2}>
        <Text color={tt.accent} bold>{`  ⚙  Setup Wizard  (${stepNum["oauth-exchanging"]} — OAuth)`}</Text>
        <Text dimColor={tt.useDim} color={tt.textDim}>{"─".repeat(50)}</Text>
        <Text color={tt.warning}>{"  Exchanging code for tokens…"}</Text>
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
  open(url).catch(() => {});
}
