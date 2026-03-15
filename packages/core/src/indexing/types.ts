/**
 * Indexing Types — interfaces for the codebase indexing system.
 */

export interface IndexTag {
  directory: string;
  branch: string;
  artifactId: string;
}

export interface ChunkWithMeta {
  content: string;
  path: string;
  startLine: number;
  endLine: number;
  cacheKey: string;
}

export interface SearchResult {
  path: string;
  content: string;
  startLine: number;
  endLine: number;
  score: number;
  source: "fts" | "embedding" | "recent";
}

export interface IndexingProgress {
  phase: string;
  current: number;
  total: number;
  message: string;
}

export type IndexingProgressCallback = (progress: IndexingProgress) => void;

export interface IndexStats {
  totalFiles: number;
  totalChunks: number;
  ftsEntries: number;
  embeddingEntries: number;
  lastIndexed: number;
  indexSizeBytes: number;
}
