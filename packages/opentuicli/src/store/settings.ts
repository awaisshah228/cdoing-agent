/**
 * Settings Store — Zustand + persist (file-backed)
 *
 * Persists user preferences to ~/.cdoing/tui-settings.json so they
 * survive across sessions: theme, mode, provider, model, sidebar, etc.
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { create } from "zustand";
import { persist, createJSONStorage, type StateStorage } from "zustand/middleware";

// ── File-backed storage adapter ─────────────────────────

const SETTINGS_PATH = path.join(os.homedir(), ".cdoing", "tui-settings.json");

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

// ── Settings State ──────────────────────────────────────

export interface SettingsState {
  // Appearance
  themeId: string;
  mode: "dark" | "light";
  syncTerminalBg: boolean;
  sidebarMode: "auto" | "show" | "hide";

  // Provider / model
  provider: string;
  model: string;

  // Actions
  setThemeId: (id: string) => void;
  setMode: (mode: "dark" | "light") => void;
  setSyncTerminalBg: (sync: boolean) => void;
  setSidebarMode: (mode: "auto" | "show" | "hide") => void;
  setProvider: (provider: string) => void;
  setModel: (model: string) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      // Defaults
      themeId: "vercel",
      mode: "dark",
      syncTerminalBg: true,
      sidebarMode: "auto",
      provider: "anthropic",
      model: "",

      // Actions
      setThemeId: (themeId) => set({ themeId }),
      setMode: (mode) => set({ mode }),
      setSyncTerminalBg: (syncTerminalBg) => set({ syncTerminalBg }),
      setSidebarMode: (sidebarMode) => set({ sidebarMode }),
      setProvider: (provider) => set({ provider }),
      setModel: (model) => set({ model }),
    }),
    {
      name: "tui-settings",
      storage: createJSONStorage(() => fileStorage),
      // Only persist these keys (not actions)
      partialize: (state) => ({
        themeId: state.themeId,
        mode: state.mode,
        syncTerminalBg: state.syncTerminalBg,
        sidebarMode: state.sidebarMode,
        provider: state.provider,
        model: state.model,
      }),
    },
  ),
);
