/**
 * Recently-Edited LRU Cache — Keeps recently edited files hot for fast retrieval.
 *
 * When the agent edits a file, it's added to this cache. Subsequent codebase
 * searches prioritize cached files, and context providers can include recent
 * edits without re-reading from disk.
 *
 * This matches what Cursor and Windsurf do with their "recently edited" caches
 * to improve relevance of search results and context suggestions.
 */

export interface CachedEdit {
  /** Absolute file path */
  filePath: string;
  /** Content at time of last edit */
  content: string;
  /** Timestamp of last edit */
  editedAt: number;
  /** Number of times this file has been edited in the session */
  editCount: number;
  /** Brief description of last edit (e.g., "replaced 2 occurrences") */
  lastEditSummary: string;
}

export class RecentEditsCache {
  private cache = new Map<string, CachedEdit>();
  private readonly maxSize: number;

  constructor(maxSize: number = 50) {
    this.maxSize = maxSize;
  }

  /**
   * Record a file edit. Moves the file to the front of the LRU cache.
   */
  put(filePath: string, content: string, editSummary: string = ""): void {
    const existing = this.cache.get(filePath);

    // Delete first to re-insert at end (Map preserves insertion order)
    if (existing) {
      this.cache.delete(filePath);
    }

    this.cache.set(filePath, {
      filePath,
      content,
      editedAt: Date.now(),
      editCount: (existing?.editCount || 0) + 1,
      lastEditSummary: editSummary,
    });

    // Evict oldest if over capacity
    if (this.cache.size > this.maxSize) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) {
        this.cache.delete(oldest);
      }
    }
  }

  /**
   * Get a cached file by path. Returns null if not in cache.
   */
  get(filePath: string): CachedEdit | null {
    return this.cache.get(filePath) || null;
  }

  /**
   * Check if a file is in the cache.
   */
  has(filePath: string): boolean {
    return this.cache.has(filePath);
  }

  /**
   * Get all cached edits, ordered by most recently edited first.
   */
  getRecent(limit: number = 10): CachedEdit[] {
    const entries = Array.from(this.cache.values());
    // Map preserves insertion order; last inserted = most recent
    return entries.reverse().slice(0, limit);
  }

  /**
   * Get file paths of recently edited files, most recent first.
   */
  getRecentPaths(limit: number = 10): string[] {
    return this.getRecent(limit).map((e) => e.filePath);
  }

  /**
   * Get files that match a search query (case-insensitive path match).
   * Recently edited files that match are boosted in search results.
   */
  searchByPath(query: string): CachedEdit[] {
    const lower = query.toLowerCase();
    return Array.from(this.cache.values())
      .filter((e) => e.filePath.toLowerCase().includes(lower))
      .reverse(); // most recent first
  }

  /**
   * Search cached file contents for a text pattern.
   */
  searchContent(pattern: string): Array<{ entry: CachedEdit; matches: number }> {
    const results: Array<{ entry: CachedEdit; matches: number }> = [];
    const regex = new RegExp(pattern, "gi");

    for (const entry of this.cache.values()) {
      const matches = (entry.content.match(regex) || []).length;
      if (matches > 0) {
        results.push({ entry, matches });
      }
    }

    // Sort by match count (descending), then recency
    return results.sort((a, b) => b.matches - a.matches || b.entry.editedAt - a.entry.editedAt);
  }

  /**
   * Remove a file from the cache.
   */
  remove(filePath: string): boolean {
    return this.cache.delete(filePath);
  }

  /**
   * Clear the entire cache.
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get cache statistics.
   */
  stats(): { size: number; maxSize: number; totalEdits: number; oldestEditAt: number | null } {
    let totalEdits = 0;
    let oldestEditAt: number | null = null;

    for (const entry of this.cache.values()) {
      totalEdits += entry.editCount;
      if (oldestEditAt === null || entry.editedAt < oldestEditAt) {
        oldestEditAt = entry.editedAt;
      }
    }

    return { size: this.cache.size, maxSize: this.maxSize, totalEdits, oldestEditAt };
  }
}
