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

import type { Engine } from "@cdoing/remote-coding-agent/core/engine";

import { ThemeProvider, useTheme } from "./context/theme";
import { EngineProvider, useEngineState } from "./context/engine";
import { StatusBar } from "./components/status-bar";
import type { Route } from "./components/status-bar";
import { Sidebar } from "./components/sidebar";
import { DialogCommand } from "./components/dialog-command";
import { DialogHelp } from "./components/dialog-help";
import { Dashboard } from "./routes/dashboard";

// ── Types ────────────────────────────────────────────────

type Dialog = "command" | "help" | null;

// ── Uptime Formatter ─────────────────────────────────────

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h${m}m`;
}

// ── Placeholder Routes ───────────────────────────────────

function SetupRoute() {
  const t = useTheme();
  return (
    <box flexDirection="column" flexGrow={1} paddingX={2} paddingY={1}>
      <text fg={t.primary} attributes={TextAttributes.BOLD}>{"Setup"}</text>
      <text fg={t.textMuted}>{"Channel and agent configuration."}</text>
      <text fg={t.textDim}>{"(Coming soon — use the gateway API at /api/config)"}</text>
    </box>
  );
}

function SkillsRoute() {
  const t = useTheme();
  return (
    <box flexDirection="column" flexGrow={1} paddingX={2} paddingY={1}>
      <text fg={t.primary} attributes={TextAttributes.BOLD}>{"Skills"}</text>
      <text fg={t.textMuted}>{"Registered skills and capabilities."}</text>
      <text fg={t.textDim}>{"(Coming soon — skills are loaded from workspace)"}</text>
    </box>
  );
}

function ConfigRoute() {
  const t = useTheme();
  return (
    <box flexDirection="column" flexGrow={1} paddingX={2} paddingY={1}>
      <text fg={t.primary} attributes={TextAttributes.BOLD}>{"Config"}</text>
      <text fg={t.textMuted}>{"Current engine configuration."}</text>
      <text fg={t.textDim}>{"(Coming soon — use the gateway API at /api/config)"}</text>
    </box>
  );
}

// ── App Shell ────────────────────────────────────────────

function AppShell(props: { engine: Engine }) {
  const dims = useTerminalDimensions();
  const t = useTheme();
  const state = useEngineState(2000);

  const [route, setRoute] = useState<Route>("dashboard");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [showSidebar, setShowSidebar] = useState(true);

  const closeDialog = useCallback(() => setDialog(null), []);

  // Auto-hide sidebar when terminal is too narrow
  const wide = dims.width > 120;
  const sidebarVisible = showSidebar && wide;

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
      setShowSidebar((s) => !s);
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
        setShowSidebar((s) => !s);
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
    <box width={dims.width} height={dims.height} flexDirection="column" backgroundColor={t.bg}>
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
          {route === "setup" && <SetupRoute />}
          {route === "skills" && <SkillsRoute />}
          {route === "config" && <ConfigRoute />}
        </box>

        {/* Vertical border between content and sidebar */}
        {sidebarVisible && (
          <box width={1} flexShrink={0}>
            <text fg={t.border}>{"\u2502\n".repeat(Math.max(dims.height - 4, 1))}</text>
          </box>
        )}

        {/* Sidebar (right panel) */}
        {sidebarVisible && <Sidebar state={state} />}
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

export async function startTUI(engine: Engine): Promise<void> {
  // Clear terminal
  console.clear();

  const renderer = await createCliRenderer({
    useMouse: false,
    exitOnCtrlC: false,
  });
  const root = createRoot(renderer);

  root.render(
    <ThemeProvider>
      <EngineProvider engine={engine}>
        <AppShell engine={engine} />
      </EngineProvider>
    </ThemeProvider>
  );

  // Graceful cleanup
  let isCleaningUp = false;
  const cleanup = () => {
    if (isCleaningUp) return;
    isCleaningUp = true;
    try { root.unmount(); } catch {}
    try { renderer.destroy(); } catch {}
    process.exit(0);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
  (globalThis as any).__remoteTuiCleanup = cleanup;

  // Keep alive
  await new Promise(() => {});
}
