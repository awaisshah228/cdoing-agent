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
import { createCliRenderer, TextAttributes } from "@opentui/core";
import { useState, useRef, useCallback } from "react";
import {
  ToolRegistry,
  PermissionManager,
  PermissionMode,
  registerAllTools,
} from "@cdoing/core";
import { AgentRunner, getDefaultModel, getApiKeyEnvVar } from "@cdoing/ai";
import type { ModelConfig } from "@cdoing/ai";

import { ThemeProvider, useTheme, detectTerminalTheme, restoreTerminalBackground } from "./context/theme";
import { SDKProvider } from "./context/sdk";
import { ToastProvider } from "./components/toast";
import { Home } from "./routes/home";
import { SessionView } from "./routes/session";
import { StatusBar } from "./components/status-bar";
import { Sidebar } from "./components/sidebar";
import { DialogModel } from "./components/dialog-model";
import { DialogCommand } from "./components/dialog-command";
import { DialogHelp } from "./components/dialog-help";
import { SessionBrowser } from "./components/session-browser";
import { SetupWizard } from "./components/setup-wizard";
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
type Dialog = "none" | "model" | "command" | "sessions" | "setup" | "help";

function AppShell(props: {
  options: TUIOptions;
  agent: AgentRunner;
  registry: ToolRegistry;
  permissionManager: PermissionManager;
}) {
  const dims = useTerminalDimensions();
  const { theme, setMode } = useTheme();
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
  const [showSidebar, setShowSidebar] = useState(false);

  // Mutable refs for agent rebuild
  const agentRef = useRef(props.agent);
  const registryRef = useRef(props.registry);
  const pmRef = useRef(props.permissionManager);

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
  const rebuildAgent = useCallback((newProvider: string, newModel: string, apiKey?: string) => {
    // Resolve API key
    let resolvedKey = apiKey;
    if (!resolvedKey) {
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
    // Don't intercept keys when a dialog is open (except escape)
    if (dialog !== "none" && key.name !== "escape") return;

    // Ctrl+C — quit
    if (key.ctrl && key.name === "c") {
      process.exit(0);
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
      setShowSidebar((s) => !s);
    }
    // Ctrl+X — command palette
    if (key.ctrl && key.name === "x") {
      setDialog((d) => (d === "command" ? "none" : "command"));
    }
    // F1 — help dialog
    if (key.name === "f1") {
      setDialog((d) => (d === "help" ? "none" : "help"));
    }
    // Enter on home → start session
    if (key.name === "return" && route === "home" && dialog === "none") {
      setRoute("session");
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
    <box width={dims.width} height={dims.height} flexDirection="column">
      {/* Header */}
      <box height={1} flexDirection="row">
        <text fg={t.primary} attributes={TextAttributes.BOLD}>
          {" cdoing "}
        </text>
        <text fg={t.textDim}>{"│ "}</text>
        <text fg={t.textMuted}>{model}</text>
        <text fg={t.textDim}>{" │ "}</text>
        <text fg={status === "Error" ? t.error : status === "Processing..." ? t.warning : t.success}>
          {status}
        </text>
      </box>

      {/* Separator */}
      <box height={1}>
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
                  rebuildAgent(config.provider, config.model, config.apiKey);
                  setDialog("none");
                }}
                onClose={() => setDialog("none")}
              />
            ) : route === "home" ? (
              <Home
                provider={provider}
                model={model}
                workingDir={workingDir}
              />
            ) : (
              <SessionView
                onStatus={setStatus}
                onTokens={(i, o) => setTokens({ input: i, output: o })}
                onActiveTool={setActiveTool}
                onContextPercent={setContextPercent}
                onOpenDialog={(d) => setDialog(d as Dialog)}
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
          />
        )}
      </box>

      {/* Separator */}
      <box height={1}>
        <text fg={t.border}>{"─".repeat(Math.max(dims.width, 40))}</text>
      </box>

      {/* Status bar */}
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
              case "theme:auto":
                setMode("auto");
                break;
              // Display
              case "display:timestamps":
              case "display:thinking":
                // Display toggles — extend as needed
                break;
              // System
              case "system:help":
                setDialog("help");
                break;
              case "system:doctor":
                setStatus("Doctor");
                break;
              case "system:exit":
                process.exit(0);
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

  // Resolve API key: flag → env var → stored config (~/.cdoing/config.json)
  let resolvedApiKey = options.apiKey;
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
  }

  // Build model config
  const modelConfig: Partial<ModelConfig> = {
    provider: resolvedProvider,
    model: resolvedModel || undefined,
    apiKey: resolvedApiKey || undefined,
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

  console.clear();

  // Set terminal title on mount
  setTerminalTitle("cdoing");

  // Restore terminal background and title on exit
  const cleanup = () => {
    resetTerminalTitle();
    restoreTerminalBackground();
    process.exit(0);
  };

  const renderer = await createCliRenderer({
    useMouse: true,
    exitOnCtrlC: false,
  });
  createRoot(renderer).render(
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

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  // Keep alive
  await new Promise(() => {});
}
