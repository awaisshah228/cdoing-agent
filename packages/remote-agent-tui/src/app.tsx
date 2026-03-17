/**
 * Main TUI Application — OpenTUI + React
 *
 * Features:
 *   - Intro screen if not configured (with setup shortcut)
 *   - Dashboard with agent status, channels, sessions, events
 *   - Config status indicators (configured/not)
 *   - Route navigation (dashboard, setup, skills, config)
 *   - Command palette (Ctrl+P), Help (F1), Sidebar (Ctrl+B)
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
import { Chat } from "./routes/chat";
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

// ── Helpers ──────────────────────────────────────────────

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h${m}m`;
}

// ── Intro Screen (shown when not configured) ─────────────

// ── Config Status Badge ──────────────────────────────────

function ConfigStatusBadge(props: { configured: boolean }) {
  const { theme: t } = useTheme();
  if (props.configured) {
    return <text fg={t.success}>{"\u2713 configured"}</text>;
  }
  return <text fg={t.warning}>{"\u26A0 not configured"}</text>;
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

  // Detect if configured
  const config = props.engine.getConfig();
  const hasApiKey = !!config.agent.apiKey || !!(process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY);
  const isConfigured = hasApiKey;

  const wide = dims.width > 100;
  // Sidebar visible on all routes (including chat) when wide enough
  const showSidebar = sidebarVisible && wide;

  // ── Global Keyboard ──────────────────────────────────

  useKeyboard((key: any) => {
    if (dialog !== null) {
      if (key.ctrl && key.name === "c") process.exit(0);
      if (key.name === "escape") setDialog(null);
      return;
    }

    if (key.ctrl && key.name === "c") {
      const cleanup = (globalThis as any).__remoteTuiCleanup;
      if (cleanup) cleanup();
      else process.exit(0);
    }
    if (key.ctrl && key.name === "p") setDialog((d) => (d === "command" ? null : "command"));
    if (key.ctrl && key.name === "b") toggleSidebar();
    if (key.name === "f1") setDialog((d) => (d === "help" ? null : "help"));

    // Route switching (don't capture when in active chat — but allow when showing welcome)
    if (route === "chat" && isConfigured) return; // Chat handles its own keyboard
    if (key.sequence === "c" && !key.ctrl && !key.meta) setRoute("chat");
    if (key.name === "1") setRoute("dashboard");
    if (key.name === "2") setRoute("skills");
    if (key.name === "3") setRoute("config");
    if (key.sequence === "s" && !key.ctrl && !key.meta) setRoute("setup");
    if (key.sequence === "q" && !key.ctrl && !key.meta) {
      const cleanup = (globalThis as any).__remoteTuiCleanup;
      if (cleanup) cleanup();
      else process.exit(0);
    }
    if (key.name === "escape" && route !== "dashboard") setRoute("dashboard");
  }, {});

  // ── Command palette ──────────────────────────────────

  const handleCommand = useCallback((commandId: string) => {
    setDialog(null);
    switch (commandId) {
      case "route:chat": setRoute("chat"); break;
      case "route:dashboard": setRoute("dashboard"); break;
      case "route:skills": setRoute("skills"); break;
      case "route:config": setRoute("config"); break;
      case "route:setup": setRoute("setup"); break;
      case "display:sidebar": toggleSidebar(); break;
      case "system:help": setDialog("help"); break;
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
        <text fg={t.border}>{" \u2502 "}</text>
        <ConfigStatusBadge configured={isConfigured} />
        <box flexGrow={1} />
        {isConfigured && <text fg={t.textDim}>{`${state.stats.assistantProvider}/${state.stats.assistantModel}`}</text>}
        {isConfigured && <text fg={t.border}>{" \u2502 "}</text>}
        <text fg={t.textDim}>{`uptime ${upStr}`}</text>
      </box>

      {/* Separator */}
      <box height={1} flexShrink={0}>
        <text fg={t.border}>{"\u2500".repeat(Math.max(dims.width, 40))}</text>
      </box>

      {/* Main content */}
      <box flexDirection="row" flexGrow={1}>
        <box flexGrow={1} flexDirection="column">
          {route === "chat" && <Chat />}
          {route === "dashboard" && <Dashboard />}
          {route === "setup" && <Setup onComplete={() => setRoute("chat")} />}
          {route === "skills" && <Skills />}
          {route === "config" && <Config />}
        </box>

        {showSidebar && (
          <box width={1} flexShrink={0}>
            <text fg={t.border}>{"\u2502\n".repeat(Math.max(dims.height - 4, 1))}</text>
          </box>
        )}
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

      {/* Dialogs */}
      {dialog === "command" && <DialogCommand onSelect={handleCommand} onClose={closeDialog} />}
      {dialog === "help" && <DialogHelp onClose={closeDialog} />}
    </box>
  );
}

// ── Entry Point ──────────────────────────────────────────

export async function startTUI(options: StartTUIOptions): Promise<void> {
  const { engine, route: initialRoute } = options;

  if (initialRoute) {
    useSettingsStore.getState().setRoute(initialRoute);
  }

  let detectedMode: "dark" | "light" | undefined;
  detectedMode = await detectTerminalTheme();

  const settings = useSettingsStore.getState();
  const initialThemeId = settings.themeId || "vercel";
  const initialMode = settings.mode || detectedMode || "dark";

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

  let isCleaningUp = false;
  const cleanup = async () => {
    if (isCleaningUp) return;
    isCleaningUp = true;
    try { root.unmount(); } catch {}
    try { renderer.destroy(); } catch {}
    restoreTerminalBackground();
    // Gracefully stop the engine (saves sessions to disk, closes gateway)
    try { await engine.stop(); } catch {}
    process.exit(0);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
  (globalThis as any).__remoteTuiCleanup = cleanup;

  await new Promise(() => {});
}
