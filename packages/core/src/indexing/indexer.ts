/**
 * Codebase Indexer — orchestrates indexing of an entire codebase.
 *
 * Pipeline:
 *   1. Scan files (respects .gitignore, skips binaries/large files)
 *   2. Compute cache keys (SHA-256 of content)
 *   3. Diff against catalog (find new/modified/deleted files)
 *   4. Chunk new/modified files
 *   5. Insert chunks into SQLite
 *   6. Build FTS5 index
 *   7. Optionally compute embeddings (if provider configured)
 *
 * Supports incremental updates — only re-indexes changed files.
 */

import * as fs from "fs";
import * as path from "path";
import { glob } from "glob";
import { IndexDatabase } from "./database";
import { chunkDocument, shouldChunk } from "./chunker";
import { loadIgnorePatterns } from "../utils/gitignore";
import type { RecentEditsCache } from "./recent-edits-cache";
import type { ChunkWithMeta, SearchResult, IndexStats, IndexingProgressCallback } from "./types";

/** File extensions to index */
const INDEXABLE_EXTENSIONS = new Set([
  // Code
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".py", ".rb", ".go", ".rs", ".java", ".kt", ".scala",
  ".c", ".cpp", ".h", ".hpp", ".cs", ".swift",
  ".lua", ".php", ".pl", ".sh", ".bash", ".zsh",
  // Config/Data
  ".json", ".yaml", ".yml", ".toml", ".xml",
  ".html", ".css", ".scss", ".less", ".vue", ".svelte",
  // Docs
  ".md", ".mdx", ".txt", ".rst",
  // Other
  ".sql", ".graphql", ".gql", ".proto",
  ".env.example", ".gitignore", ".dockerignore",
  "Dockerfile", "Makefile", "Gemfile",
]);

const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", "out", ".next", ".nuxt",
  "__pycache__", ".cache", ".turbo", "coverage", "venv", ".venv",
  "target", "vendor", ".idea", ".vscode",
]);

const MAX_FILE_SIZE = 1024 * 1024; // 1MB
const BATCH_SIZE = 200;

export interface EmbeddingProvider {
  modelId: string;
  embed(texts: string[]): Promise<number[][]>;
  maxBatchSize?: number;
}

export class CodebaseIndexer {
  private db: IndexDatabase;
  private workingDir: string;
  private embeddingProvider?: EmbeddingProvider;
  private recentEditsCache?: RecentEditsCache;

  constructor(
    workingDir: string,
    embeddingProvider?: EmbeddingProvider,
    dbPath?: string,
    recentEditsCache?: RecentEditsCache,
  ) {
    this.workingDir = path.resolve(workingDir);
    this.db = new IndexDatabase(dbPath);
    this.embeddingProvider = embeddingProvider;
    this.recentEditsCache = recentEditsCache;
  }

  /**
   * Attach a RecentEditsCache after construction.
   */
  setRecentEditsCache(cache: RecentEditsCache): void {
    this.recentEditsCache = cache;
  }

  /**
   * Index the entire codebase (incremental — only processes changed files).
   */
  async index(onProgress?: IndexingProgressCallback): Promise<{
    added: number;
    updated: number;
    deleted: number;
    totalChunks: number;
  }> {
    const report = (phase: string, current: number, total: number, message: string) => {
      onProgress?.({ phase, current, total, message });
    };

    // 1. Scan files
    report("scan", 0, 1, "Scanning files...");
    const files = await this.scanFiles();
    report("scan", 1, 1, `Found ${files.length} files`);

    // 2. Diff against catalog
    report("diff", 0, 1, "Computing changes...");
    const catalogPaths = this.db.getCatalogPaths(this.workingDir);
    const currentPaths = new Map<string, string>();

    for (const filePath of files) {
      try {
        const content = fs.readFileSync(filePath, "utf-8");
        const key = IndexDatabase.cacheKey(content);
        currentPaths.set(filePath, key);
      } catch {
        // Skip unreadable files
      }
    }

    // Classify: new, modified, deleted, unchanged
    const toAdd: string[] = [];
    const toUpdate: string[] = [];
    const toDelete: string[] = [];

    for (const [filePath, cacheKey] of currentPaths) {
      const existing = catalogPaths.get(filePath);
      if (!existing) {
        toAdd.push(filePath);
      } else if (existing !== cacheKey) {
        toUpdate.push(filePath);
      }
      // else: unchanged — skip
    }

    for (const filePath of catalogPaths.keys()) {
      if (!currentPaths.has(filePath)) {
        toDelete.push(filePath);
      }
    }

    report("diff", 1, 1, `Changes: ${toAdd.length} new, ${toUpdate.length} modified, ${toDelete.length} deleted`);

    // 3. Delete removed files
    for (const filePath of toDelete) {
      this.db.deleteChunksByPath(filePath);
      this.db.removeCatalogEntry(filePath, this.workingDir);
    }

    // 4. Delete modified files (will re-index)
    for (const filePath of toUpdate) {
      this.db.deleteChunksByPath(filePath);
    }

    // 5. Process new + modified files in batches
    const toProcess = [...toAdd, ...toUpdate];
    let totalChunks = 0;

    for (let batch = 0; batch < toProcess.length; batch += BATCH_SIZE) {
      const batchFiles = toProcess.slice(batch, batch + BATCH_SIZE);
      report("index", batch, toProcess.length, `Indexing batch ${Math.floor(batch / BATCH_SIZE) + 1}...`);

      for (const filePath of batchFiles) {
        const cacheKey = currentPaths.get(filePath)!;
        const content = fs.readFileSync(filePath, "utf-8");
        const relPath = path.relative(this.workingDir, filePath);

        if (!shouldChunk(filePath, content.length)) continue;

        // Chunk the file
        const rawChunks = chunkDocument(filePath, content);
        if (rawChunks.length === 0) continue;

        const chunks: ChunkWithMeta[] = rawChunks.map((c) => ({
          content: c.content,
          path: relPath,
          startLine: c.startLine,
          endLine: c.endLine,
          cacheKey,
        }));

        // Insert chunks
        const chunkIds = this.db.insertChunks(chunks);
        totalChunks += chunkIds.length;

        // Build FTS index
        for (let i = 0; i < chunkIds.length; i++) {
          if (chunkIds[i] > 0) {
            this.db.insertFts(chunkIds[i], relPath, chunks[i].content, cacheKey);
          }
        }

        // Update catalog
        this.db.updateCatalog(filePath, cacheKey, this.workingDir);
      }
    }

    // 6. Compute embeddings (if provider available)
    if (this.embeddingProvider && toProcess.length > 0) {
      report("embeddings", 0, 1, "Computing embeddings...");
      await this.computeEmbeddings(toProcess, currentPaths);
      report("embeddings", 1, 1, "Embeddings complete");
    }

    report("done", 1, 1, "Indexing complete");

    return {
      added: toAdd.length,
      updated: toUpdate.length,
      deleted: toDelete.length,
      totalChunks,
    };
  }

  /**
   * Search the index using full-text search (BM25).
   */
  searchFts(query: string, limit = 25, directory?: string): SearchResult[] {
    return this.db.searchFts(query, limit, directory);
  }

  /**
   * Search using vector similarity (cosine similarity).
   * Requires an embedding provider.
   */
  async searchSemantic(query: string, limit = 25, directory?: string): Promise<SearchResult[]> {
    if (!this.embeddingProvider) return [];

    const [queryVector] = await this.embeddingProvider.embed([query]);
    if (!queryVector) return [];

    const embeddings = this.db.getEmbeddings(this.embeddingProvider.modelId, directory);
    if (embeddings.length === 0) return [];

    // Compute cosine similarity
    const scored = embeddings.map((e) => ({
      ...e,
      score: cosineSimilarity(queryVector, e.vector),
    }));

    // Sort by similarity (highest first) and take top-k
    scored.sort((a, b) => b.score - a.score);

    return scored.slice(0, limit).map((s) => ({
      path: s.path,
      content: s.content,
      startLine: s.startLine,
      endLine: s.endLine,
      score: s.score,
      source: "embedding" as const,
    }));
  }

  /**
   * Search recently edited files for query matches.
   * Recently edited files are highly relevant — the user/agent was just working on them.
   */
  searchRecent(query: string, limit = 10, directory?: string): SearchResult[] {
    if (!this.recentEditsCache) return [];

    const recentFiles = this.recentEditsCache.getRecent(limit * 2);
    if (recentFiles.length === 0) return [];

    const queryLower = query.toLowerCase();
    const results: SearchResult[] = [];

    for (const entry of recentFiles) {
      const relPath = path.relative(this.workingDir, entry.filePath);

      // Filter by directory if specified
      if (directory && !relPath.startsWith(directory)) continue;

      const contentLower = entry.content.toLowerCase();
      const pathLower = relPath.toLowerCase();

      // Score: path match (high) + content match (medium) + recency boost
      let score = 0;
      if (pathLower.includes(queryLower)) score += 5;

      const contentMatches = contentLower.split(queryLower).length - 1;
      if (contentMatches > 0) score += Math.min(contentMatches, 5);

      // Recency boost: more recent = higher score (max +2)
      const ageMinutes = (Date.now() - entry.editedAt) / 60000;
      score += Math.max(0, 2 - ageMinutes / 30);

      if (score <= 0) continue;

      // Extract a snippet around the first match
      const matchIndex = contentLower.indexOf(queryLower);
      let snippet: string;
      if (matchIndex >= 0) {
        const lines = entry.content.split("\n");
        const linesBefore = entry.content.substring(0, matchIndex).split("\n");
        const matchLine = linesBefore.length - 1;
        const start = Math.max(0, matchLine - 3);
        const end = Math.min(lines.length, matchLine + 10);
        snippet = lines.slice(start, end).join("\n");
        results.push({
          path: relPath,
          content: snippet,
          startLine: start + 1,
          endLine: end,
          score,
          source: "recent" as const,
        });
      } else if (pathLower.includes(queryLower)) {
        // Path matched but not content — include file header
        const lines = entry.content.split("\n");
        snippet = lines.slice(0, Math.min(15, lines.length)).join("\n");
        results.push({
          path: relPath,
          content: snippet,
          startLine: 1,
          endLine: Math.min(15, lines.length),
          score,
          source: "recent" as const,
        });
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }

  /**
   * Combined 3-source search: Recent (25%) + FTS (25%) + Embeddings (50%), deduplicated.
   * Matches Continue's hybrid retrieval pipeline.
   */
  async search(query: string, limit = 25, directory?: string): Promise<SearchResult[]> {
    const recentLimit = Math.ceil(limit * 0.25);
    const ftsLimit = Math.ceil(limit * 0.25);
    const embLimit = Math.ceil(limit * 0.50);

    const [recentResults, ftsResults, embResults] = await Promise.all([
      Promise.resolve(this.searchRecent(query, recentLimit, directory)),
      Promise.resolve(this.searchFts(query, ftsLimit, directory)),
      this.searchSemantic(query, embLimit, directory),
    ]);

    // Deduplicate by path + startLine, priority: recent > embeddings > FTS
    const seen = new Set<string>();
    const combined: SearchResult[] = [];

    for (const r of [...recentResults, ...embResults, ...ftsResults]) {
      const key = `${r.path}:${r.startLine}`;
      if (seen.has(key)) continue;
      seen.add(key);
      combined.push(r);
    }

    return combined.slice(0, limit);
  }

  /**
   * Get index statistics.
   */
  getStats(): IndexStats {
    return this.db.getStats();
  }

  /**
   * Clear the entire index.
   */
  clearIndex(): void {
    this.db.clearAll();
  }

  /**
   * Close the database connection.
   */
  close(): void {
    this.db.close();
  }

  // ── Private methods ───────────────────────────────────────────────────────

  private async scanFiles(): Promise<string[]> {
    const ignorePatterns = loadIgnorePatterns(this.workingDir);

    const allFiles = await glob("**/*", {
      cwd: this.workingDir,
      absolute: true,
      nodir: true,
      ignore: [
        ...SKIP_DIRS.values(),
        ...ignorePatterns.map((p) => `**/${p}/**`),
      ].map(p => `**/${p}`),
    });

    return allFiles.filter((f) => {
      const ext = path.extname(f).toLowerCase();
      const basename = path.basename(f);

      // Check extension or known config filenames
      if (!INDEXABLE_EXTENSIONS.has(ext) && !INDEXABLE_EXTENSIONS.has(basename)) return false;

      // Check file size
      try {
        const stat = fs.statSync(f);
        if (stat.size > MAX_FILE_SIZE || stat.size === 0) return false;
      } catch {
        return false;
      }

      // Skip dirs in path
      const rel = path.relative(this.workingDir, f);
      const parts = rel.split(path.sep);
      if (parts.some((p) => SKIP_DIRS.has(p))) return false;

      return true;
    });
  }

  private async computeEmbeddings(
    filePaths: string[],
    cacheKeys: Map<string, string>,
  ): Promise<void> {
    if (!this.embeddingProvider) return;

    const model = this.embeddingProvider.modelId;
    const batchSize = this.embeddingProvider.maxBatchSize || 64;

    // Collect all chunks that need embeddings
    const chunksToEmbed: Array<{ chunkId: number; path: string; content: string; cacheKey: string }> = [];

    for (const filePath of filePaths) {
      const relPath = path.relative(this.workingDir, filePath);
      const cacheKey = cacheKeys.get(filePath)!;

      // Get chunks for this file
      const dbInner = this.db["db"] as any;
      if (!dbInner) continue;
      const rows = dbInner.prepare(
        "SELECT id, content FROM chunks WHERE path = ? AND cacheKey = ?"
      ).all(relPath, cacheKey) as { id: number; content: string }[];

      for (const row of rows) {
        chunksToEmbed.push({ chunkId: row.id, path: relPath, content: row.content, cacheKey });
      }
    }

    // Batch embed
    for (let i = 0; i < chunksToEmbed.length; i += batchSize) {
      const batch = chunksToEmbed.slice(i, i + batchSize);
      const texts = batch.map((c) => c.content);

      try {
        const vectors = await this.embeddingProvider.embed(texts);

        for (let j = 0; j < batch.length; j++) {
          if (vectors[j]) {
            this.db.insertEmbedding(
              batch[j].chunkId,
              batch[j].path,
              batch[j].cacheKey,
              vectors[j],
              model,
            );
          }
        }
      } catch {
        // Embedding failed for this batch — continue with next
      }
    }
  }
}

/** Cosine similarity between two vectors */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}
