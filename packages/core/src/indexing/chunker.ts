/**
 * Code Chunker — splits files into meaningful chunks for indexing.
 *
 * Two strategies:
 *   1. Code-aware: splits on function/class boundaries (heuristic, no tree-sitter)
 *   2. Basic: splits on line count with overlap
 *
 * Inspired by Continue's chunking but without tree-sitter dependency
 * to keep the package lightweight.
 */

import * as path from "path";

export interface Chunk {
  content: string;
  startLine: number;
  endLine: number;
}

/** Target tokens per chunk (matches embedding model sweet spot) */
const MAX_CHUNK_TOKENS = 384;

/** Approximate chars per token (~3.5 for Claude, ~4 for OpenAI) */
const CHARS_PER_TOKEN = 3.5;

/** Max chars per chunk (derived from token target) */
const MAX_CHUNK_CHARS = Math.ceil(MAX_CHUNK_TOKENS * CHARS_PER_TOKEN);

/** Overlap between chunks (lines) */
const OVERLAP_LINES = 3;

/**
 * Estimate token count for a string.
 * Uses ~3.5 chars/token heuristic (consistent with context-manager.ts).
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/** File extensions that support code-aware chunking */
const CODE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".py", ".rb", ".go", ".rs", ".java", ".kt",
  ".c", ".cpp", ".h", ".hpp", ".cs",
  ".swift", ".scala", ".lua", ".php", ".pl",
  ".sh", ".bash", ".zsh",
]);

/** Patterns that indicate function/class boundaries */
const BOUNDARY_PATTERNS = [
  /^(?:export\s+)?(?:async\s+)?function\s/,          // function declarations
  /^(?:export\s+)?(?:const|let|var)\s+\w+\s*=\s*(?:async\s+)?\(/,  // arrow functions
  /^(?:export\s+)?(?:const|let|var)\s+\w+\s*=\s*(?:async\s+)?function/,
  /^(?:export\s+)?class\s/,                           // classes
  /^(?:export\s+)?interface\s/,                        // interfaces
  /^(?:export\s+)?type\s+\w+\s*=/,                     // type aliases
  /^(?:export\s+)?enum\s/,                             // enums
  /^\s*(?:public|private|protected|static|async)\s+\w+\s*\(/, // methods
  /^def\s+\w+/,                                        // Python functions
  /^class\s+\w+/,                                      // Python classes
  /^func\s+/,                                          // Go functions
  /^(?:pub\s+)?(?:fn|struct|enum|impl|trait)\s/,       // Rust
  /^(?:public|private|protected)\s+(?:static\s+)?(?:\w+\s+)?\w+\s*\(/, // Java/C#
];

/**
 * Check if a file should be chunked.
 */
export function shouldChunk(filePath: string, contentLength: number): boolean {
  if (contentLength === 0) return false;
  if (contentLength > 1024 * 1024) return false; // Skip files > 1MB
  const ext = path.extname(filePath).toLowerCase();
  if (!ext) return false;
  return true;
}

/**
 * Chunk a file's content into meaningful pieces.
 * Uses code-aware splitting for code files, basic splitting for others.
 */
export function chunkDocument(filePath: string, content: string): Chunk[] {
  if (!content.trim()) return [];

  const ext = path.extname(filePath).toLowerCase();

  if (CODE_EXTENSIONS.has(ext)) {
    return codeChunker(content);
  }

  // Markdown: split by headers
  if (ext === ".md" || ext === ".mdx") {
    return markdownChunker(content);
  }

  return basicChunker(content);
}

/**
 * Code-aware chunking: split on function/class boundaries.
 */
function codeChunker(content: string): Chunk[] {
  const lines = content.split("\n");
  const chunks: Chunk[] = [];

  // Find boundary lines
  const boundaries: number[] = [0];
  for (let i = 1; i < lines.length; i++) {
    const trimmed = lines[i].trimStart();
    if (BOUNDARY_PATTERNS.some((p) => p.test(trimmed))) {
      boundaries.push(i);
    }
  }
  boundaries.push(lines.length);

  // Create chunks from boundaries
  for (let i = 0; i < boundaries.length - 1; i++) {
    const start = boundaries[i];
    const end = boundaries[i + 1];
    const chunkLines = lines.slice(start, end);
    const chunkContent = chunkLines.join("\n").trim();

    if (!chunkContent) continue;

    // If chunk exceeds 2x token target, split it further
    if (estimateTokens(chunkContent) > MAX_CHUNK_TOKENS * 2) {
      const subChunks = basicChunkerFromLines(chunkLines, start);
      chunks.push(...subChunks);
    } else {
      chunks.push({ content: chunkContent, startLine: start + 1, endLine: end });
    }
  }

  // Merge tiny chunks (< 100 chars) with neighbors
  return mergeSmallChunks(chunks);
}

/**
 * Markdown chunking: split by headers.
 */
function markdownChunker(content: string): Chunk[] {
  const lines = content.split("\n");
  const chunks: Chunk[] = [];
  let currentStart = 0;
  let currentLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    if (/^#{1,3}\s/.test(lines[i]) && currentLines.length > 0) {
      const text = currentLines.join("\n").trim();
      if (text) {
        chunks.push({ content: text, startLine: currentStart + 1, endLine: i });
      }
      currentStart = i;
      currentLines = [lines[i]];
    } else {
      currentLines.push(lines[i]);
    }
  }

  // Last section
  const text = currentLines.join("\n").trim();
  if (text) {
    chunks.push({ content: text, startLine: currentStart + 1, endLine: lines.length });
  }

  return mergeSmallChunks(chunks);
}

/**
 * Basic line-based chunking with overlap.
 */
function basicChunker(content: string): Chunk[] {
  return basicChunkerFromLines(content.split("\n"), 0);
}

function basicChunkerFromLines(lines: string[], lineOffset: number): Chunk[] {
  const chunks: Chunk[] = [];
  let i = 0;

  while (i < lines.length) {
    let tokenCount = 0;
    let end = i;

    // Accumulate lines until we hit the token limit
    while (end < lines.length && tokenCount < MAX_CHUNK_TOKENS) {
      tokenCount += estimateTokens(lines[end] + "\n");
      end++;
    }

    const chunkLines = lines.slice(i, end);
    const content = chunkLines.join("\n").trim();

    if (content) {
      chunks.push({
        content,
        startLine: lineOffset + i + 1,
        endLine: lineOffset + end,
      });
    }

    if (end >= lines.length) break;

    // Step back by overlap lines for context continuity
    i = Math.max(i + 1, end - OVERLAP_LINES);
  }

  return chunks;
}

function mergeSmallChunks(chunks: Chunk[], minSize = 100): Chunk[] {
  if (chunks.length <= 1) return chunks;

  const merged: Chunk[] = [];
  let current = chunks[0];

  for (let i = 1; i < chunks.length; i++) {
    if (current.content.length < minSize) {
      // Merge with next
      current = {
        content: current.content + "\n\n" + chunks[i].content,
        startLine: current.startLine,
        endLine: chunks[i].endLine,
      };
    } else {
      merged.push(current);
      current = chunks[i];
    }
  }
  merged.push(current);

  return merged;
}
