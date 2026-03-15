/**
 * LRU cache for recently opened/edited files.
 * Provides context to autocomplete — the model sees what you've been working on.
 */

export class OpenedFilesCache {
  private cache = new Map<string, { content: string; editedAt: number }>();
  private readonly maxSize: number;

  constructor(maxSize: number = 10) {
    this.maxSize = maxSize;
  }

  /** Record a file being opened or edited */
  touch(uri: string, content: string): void {
    this.cache.delete(uri); // re-insert at end
    this.cache.set(uri, { content, editedAt: Date.now() });
    if (this.cache.size > this.maxSize) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
  }

  /** Get recently opened files (most recent first), excluding a given URI */
  getRecent(excludeUri?: string, limit: number = 5): Array<{ uri: string; content: string }> {
    const entries = Array.from(this.cache.entries())
      .filter(([uri]) => uri !== excludeUri)
      .reverse()
      .slice(0, limit);
    return entries.map(([uri, { content }]) => ({ uri, content }));
  }

  /** Get a file's cached content */
  get(uri: string): string | null {
    return this.cache.get(uri)?.content ?? null;
  }

  clear(): void {
    this.cache.clear();
  }
}

/** Singleton instance */
export const openedFilesCache = new OpenedFilesCache();
