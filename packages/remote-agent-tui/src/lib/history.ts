/**
 * Prompt History — persistent input history with up/down navigation
 *
 * Saves the last N prompts to disk so you can navigate them with
 * up/down arrows. Shared across sessions.
 *
 * Storage: ~/.cdoing/remote/prompt-history.json
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const HISTORY_DIR = path.join(os.homedir(), ".cdoing", "remote");
const HISTORY_FILE = path.join(HISTORY_DIR, "prompt-history.json");
const MAX_ENTRIES = 100;

export interface PromptHistoryEntry {
  text: string;
  timestamp: number;
}

let cache: PromptHistoryEntry[] | null = null;

function ensureDir(): void {
  if (!fs.existsSync(HISTORY_DIR)) fs.mkdirSync(HISTORY_DIR, { recursive: true });
}

function load(): PromptHistoryEntry[] {
  if (cache) return cache;
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      const raw = fs.readFileSync(HISTORY_FILE, "utf-8");
      cache = JSON.parse(raw);
      return cache!;
    }
  } catch { /* corrupt file */ }
  cache = [];
  return cache;
}

function save(): void {
  try {
    ensureDir();
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(cache || [], null, 2), "utf-8");
  } catch { /* ignore */ }
}

/** Add a prompt to history. Deduplicates consecutive identical entries. */
export function addToHistory(text: string): void {
  const entries = load();
  const trimmed = text.trim();
  if (!trimmed) return;

  // Don't add if same as last entry
  if (entries.length > 0 && entries[entries.length - 1].text === trimmed) return;

  entries.push({ text: trimmed, timestamp: Date.now() });

  // Trim to max
  if (entries.length > MAX_ENTRIES) {
    cache = entries.slice(entries.length - MAX_ENTRIES);
  }

  save();
}

/** Get all history entries (oldest first). */
export function getHistory(): PromptHistoryEntry[] {
  return load();
}

/** Get the entry at a given index from the end (0 = most recent). */
export function getHistoryEntry(indexFromEnd: number): string | null {
  const entries = load();
  if (indexFromEnd < 0 || indexFromEnd >= entries.length) return null;
  return entries[entries.length - 1 - indexFromEnd].text;
}

/** Number of history entries. */
export function historySize(): number {
  return load().length;
}

/** Clear all history. */
export function clearHistory(): void {
  cache = [];
  save();
}

/**
 * Prompt history navigator — call from the input component.
 *
 * Usage:
 *   const nav = createHistoryNavigator();
 *   // on Up arrow: nav.previous(currentInput) → returns previous prompt or null
 *   // on Down arrow: nav.next() → returns next prompt or null (empty = back to live input)
 */
export function createHistoryNavigator() {
  let cursor = -1; // -1 = live input (not navigating)
  let savedInput = ""; // stash the live input while navigating

  return {
    /** Navigate to the previous (older) entry. Returns the entry text or null if at the end. */
    previous(currentInput: string): string | null {
      const entries = load();
      if (entries.length === 0) return null;

      if (cursor === -1) {
        // Entering history mode — save current input
        savedInput = currentInput;
        cursor = 0;
      } else {
        cursor = Math.min(cursor + 1, entries.length - 1);
      }

      return getHistoryEntry(cursor);
    },

    /** Navigate to the next (newer) entry. Returns the entry text, or the saved input if back to live. */
    next(): string | null {
      if (cursor <= 0) {
        // Back to live input
        cursor = -1;
        return savedInput;
      }

      cursor--;
      return getHistoryEntry(cursor);
    },

    /** Reset navigation (call when user submits or types). */
    reset(): void {
      cursor = -1;
      savedInput = "";
    },

    /** Whether currently navigating history. */
    get isNavigating(): boolean {
      return cursor >= 0;
    },
  };
}
