/**
 * Codebase Search Tool — semantic + full-text search across the indexed codebase.
 *
 * Uses the indexing system (SQLite FTS5 + optional embeddings) for fast,
 * ranked code retrieval. Falls back to runtime grep if index not available.
 */

import type { BaseTool, ToolDefinition, ToolResult } from "./types";
import { CodebaseIndexer } from "../indexing";

export class CodebaseSearchTool implements BaseTool {
  definition: ToolDefinition = {
    name: "codebase_search",
    description:
      `Search the entire codebase using natural language or keywords. Uses indexed full-text search (BM25) and optional semantic search (embeddings) for fast, ranked results.

The codebase is automatically indexed on first use. Results include file paths, line numbers, and matching code snippets ranked by relevance.

Use this for:
- Finding where a concept is implemented ("authentication middleware")
- Locating function/class definitions ("UserService class")
- Understanding how something works ("how errors are handled")
- Finding usage patterns ("all places that call sendEmail")`,
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Natural language query or keywords to search for",
        },
        directory: {
          type: "string",
          description: "Optional: limit search to a subdirectory (e.g. 'src/api')",
        },
        limit: {
          type: "number",
          description: "Max results to return. Default: 20.",
        },
      },
      required: ["query"],
    },
    requiresPermission: false,
  };

  private indexer: CodebaseIndexer | null = null;
  private workingDir: string;
  private indexPromise: Promise<void> | null = null;

  constructor(workingDir: string) {
    this.workingDir = workingDir;
  }

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const query = input.query as string;
    const directory = input.directory as string | undefined;
    const limit = (input.limit as number) || 20;

    if (!query.trim()) {
      return { success: false, output: "", error: "Query cannot be empty" };
    }

    // Ensure index exists (lazy initialization)
    try {
      await this.ensureIndex();
    } catch (err) {
      return { success: false, output: "", error: `Indexing failed: ${(err as Error).message}` };
    }

    if (!this.indexer) {
      return { success: false, output: "", error: "Indexer not available" };
    }

    // Search
    const results = await this.indexer.search(query, limit, directory);

    if (results.length === 0) {
      return { success: true, output: `No results found for: "${query}"` };
    }

    // Format results
    const formatted = results.map((r, i) => {
      const header = `### ${i + 1}. ${r.path}:${r.startLine}-${r.endLine} (${r.source}, score: ${r.score.toFixed(3)})`;
      const content = r.content.length > 500
        ? r.content.substring(0, 500) + "\n... [truncated]"
        : r.content;
      return `${header}\n\`\`\`\n${content}\n\`\`\``;
    });

    const stats = this.indexer.getStats();
    const header = `Found ${results.length} results for "${query}" (searched ${stats.totalChunks} chunks across ${stats.totalFiles} files)`;

    return { success: true, output: `${header}\n\n${formatted.join("\n\n")}` };
  }

  private async ensureIndex(): Promise<void> {
    if (this.indexer) return;

    // Prevent concurrent indexing
    if (this.indexPromise) {
      await this.indexPromise;
      return;
    }

    this.indexPromise = (async () => {
      this.indexer = new CodebaseIndexer(this.workingDir);
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
