/**
 * Setup Route — Multi-step setup wizard for configuring the remote coding agent.
 *
 * Steps:
 *   1. Provider — arrow-key selection from getProviders()
 *   2. Auth — OAuth / API key / env / skip
 *   3. Assistant model — arrow-key selection
 *   4. Skills — checklist (Y/n toggle for each)
 *   5. Coding model setup (if coding-agent skill enabled) — provider + model
 *   6. Channel — Telegram token input, Discord toggle
 *   7. Security — auto-generated auth token, permission mode selection
 *   8. Working dir + port + log level
 *   9. Summary + write config
 *
 * On completion, writes config via writeSetupConfig and switches route to "dashboard".
 */

import { useState, useRef, useEffect } from "react";
import { TextAttributes } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { useTheme } from "../context/theme";
import { useEngine } from "../context/engine";
import { getProviders } from "@cdoing/ai";
import { supportsOAuth } from "@cdoing/core";
import { execSync } from "child_process";
import * as fs from "fs";
import * as nodePath from "path";
import { writeSetupConfig, generateSecretKey, CredentialManager } from "@cdoing/remote-coding-agent";
import type { Engine } from "@cdoing/remote-coding-agent";

// ── Directory completion helper ───────────────────────────────────────────

function getDirCompletions(partial: string): string[] {
  try {
    const resolved = partial.startsWith("~")
      ? nodePath.join(process.env.HOME || "", partial.substring(1))
      : nodePath.resolve(partial);
    const dir = partial.endsWith("/") ? resolved : nodePath.dirname(resolved);
    const prefix = partial.endsWith("/") ? "" : nodePath.basename(resolved);

    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return [];

    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .filter((e) => !prefix || e.name.toLowerCase().startsWith(prefix.toLowerCase()))
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 15)
      .map((e) => nodePath.join(dir, e.name) + "/");
  } catch {
    return [];
  }
}

// ── Data from centralized catalog ─────────────────────────────────────────

const _catalog = getProviders();

const PROVIDERS = _catalog.map((p: { id: string; label: string; hint: string }) => ({
  id: p.id,
  name: p.label,
  hint: p.hint,
}));

const MODELS: Record<string, { id: string; name: string; hint?: string }[]> = {};
for (const p of _catalog) {
  MODELS[p.id] = p.models.map((m: { id: string; label: string; hint?: string }) => ({
    id: m.id,
    name: m.label,
    hint: m.hint,
  }));
}

const AUTH_METHODS = [
  { id: "oauth", name: "OAuth", hint: "opens browser — recommended" },
  { id: "apikey", name: "API Key", hint: "paste manually" },
  { id: "env", name: "Environment Variable", hint: "already set" },
  { id: "skip", name: "Skip", hint: "configure later" },
];

const PERMISSION_MODES = [
  { id: "auto", label: "Auto — Agent runs all tools without asking" },
  { id: "auto-edit", label: "Auto-Edit — Auto for reads, asks for writes" },
  { id: "ask", label: "Ask — Agent asks before every tool call" },
];

const LOG_LEVELS = ["info", "debug", "warn", "error"];

const SKILL_OPTIONS = [
  { id: "coding-agent", name: "Coding Agent", desc: "Delegate coding tasks to a powerful model", defaultOn: true },
];

// ── Helpers ───────────────────────────────────────────────────────────────

function readClipboard(): string {
  try {
    const { execSync } = require("child_process");
    if (process.platform === "darwin") return execSync("pbpaste", { encoding: "utf-8" });
    try { return execSync("xclip -selection clipboard -o", { encoding: "utf-8" }); }
    catch { return execSync("xsel --clipboard --output", { encoding: "utf-8" }); }
  } catch { return ""; }
}

// ── Component ─────────────────────────────────────────────────────────────

type Step = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

const TOTAL_STEPS = 9;

function stepTitle(step: Step): string {
  switch (step) {
    case 1: return "AI Provider";
    case 2: return "Authentication";
    case 3: return "Assistant Model";
    case 4: return "Skills";
    case 5: return "Coding Model Setup";
    case 6: return "Channels";
    case 7: return "Security";
    case 8: return "Working Directory, Port & Log Level";
    case 9: return "Summary";
  }
}

export interface SetupProps {
  onComplete: () => void;
}

export function Setup(props: SetupProps) {
  const { theme } = useTheme();
  const t = theme;
  const engine = useEngine();

  // ── Step tracking ──
  const [step, setStep] = useState<Step>(1);
  const [selectedIndex, setSelectedIndex] = useState(0);

  // ── Wizard state ──
  const [providerId, setProviderId] = useState("anthropic");
  const [providerName, setProviderName] = useState("Anthropic");
  const [authMethod, setAuthMethod] = useState<string>("apikey");
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [modelId, setModelId] = useState("");
  const [skillEnabled, setSkillEnabled] = useState<Record<string, boolean>>(() => {
    const m: Record<string, boolean> = {};
    for (const s of SKILL_OPTIONS) m[s.id] = s.defaultOn;
    return m;
  });

  // Coding model (step 5)
  const [codingSubStep, setCodingSubStep] = useState<"provider" | "model">("provider");
  const [codingProviderId, setCodingProviderId] = useState("anthropic");
  const [codingModelId, setCodingModelId] = useState("");

  // Channels (step 6)
  const [channelSubStep, setChannelSubStep] = useState<"telegram-toggle" | "telegram-token">("telegram-toggle");
  const [telegramEnabled, setTelegramEnabled] = useState(false);
  const [telegramToken, setTelegramToken] = useState("");

  // Security (step 7)
  const authTokenRef = useRef(generateSecretKey());
  const [permModeIndex, setPermModeIndex] = useState(0);
  const [secSubStep, setSecSubStep] = useState<"token" | "permission">("token");

  // Working dir, port, log level (step 8)
  const [envSubStep, setEnvSubStep] = useState<"workdir" | "port" | "loglevel">("workdir");
  const [workingDir, setWorkingDir] = useState(process.cwd());
  const [dirCompletions, setDirCompletions] = useState<string[]>([]);
  const [dirCompIdx, setDirCompIdx] = useState(-1);
  const [portInput, setPortInput] = useState("4567");
  const [logLevelIndex, setLogLevelIndex] = useState(0);

  // OAuth flow state
  const [oauthStatus, setOauthStatus] = useState<"idle" | "waiting" | "success" | "error">("idle");
  const [oauthMessage, setOauthMessage] = useState("");
  const oauthCloseRef = useRef<(() => void) | null>(null);

  // Error display
  const [error, setError] = useState("");

  // Summary written state
  const [configWritten, setConfigWritten] = useState(false);

  // ── Derived ──
  const models = MODELS[providerId] || [];
  const codingModels = MODELS[codingProviderId] || [];
  const hasCodingSkill = skillEnabled["coding-agent"] === true;
  const enabledSkillIds = Object.entries(skillEnabled).filter(([, v]) => v).map(([k]) => k);

  // ── Keyboard ──
  useKeyboard((key: any) => {
    if (key.name === "escape") {
      props.onComplete();
      return;
    }

    // ── Step 1: Provider ──
    if (step === 1) {
      if (key.name === "up" || key.name === "k") {
        setSelectedIndex((s) => Math.max(0, s - 1));
      } else if (key.name === "down" || key.name === "j") {
        setSelectedIndex((s) => Math.min(PROVIDERS.length - 1, s + 1));
      } else if (key.name === "return") {
        const p = PROVIDERS[selectedIndex];
        setProviderId(p.id);
        setProviderName(p.name);
        setSelectedIndex(0);
        setStep(2);
      }
      return;
    }

    // ── Step 2: Auth ──
    if (step === 2) {
      // If provider supports OAuth, show all options; otherwise filter
      const methods = supportsOAuth(providerId)
        ? AUTH_METHODS
        : AUTH_METHODS.filter((m) => m.id !== "oauth");

      if (authMethod === "") {
        // Selecting auth method
        if (key.name === "up" || key.name === "k") {
          setSelectedIndex((s) => Math.max(0, s - 1));
        } else if (key.name === "down" || key.name === "j") {
          setSelectedIndex((s) => Math.min(methods.length - 1, s + 1));
        } else if (key.name === "return") {
          const chosen = methods[selectedIndex];
          setAuthMethod(chosen.id);
          if (chosen.id === "apikey") {
            setApiKeyInput("");
            setShowKey(false);
            setError("");
          } else if (chosen.id === "skip" || chosen.id === "env") {
            setSelectedIndex(0);
            setStep(3);
          } else if (chosen.id === "oauth") {
            // Start OAuth flow: local server + open browser
            setOauthStatus("waiting");
            setOauthMessage("Starting OAuth server...");
            (async () => {
              try {
                const creds = new CredentialManager();
                const { url, codeVerifier, state, port, codePromise, close } =
                  await creds.startOAuth(providerId);
                oauthCloseRef.current = close;
                setOauthMessage(`Waiting for browser login on port ${port}...`);

                // Open browser
                const openCmd =
                  process.platform === "darwin" ? "open" :
                  process.platform === "win32" ? "start \"\"" : "xdg-open";
                try {
                  execSync(`${openCmd} "${url}"`, { stdio: "ignore" });
                } catch {
                  setOauthMessage(`Open this URL in your browser:\n${url}`);
                }

                const code = await codePromise;
                setOauthMessage("Exchanging code for token...");
                const localRedirectUri = `http://localhost:${port}/callback`;
                // Exchange + save to remote agent's own store (not the CLI's)
                await creds.completeOAuth(providerId, code, codeVerifier, localRedirectUri, state);
                setOauthStatus("success");
                setOauthMessage("Authenticated successfully!");
                oauthCloseRef.current = null;
                // Move to next step after short delay so user sees success
                setTimeout(() => {
                  setSelectedIndex(0);
                  setOauthStatus("idle");
                  setOauthMessage("");
                  setStep(3);
                }, 1000);
              } catch (err) {
                oauthCloseRef.current = null;
                setOauthStatus("error");
                setOauthMessage(
                  `OAuth failed: ${err instanceof Error ? err.message : String(err)}\nPress Enter to try API key instead.`
                );
              }
            })();
          }
        }
        return;
      }

      // Text input for API key
      if (authMethod === "apikey") {
        if (key.name === "return") {
          if (!apiKeyInput.trim()) {
            setError("API key cannot be empty");
            return;
          }
          setSelectedIndex(0);
          setError("");
          setStep(3);
        } else if ((key.ctrl || key.meta) && key.name === "v") {
          const clip = readClipboard().trim();
          if (clip) { setApiKeyInput((s) => s + clip); setError(""); }
        } else if (key.ctrl && key.name === "s") {
          setShowKey((s) => !s);
        } else if (key.name === "backspace") {
          setApiKeyInput((s) => s.slice(0, -1));
          setError("");
        } else if (key.ctrl && key.name === "u") {
          setApiKeyInput("");
          setError("");
        } else if (key.sequence && !key.ctrl && !key.meta) {
          setApiKeyInput((s) => s + key.sequence);
          setError("");
        }
        return;
      }
    }

    // ── Step 3: Model ──
    if (step === 3) {
      if (key.name === "up" || key.name === "k") {
        setSelectedIndex((s) => Math.max(0, s - 1));
      } else if (key.name === "down" || key.name === "j") {
        setSelectedIndex((s) => Math.min(models.length - 1, s + 1));
      } else if (key.name === "return") {
        const m = models[selectedIndex];
        if (m) {
          setModelId(m.id);
          setSelectedIndex(0);
          setStep(4);
        }
      }
      return;
    }

    // ── Step 4: Skills ──
    if (step === 4) {
      if (key.name === "up" || key.name === "k") {
        setSelectedIndex((s) => Math.max(0, s - 1));
      } else if (key.name === "down" || key.name === "j") {
        setSelectedIndex((s) => Math.min(SKILL_OPTIONS.length - 1, s + 1));
      } else if (key.name === "return" || key.name === "space" || key.sequence === " ") {
        const skill = SKILL_OPTIONS[selectedIndex];
        setSkillEnabled((prev) => ({ ...prev, [skill.id]: !prev[skill.id] }));
      } else if (key.sequence === "y" || key.sequence === "Y") {
        const skill = SKILL_OPTIONS[selectedIndex];
        setSkillEnabled((prev) => ({ ...prev, [skill.id]: true }));
      } else if (key.sequence === "n" || key.sequence === "N") {
        const skill = SKILL_OPTIONS[selectedIndex];
        setSkillEnabled((prev) => ({ ...prev, [skill.id]: false }));
      } else if (key.name === "tab") {
        // Proceed to next step
        setSelectedIndex(0);
        if (skillEnabled["coding-agent"]) {
          setCodingSubStep("provider");
          setStep(5);
        } else {
          setChannelSubStep("telegram-toggle");
          setStep(6);
        }
      }
      return;
    }

    // ── Step 5: Coding model ──
    if (step === 5) {
      if (codingSubStep === "provider") {
        if (key.name === "up" || key.name === "k") {
          setSelectedIndex((s) => Math.max(0, s - 1));
        } else if (key.name === "down" || key.name === "j") {
          setSelectedIndex((s) => Math.min(PROVIDERS.length - 1, s + 1));
        } else if (key.name === "return") {
          const p = PROVIDERS[selectedIndex];
          setCodingProviderId(p.id);
          setSelectedIndex(0);
          setCodingSubStep("model");
        }
      } else if (codingSubStep === "model") {
        if (key.name === "up" || key.name === "k") {
          setSelectedIndex((s) => Math.max(0, s - 1));
        } else if (key.name === "down" || key.name === "j") {
          setSelectedIndex((s) => Math.min(codingModels.length - 1, s + 1));
        } else if (key.name === "return") {
          const m = codingModels[selectedIndex];
          if (m) {
            setCodingModelId(m.id);
            setSelectedIndex(0);
            setChannelSubStep("telegram-toggle");
            setStep(6);
          }
        }
      }
      return;
    }

    // ── Step 6: Channels ──
    if (step === 6) {
      if (channelSubStep === "telegram-toggle") {
        if (key.sequence === "y" || key.sequence === "Y") {
          setTelegramEnabled(true);
          setChannelSubStep("telegram-token");
        } else if (key.sequence === "n" || key.sequence === "N" || key.name === "return") {
          if (!telegramEnabled) {
            // Skip token input, go to security
            setSelectedIndex(0);
            setSecSubStep("token");
            setStep(7);
          } else {
            setChannelSubStep("telegram-token");
          }
        }
      } else if (channelSubStep === "telegram-token") {
        if (key.name === "return") {
          setSelectedIndex(0);
          setSecSubStep("token");
          setStep(7);
        } else if ((key.ctrl || key.meta) && key.name === "v") {
          const clip = readClipboard().trim();
          if (clip) setTelegramToken((s) => s + clip);
        } else if (key.name === "backspace") {
          setTelegramToken((s) => s.slice(0, -1));
        } else if (key.ctrl && key.name === "u") {
          setTelegramToken("");
        } else if (key.sequence && !key.ctrl && !key.meta) {
          setTelegramToken((s) => s + key.sequence);
        }
      }
      return;
    }

    // ── Step 7: Security ──
    if (step === 7) {
      if (secSubStep === "token") {
        if (key.name === "return") {
          setSelectedIndex(0);
          setSecSubStep("permission");
        }
      } else if (secSubStep === "permission") {
        if (key.name === "up" || key.name === "k") {
          setPermModeIndex((s) => Math.max(0, s - 1));
        } else if (key.name === "down" || key.name === "j") {
          setPermModeIndex((s) => Math.min(PERMISSION_MODES.length - 1, s + 1));
        } else if (key.name === "return") {
          setSelectedIndex(0);
          setEnvSubStep("workdir");
          setStep(8);
        }
      }
      return;
    }

    // ── Step 8: Working dir, port, log level ──
    if (step === 8) {
      if (envSubStep === "workdir") {
        if (key.name === "return") {
          setDirCompletions([]);
          setDirCompIdx(-1);
          setEnvSubStep("port");
        } else if (key.name === "tab") {
          // Tab completion for directories
          if (dirCompletions.length === 0) {
            const comps = getDirCompletions(workingDir);
            if (comps.length === 1) {
              setWorkingDir(comps[0]);
            } else if (comps.length > 1) {
              setDirCompletions(comps);
              setDirCompIdx(0);
              setWorkingDir(comps[0]);
            }
          } else {
            // Cycle through completions
            const next = (dirCompIdx + 1) % dirCompletions.length;
            setDirCompIdx(next);
            setWorkingDir(dirCompletions[next]);
          }
        } else if ((key.ctrl || key.meta) && key.name === "v") {
          const clip = readClipboard().trim();
          if (clip) { setWorkingDir((s) => s + clip); setDirCompletions([]); setDirCompIdx(-1); }
        } else if (key.name === "backspace") {
          setWorkingDir((s) => s.slice(0, -1));
          setDirCompletions([]); setDirCompIdx(-1);
        } else if (key.ctrl && key.name === "u") {
          setWorkingDir("");
          setDirCompletions([]); setDirCompIdx(-1);
        } else if (key.sequence && !key.ctrl && !key.meta) {
          setWorkingDir((s) => s + key.sequence);
          setDirCompletions([]); setDirCompIdx(-1);
        }
      } else if (envSubStep === "port") {
        if (key.name === "return") {
          setSelectedIndex(0);
          setEnvSubStep("loglevel");
        } else if (key.name === "backspace") {
          setPortInput((s) => s.slice(0, -1));
        } else if (key.ctrl && key.name === "u") {
          setPortInput("");
        } else if (key.sequence && /\d/.test(key.sequence)) {
          setPortInput((s) => s + key.sequence);
        }
      } else if (envSubStep === "loglevel") {
        if (key.name === "up" || key.name === "k") {
          setLogLevelIndex((s) => Math.max(0, s - 1));
        } else if (key.name === "down" || key.name === "j") {
          setLogLevelIndex((s) => Math.min(LOG_LEVELS.length - 1, s + 1));
        } else if (key.name === "return") {
          setStep(9);
        }
      }
      return;
    }

    // ── Step 9: Summary ──
    if (step === 9) {
      if (key.name === "return") {
        // Write config and finish
        const result = {
          provider: providerId,
          model: modelId,
          apiKey: authMethod === "apikey" ? apiKeyInput.trim() : undefined,
          usedOAuth: authMethod === "oauth",
          hasCodingModel: hasCodingSkill,
          codingProvider: hasCodingSkill ? codingProviderId : undefined,
          codingModel: hasCodingSkill ? codingModelId : undefined,
          codingApiKey: undefined,
          telegramEnabled,
          telegramToken: telegramToken || undefined,
          authToken: authTokenRef.current,
          allowedDirs: [workingDir],
          workingDir,
          port: parseInt(portInput, 10) || 4567,
          permissionMode: PERMISSION_MODES[permModeIndex].id,
          logLevel: LOG_LEVELS[logLevelIndex],
          enabledSkills: enabledSkillIds,
          gatewayBind: "loopback" as const,
          gatewayAuthMode: "token" as const,
        };
        writeSetupConfig(result);

        // Save API key to CredentialManager so engine can resolve it
        if (authMethod === "apikey" && apiKeyInput.trim()) {
          try {
            const creds = new CredentialManager();
            creds.saveApiKey(providerId, apiKeyInput.trim(), "assistant");
          } catch { /* non-fatal */ }
        }

        setConfigWritten(true);
        props.onComplete();
      }
      return;
    }
  });

  // Reset selectedIndex and auth method for step 2 entry
  useEffect(() => {
    if (step === 2) {
      setAuthMethod("");
      setSelectedIndex(0);
    }
  }, [step]);

  // ── Render ──────────────────────────────────────────────────────────────

  const header = `Step ${step}/${TOTAL_STEPS}: ${stepTitle(step)}`;

  return (
    <box flexDirection="column" flexGrow={1} paddingX={2} paddingY={1}>
      <text fg={t.primary} attributes={TextAttributes.BOLD}>
        {"Remote Coding Agent — Setup Wizard"}
      </text>
      <text>{""}</text>
      <text fg={t.text} attributes={TextAttributes.BOLD}>
        {header}
      </text>
      <text>{""}</text>

      {/* Step 1: Provider */}
      {step === 1 && (
        <box flexDirection="column">
          <text fg={t.textDim}>{"Select your AI provider:"}</text>
          <text>{""}</text>
          {PROVIDERS.map((p: { id: string; name: string; hint: string }, i: number) => (
            <text
              key={p.id}
              fg={selectedIndex === i ? t.primary : t.textMuted}
              {...(selectedIndex === i ? { attributes: TextAttributes.BOLD } : {})}
            >
              {`  ${selectedIndex === i ? ">" : " "} ${p.name}  ${selectedIndex === i ? p.hint : ""}`}
            </text>
          ))}
          <text>{""}</text>
          <text fg={t.textMuted}>{"  Up/Down Navigate  Enter Select  Esc Cancel"}</text>
        </box>
      )}

      {/* Step 2: Auth — method selection */}
      {step === 2 && authMethod === "" && (() => {
        const methods = supportsOAuth(providerId)
          ? AUTH_METHODS
          : AUTH_METHODS.filter((m) => m.id !== "oauth");
        return (
          <box flexDirection="column">
            <text fg={t.textDim}>{`How do you want to authenticate with ${providerName}?`}</text>
            <text>{""}</text>
            {methods.map((m, i) => (
              <text
                key={m.id}
                fg={selectedIndex === i ? t.primary : t.textMuted}
                {...(selectedIndex === i ? { attributes: TextAttributes.BOLD } : {})}
              >
                {`  ${selectedIndex === i ? ">" : " "} ${m.name}  ${selectedIndex === i ? m.hint : ""}`}
              </text>
            ))}
            <text>{""}</text>
            <text fg={t.textMuted}>{"  Up/Down Navigate  Enter Select  Esc Cancel"}</text>
          </box>
        );
      })()}

      {/* Step 2: Auth — API key input */}
      {step === 2 && authMethod === "apikey" && (
        <box flexDirection="column">
          <text fg={t.textDim}>{`Enter your ${providerName} API key:`}</text>
          <text>{""}</text>
          <text fg={t.text}>
            {`  > ${showKey ? apiKeyInput : apiKeyInput.replace(/./g, "*")}|`}
          </text>
          {error && <text fg={t.error}>{`  ${error}`}</text>}
          <text>{""}</text>
          <text fg={t.textMuted}>{"  Enter Confirm  Ctrl+V Paste  Ctrl+S Toggle visibility  Esc Cancel"}</text>
        </box>
      )}

      {/* Step 3: Model */}
      {step === 3 && (
        <box flexDirection="column">
          <text fg={t.textDim}>{`Select assistant model (${providerName}):`}</text>
          <text fg={t.textDim}>{"  Use a fast/cheap model for chat and routing."}</text>
          <text>{""}</text>
          {models.map((m: { id: string; name: string; hint?: string }, i: number) => (
            <text
              key={m.id}
              fg={selectedIndex === i ? t.primary : t.textMuted}
              {...(selectedIndex === i ? { attributes: TextAttributes.BOLD } : {})}
            >
              {`  ${selectedIndex === i ? ">" : " "} ${m.name}${m.hint ? `  ${m.hint}` : ""}`}
            </text>
          ))}
          <text>{""}</text>
          <text fg={t.textMuted}>{"  Up/Down Navigate  Enter Select  Esc Cancel"}</text>
        </box>
      )}

      {/* Step 4: Skills */}
      {step === 4 && (
        <box flexDirection="column">
          <text fg={t.textDim}>{"Toggle skills on/off. Press Tab when done."}</text>
          <text>{""}</text>
          {SKILL_OPTIONS.map((s, i) => {
            const on = skillEnabled[s.id];
            const marker = on ? "[Y]" : "[n]";
            const markerColor = on ? t.success : t.textMuted;
            return (
              <box key={s.id} flexDirection="row">
                <text
                  fg={selectedIndex === i ? t.primary : t.textMuted}
                  {...(selectedIndex === i ? { attributes: TextAttributes.BOLD } : {})}
                >
                  {`  ${selectedIndex === i ? ">" : " "} `}
                </text>
                <text fg={markerColor}>{marker}</text>
                <text
                  fg={selectedIndex === i ? t.primary : t.textMuted}
                  {...(selectedIndex === i ? { attributes: TextAttributes.BOLD } : {})}
                >
                  {` ${s.name} — ${s.desc}`}
                </text>
              </box>
            );
          })}
          <text>{""}</text>
          <text fg={t.textMuted}>{"  Up/Down Navigate  Enter/Space Toggle  Y Enable  N Disable  Tab Continue"}</text>
        </box>
      )}

      {/* Step 5: Coding model — provider */}
      {step === 5 && codingSubStep === "provider" && (
        <box flexDirection="column">
          <text fg={t.textDim}>{"Select provider for the coding agent:"}</text>
          <text fg={t.textDim}>{"  The coding agent handles file edits, builds, and complex tasks."}</text>
          <text>{""}</text>
          {PROVIDERS.map((p: { id: string; name: string; hint: string }, i: number) => (
            <text
              key={p.id}
              fg={selectedIndex === i ? t.primary : t.textMuted}
              {...(selectedIndex === i ? { attributes: TextAttributes.BOLD } : {})}
            >
              {`  ${selectedIndex === i ? ">" : " "} ${p.name}`}
            </text>
          ))}
          <text>{""}</text>
          <text fg={t.textMuted}>{"  Up/Down Navigate  Enter Select  Esc Cancel"}</text>
        </box>
      )}

      {/* Step 5: Coding model — model selection */}
      {step === 5 && codingSubStep === "model" && (
        <box flexDirection="column">
          <text fg={t.textDim}>{`Select coding model (${PROVIDERS.find((p) => p.id === codingProviderId)?.name || codingProviderId}):`}</text>
          <text fg={t.textDim}>{"  Use a powerful model here (e.g., Sonnet, GPT-4o)."}</text>
          <text>{""}</text>
          {codingModels.map((m: { id: string; name: string; hint?: string }, i: number) => (
            <text
              key={m.id}
              fg={selectedIndex === i ? t.primary : t.textMuted}
              {...(selectedIndex === i ? { attributes: TextAttributes.BOLD } : {})}
            >
              {`  ${selectedIndex === i ? ">" : " "} ${m.name}${m.hint ? `  ${m.hint}` : ""}`}
            </text>
          ))}
          <text>{""}</text>
          <text fg={t.textMuted}>{"  Up/Down Navigate  Enter Select  Esc Cancel"}</text>
        </box>
      )}

      {/* Step 6: Channels — Telegram toggle */}
      {step === 6 && channelSubStep === "telegram-toggle" && (
        <box flexDirection="column">
          <text fg={t.textDim}>{"Configure channels for communicating with your agent."}</text>
          <text>{""}</text>
          <text fg={t.text}>{"  Enable Telegram channel? (Y/n)"}</text>
          <text>{""}</text>
          <text fg={t.textMuted}>{"  Y Yes  N No  Esc Cancel"}</text>
        </box>
      )}

      {/* Step 6: Channels — Telegram token */}
      {step === 6 && channelSubStep === "telegram-token" && (
        <box flexDirection="column">
          <text fg={t.textDim}>{"Enter Telegram bot token (from @BotFather). Press Enter to skip."}</text>
          <text>{""}</text>
          <text fg={t.text}>
            {`  > ${telegramToken}|`}
          </text>
          <text>{""}</text>
          <text fg={t.textMuted}>{"  Enter Continue  Ctrl+V Paste  Esc Cancel"}</text>
        </box>
      )}

      {/* Step 7: Security — auth token */}
      {step === 7 && secSubStep === "token" && (
        <box flexDirection="column">
          <text fg={t.textDim}>{"A secure auth token has been generated for API and dashboard access."}</text>
          <text>{""}</text>
          <text fg={t.success}>{"  Auth Token:"}</text>
          <text fg={t.warning}>{`  ${authTokenRef.current.substring(0, 12)}...${authTokenRef.current.substring(authTokenRef.current.length - 8)}`}</text>
          <text>{""}</text>
          <text fg={t.textDim}>{"  Keep this secret! You will need it to access the dashboard."}</text>
          <text>{""}</text>
          <text fg={t.textMuted}>{"  Enter Continue  Esc Cancel"}</text>
        </box>
      )}

      {/* Step 7: Security — permission mode */}
      {step === 7 && secSubStep === "permission" && (
        <box flexDirection="column">
          <text fg={t.textDim}>{"Select permission mode (how much freedom the agent has):"}</text>
          <text>{""}</text>
          {PERMISSION_MODES.map((m, i) => (
            <text
              key={m.id}
              fg={permModeIndex === i ? t.primary : t.textMuted}
              {...(permModeIndex === i ? { attributes: TextAttributes.BOLD } : {})}
            >
              {`  ${permModeIndex === i ? ">" : " "} ${m.label}`}
            </text>
          ))}
          <text>{""}</text>
          <text fg={t.textMuted}>{"  Up/Down Navigate  Enter Select  Esc Cancel"}</text>
        </box>
      )}

      {/* Step 8: Working dir */}
      {step === 8 && envSubStep === "workdir" && (
        <box flexDirection="column">
          <text fg={t.textDim}>{"Working directory for coding operations:"}</text>
          <text>{""}</text>
          <text fg={t.text}>
            {`  > ${workingDir}|`}
          </text>
          {dirCompletions.length > 1 && (
            <box flexDirection="column">
              <text>{""}</text>
              {dirCompletions.slice(0, 8).map((c, i) => (
                <text key={c} fg={i === dirCompIdx ? t.primary : t.textDim}>
                  {`  ${i === dirCompIdx ? ">" : " "} ${c}`}
                </text>
              ))}
              {dirCompletions.length > 8 && (
                <text fg={t.textDim}>{`    ...and ${dirCompletions.length - 8} more`}</text>
              )}
            </box>
          )}
          <text>{""}</text>
          <text fg={t.textMuted}>{"  Tab Autocomplete  Enter Continue  Ctrl+V Paste"}</text>
        </box>
      )}

      {/* Step 8: Port */}
      {step === 8 && envSubStep === "port" && (
        <box flexDirection="column">
          <text fg={t.textDim}>{"Gateway port:"}</text>
          <text>{""}</text>
          <text fg={t.text}>
            {`  > ${portInput}|`}
          </text>
          <text>{""}</text>
          <text fg={t.textMuted}>{"  Enter Continue  Esc Cancel"}</text>
        </box>
      )}

      {/* Step 8: Log level */}
      {step === 8 && envSubStep === "loglevel" && (
        <box flexDirection="column">
          <text fg={t.textDim}>{"Select log level:"}</text>
          <text>{""}</text>
          {LOG_LEVELS.map((level, i) => (
            <text
              key={level}
              fg={logLevelIndex === i ? t.primary : t.textMuted}
              {...(logLevelIndex === i ? { attributes: TextAttributes.BOLD } : {})}
            >
              {`  ${logLevelIndex === i ? ">" : " "} ${level}`}
            </text>
          ))}
          <text>{""}</text>
          <text fg={t.textMuted}>{"  Up/Down Navigate  Enter Continue  Esc Cancel"}</text>
        </box>
      )}

      {/* Step 9: Summary */}
      {step === 9 && (
        <box flexDirection="column">
          <text fg={t.textDim}>{"Review your configuration and press Enter to save."}</text>
          <text>{""}</text>
          <text fg={t.text} attributes={TextAttributes.BOLD}>{"  Configuration Summary"}</text>
          <text>{""}</text>
          <text fg={t.text}>{`    Assistant:    ${providerName} / ${modelId}`}</text>
          <text fg={t.text}>{`    Auth:         ${authMethod === "oauth" ? "OAuth" : authMethod === "apikey" ? "API Key" : authMethod === "env" ? "Env Variable" : "Skipped"}`}</text>
          {hasCodingSkill && (
            <text fg={t.text}>{`    Coding:       ${PROVIDERS.find((p) => p.id === codingProviderId)?.name || codingProviderId} / ${codingModelId}`}</text>
          )}
          <text fg={t.text}>{`    Skills:       ${enabledSkillIds.join(", ")}`}</text>
          <text fg={t.text}>{`    Telegram:     ${telegramEnabled ? "enabled" : "disabled"}`}</text>
          <text fg={t.text}>{`    Permission:   ${PERMISSION_MODES[permModeIndex].id}`}</text>
          <text fg={t.text}>{`    Working dir:  ${workingDir}`}</text>
          <text fg={t.text}>{`    Port:         ${portInput}`}</text>
          <text fg={t.text}>{`    Log level:    ${LOG_LEVELS[logLevelIndex]}`}</text>
          <text>{""}</text>
          <text fg={t.warning}>{`    Auth token:   ${authTokenRef.current.substring(0, 8)}...`}</text>
          <text>{""}</text>
          <text fg={t.textMuted}>{"  Enter Save & Continue  Esc Cancel"}</text>
        </box>
      )}
    </box>
  );
}
