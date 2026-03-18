/**
 * Memory System — persistent, project-scoped memory across sessions.
 *
 * Inspired by Claude Code's memory system:
 *   - Global memories: ~/.cdoing/memory/  (user prefs, cross-project)
 *   - Project memories: ~/.cdoing/projects/<hash>/memory/  (project-specific)
 *   - Each memory is a separate .md file with YAML frontmatter
 *   - MEMORY.md index file for quick loading
 *
 * Memory types:
 *   - user: info about the user (role, expertise, preferences)
 *   - feedback: corrections/guidance the user gave (don't repeat mistakes)
 *   - project: ongoing work, goals, deadlines, decisions
 *   - reference: pointers to external systems (Linear, Slack, Grafana, etc.)
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";

export type MemoryType = "user" | "feedback" | "project" | "reference";

export interface MemoryEntry {
  /** Unique key (also the filename without .md) */
  key: string;
  /** Human-readable name */
  name: string;
  /** One-line description — used to decide relevance */
  description: string;
  /** Memory type */
  type: MemoryType;
  /** Full content */
  content: string;
  createdAt: string;
  updatedAt: string;
}

// Legacy support
export { MemoryType as MemoryCategory };

const CDOING_DIR = path.join(os.homedir(), ".cdoing");
const GLOBAL_MEMORY_DIR = path.join(CDOING_DIR, "memory");

function projectMemoryDir(workingDir: string): string {
  // Use path-based dirname like Claude Code: ~/.cdoing/projects/-Users-foo-myproject/memory/
  const safeName = workingDir.replace(/[/\\]/g, "-").replace(/^-/, "");
  return path.join(CDOING_DIR, "projects", safeName, "memory");
}

/** Parse a memory .md file with YAML frontmatter */
function parseMemoryFile(filePath: string): MemoryEntry | null {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!match) return null;

    const frontmatter = match[1];
    const content = match[2].trim();

    // Simple YAML parser for our known fields
    const fields: Record<string, string> = {};
    for (const line of frontmatter.split("\n")) {
      const kv = line.match(/^(\w+):\s*(.+)$/);
      if (kv) fields[kv[1]] = kv[2].trim();
    }

    const key = path.basename(filePath, ".md");
    return {
      key,
      name: fields.name || key,
      description: fields.description || "",
      type: (fields.type as MemoryType) || "reference",
      content,
      createdAt: fields.createdAt || new Date().toISOString(),
      updatedAt: fields.updatedAt || new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

/** Serialize a memory entry to .md with YAML frontmatter */
function serializeMemory(entry: MemoryEntry): string {
  return [
    "---",
    `name: ${entry.name}`,
    `description: ${entry.description}`,
    `type: ${entry.type}`,
    `createdAt: ${entry.createdAt}`,
    `updatedAt: ${entry.updatedAt}`,
    "---",
    "",
    entry.content,
    "",
  ].join("\n");
}

export class MemoryStore {
  private globalMemories: Map<string, MemoryEntry> = new Map();
  private projectMemories: Map<string, MemoryEntry> = new Map();
  private workingDir: string | null;

  constructor(workingDir?: string) {
    this.workingDir = workingDir || null;
    this.load();
  }

  private getProjectDir(): string | null {
    if (!this.workingDir) return null;
    return projectMemoryDir(this.workingDir);
  }

  /** Load all memories from both global and project directories */
  private load(): void {
    this.globalMemories = this.loadDir(GLOBAL_MEMORY_DIR);
    const projDir = this.getProjectDir();
    if (projDir) {
      this.projectMemories = this.loadDir(projDir);
    }

    // Migrate legacy memory.json if it exists
    this.migrateLegacy();
  }

  private loadDir(dir: string): Map<string, MemoryEntry> {
    const entries = new Map<string, MemoryEntry>();
    try {
      if (!fs.existsSync(dir)) return entries;
      for (const file of fs.readdirSync(dir)) {
        if (!file.endsWith(".md") || file === "MEMORY.md") continue;
        const entry = parseMemoryFile(path.join(dir, file));
        if (entry) entries.set(entry.key, entry);
      }
    } catch {
      // directory not readable
    }
    return entries;
  }

  /** Migrate from legacy ~/.cdoing/memory.json to new format */
  private migrateLegacy(): void {
    const legacyFile = path.join(CDOING_DIR, "memory.json");
    try {
      if (!fs.existsSync(legacyFile)) return;
      const data = JSON.parse(fs.readFileSync(legacyFile, "utf-8"));
      const memories = Array.isArray(data.memories) ? data.memories : [];
      if (memories.length === 0) return;

      for (const m of memories) {
        if (!m.key || this.globalMemories.has(m.key)) continue;
        const typeMap: Record<string, MemoryType> = {
          user: "user", project: "project", preference: "feedback", context: "reference",
        };
        const entry: MemoryEntry = {
          key: m.key,
          name: m.key,
          description: m.value?.substring(0, 80) || "",
          type: typeMap[m.category] || "reference",
          content: m.value || "",
          createdAt: m.createdAt || new Date().toISOString(),
          updatedAt: m.updatedAt || new Date().toISOString(),
        };
        this.globalMemories.set(entry.key, entry);
        this.writeEntry(GLOBAL_MEMORY_DIR, entry);
      }

      // Rename legacy file so we don't migrate again
      fs.renameSync(legacyFile, legacyFile + ".migrated");
    } catch {
      // ignore migration errors
    }
  }

  /** Write a single memory entry to disk */
  private writeEntry(dir: string, entry: MemoryEntry): void {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, `${entry.key}.md`);
    fs.writeFileSync(filePath, serializeMemory(entry), "utf-8");
  }

  /** Delete a memory file from disk */
  private deleteEntry(dir: string, key: string): void {
    const filePath = path.join(dir, `${key}.md`);
    try { fs.unlinkSync(filePath); } catch { /* ignore */ }
  }

  /** Update the MEMORY.md index file */
  private updateIndex(dir: string, entries: Map<string, MemoryEntry>): void {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const lines = ["# Memory Index", ""];
    for (const [key, entry] of entries) {
      lines.push(`- [${key}.md](${key}.md) — ${entry.description}`);
    }
    fs.writeFileSync(path.join(dir, "MEMORY.md"), lines.join("\n") + "\n", "utf-8");
  }

  // ── Public API ──────────────────────────────────────────

  /**
   * Save or update a memory.
   * Project-scoped types (project, reference) go to project dir.
   * User-scoped types (user, feedback) go to global dir.
   */
  set(key: string, value: string, type: MemoryType = "reference", opts?: { name?: string; description?: string }): void {
    const now = new Date().toISOString();
    const isProjectScoped = (type === "project" || type === "reference") && this.workingDir;
    const targetMap = isProjectScoped ? this.projectMemories : this.globalMemories;
    const targetDir = isProjectScoped ? this.getProjectDir()! : GLOBAL_MEMORY_DIR;

    const existing = targetMap.get(key);
    const entry: MemoryEntry = {
      key,
      name: opts?.name || existing?.name || key,
      description: opts?.description || existing?.description || value.substring(0, 80),
      type,
      content: value,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };

    targetMap.set(key, entry);
    this.writeEntry(targetDir, entry);
    this.updateIndex(targetDir, targetMap);
  }

  /** Get a specific memory by key (searches both scopes) */
  get(key: string): MemoryEntry | null {
    return this.projectMemories.get(key) || this.globalMemories.get(key) || null;
  }

  /** Get a memory value by key (legacy compat) */
  getValue(key: string): string | null {
    const entry = this.get(key);
    return entry?.content || null;
  }

  /** Search memories by keyword across both scopes */
  search(query: string): MemoryEntry[] {
    const q = query.toLowerCase();
    const results: MemoryEntry[] = [];
    const all = [...this.projectMemories.values(), ...this.globalMemories.values()];
    for (const m of all) {
      if (
        m.key.toLowerCase().includes(q) ||
        m.name.toLowerCase().includes(q) ||
        m.description.toLowerCase().includes(q) ||
        m.content.toLowerCase().includes(q)
      ) {
        results.push(m);
      }
    }
    return results;
  }

  /** Get all memories (merged: project overrides global for same key) */
  getAll(): MemoryEntry[] {
    const merged = new Map<string, MemoryEntry>(this.globalMemories);
    for (const [key, entry] of this.projectMemories) {
      merged.set(key, entry); // project overrides global
    }
    return [...merged.values()];
  }

  /** Get memories by type */
  getByType(type: MemoryType): MemoryEntry[] {
    return this.getAll().filter((m) => m.type === type);
  }

  /** Alias for backward compat */
  getByCategory(category: string): MemoryEntry[] {
    return this.getByType(category as MemoryType);
  }

  /** Delete a memory */
  forget(key: string): boolean {
    let deleted = false;
    if (this.projectMemories.has(key)) {
      this.projectMemories.delete(key);
      this.deleteEntry(this.getProjectDir()!, key);
      this.updateIndex(this.getProjectDir()!, this.projectMemories);
      deleted = true;
    }
    if (this.globalMemories.has(key)) {
      this.globalMemories.delete(key);
      this.deleteEntry(GLOBAL_MEMORY_DIR, key);
      this.updateIndex(GLOBAL_MEMORY_DIR, this.globalMemories);
      deleted = true;
    }
    return deleted;
  }

  /** Clear all memories in both scopes */
  clear(): void {
    for (const key of this.globalMemories.keys()) {
      this.deleteEntry(GLOBAL_MEMORY_DIR, key);
    }
    for (const key of this.projectMemories.keys()) {
      this.deleteEntry(this.getProjectDir()!, key);
    }
    this.globalMemories.clear();
    this.projectMemories.clear();
  }

  /** Format memories for inclusion in system prompt */
  formatForPrompt(): string {
    const all = this.getAll();
    if (all.length === 0) return "";

    const byType = new Map<string, MemoryEntry[]>();
    for (const m of all) {
      const list = byType.get(m.type) || [];
      list.push(m);
      byType.set(m.type, list);
    }

    const typeLabels: Record<string, string> = {
      user: "About the User",
      feedback: "Guidance & Corrections",
      project: "Project Context",
      reference: "External References",
    };

    const parts: string[] = [];
    for (const [type, entries] of byType) {
      parts.push(`## ${typeLabels[type] || type}`);
      for (const e of entries) {
        parts.push(`- **${e.name}**: ${e.content}`);
      }
    }

    return parts.join("\n");
  }
}
