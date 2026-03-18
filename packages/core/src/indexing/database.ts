/**
 * Index Database — SQLite storage for codebase index.
 *
 * Tables:
 *   - chunks: file chunks with content and line ranges
 *   - fts: FTS5 virtual table for full-text search (trigram tokenizer)
 *   - fts_metadata: links FTS entries to chunks
 *   - embeddings: vector embeddings stored as JSON arrays
 *   - index_catalog: tracks which files have been indexed (for incremental updates)
 */

import Database from "better-sqlite3";
import * as path from "path";
import * as os from "os";
import * as fs from "fs";
import * as crypto from "crypto";
import type { ChunkWithMeta, SearchResult, IndexStats } from "./types";

const INDEX_DIR = path.join(os.homedir(), ".cdoing");
const INDEX_FILE = path.join(INDEX_DIR, "index.sqlite");

export class IndexDatabase {
  private db: Database.Database;

  constructor(dbPath?: string) {
    const filePath = dbPath || INDEX_FILE;
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    this.db = new Database(filePath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");
    this.initTables();
  }

  private initTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS chunks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        path TEXT NOT NULL,
        cacheKey TEXT NOT NULL,
        content TEXT NOT NULL,
        startLine INTEGER NOT NULL,
        endLine INTEGER NOT NULL,
        idx INTEGER NOT NULL DEFAULT 0,
        UNIQUE(path, cacheKey, startLine, endLine)
      );

      CREATE INDEX IF NOT EXISTS idx_chunks_path ON chunks(path);
      CREATE INDEX IF NOT EXISTS idx_chunks_cacheKey ON chunks(cacheKey);

      CREATE VIRTUAL TABLE IF NOT EXISTS fts USING fts5(
        path,
        content,
        tokenize = 'trigram'
      );

      CREATE TABLE IF NOT EXISTS fts_metadata (
        id INTEGER PRIMARY KEY,
        path TEXT NOT NULL,
        cacheKey TEXT NOT NULL,
        chunkId INTEGER NOT NULL,
        FOREIGN KEY (chunkId) REFERENCES chunks(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS embeddings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chunkId INTEGER NOT NULL,
        path TEXT NOT NULL,
        cacheKey TEXT NOT NULL,
        vector TEXT NOT NULL,
        model TEXT NOT NULL,
        FOREIGN KEY (chunkId) REFERENCES chunks(id) ON DELETE CASCADE,
        UNIQUE(chunkId, model)
      );

      CREATE TABLE IF NOT EXISTS index_catalog (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        path TEXT NOT NULL,
        cacheKey TEXT NOT NULL,
        lastUpdated INTEGER NOT NULL,
        directory TEXT NOT NULL,
        UNIQUE(path, directory)
      );
    `);
  }

  // ── Cache key ─────────────────────────────────────────────────────────────

  static cacheKey(content: string): string {
    return crypto.createHash("sha256").update(content).digest("hex").substring(0, 16);
  }

  // ── Chunk operations ──────────────────────────────────────────────────────

  insertChunks(chunks: ChunkWithMeta[]): number[] {
    const insert = this.db.prepare(
      `INSERT OR IGNORE INTO chunks (path, cacheKey, content, startLine, endLine, idx) VALUES (?, ?, ?, ?, ?, ?)`
    );
    const ids: number[] = [];

    const tx = this.db.transaction(() => {
      for (let i = 0; i < chunks.length; i++) {
        const c = chunks[i];
        const info = insert.run(c.path, c.cacheKey, c.content, c.startLine, c.endLine, i);
        ids.push(Number(info.lastInsertRowid));
      }
    });
    tx();
    return ids;
  }

  deleteChunksByPath(filePath: string): void {
    // Get chunk IDs first for cascading cleanup
    const chunkIds = this.db.prepare("SELECT id FROM chunks WHERE path = ?").all(filePath) as { id: number }[];
    if (chunkIds.length === 0) return;

    const tx = this.db.transaction(() => {
      for (const { id } of chunkIds) {
        this.db.prepare("DELETE FROM fts_metadata WHERE chunkId = ?").run(id);
        this.db.prepare("DELETE FROM embeddings WHERE chunkId = ?").run(id);
      }
      this.db.prepare("DELETE FROM chunks WHERE path = ?").run(filePath);
      // FTS cleanup — delete by path
      this.db.prepare("DELETE FROM fts WHERE path = ?").run(filePath);
    });
    tx();
  }

  // ── FTS operations ────────────────────────────────────────────────────────

  insertFts(chunkId: number, filePath: string, content: string, cacheKey: string): void {
    // Insert into FTS virtual table
    const ftsInsert = this.db.prepare("INSERT INTO fts (rowid, path, content) VALUES (?, ?, ?)");
    const metaInsert = this.db.prepare(
      "INSERT INTO fts_metadata (id, path, cacheKey, chunkId) VALUES (?, ?, ?, ?)"
    );

    // Use chunkId as rowid for direct mapping
    const rowid = chunkId;
    ftsInsert.run(rowid, filePath, content);
    metaInsert.run(rowid, filePath, cacheKey, chunkId);
  }

  /**
   * Full-text search with BM25 ranking.
   * Path matches get a 10x boost.
   * Results below bm25Threshold are filtered out (BM25 scores are negative; closer to 0 = better).
   */
  searchFts(query: string, limit = 25, directory?: string, bm25Threshold = -2.5): SearchResult[] {
    // Escape special FTS5 characters
    const escaped = query.replace(/[?"]/g, "");
    if (!escaped.trim()) return [];

    let sql = `
      SELECT fts_metadata.chunkId, fts_metadata.path, fts.content,
             bm25(fts, 10.0) AS score, chunks.startLine, chunks.endLine
      FROM fts
      JOIN fts_metadata ON fts.rowid = fts_metadata.id
      JOIN chunks ON fts_metadata.chunkId = chunks.id
      WHERE fts MATCH ?
        AND bm25(fts, 10.0) < 0
    `;

    const params: any[] = [escaped];

    if (directory) {
      sql += " AND fts_metadata.path LIKE ?";
      params.push(directory + "%");
    }

    // Filter out low-quality results (BM25 scores are negative; more negative = worse)
    sql += " AND bm25(fts, 10.0) >= ?";
    params.push(bm25Threshold);

    sql += " ORDER BY bm25(fts, 10.0) LIMIT ?";
    params.push(limit);

    try {
      const rows = this.db.prepare(sql).all(...params) as any[];
      return rows.map((r) => ({
        path: r.path,
        content: r.content,
        startLine: r.startLine,
        endLine: r.endLine,
        score: Math.abs(r.score),
        source: "fts" as const,
      }));
    } catch {
      // FTS query syntax error — return empty
      return [];
    }
  }

  // ── Embedding operations ──────────────────────────────────────────────────

  insertEmbedding(chunkId: number, filePath: string, cacheKey: string, vector: number[], model: string): void {
    this.db.prepare(
      "INSERT OR REPLACE INTO embeddings (chunkId, path, cacheKey, vector, model) VALUES (?, ?, ?, ?, ?)"
    ).run(chunkId, filePath, cacheKey, JSON.stringify(vector), model);
  }

  /**
   * Retrieve all embeddings for similarity search.
   * Returns chunks with their vectors for in-process cosine similarity.
   */
  getEmbeddings(model: string, directory?: string): Array<{
    chunkId: number;
    path: string;
    content: string;
    vector: number[];
    startLine: number;
    endLine: number;
  }> {
    let sql = `
      SELECT e.chunkId, e.path, c.content, e.vector, c.startLine, c.endLine
      FROM embeddings e
      JOIN chunks c ON e.chunkId = c.id
      WHERE e.model = ?
    `;
    const params: any[] = [model];

    if (directory) {
      sql += " AND e.path LIKE ?";
      params.push(directory + "%");
    }

    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.map((r) => ({
      ...r,
      vector: JSON.parse(r.vector),
    }));
  }

  // ── Catalog operations (incremental updates) ─────────────────────────────

  getCatalogEntry(filePath: string, directory: string): { cacheKey: string; lastUpdated: number } | null {
    const row = this.db.prepare(
      "SELECT cacheKey, lastUpdated FROM index_catalog WHERE path = ? AND directory = ?"
    ).get(filePath, directory) as any;
    return row || null;
  }

  updateCatalog(filePath: string, cacheKey: string, directory: string): void {
    this.db.prepare(
      `INSERT OR REPLACE INTO index_catalog (path, cacheKey, lastUpdated, directory)
       VALUES (?, ?, ?, ?)`
    ).run(filePath, cacheKey, Date.now(), directory);
  }

  removeCatalogEntry(filePath: string, directory: string): void {
    this.db.prepare("DELETE FROM index_catalog WHERE path = ? AND directory = ?").run(filePath, directory);
  }

  getCatalogPaths(directory: string): Map<string, string> {
    const rows = this.db.prepare(
      "SELECT path, cacheKey FROM index_catalog WHERE directory = ?"
    ).all(directory) as { path: string; cacheKey: string }[];

    const map = new Map<string, string>();
    for (const row of rows) map.set(row.path, row.cacheKey);
    return map;
  }

  // ── Stats ─────────────────────────────────────────────────────────────────

  getStats(): IndexStats {
    const chunks = (this.db.prepare("SELECT COUNT(*) as c FROM chunks").get() as any)?.c || 0;
    const fts = (this.db.prepare("SELECT COUNT(*) as c FROM fts_metadata").get() as any)?.c || 0;
    const emb = (this.db.prepare("SELECT COUNT(*) as c FROM embeddings").get() as any)?.c || 0;
    const files = (this.db.prepare("SELECT COUNT(DISTINCT path) as c FROM index_catalog").get() as any)?.c || 0;
    const lastRow = this.db.prepare("SELECT MAX(lastUpdated) as m FROM index_catalog").get() as any;

    let sizeBytes = 0;
    try {
      const dbPath = this.db.name;
      if (fs.existsSync(dbPath)) sizeBytes = fs.statSync(dbPath).size;
    } catch {}

    return {
      totalFiles: files,
      totalChunks: chunks,
      ftsEntries: fts,
      embeddingEntries: emb,
      lastIndexed: lastRow?.m || 0,
      indexSizeBytes: sizeBytes,
    };
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  close(): void {
    this.db.close();
  }

  clearAll(): void {
    this.db.exec(`
      DELETE FROM embeddings;
      DELETE FROM fts_metadata;
      DELETE FROM fts;
      DELETE FROM chunks;
      DELETE FROM index_catalog;
    `);
  }
}
