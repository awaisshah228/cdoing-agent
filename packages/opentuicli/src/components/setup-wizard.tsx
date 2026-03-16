/**
 * SetupWizard — Interactive setup overlay for configuring provider, model, API key, or OAuth
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
import { execSync } from "child_process";
import { TextAttributes } from "@opentui/core";
import { useState, useRef, useEffect } from "react";
import { useKeyboard } from "@opentui/react";
import { useTheme } from "../context/theme";

export interface SetupWizardProps {
  onComplete: (config: { provider: string; model: string; apiKey?: string; oauthToken?: string }) => void;
  onClose: () => void;
}

const PROVIDERS = [
  { id: "anthropic", name: "Anthropic (Claude)", hint: "Claude Sonnet, Opus, Haiku" },
  { id: "openai", name: "OpenAI", hint: "GPT-4o, o3" },
  { id: "google", name: "Google AI", hint: "Gemini 2.0 Flash, 2.5 Pro" },
  { id: "ollama", name: "Ollama (Local)", hint: "No API key needed" },
];

const AUTH_METHODS = [
  { id: "apikey", name: "API Key", hint: "all models available - console.anthropic.com" },
  { id: "oauth", name: "OAuth", hint: "Claude Pro/Max - opens browser" },
];

const MODELS: Record<string, { id: string; name: string; hint?: string }[]> = {
  anthropic: [
    { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6", hint: "recommended - fast & smart" },
    { id: "claude-opus-4-6", name: "Claude Opus 4.6", hint: "most capable" },
    { id: "claude-haiku-4-5-20251001", name: "Claude Haiku 4.5", hint: "fastest" },
  ],
  openai: [
    { id: "gpt-4o", name: "GPT-4o", hint: "recommended" },
    { id: "gpt-4o-mini", name: "GPT-4o mini", hint: "fastest" },
    { id: "o3", name: "o3", hint: "reasoning" },
  ],
  google: [
    { id: "gemini-2.0-flash", name: "Gemini 2.0 Flash", hint: "recommended" },
    { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro", hint: "most capable" },
  ],
  ollama: [
    { id: "llama3.1", name: "Llama 3.1", hint: "general purpose" },
    { id: "codellama", name: "Code Llama", hint: "code-focused" },
    { id: "mistral", name: "Mistral", hint: "fast & capable" },
  ],
};

const OAUTH_MODELS = [
  { id: "claude-haiku-4-5", name: "Claude Haiku 4.5", hint: "only model supported with OAuth" },
];

const ENV_VARS: Record<string, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  google: "GOOGLE_API_KEY",
};

const KEY_URLS: Record<string, string> = {
  anthropic: "https://console.anthropic.com/settings/keys",
  openai: "https://platform.openai.com/api-keys",
  google: "https://aistudio.google.com/apikey",
};

type Step = "provider" | "auth-method" | "model" | "apikey" | "oauth-paste" | "oauth-exchanging";

function openBrowser(url: string): void {
  try {
    const cmd = process.platform === "darwin" ? `open "${url}"`
      : process.platform === "win32" ? `start "" "${url}"`
      : `xdg-open "${url}"`;
    execSync(cmd, { stdio: "ignore", timeout: 3000 });
  } catch { /* browser open is best-effort */ }
}

export function SetupWizard(props: SetupWizardProps) {
  const { theme } = useTheme();
  const t = theme;

  const [step, setStep] = useState<Step>("provider");
  const [selectedProvider, setSelectedProvider] = useState(0);
  const [selectedAuth, setSelectedAuth] = useState(0);
  const [selectedModel, setSelectedModel] = useState(0);
  const [authMethod, setAuthMethod] = useState<"apikey" | "oauth">("apikey");
  const [chosenProviderId, setChosenProviderId] = useState("anthropic");
  const [chosenModelId, setChosenModelId] = useState("");
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [error, setError] = useState("");

  // OAuth state
  const [oauthUrl, setOauthUrl] = useState("");
  const [oauthVerifier, setOauthVerifier] = useState("");
  const [oauthCodeInput, setOauthCodeInput] = useState("");
  const [showCode, setShowCode] = useState(false);
  const [oauthError, setOauthError] = useState("");
  const exchangingRef = useRef(false);

  const provider = PROVIDERS[selectedProvider];
  const models = authMethod === "oauth" ? OAUTH_MODELS : (MODELS[chosenProviderId] || []);

  // Generate OAuth URL when entering oauth-paste step
  useEffect(() => {
    if (step !== "oauth-paste") return;
    try {
      const { generateOAuthUrl } = require("@cdoing/core");
      const { url, codeVerifier } = generateOAuthUrl(chosenProviderId);
      setOauthUrl(url);
      setOauthVerifier(codeVerifier);
      setOauthCodeInput("");
      setOauthError("");
      openBrowser(url);
    } catch {
      setOauthError("OAuth not available. Install @cdoing/core with OAuth support.");
    }
  }, [step, chosenProviderId]);

  useKeyboard((key: any) => {
    // Escape — go back or close
    if (key.name === "escape") {
      if (step === "oauth-paste" || step === "oauth-exchanging") {
        setStep("model");
        setOauthError("");
      } else if (step === "apikey") {
        setStep("model");
        setError("");
      } else if (step === "model") {
        setStep(chosenProviderId === "anthropic" ? "auth-method" : "provider");
      } else if (step === "auth-method") {
        setStep("provider");
      } else {
        props.onClose();
      }
      return;
    }

    // ── Step 1: Provider ──
    if (step === "provider") {
      if (key.name === "up" || key.name === "k") {
        setSelectedProvider((s) => Math.max(0, s - 1));
      } else if (key.name === "down" || key.name === "j") {
        setSelectedProvider((s) => Math.min(PROVIDERS.length - 1, s + 1));
      } else if (key.name === "return") {
        const p = PROVIDERS[selectedProvider];
        setChosenProviderId(p.id);
        setSelectedModel(0);
        if (p.id === "anthropic") {
          setSelectedAuth(0);
          setStep("auth-method");
        } else {
          setAuthMethod("apikey");
          setStep("model");
        }
      }
      return;
    }

    // ── Step 2: Auth method (Anthropic only) ──
    if (step === "auth-method") {
      if (key.name === "up" || key.name === "k") {
        setSelectedAuth((s) => Math.max(0, s - 1));
      } else if (key.name === "down" || key.name === "j") {
        setSelectedAuth((s) => Math.min(AUTH_METHODS.length - 1, s + 1));
      } else if (key.name === "return") {
        const auth = AUTH_METHODS[selectedAuth].id as "apikey" | "oauth";
        setAuthMethod(auth);
        setSelectedModel(0);
        setStep("model");
      }
      return;
    }

    // ── Step 3: Model ──
    if (step === "model") {
      if (key.name === "up" || key.name === "k") {
        setSelectedModel((s) => Math.max(0, s - 1));
      } else if (key.name === "down" || key.name === "j") {
        setSelectedModel((s) => Math.min(models.length - 1, s + 1));
      } else if (key.name === "return") {
        const m = models[selectedModel];
        setChosenModelId(m.id);
        if (chosenProviderId === "ollama") {
          saveAndComplete(chosenProviderId, m.id, undefined);
        } else if (authMethod === "oauth") {
          exchangingRef.current = false;
          setStep("oauth-paste");
        } else {
          setStep("apikey");
          setApiKeyInput("");
          setError("");
        }
      }
      return;
    }

    // ── Step 4a: API key ──
    if (step === "apikey") {
      if (key.name === "return") {
        if (!apiKeyInput.trim()) {
          setError("API key cannot be empty");
          return;
        }
        saveAndComplete(chosenProviderId, chosenModelId, apiKeyInput.trim());
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
      return;
    }

    // ── Step 4b: OAuth code paste ──
    if (step === "oauth-paste") {
      if (key.name === "return") {
        const code = oauthCodeInput.trim();
        if (!code || exchangingRef.current) return;
        exchangingRef.current = true;
        setStep("oauth-exchanging");
        try {
          const { exchangeOAuthCode } = require("@cdoing/core");
          exchangeOAuthCode(code, oauthVerifier, chosenProviderId)
            .then((tokens: any) => {
              saveAndComplete(chosenProviderId, chosenModelId, undefined);
              props.onComplete({
                provider: chosenProviderId,
                model: chosenModelId,
                oauthToken: tokens.access_token,
              });
            })
            .catch((err: Error) => {
              exchangingRef.current = false;
              setOauthError(err.message);
              setStep("oauth-paste");
            });
        } catch {
          exchangingRef.current = false;
          setOauthError("OAuth exchange failed");
          setStep("oauth-paste");
        }
        return;
      }
      if (key.ctrl && key.name === "s") {
        setShowCode((s) => !s);
      } else if (key.name === "backspace") {
        setOauthCodeInput((s) => s.slice(0, -1));
        setOauthError("");
      } else if (key.ctrl && key.name === "u") {
        setOauthCodeInput("");
        setOauthError("");
      } else if (key.sequence && key.sequence.length === 1 && !key.ctrl && !key.meta) {
        setOauthCodeInput((s) => s + key.sequence);
        setOauthError("");
      }
      return;
    }
  });

  const saveAndComplete = (prov: string, model: string, apiKey?: string) => {
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

  // Step numbers for display
  const isAnthropic = chosenProviderId === "anthropic";
  const total = isAnthropic ? 4 : chosenProviderId === "ollama" ? 2 : 3;
  const stepLabel = (s: Step): string => {
    switch (s) {
      case "provider": return `1/${total}`;
      case "auth-method": return "2/4";
      case "model": return isAnthropic ? "3/4" : chosenProviderId === "ollama" ? "2/2" : "2/3";
      case "apikey": return isAnthropic ? "4/4" : "3/3";
      case "oauth-paste": return "4/4";
      case "oauth-exchanging": return "4/4";
      default: return "";
    }
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
        {"Setup Wizard"}
      </text>
      <text>{""}</text>

      {/* Step 1: Provider */}
      {step === "provider" && (
        <box flexDirection="column">
          <text fg={t.text} attributes={TextAttributes.BOLD}>
            {`Step ${stepLabel("provider")}: Select Provider`}
          </text>
          <text>{""}</text>
          {PROVIDERS.map((p, i) => (
            <text
              key={p.id}
              fg={selectedProvider === i ? t.primary : t.textMuted}
              attributes={selectedProvider === i ? TextAttributes.BOLD : undefined}
            >
              {`  ${selectedProvider === i ? ">" : " "} ${p.name}  ${selectedProvider === i ? p.hint : ""}`}
            </text>
          ))}
          <text>{""}</text>
          <text fg={t.textMuted}>{"  Up/Down Navigate  Enter Select  Esc Cancel"}</text>
        </box>
      )}

      {/* Step 2: Auth method (Anthropic only) */}
      {step === "auth-method" && (
        <box flexDirection="column">
          <text fg={t.text} attributes={TextAttributes.BOLD}>
            {`Step ${stepLabel("auth-method")}: How do you want to authenticate?`}
          </text>
          <text>{""}</text>
          {AUTH_METHODS.map((a, i) => (
            <text
              key={a.id}
              fg={selectedAuth === i ? t.primary : t.textMuted}
              attributes={selectedAuth === i ? TextAttributes.BOLD : undefined}
            >
              {`  ${selectedAuth === i ? ">" : " "} ${a.name}  ${selectedAuth === i ? a.hint : ""}`}
            </text>
          ))}
          <text>{""}</text>
          <text fg={t.textMuted}>{"  Up/Down Navigate  Enter Select  Esc Back"}</text>
        </box>
      )}

      {/* Step 3: Model */}
      {step === "model" && (
        <box flexDirection="column">
          <text fg={t.text} attributes={TextAttributes.BOLD}>
            {authMethod === "oauth"
              ? `Step ${stepLabel("model")}: Select Model (OAuth supports Haiku only)`
              : `Step ${stepLabel("model")}: Select Model (${provider.name})`}
          </text>
          <text>{""}</text>
          {models.map((m, i) => (
            <text
              key={m.id}
              fg={selectedModel === i ? t.primary : t.textMuted}
              attributes={selectedModel === i ? TextAttributes.BOLD : undefined}
            >
              {`  ${selectedModel === i ? ">" : " "} ${m.name}${m.hint ? `  ${m.hint}` : ""}`}
            </text>
          ))}
          <text>{""}</text>
          <text fg={t.textMuted}>{"  Up/Down Navigate  Enter Select  Esc Back"}</text>
        </box>
      )}

      {/* Step 4a: API key */}
      {step === "apikey" && (
        <box flexDirection="column">
          <text fg={t.text} attributes={TextAttributes.BOLD}>
            {`Step ${stepLabel("apikey")}: Enter API Key`}
          </text>
          <text>{""}</text>
          <text fg={t.textDim}>
            {`  Provider: ${chosenProviderId}   Model: ${chosenModelId}`}
          </text>
          {KEY_URLS[chosenProviderId] && (
            <text fg={t.textDim}>
              {`  Get a key: ${KEY_URLS[chosenProviderId]}`}
            </text>
          )}
          <text fg={t.textDim}>
            {`  Environment variable: ${ENV_VARS[chosenProviderId] || "N/A"}`}
          </text>
          <text>{""}</text>
          <text fg={t.text}>
            {`  > ${showKey ? apiKeyInput : apiKeyInput.replace(/./g, "*")}|`}
          </text>
          {error && (
            <text fg={t.error}>{`\n  ${error}`}</text>
          )}
          <text>{""}</text>
          <text fg={t.textMuted}>{"  Enter Save  Ctrl+S Toggle visibility  Ctrl+U Clear  Esc Back"}</text>
        </box>
      )}

      {/* Step 4b: OAuth paste */}
      {step === "oauth-paste" && (
        <box flexDirection="column">
          <text fg={t.text} attributes={TextAttributes.BOLD}>
            {`Step ${stepLabel("oauth-paste")}: OAuth Login`}
          </text>
          <text>{""}</text>
          <text fg={t.text}>{"  1. Browser opening to Claude login..."}</text>
          {oauthUrl ? (
            <text fg={t.textDim}>{`     If it didn't open: ${oauthUrl.substring(0, 70)}...`}</text>
          ) : null}
          <text fg={t.text}>{"  2. Approve -> you'll land on a page with a code in the URL"}</text>
          <text fg={t.text}>{"  3. Copy the code= value from the URL and paste below"}</text>
          {oauthError ? (
            <>
              <text>{""}</text>
              <text fg={t.error}>{`  Error: ${oauthError}`}</text>
            </>
          ) : null}
          <text>{""}</text>
          <text fg={t.text}>
            {`  Code: ${showCode ? oauthCodeInput : oauthCodeInput.replace(/./g, "*")}|`}
          </text>
          <text>{""}</text>
          <text fg={t.textMuted}>{"  Paste code then Enter  Ctrl+S Toggle visible  Esc Cancel"}</text>
        </box>
      )}

      {/* Step 4b: OAuth exchanging */}
      {step === "oauth-exchanging" && (
        <box flexDirection="column">
          <text fg={t.text} attributes={TextAttributes.BOLD}>
            {`Step ${stepLabel("oauth-exchanging")}: OAuth Login`}
          </text>
          <text>{""}</text>
          <text fg={t.warning}>{"  Exchanging code for tokens..."}</text>
        </box>
      )}
    </box>
  );
}
