/**
 * Main TUI Application — OpenTUI + React
 *
 * Full-featured terminal UI for monitoring the Remote Coding Agent:
 *   - Dashboard with agent status, channels, sessions, event stream
 *   - Route navigation (dashboard, setup, skills, config)
 *   - Command palette (Ctrl+P)
 *   - Help dialog (F1)
 *   - Collapsible sidebar (Ctrl+B)
 *   - Keyboard-driven navigation
 */

import { createRoot, useKeyboard, useTerminalDimensions } from "@opentui/react";
import { createCliRenderer, TextAttributes, RGBA } from "@opentui/core";
import { useState, useCallback } from "react";

import type { Engine } from "@cdoing/remote-coding-agent";

import {
  ThemeProvider,
  useTheme,
  detectTerminalTheme,
  restoreTerminalBackground,
  getThemeColors,
  setTerminalBackground,
} from "./context/theme";
import { EngineProvider } from "./context/engine";
import { useEngineState } from "./hooks/use-engine-state";
import { useSettingsStore } from "./store/settings";
import type { Route } from "./store/settings";
import { StatusBar } from "./components/status-bar";
import { Sidebar } from "./components/sidebar";
import { DialogCommand } from "./components/dialog-command";
import { DialogHelp } from "./components/dialog-help";
import { Dashboard } from "./routes/dashboard";
import { Setup } from "./routes/setup";
import { Skills } from "./routes/skills";
import { Config } from "./routes/config";

// ── Types ────────────────────────────────────────────────

type Dialog = "command" | "help" | null;

export interface StartTUIOptions {
  engine: Engine;
  route?: Route;
  workingDir?: string;
}

// ── Uptime Formatter ─────────────────────────────────────

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h${m}m`;
}

// ── App Shell ────────────────────────────────────────────

function AppShell(props: { engine: Engine }) {
  const dims = useTerminalDimensions();
  const { theme: t, customBg } = useTheme();
  const state = useEngineState(2000);

  // Persisted navigation state
  const route = useSettingsStore((s) => s.route);
  const sidebarVisible = useSettingsStore((s) => s.sidebarVisible);
  const setRoute = useSettingsStore((s) => s.setRoute);
  const toggleSidebar = useSettingsStore((s) => s.toggleSidebar);

  const [dialog, setDialog] = useState<Dialog>(null);

  const closeDialog = useCallback(() => setDialog(null), []);

  // Auto-hide sidebar when terminal is too narrow
  const wide = dims.width > 120;
  const showSidebar = sidebarVisible && wide;

  // ── Global Keyboard ──────────────────────────────────

  useKeyboard((key: any) => {
    // When a dialog is open, only handle close/quit
    if (dialog !== null) {
      if (key.ctrl && key.name === "c") {
        process.exit(0);
      }
      if (key.name === "escape") {
        setDialog(null);
      }
      return;
    }

    // Ctrl+C — quit
    if (key.ctrl && key.name === "c") {
      const cleanup = (globalThis as any).__remoteTuiCleanup;
      if (cleanup) cleanup();
      else process.exit(0);
    }

    // Ctrl+P — command palette
    if (key.ctrl && key.name === "p") {
      setDialog((d) => (d === "command" ? null : "command"));
    }

    // Ctrl+B — toggle sidebar
    if (key.ctrl && key.name === "b") {
      toggleSidebar();
    }

    // F1 — help
    if (key.name === "f1") {
      setDialog((d) => (d === "help" ? null : "help"));
    }

    // Number keys — route switching
    if (key.name === "1") setRoute("dashboard");
    if (key.name === "2") setRoute("skills");
    if (key.name === "3") setRoute("config");

    // s — setup
    if (key.sequence === "s" && !key.ctrl && !key.meta) {
      setRoute("setup");
    }

    // q — quit
    if (key.sequence === "q" && !key.ctrl && !key.meta) {
      const cleanup = (globalThis as any).__remoteTuiCleanup;
      if (cleanup) cleanup();
      else process.exit(0);
    }

    // Escape — go back to dashboard
    if (key.name === "escape") {
      setRoute("dashboard");
    }
  }, {});

  // ── Command palette handler ──────────────────────────

  const handleCommand = useCallback((commandId: string) => {
    setDialog(null);
    switch (commandId) {
      case "route:dashboard":
        setRoute("dashboard");
        break;
      case "route:skills":
        setRoute("skills");
        break;
      case "route:config":
        setRoute("config");
        break;
      case "route:setup":
        setRoute("setup");
        break;
      case "display:sidebar":
        toggleSidebar();
        break;
      case "system:help":
        setDialog("help");
        break;
      case "system:quit": {
        const cleanup = (globalThis as any).__remoteTuiCleanup;
        if (cleanup) cleanup();
        else process.exit(0);
        break;
      }
    }
  }, []);

  const upStr = formatUptime(state.stats.uptime);
  const allConnected = state.channels.length > 0 && state.channels.every((c) => c.connected);

  return (
    <box
      width={dims.width}
      height={dims.height}
      flexDirection="column"
      backgroundColor={customBg ? RGBA.fromHex(customBg) : t.bg}
    >
      {/* Header bar */}
      <box height={1} flexDirection="row" paddingX={1} flexShrink={0} backgroundColor={t.bgSubtle}>
        <text fg={t.primary} attributes={TextAttributes.BOLD}>{"Remote Coding Agent"}</text>
        <text fg={t.border}>{" \u2502 "}</text>
        <text fg={t.textMuted}>{route}</text>
        <box flexGrow={1} />
        <text fg={t.textDim}>{`uptime ${upStr}`}</text>
      </box>

      {/* Separator */}
      <box height={1} flexShrink={0}>
        <text fg={t.border}>{"\u2500".repeat(Math.max(dims.width, 40))}</text>
      </box>

      {/* Main content area with optional sidebar */}
      <box flexDirection="row" flexGrow={1}>
        {/* Content */}
        <box flexGrow={1} flexDirection="column">
          {route === "dashboard" && <Dashboard />}
          {route === "setup" && <Setup onComplete={() => setRoute("dashboard")} />}
          {route === "skills" && <Skills />}
          {route === "config" && <Config />}
        </box>

        {/* Vertical border between content and sidebar */}
        {showSidebar && (
          <box width={1} flexShrink={0}>
            <text fg={t.border}>{"\u2502\n".repeat(Math.max(dims.height - 4, 1))}</text>
          </box>
        )}

        {/* Sidebar (right panel) */}
        {showSidebar && <Sidebar state={state} />}
      </box>

      {/* Separator */}
      <box height={1} flexShrink={0}>
        <text fg={t.border}>{"\u2500".repeat(Math.max(dims.width, 40))}</text>
      </box>

      {/* Footer */}
      <StatusBar
        route={route}
        channelCount={state.channels.length}
        allConnected={allConnected}
      />

      {/* Command palette dialog (overlay) */}
      {dialog === "command" && (
        <DialogCommand
          onSelect={handleCommand}
          onClose={closeDialog}
        />
      )}

      {/* Help dialog (overlay) */}
      {dialog === "help" && (
        <DialogHelp onClose={closeDialog} />
      )}
    </box>
  );
}

// ── Entry Point ──────────────────────────────────────────

export async function startTUI(options: StartTUIOptions): Promise<void> {
  const { engine, route: initialRoute, workingDir } = options;

  // Set initial route if provided
  if (initialRoute) {
    useSettingsStore.getState().setRoute(initialRoute);
  }

  // Detect terminal background for auto theme
  let detectedMode: "dark" | "light" | undefined;
  detectedMode = await detectTerminalTheme();

  // Read persisted settings
  const settings = useSettingsStore.getState();
  const initialThemeId = settings.themeId || "vercel";
  const initialMode = settings.mode || detectedMode || "dark";

  // Set terminal background before clearing
  const initialColors = getThemeColors(initialThemeId, initialMode);
  if (settings.syncTerminalBg) {
    setTerminalBackground(initialColors.bg);
  }

  console.clear();

  const renderer = await createCliRenderer({
    useMouse: false,
    exitOnCtrlC: false,
  });
  const root = createRoot(renderer);

  root.render(
    <ThemeProvider
      mode={initialMode}
      themeId={initialThemeId}
      syncTerminalBg={settings.syncTerminalBg}
      detectedMode={detectedMode}
    >
      <EngineProvider value={engine}>
        <AppShell engine={engine} />
      </EngineProvider>
    </ThemeProvider>,
  );

  // Graceful cleanup
  let isCleaningUp = false;
  const cleanup = () => {
    if (isCleaningUp) return;
    isCleaningUp = true;
    try { root.unmount(); } catch {}
    try { renderer.destroy(); } catch {}
    restoreTerminalBackground();
    process.exit(0);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
  (globalThis as any).__remoteTuiCleanup = cleanup;

  // Keep alive
  await new Promise(() => {});
}
