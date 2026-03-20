/**
 * Main TUI Application — OpenTUI + React
 *
 * Full-featured terminal UI with:
 *   - Agent integration (streaming, tool calls, permissions)
 *   - Permission prompt wiring (real UI prompts, not auto-allow)
 *   - Runtime model/provider switching with agent rebuild
 *   - Session browser overlay (Ctrl+S)
 *   - Setup wizard overlay (/setup)
 *   - Keyboard-driven navigation
 *   - Command palette (Ctrl+P)
 *   - Theme support (dark/light/auto)
 *   - Status bar with token counts and context %
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { createRoot, useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/react";
import { createCliRenderer, TextAttributes, RGBA } from "@opentui/core";
import { useState, useRef, useCallback } from "react";
import {
  ToolRegistry,
  PermissionManager,
  PermissionMode,
  ProcessManager,
  TodoStore,
  MemoryStore,
  registerAllTools,
  resolveOAuthToken,
  supportsOAuth,
} from "@cdoing/core";
import { AgentRunner, getDefaultModel, getApiKeyEnvVar } from "@cdoing/ai";
import type { ModelConfig } from "@cdoing/ai";

import { ThemeProvider, useTheme, detectTerminalTheme, restoreTerminalBackground, getThemeColors, setTerminalBackground } from "./context/theme";
import { SDKProvider } from "./context/sdk";
import { ToastProvider } from "./components/toast";
import { useSettingsStore } from "./store/settings";
import { Home } from "./routes/home";
import { SessionView } from "./routes/session";
import { StatusBar } from "./components/status-bar";
import { SessionHeader } from "./components/session-header";
import { SessionFooter } from "./components/session-footer";
import { Sidebar } from "./components/sidebar";
import { DialogModel } from "./components/dialog-model";
import { DialogCommand } from "./components/dialog-command";
import { DialogHelp } from "./components/dialog-help";
import { DialogTheme } from "./components/dialog-theme";
import { SessionBrowser } from "./components/session-browser";
import { SetupWizard } from "./components/setup-wizard";
import { DialogStatus } from "./components/dialog-status";
import { setTerminalTitle, resetTerminalTitle } from "./lib/terminal-title";
import { copySelection } from "./lib/selection";
import type { Conversation } from "./lib/history";

// ── Types ────────────────────────────────────────────────

export interface TUIOptions {
  prompt?: string;
  provider: string;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  workingDir: string;
  mode: string;
  resume?: string;
  continue?: boolean;
  theme: string;
}

// ── App Shell ────────────────────────────────────────────

type Route = "home" | "session";
type Dialog = "none" | "model" | "command" | "sessions" | "setup" | "help" | "theme" | "status";

function AppShell(props: {
  options: TUIOptions;
  agent: AgentRunner;
  registry: ToolRegistry;
  permissionManager: PermissionManager;
}) {
  const dims = useTerminalDimensions();
  const { theme, themeId, customBg, setMode, setThemeId } = useTheme();
  const t = theme;

  const [route, setRoute] = useState<Route>(props.options.prompt ? "session" : "home");
  const [dialog, setDialog] = useState<Dialog>("none");
  const [status, setStatus] = useState("Ready");
  const [workingDir, setWorkingDir] = useState(props.options.workingDir);
  const [tokens, setTokens] = useState<{ input: number; output: number } | undefined>();
  const [contextPercent, setContextPercent] = useState(0);
  const [activeTool, setActiveTool] = useState<string | undefined>();

  // Persisted settings from Zustand store
  const provider = useSettingsStore((s) => s.provider);
  const model = useSettingsStore((s) => s.model);
  const sidebarMode = useSettingsStore((s) => s.sidebarMode);
  const setProvider = useSettingsStore((s) => s.setProvider);
  const setModel = useSettingsStore((s) => s.setModel);
  const setSidebarMode = useSettingsStore((s) => s.setSidebarMode);

  // Auto-hide sidebar when terminal is too narrow (like opencode: > 120 cols)
  const wide = dims.width > 120;
  const showSidebar = sidebarMode === "show" || (sidebarMode === "auto" && wide);

  const closeDialog = useCallback(() => {
    setDialog("none");
  }, []);

  // Mutable refs for agent rebuild
  const agentRef = useRef(props.agent);
  const registryRef = useRef(props.registry);
  const pmRef = useRef(props.permissionManager);

  // Initial message from home screen input
  const initialMessageRef = useRef<{ text: string; images?: import("@cdoing/ai").ImageAttachment[] } | null>(null);

  // ── Permission prompt bridge ────────────────────────
  // Store a pending permission resolve callback that the UI can call
  const permissionResolveRef = useRef<((decision: "allow" | "always" | "deny") => void) | null>(null);
  const [pendingPermission, setPendingPermission] = useState<{
    toolName: string;
    message: string;
  } | null>(null);

  // Wire PermissionManager to show UI prompt
  const requestPermission = useCallback((toolName: string, message: string): Promise<"allow" | "always" | "deny"> => {
    return new Promise((resolve) => {
      permissionResolveRef.current = resolve;
      setPendingPermission({ toolName, message });
    });
  }, []);

  // Set up the prompt function on the permission manager
  pmRef.current.setPromptFn(async (toolName: string, message: string) => {
    const decision = await requestPermission(toolName, message);
    return decision === "always" ? "allow" : decision;
  });

  // ── Agent Rebuild ──────────────────────────────────
  const rebuildAgent = useCallback((newProvider: string, newModel: string, apiKey?: string, oauthToken?: string) => {
    // Resolve API key or OAuth token
    // If apiKey is explicitly "" (empty string), it means logout — skip all fallbacks
    let resolvedKey = apiKey;
    let resolvedOAuthToken = oauthToken;

    if (!resolvedKey && !resolvedOAuthToken && apiKey !== "") {
      // Try OAuth first for providers that support it
      if (supportsOAuth(newProvider)) {
        resolveOAuthToken(newProvider).then((token) => {
          if (token) {
            const modelConfig: Partial<ModelConfig> = {
              provider: newProvider,
              model: newModel,
              oauthToken: token,
              baseURL: props.options.baseUrl || undefined,
              temperature: 0,
              maxTokens: 8096,
            };
            const newAgent = new AgentRunner(modelConfig, registryRef.current, pmRef.current);
            agentRef.current = newAgent;
            setProvider(newProvider);
            setModel(newModel);
          }
        }).catch(() => {});
        // If OAuth token is being resolved async, still try API key fallback synchronously
      }

      const envVar = getApiKeyEnvVar(newProvider);
      if (process.env[envVar]) {
        resolvedKey = process.env[envVar];
      } else {
        try {
          const configPath = path.join(os.homedir(), ".cdoing", "config.json");
          if (fs.existsSync(configPath)) {
            const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
            resolvedKey = config.apiKeys?.[newProvider];
          }
        } catch {}
      }
    }

    const modelConfig: Partial<ModelConfig> = {
      provider: newProvider,
      model: newModel,
      apiKey: resolvedKey || undefined,
      oauthToken: resolvedOAuthToken || undefined,
      baseURL: props.options.baseUrl || undefined,
      temperature: 0,
      maxTokens: 8096,
    };

    const newAgent = new AgentRunner(modelConfig, registryRef.current, pmRef.current);
    agentRef.current = newAgent;
    setProvider(newProvider);
    setModel(newModel);
  }, [props.options.baseUrl]);

  // ── Working Directory Change ────────────────────────
  const handleSetWorkingDir = useCallback((dir: string) => {
    setWorkingDir(dir);
  }, []);

  // ── Global Keyboard ──────────────────────────────────

  const renderer = useRenderer();

  useKeyboard((key: any) => {
    // Ctrl+C — if text is selected, copy to clipboard; otherwise quit
    if (key.ctrl && key.name === "c") {
      if (copySelection(renderer)) return;
      const cleanup = (globalThis as any).__cdoingCleanup;
      if (cleanup) cleanup();
      else process.exit(0);
      return;
    }

    // Don't intercept keys when a dialog is open (let the dialog handle them)
    // Exception: Escape should always work
    if (dialog !== "none") {
      if (key.name === "escape") {
        setDialog("none");
        setRoute("home");
      }
      return;
    }
    // Ctrl+N — new session
    if (key.ctrl && key.name === "n") {
      setRoute("session");
      setStatus("Ready");
    }
    // Ctrl+P — command palette
    if (key.ctrl && key.name === "p") {
      setDialog((d) => (d === "command" ? "none" : "command"));
    }
    // Ctrl+S — session browser
    if (key.ctrl && key.name === "s") {
      setDialog((d) => (d === "sessions" ? "none" : "sessions"));
    }
    // Ctrl+B — toggle sidebar
    if (key.ctrl && key.name === "b") {
      setSidebarMode(sidebarMode === "hide" ? "show" : sidebarMode === "show" ? "hide" : showSidebar ? "hide" : "show");
    }
    // Ctrl+T — theme picker
    if (key.ctrl && key.name === "t") {
      setDialog((d) => (d === "theme" ? "none" : "theme"));
    }
    // Ctrl+O — model picker (Ctrl+M = Enter in terminals)
    if (key.ctrl && key.name === "o") {
      setDialog((d) => (d === "model" ? "none" : "model"));
    }
    // F1 — help dialog
    if (key.name === "f1") {
      setDialog((d) => (d === "help" ? "none" : "help"));
    }
    // Escape — close any dialog
    if (key.name === "escape") {
      setDialog("none");
    }
  }, {});

  // ── Session Resume Handler ────────────────────────
  const handleResumeSession = useCallback((_conv: Conversation) => {
    // TODO: restore conversation messages into agent history
    setRoute("session");
    setDialog("none");
    setStatus("Ready");
  }, []);

  return (
    <box width={dims.width} height={dims.height} flexDirection="column" backgroundColor={customBg ? RGBA.fromHex(customBg) : t.bg}>
      {/* Header bar */}
      <box height={1} flexDirection="row" paddingX={1} flexShrink={0} backgroundColor={t.bgSubtle}>
        <text fg={t.primary} attributes={TextAttributes.BOLD}>{"cdoing"}</text>
        <text fg={t.border}>{" │ "}</text>
        <text fg={t.textMuted}>{model}</text>
        <text fg={t.border}>{" │ "}</text>
        <text fg={status === "Error" ? t.error : status === "Processing..." ? t.warning : t.success}>
          {status}
        </text>
      </box>

      {/* Session header (only in session route) */}
      {route === "session" && (
        <SessionHeader
          title="Session"
          provider={provider}
          model={model}
          tokens={tokens}
          contextPercent={contextPercent}
          status={status}
        />
      )}

      {/* Separator */}
      <box height={1} flexShrink={0}>
        <text fg={t.border}>{"─".repeat(Math.max(dims.width, 40))}</text>
      </box>

      {/* Main content area with optional sidebar */}
      <box flexDirection="row" flexGrow={1}>
        <SDKProvider
          value={{
            agent: agentRef.current,
            registry: registryRef.current,
            permissionManager: pmRef.current,
            workingDir,
            provider,
            model,
            requestPermission,
            rebuildAgent,
            setWorkingDir: handleSetWorkingDir,
          }}
        >
          <box flexGrow={1} flexDirection="column">
            {dialog === "sessions" ? (
              <SessionBrowser
                onResume={handleResumeSession}
                onClose={() => setDialog("none")}
              />
            ) : dialog === "setup" ? (
              <SetupWizard
                onComplete={(config) => {
                  rebuildAgent(config.provider, config.model, config.apiKey, config.oauthToken);
                  setDialog("none");
                }}
                onClose={() => setDialog("none")}
              />
            ) : route === "home" ? (
              <Home
                provider={provider}
                model={model}
                workingDir={workingDir}
                themeId={themeId}
                onSubmit={(text, images) => {
                  initialMessageRef.current = { text, images };
                  setRoute("session");
                }}
              />
            ) : (
              <SessionView
                onStatus={setStatus}
                onTokens={(i, o) => setTokens({ input: i, output: o })}
                onActiveTool={setActiveTool}
                onContextPercent={setContextPercent}
                onOpenDialog={(d) => setDialog(d as Dialog)}
                initialMessage={initialMessageRef.current}
                dialogOpen={dialog !== "none"}
              />
            )}
          </box>
        </SDKProvider>

        {/* Vertical border between content and sidebar */}
        {showSidebar && (
          <box width={1} flexShrink={0}>
            <text fg={t.border}>{"│\n".repeat(Math.max(dims.height - 4, 1))}</text>
          </box>
        )}

        {/* Sidebar (right panel) */}
        {showSidebar && (
          <Sidebar
            provider={provider}
            model={model}
            workingDir={workingDir}
            tokens={tokens}
            contextPercent={contextPercent}
            activeTool={activeTool}
            status={status}
            themeId={themeId}
          />
        )}
      </box>

      {/* Separator */}
      <box height={1} flexShrink={0}>
        <text fg={t.border}>{"─".repeat(Math.max(dims.width, 40))}</text>
      </box>

      {/* Footer: session footer in session route, status bar always */}
      {route === "session" ? (
        <SessionFooter
          workingDir={workingDir}
          isProcessing={status === "Processing..."}
        />
      ) : (
        <StatusBar
          provider={provider}
          model={model}
          mode={props.options.mode}
          workingDir={workingDir}
          tokens={tokens}
          contextPercent={contextPercent}
          activeTool={activeTool}
          isProcessing={status === "Processing..."}
        />
      )}

      {/* Model picker dialog (overlay) */}
      {dialog === "model" && (
        <DialogModel
          provider={provider}
          currentModel={model}
          onSelect={(m) => {
            rebuildAgent(provider, m);
            setDialog("none");
          }}
          onClose={() => setDialog("none")}
        />
      )}

      {/* Command palette dialog (overlay) */}
      {dialog === "command" && (
        <DialogCommand
          onSelect={(commandId) => {
            setDialog("none");
            switch (commandId) {
              // Session
              case "session:new":
                setRoute("session");
                setStatus("Ready");
                break;
              case "session:browse":
                setDialog("sessions");
                break;
              case "session:clear":
                setRoute("session");
                setStatus("Ready");
                break;
              // Model
              case "model:switch":
              case "model:provider":
                setDialog("model");
                break;
              // Theme
              case "theme:dark":
                setMode("dark");
                break;
              case "theme:light":
                setMode("light");
                break;
              case "theme:picker":
                setDialog("theme");
                break;
              // Display
              case "display:sidebar":
                setSidebarMode(sidebarMode === "hide" ? "show" : sidebarMode === "show" ? "hide" : showSidebar ? "hide" : "show");
                break;
              // Tools (dispatch as slash commands into session)
              case "tool:shell":
              case "tool:search":
              case "tool:tree":
                setRoute("session");
                break;
              // System
              case "system:status":
                setDialog("status");
                break;
              case "system:help":
                setDialog("help");
                break;
              case "system:doctor":
                setStatus("Doctor");
                break;
              case "system:setup":
                setDialog("setup");
                break;
              case "system:exit": {
                const exit = (globalThis as any).__cdoingCleanup;
                if (exit) exit();
                else process.exit(0);
                break;
              }
            }
          }}
          onClose={() => setDialog("none")}
        />
      )}

      {/* Help dialog (overlay) */}
      {dialog === "help" && (
        <DialogHelp
          onClose={() => setDialog("none")}
        />
      )}

      {/* Theme picker dialog (overlay) */}
      {dialog === "theme" && (
        <DialogTheme
          onClose={() => setDialog("none")}
        />
      )}

      {/* Status dialog (overlay) */}
      {dialog === "status" && (
        <DialogStatus onClose={() => setDialog("none")} />
      )}

    </box>
  );
}

// ── Error Boundary ───────────────────────────────────────

// Global error signal — set by uncaughtException/unhandledRejection handlers,
// read by the AppRoot wrapper to swap in the error screen.
let __fatalError: Error | null = null;
let __fatalErrorSetter: ((err: Error | null) => void) | null = null;

function AppRoot(props: {
  children: any;
}) {
  const [error, setError] = useState<Error | null>(__fatalError);
  __fatalErrorSetter = setError;

  if (error) {
    return <ErrorScreen error={error} onReset={() => setError(null)} />;
  }
  return props.children;
}

function ErrorScreen(props: {
  error: Error;
  onReset: () => void;
}) {
  const dims = useTerminalDimensions();
  const maxW = Math.max(dims.width, 40);

  const colors = {
    bg: "#0a0a0a",
    text: "#eeeeee",
    muted: "#808080",
    primary: "#fab283",
    error: "#ff6b6b",
  };

  const issueURL = `https://github.com/AhmadMuj/cdoing-agent/issues/new?title=${encodeURIComponent(`tui: fatal: ${props.error.message}`)}&body=${encodeURIComponent("```\n" + (props.error.stack || props.error.message).substring(0, 4000) + "\n```")}`;

  useKeyboard((key: any) => {
    if (key.ctrl && key.name === "c") {
      const cleanup = (globalThis as any).__cdoingCleanup;
      if (cleanup) cleanup();
      else process.exit(1);
    }
    if (key.name === "r") {
      props.onReset();
    }
    if (key.name === "q" || key.name === "escape") {
      const cleanup = (globalThis as any).__cdoingCleanup;
      if (cleanup) cleanup();
      else process.exit(0);
    }
  });

  const stackLines = (props.error.stack || "").split("\n").slice(0, Math.max(5, dims.height - 12));

  return (
    <box
      width={dims.width}
      height={dims.height}
      flexDirection="column"
      backgroundColor={colors.bg}
      paddingX={2}
      paddingY={1}
    >
      <text fg={colors.error} attributes={TextAttributes.BOLD}>
        {"  A fatal error occurred!"}
      </text>
      <text>{""}</text>
      <text fg={colors.text} attributes={TextAttributes.BOLD}>
        {`  ${props.error.message}`}
      </text>
      <text>{""}</text>
      <text fg={colors.muted}>{"  Stack trace:"}</text>
      {stackLines.map((line, i) => (
        <text key={i} fg={colors.muted}>
          {`  ${line}`}
        </text>
      ))}
      <text>{""}</text>
      <text fg={colors.primary}>{"  Report this issue:"}</text>
      <text fg={colors.muted}>{`  ${issueURL.length > maxW - 4 ? issueURL.substring(0, maxW - 7) + "..." : issueURL}`}</text>
      <text>{""}</text>
      <box height={1} flexShrink={0}>
        <text fg={colors.muted}>{"─".repeat(maxW)}</text>
      </box>
      <text fg={colors.text}>{"  r Reset TUI  •  q/Esc Exit  •  Ctrl+C Force quit"}</text>
    </box>
  );
}

// ── Entry Point ──────────────────────────────────────────

export async function startTUI(options: TUIOptions): Promise<void> {
  // Initialize core services
  const registry = new ToolRegistry();
  const permMode = options.mode === "auto" ? PermissionMode.BYPASS
    : options.mode === "auto-edit" ? PermissionMode.ACCEPT_EDITS
    : PermissionMode.DEFAULT;
  const pm = new PermissionManager(permMode, options.workingDir);

  // Permission prompt will be wired up via React state in AppShell
  // Set a temporary default — will be overridden once React mounts
  pm.setPromptFn(async (_toolName, _message) => {
    return "allow";
  });

  const processManager = new ProcessManager();
  const todoStore = new TodoStore();
  const memoryStore = new MemoryStore(options.workingDir);
  await registerAllTools(registry, {
    workingDir: options.workingDir,
    permissionManager: pm,
    processManager,
    todoStore,
    memoryStore,
    planExitCallback: (summary: string) => {
      // Signal that plan is ready — the session component handles the approval via /plan approve
      console.log("\n  📋 Plan ready: " + summary);
      console.log("  Use /plan approve, /plan reject, or /plan show\n");
    },
  });

  // Resolve API key: flag → env var → stored config → OAuth token
  let resolvedApiKey = options.apiKey;
  let resolvedOAuthToken: string | undefined;
  let resolvedProvider = options.provider;
  let resolvedModel = options.model;
  let resolvedBaseUrl = options.baseUrl;

  if (!resolvedApiKey) {
    // Load stored config
    const configPath = path.join(os.homedir(), ".cdoing", "config.json");
    let storedConfig: Record<string, any> = {};
    try {
      if (fs.existsSync(configPath)) {
        storedConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      }
    } catch {}

    // Apply stored provider/model/baseUrl if not set via flags
    if (resolvedProvider === "anthropic" && storedConfig.provider) {
      resolvedProvider = storedConfig.provider;
    }
    if (!resolvedModel && storedConfig.model) {
      resolvedModel = storedConfig.model;
    }
    if (!resolvedBaseUrl && storedConfig.baseUrl) {
      resolvedBaseUrl = storedConfig.baseUrl;
    }

    // Check env var
    const envVar = getApiKeyEnvVar(resolvedProvider);
    if (process.env[envVar]) {
      resolvedApiKey = process.env[envVar];
    }
    // Check stored API keys
    else if (storedConfig.apiKeys?.[resolvedProvider]) {
      resolvedApiKey = storedConfig.apiKeys[resolvedProvider];
    }

    // If no API key found, try OAuth token
    if (!resolvedApiKey && supportsOAuth(resolvedProvider)) {
      try {
        const token = await resolveOAuthToken(resolvedProvider);
        if (token) resolvedOAuthToken = token;
      } catch {}
    }
  }

  // Hydrate settings store with resolved CLI values (overrides persisted defaults when flags are explicit)
  const settingsStore = useSettingsStore.getState();
  if (resolvedProvider && resolvedProvider !== "anthropic") {
    settingsStore.setProvider(resolvedProvider);
  } else if (!settingsStore.provider || settingsStore.provider === "anthropic") {
    settingsStore.setProvider(resolvedProvider);
  }
  if (resolvedModel) {
    settingsStore.setModel(resolvedModel);
  } else if (!settingsStore.model) {
    settingsStore.setModel(getDefaultModel(settingsStore.provider) || "default");
  }

  // Use persisted values as the effective config (store is now hydrated)
  const effectiveProvider = useSettingsStore.getState().provider;
  const effectiveModel = useSettingsStore.getState().model;

  // Build model config (use effective values from persisted store)
  const modelConfig: Partial<ModelConfig> = {
    provider: effectiveProvider,
    model: effectiveModel || undefined,
    apiKey: resolvedApiKey || undefined,
    oauthToken: resolvedOAuthToken || undefined,
    baseURL: resolvedBaseUrl || undefined,
    temperature: 0,
    maxTokens: 8096,
  };

  // Create agent with environment context
  const isGitRepo = require("fs").existsSync(require("path").join(options.workingDir, ".git"));
  const agent = new AgentRunner(modelConfig, registry, pm, undefined, {
    workingDir: options.workingDir,
    isGitRepo,
  });

  // Detect terminal background color before rendering (async OSC 11 query)
  let detectedMode: "dark" | "light" | undefined;
  if (options.theme === "auto") {
    detectedMode = await detectTerminalTheme();
  }

  // Set terminal background BEFORE clearing so it fills the entire screen
  const resolvedMode: "dark" | "light" = options.theme === "light" ? "light"
    : options.theme === "auto" ? (detectedMode || "dark")
    : "dark";
  // Hydrate theme settings from store
  const persistedThemeId = useSettingsStore.getState().themeId;
  const persistedMode = useSettingsStore.getState().mode;
  if (options.theme !== "light" && options.theme !== "dark") {
    // "auto" mode — use persisted mode if available
    if (persistedMode) settingsStore.setMode(persistedMode);
  } else {
    settingsStore.setMode(options.theme === "light" ? "light" : "dark");
  }

  const initialColors = getThemeColors(persistedThemeId || "default", resolvedMode);
  setTerminalBackground(initialColors.bg);

  // Reset terminal size to a good default (80x24 minimum)
  const cols = Math.max(process.stdout.columns || 80, 80);
  const rows = Math.max(process.stdout.rows || 24, 24);
  process.stdout.write(`\x1b[8;${rows};${cols}t`);

  console.clear();

  // Set terminal title on mount
  setTerminalTitle("cdoing");

  const renderer = await createCliRenderer({
    useMouse: true,
    exitOnCtrlC: false,
  });
  const root = createRoot(renderer);
  // Install global error handlers to catch uncaught exceptions and show the error screen
  const handleFatalError = (err: unknown) => {
    const error = err instanceof Error ? err : new Error(String(err));
    process.stderr.write(`\n[cdoing] Fatal error: ${error.message}\n${error.stack || ""}\n`);
    __fatalError = error;
    if (__fatalErrorSetter) __fatalErrorSetter(error);
  };
  process.on("uncaughtException", handleFatalError);
  process.on("unhandledRejection", handleFatalError);

  root.render(
    <AppRoot>
      <ThemeProvider mode={options.theme} themeId={persistedThemeId} detectedMode={detectedMode} syncTerminalBg>
        <ToastProvider>
          <AppShell
            options={{ ...options, provider: effectiveProvider, model: effectiveModel || undefined }}
            agent={agent}
            registry={registry}
            permissionManager={pm}
          />
        </ToastProvider>
      </ThemeProvider>
    </AppRoot>
  );

  // Graceful cleanup: unmount React, destroy renderer, restore terminal
  let isCleaningUp = false;
  const cleanup = () => {
    if (isCleaningUp) return;
    isCleaningUp = true;
    try { root.unmount(); } catch {}
    try { renderer.destroy(); } catch {}
    resetTerminalTitle();
    restoreTerminalBackground();
    process.exit(0);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  // Expose cleanup globally so the keyboard handler can use it
  (globalThis as any).__cdoingCleanup = cleanup;

  // Keep alive
  await new Promise(() => {});
}
