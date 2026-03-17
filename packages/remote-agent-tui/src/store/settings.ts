/**
 * Settings Store — Zustand + persist (file-backed)
 *
 * Persists user preferences to ~/.cdoing/remote-agent-tui-settings.json
 * so they survive across sessions: theme, mode, route, sidebar, etc.
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { create } from "zustand";
import { persist, createJSONStorage, type StateStorage } from "zustand/middleware";

// ── File-backed storage adapter ─────────────────────────

const SETTINGS_PATH = path.join(os.homedir(), ".cdoing", "remote-agent-tui-settings.json");

const fileStorage: StateStorage = {
  getItem: (name: string): string | null => {
    try {
      if (!fs.existsSync(SETTINGS_PATH)) return null;
      const data = JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf-8"));
      return JSON.stringify(data[name] ?? null);
    } catch {
      return null;
    }
  },
  setItem: (name: string, value: string): void => {
    try {
      const dir = path.dirname(SETTINGS_PATH);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      let data: Record<string, unknown> = {};
      try {
        if (fs.existsSync(SETTINGS_PATH)) {
          data = JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf-8"));
        }
      } catch {}
      data[name] = JSON.parse(value);
      fs.writeFileSync(SETTINGS_PATH, JSON.stringify(data, null, 2), "utf-8");
    } catch {}
  },
  removeItem: (name: string): void => {
    try {
      if (!fs.existsSync(SETTINGS_PATH)) return;
      const data = JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf-8"));
      delete data[name];
      fs.writeFileSync(SETTINGS_PATH, JSON.stringify(data, null, 2), "utf-8");
    } catch {}
  },
};

// ── Types ───────────────────────────────────────────────

export type Route = "dashboard" | "setup" | "skills" | "config";
export type Dialog = "command" | "help" | "model" | null;

// ── Settings State ──────────────────────────────────────

export interface SettingsState {
  // Navigation
  route: Route;
  dialog: Dialog;
  sidebarVisible: boolean;

  // Appearance
  themeId: string;
  mode: "dark" | "light";
  syncTerminalBg: boolean;

  // Actions
  setRoute: (route: Route) => void;
  setDialog: (dialog: Dialog) => void;
  toggleSidebar: () => void;
  setThemeId: (id: string) => void;
  setMode: (mode: "dark" | "light") => void;
  setSyncTerminalBg: (sync: boolean) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      // Defaults
      route: "dashboard" as Route,
      dialog: null as Dialog,
      sidebarVisible: true,
      themeId: "vercel",
      mode: "dark" as "dark" | "light",
      syncTerminalBg: true,

      // Actions
      setRoute: (route) => set({ route }),
      setDialog: (dialog) => set({ dialog }),
      toggleSidebar: () => set((state) => ({ sidebarVisible: !state.sidebarVisible })),
      setThemeId: (themeId) => set({ themeId }),
      setMode: (mode) => set({ mode }),
      setSyncTerminalBg: (syncTerminalBg) => set({ syncTerminalBg }),
    }),
    {
      name: "remote-agent-tui-settings",
      storage: createJSONStorage(() => fileStorage),
      // Only persist these keys (not actions)
      partialize: (state) => ({
        route: state.route,
        sidebarVisible: state.sidebarVisible,
        themeId: state.themeId,
        mode: state.mode,
        syncTerminalBg: state.syncTerminalBg,
      }),
    },
  ),
);
