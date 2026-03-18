/**
 * Codebase Context Provider — @codebase
 *
 * Parallel pipeline search across the entire repository:
 *   - Primary (60%): FTS5 index (BM25 ranked + recent files + embeddings)
 *   - Secondary (40%): Ripgrep live filesystem search (catches unindexed files)
 *   - Deduplicated by file path, FTS results take priority
 *
 * If the index is not available (first run, errors), falls back to ripgrep-only.
 */

import * as path from "path";
import { execSync } from "child_process";
import { CodebaseIndexer } from "../indexing";
import type { ContextProvider, ContextResult, ContextResolveOptions } from "./types";

/** Max files to include in results */
const MAX_RESULTS = 10;

/** Max chars per file snippet */
const SNIPPET_LIMIT = 2000;

/** Total max chars for all results */
const TOTAL_LIMIT = 20000;

/** How results are split between sources */
const FTS_SLOTS = Math.ceil(MAX_RESULTS * 0.6);   // 6 primary slots
const RG_SLOTS = Math.ceil(MAX_RESULTS * 0.4);    // 4 secondary slots

interface SearchHit {
  path: string;
  line?: number;
  snippet: string;
  score: number;
  source: "fts" | "ripgrep";
}

export class CodebaseContextProvider implements ContextProvider {
  id = "codebase";
  trigger = "@codebase";
  description = "Search the entire codebase for relevant code";
  requiresArg = true;

  private indexer: CodebaseIndexer | null = null;
  private indexPromise: Promise<void> | null = null;

  async resolve(arg?: string, options?: ContextResolveOptions): Promise<ContextResult> {
    const query = arg?.trim();
    if (!query) {
      return {
        label: "Codebase Search",
        content: "[Please provide a search query after @codebase, e.g.: @codebase authentication flow]",
        metadata: { source: "codebase" },
      };
    }

    const workingDir = options?.workingDir || process.cwd();

    // Run both sources in parallel, merge & deduplicate
    const results = await this.searchPipeline(query, workingDir);

    if (results.length === 0) {
      return {
        label: `Codebase: "${query}"`,
        content: `[No results found for "${query}" in the codebase.]`,
        metadata: { source: "codebase", itemCount: 0 },
      };
    }

    // Format results with code snippets
    const sections: string[] = [];
    let totalChars = 0;

    for (const result of results.slice(0, MAX_RESULTS)) {
      if (totalChars >= TOTAL_LIMIT) {
        sections.push(`\n... [more results omitted]`);
        break;
      }

      const ext = path.extname(result.path).slice(1);
      const lang = ext || "text";

      let snippet = result.snippet;
      if (snippet.length > SNIPPET_LIMIT) {
        snippet = snippet.substring(0, SNIPPET_LIMIT) + "\n... [truncated]";
      }

      sections.push(`### ${result.path}${result.line ? `:${result.line}` : ""}\n\n\`\`\`${lang}\n${snippet}\n\`\`\``);
      totalChars += snippet.length;
    }

    return {
      label: `Codebase: "${query}" (${results.length} results)`,
      content: `## Codebase Search: "${query}"\n\n${sections.join("\n\n")}`,
      metadata: {
        source: "codebase",
        itemCount: results.length,
        truncated: results.length > MAX_RESULTS,
      },
    };
  }

  // ── Pipeline: FTS (primary) + Ripgrep (secondary), parallel ──────────

  /**
   * Run FTS and ripgrep in parallel, merge results.
   * FTS results take priority (better ranked). Ripgrep fills gaps
   * for files not yet indexed or matches below BM25 threshold.
   */
  private async searchPipeline(query: string, workingDir: string): Promise<SearchHit[]> {
    const [ftsResults, rgResults] = await Promise.all([
      this.searchWithIndex(query, workingDir, FTS_SLOTS),
      this.searchWithRipgrep(query, workingDir, RG_SLOTS * 2), // fetch extra, dedup will trim
    ]);

    // Deduplicate by normalized file path — FTS wins on conflicts
    const seen = new Set<string>();
    const combined: SearchHit[] = [];

    // FTS results first (primary, better ranked)
    for (const hit of ftsResults) {
      const key = normalizePath(hit.path);
      if (seen.has(key)) continue;
      seen.add(key);
      combined.push(hit);
    }

    // Ripgrep results fill remaining slots (secondary, catches fresh/unindexed files)
    for (const hit of rgResults) {
      const key = normalizePath(hit.path);
      if (seen.has(key)) continue;
      seen.add(key);
      combined.push(hit);
    }

    return combined.slice(0, MAX_RESULTS);
  }

  // ── Primary: FTS5 Index ──────────────────────────────────────────────

  /**
   * Search using the FTS5 index (hybrid: recent + FTS + embeddings).
   * Returns empty array if index is not available (never blocks pipeline).
   */
  private async searchWithIndex(
    query: string,
    workingDir: string,
    limit: number,
  ): Promise<SearchHit[]> {
    try {
      await this.ensureIndex(workingDir);
    } catch {
      return [];
    }

    if (!this.indexer) return [];

    try {
      const results = await this.indexer.search(query, limit);
      return results.map((r) => ({
        path: r.path,
        line: r.startLine,
        snippet: r.content,
        score: r.score,
        source: "fts" as const,
      }));
    } catch {
      return [];
    }
  }

  // ── Secondary: Ripgrep ───────────────────────────────────────────────

  /**
   * Live filesystem search using ripgrep.
   * Always up-to-date — catches files not yet in the index.
   */
  private searchWithRipgrep(
    query: string,
    workingDir: string,
    limit: number,
  ): Promise<SearchHit[]> {
    return new Promise((resolve) => {
      try {
        const escapedQuery = query.replace(/['"\\]/g, "\\$&");
        const output = execSync(
          `rg --ignore-case --max-count=3 --context=3 --with-filename --line-number "${escapedQuery}" .`,
          {
            cwd: workingDir,
            encoding: "utf-8",
            timeout: 10000,
            maxBuffer: 5 * 1024 * 1024,
          },
        );

        const results = new Map<string, SearchHit>();
        const lines = output.split("\n");
        let currentFile = "";
        let currentSnippet = "";
        let currentLine: number | undefined;

        for (const line of lines) {
          const match = line.match(/^(.+?)[:-](\d+)[:-](.*)$/);
          if (match) {
            const [, file, lineNum, content] = match;

            if (file !== currentFile) {
              if (currentFile && currentSnippet) {
                const existing = results.get(currentFile);
                if (!existing || currentSnippet.length > existing.snippet.length) {
                  results.set(currentFile, {
                    path: currentFile,
                    line: currentLine,
                    snippet: currentSnippet.trim(),
                    score: 1,
                    source: "ripgrep",
                  });
                }
              }
              currentFile = file;
              currentSnippet = "";
              currentLine = parseInt(lineNum, 10);
            }
            currentSnippet += content + "\n";
          } else if (line === "--") {
            currentSnippet += "...\n";
          }
        }

        if (currentFile && currentSnippet) {
          results.set(currentFile, {
            path: currentFile,
            line: currentLine,
            snippet: currentSnippet.trim(),
            score: 1,
            source: "ripgrep",
          });
        }

        // Score boost: filename matches rank higher
        const queryLower = query.toLowerCase();
        for (const [, hit] of results) {
          if (path.basename(hit.path).toLowerCase().includes(queryLower)) {
            hit.score += 5;
          }
        }

        const sorted = Array.from(results.values())
          .sort((a, b) => b.score - a.score)
          .slice(0, limit);

        resolve(sorted);
      } catch {
        // rg not found, no matches, or timeout — not an error, just empty
        resolve([]);
      }
    });
  }

  // ── Index lifecycle ──────────────────────────────────────────────────

  private async ensureIndex(workingDir: string): Promise<void> {
    if (this.indexer) return;

    if (this.indexPromise) {
      await this.indexPromise;
      return;
    }

    this.indexPromise = (async () => {
      this.indexer = new CodebaseIndexer(workingDir);
      const stats = this.indexer.getStats();

      // If index is empty or stale (>1 hour), re-index
      const oneHour = 60 * 60 * 1000;
      if (stats.totalFiles === 0 || Date.now() - stats.lastIndexed > oneHour) {
        await this.indexer.index();
      }
    })();

    await this.indexPromise;
  }
}

/**
 * Normalize a file path for deduplication.
 * Strips leading ./ and normalizes separators.
 */
function normalizePath(p: string): string {
  return p.replace(/^\.\//, "").replace(/\\/g, "/");
}
