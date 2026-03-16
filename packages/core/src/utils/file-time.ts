/**
 * File Time Lock — prevents concurrent file modifications
 * and ensures files are read before being written.
 *
 * Two safety features:
 *   1. Read-before-write: tools must read a file before editing/overwriting it
 *   2. Write serialization: concurrent writes to the same file are queued
 */

import * as fs from "fs";
import * as path from "path";

/** Tolerance in ms for mtime comparison (filesystem rounding) */
const MTIME_TOLERANCE_MS = 100;

export class FileTimeLock {
  /** Map of file path → timestamp when we last read it */
  private reads = new Map<string, number>();
  /** Map of file path → chained write promise for serialization */
  private locks = new Map<string, Promise<void>>();

  /**
   * Record that a file was read at the current time.
   * Called by FileReadTool after successfully reading a file.
   */
  recordRead(filePath: string): void {
    const normalized = path.resolve(filePath);
    this.reads.set(normalized, Date.now());
  }

  /**
   * Assert that a file was read before attempting to write it.
   * Also checks that the file hasn't been modified externally since it was last read.
   *
   * @throws Error if the file was never read or was modified since last read
   */
  assertReadBeforeWrite(filePath: string): void {
    const normalized = path.resolve(filePath);

    // New files don't need to be read first
    if (!fs.existsSync(normalized)) return;

    const readTime = this.reads.get(normalized);
    if (readTime === undefined) {
      throw new Error(
        `You must read the file "${path.basename(filePath)}" before modifying it. ` +
        `Use file_read first to see the current content.`
      );
    }

    // Check if file was modified externally since we last read it
    try {
      const stat = fs.statSync(normalized);
      const mtime = stat.mtimeMs;
      if (mtime > readTime + MTIME_TOLERANCE_MS) {
        // Update recorded time so the agent can re-read and try again
        this.reads.delete(normalized);
        throw new Error(
          `File "${path.basename(filePath)}" was modified externally since you last read it ` +
          `(last read: ${new Date(readTime).toISOString()}, modified: ${new Date(mtime).toISOString()}). ` +
          `Please re-read the file before editing.`
        );
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes("modified externally")) throw err;
      // If stat fails, allow the write (file may have been deleted)
    }
  }

  /**
   * Record that a file was successfully written.
   * Updates the read timestamp to the current time so subsequent
   * edits don't require re-reading.
   */
  recordWrite(filePath: string): void {
    const normalized = path.resolve(filePath);
    this.reads.set(normalized, Date.now());
  }

  /**
   * Serialize concurrent writes to the same file.
   * Multiple writes to different files can still run in parallel.
   */
  async withLock<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
    const normalized = path.resolve(filePath);

    // Chain onto existing lock for this file (or start fresh)
    const currentLock = this.locks.get(normalized) || Promise.resolve();

    let releaseLock: () => void;
    const nextLock = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });

    // Set the lock before awaiting (so next caller sees it)
    this.locks.set(normalized, nextLock);

    // Wait for previous operation on this file to complete
    await currentLock;

    try {
      return await fn();
    } finally {
      releaseLock!();
      // Clean up if this was the last lock
      if (this.locks.get(normalized) === nextLock) {
        this.locks.delete(normalized);
      }
    }
  }

  /** Clear all recorded reads (e.g., on session reset) */
  clear(): void {
    this.reads.clear();
  }
}
