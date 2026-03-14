/**
 * Memory System — persistent memory across sessions.
 *
 * Stores key-value memories in ~/.cdoing/memory.json
 * The agent can save, recall, and forget memories.
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const MEMORY_DIR = path.join(os.homedir(), ".cdoing");
const MEMORY_FILE = path.join(MEMORY_DIR, "memory.json");

export interface MemoryEntry {
  key: string;
  value: string;
  category: "user" | "project" | "preference" | "context";
  createdAt: string;
  updatedAt: string;
}

export class MemoryStore {
  private memories: MemoryEntry[] = [];

  constructor() {
    this.load();
  }

  private load(): void {
    try {
      if (fs.existsSync(MEMORY_FILE)) {
        const data = JSON.parse(fs.readFileSync(MEMORY_FILE, "utf-8"));
        this.memories = Array.isArray(data.memories) ? data.memories : [];
      }
    } catch {
      this.memories = [];
    }
  }

  private save(): void {
    if (!fs.existsSync(MEMORY_DIR)) fs.mkdirSync(MEMORY_DIR, { recursive: true });
    fs.writeFileSync(
      MEMORY_FILE,
      JSON.stringify({ memories: this.memories }, null, 2),
      "utf-8"
    );
  }

  /** Save or update a memory */
  set(key: string, value: string, category: MemoryEntry["category"] = "context"): void {
    const now = new Date().toISOString();
    const existing = this.memories.find((m) => m.key === key);
    if (existing) {
      existing.value = value;
      existing.updatedAt = now;
      existing.category = category;
    } else {
      this.memories.push({ key, value, category, createdAt: now, updatedAt: now });
    }
    this.save();
  }

  /** Get a specific memory */
  get(key: string): string | null {
    const entry = this.memories.find((m) => m.key === key);
    return entry?.value || null;
  }

  /** Search memories by keyword */
  search(query: string): MemoryEntry[] {
    const q = query.toLowerCase();
    return this.memories.filter(
      (m) => m.key.toLowerCase().includes(q) || m.value.toLowerCase().includes(q)
    );
  }

  /** Get all memories */
  getAll(): ReadonlyArray<MemoryEntry> {
    return this.memories;
  }

  /** Get memories by category */
  getByCategory(category: MemoryEntry["category"]): MemoryEntry[] {
    return this.memories.filter((m) => m.category === category);
  }

  /** Delete a memory */
  forget(key: string): boolean {
    const index = this.memories.findIndex((m) => m.key === key);
    if (index === -1) return false;
    this.memories.splice(index, 1);
    this.save();
    return true;
  }

  /** Clear all memories */
  clear(): void {
    this.memories = [];
    this.save();
  }

  /** Format memories for inclusion in system prompt */
  formatForPrompt(): string {
    if (this.memories.length === 0) return "";

    const byCategory = new Map<string, MemoryEntry[]>();
    for (const m of this.memories) {
      const list = byCategory.get(m.category) || [];
      list.push(m);
      byCategory.set(m.category, list);
    }

    const parts: string[] = [];
    for (const [category, entries] of byCategory) {
      parts.push(`## ${category}`);
      for (const e of entries) {
        parts.push(`- **${e.key}**: ${e.value}`);
      }
    }

    return parts.join("\n");
  }
}
