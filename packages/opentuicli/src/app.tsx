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
 *   - Model picker dialog (Ctrl+P)
 *   - Theme support (dark/light/auto)
 *   - Status bar with token counts and context %
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { createRoot, useKeyboard, useTerminalDimensions } from "@opentui/react";
import { createCliRenderer, TextAttributes, RGBA } from "@opentui/core";
import { useState, useRef, useCallback } from "react";
import {
  ToolRegistry,
  PermissionManager,
  PermissionMode,
  registerAllTools,
  resolveOAuthToken,
  supportsOAuth,
} from "@cdoing/core";
import { AgentRunner, getDefaultModel, getApiKeyEnvVar } from "@cdoing/ai";
import type { ModelConfig } from "@cdoing/ai";

import { ThemeProvider, useTheme, detectTerminalTheme, restoreTerminalBackground, getThemeColors, setTerminalBackground } from "./context/theme";
import { SDKProvider } from "./context/sdk";
import { ToastProvider } from "./components/toast";
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
  const [provider, setProvider] = useState(props.options.provider);
  const [model, setModel] = useState(props.options.model || getDefaultModel(props.options.provider) || "default");
  const [workingDir, setWorkingDir] = useState(props.options.workingDir);
  const [tokens, setTokens] = useState<{ input: number; output: number } | undefined>();
  const [contextPercent, setContextPercent] = useState(0);
  const [activeTool, setActiveTool] = useState<string | undefined>();
  const [sidebarMode, setSidebarMode] = useState<"auto" | "show" | "hide">("auto");

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

  useKeyboard((key: any) => {
    // Don't intercept keys when a dialog is open (let the dialog handle them)
    // Exception: Ctrl+C and Escape should always work
    if (dialog !== "none") {
      if (key.ctrl && key.name === "c") {
        const cleanup = (globalThis as any).__cdoingCleanup;
        if (cleanup) cleanup();
        process.exit(0);
      }
      if (key.name === "escape") {
        setDialog("none");
        setRoute("home");
      }
      return;
    }

    // Ctrl+C — graceful quit
    if (key.ctrl && key.name === "c") {
      const cleanup = (globalThis as any).__cdoingCleanup;
      if (cleanup) cleanup();
      else process.exit(0);
    }
    // Ctrl+N — new session
    if (key.ctrl && key.name === "n") {
      setRoute("session");
      setStatus("Ready");
    }
    // Ctrl+P — model picker
    if (key.ctrl && key.name === "p") {
      setDialog((d) => (d === "model" ? "none" : "model"));
    }
    // Ctrl+S — session browser
    if (key.ctrl && key.name === "s") {
      setDialog((d) => (d === "sessions" ? "none" : "sessions"));
    }
    // Ctrl+B — toggle sidebar
    if (key.ctrl && key.name === "b") {
      setSidebarMode((m) => m === "hide" ? "show" : m === "show" ? "hide" : showSidebar ? "hide" : "show");
    }
    // Ctrl+T — theme picker
    if (key.ctrl && key.name === "t") {
      setDialog((d) => (d === "theme" ? "none" : "theme"));
    }
    // Ctrl+X — command palette
    if (key.ctrl && key.name === "x") {
      setDialog((d) => (d === "command" ? "none" : "command"));
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
      <box height={1} flexDirection="row" paddingX={1} flexShrink={0}>
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
                setSidebarMode((m) => m === "hide" ? "show" : m === "show" ? "hide" : showSidebar ? "hide" : "show");
                break;
              case "display:timestamps":
              case "display:thinking":
                // Display toggles — extend as needed
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

  await registerAllTools(registry, {
    workingDir: options.workingDir,
    permissionManager: pm,
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

  // Build model config
  const modelConfig: Partial<ModelConfig> = {
    provider: resolvedProvider,
    model: resolvedModel || undefined,
    apiKey: resolvedApiKey || undefined,
    oauthToken: resolvedOAuthToken || undefined,
    baseURL: resolvedBaseUrl || undefined,
    temperature: 0,
    maxTokens: 8096,
  };

  // Create agent
  const agent = new AgentRunner(modelConfig, registry, pm);

  // Detect terminal background color before rendering (async OSC 11 query)
  let detectedMode: "dark" | "light" | undefined;
  if (options.theme === "auto") {
    detectedMode = await detectTerminalTheme();
  }

  // Set terminal background BEFORE clearing so it fills the entire screen
  const resolvedMode: "dark" | "light" = options.theme === "light" ? "light"
    : options.theme === "auto" ? (detectedMode || "dark")
    : "dark";
  const initialColors = getThemeColors("default", resolvedMode);
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
  root.render(
    <ThemeProvider mode={options.theme} detectedMode={detectedMode} syncTerminalBg>
      <ToastProvider>
        <AppShell
          options={{ ...options, provider: resolvedProvider, model: resolvedModel || undefined }}
          agent={agent}
          registry={registry}
          permissionManager={pm}
        />
      </ToastProvider>
    </ThemeProvider>
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
