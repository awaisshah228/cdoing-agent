/**
 * Codebase Context Provider — @codebase
 *
 * Semantic search across the entire repository.
 * Finds the most relevant files/code for a given query.
 *
 * How it works:
 *   1. User types @codebase followed by a search query
 *   2. We search file names and content using glob + grep
 *   3. Rank results by relevance (filename match > content match)
 *   4. Return the top N most relevant code snippets
 *
 * Learning note: This is a text-based search approach (not embedding-based).
 * For true semantic search, you'd want vector embeddings + a vector DB.
 * But text search with smart ranking gets you 80% of the way there
 * and works offline without any setup.
 *
 * Future enhancement: Add optional embedding-based indexing for
 * projects that configure it.
 */

import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import type { ContextProvider, ContextResult, ContextResolveOptions } from "./types";

/** Max files to include in results */
const MAX_RESULTS = 10;

/** Max chars per file snippet */
const SNIPPET_LIMIT = 2000;

/** Total max chars for all results */
const TOTAL_LIMIT = 20000;

/** File extensions to search (common code files) */
const CODE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".py", ".rs", ".go", ".java",
  ".rb", ".php", ".cs", ".cpp", ".c", ".h", ".hpp", ".swift",
  ".kt", ".scala", ".r", ".html", ".css", ".scss", ".less",
  ".json", ".yaml", ".yml", ".toml", ".xml", ".sql", ".sh",
  ".bash", ".zsh", ".md", ".mdx", ".txt", ".vue", ".svelte",
]);

/** Directories to skip during search */
const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".next", ".nuxt",
  "__pycache__", ".cache", ".turbo", "coverage", "venv",
  ".venv", ".tox", "target", "vendor",
]);

export class CodebaseContextProvider implements ContextProvider {
  id = "codebase";
  trigger = "@codebase";
  description = "Search the entire codebase for relevant code";
  requiresArg = true;

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

    // Search using ripgrep if available, fall back to simple search
    const results = await this.search(query, workingDir);

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

      const relPath = path.relative(workingDir, result.file);
      const ext = path.extname(result.file).slice(1);
      const lang = ext || "text";

      let snippet = result.snippet;
      if (snippet.length > SNIPPET_LIMIT) {
        snippet = snippet.substring(0, SNIPPET_LIMIT) + "\n... [truncated]";
      }

      sections.push(`### ${relPath}${result.line ? `:${result.line}` : ""}\n\n\`\`\`${lang}\n${snippet}\n\`\`\``);
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

  /**
   * Search the codebase for a query string.
   * Uses ripgrep (rg) if available for fast searching,
   * otherwise falls back to a simple Node.js file walker.
   */
  private async search(
    query: string,
    workingDir: string,
  ): Promise<Array<{ file: string; line?: number; snippet: string; score: number }>> {
    // Try ripgrep first (much faster for large codebases)
    try {
      return this.searchWithRipgrep(query, workingDir);
    } catch {
      // Fall back to simple search
      return this.searchSimple(query, workingDir);
    }
  }

  /**
   * Fast search using ripgrep (rg).
   * Learning note: ripgrep respects .gitignore by default,
   * which is exactly what we want.
   */
  private searchWithRipgrep(
    query: string,
    workingDir: string,
  ): Array<{ file: string; line?: number; snippet: string; score: number }> {
    // Use ripgrep with context lines around matches
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

    // Parse ripgrep output into structured results
    const results = new Map<string, { file: string; line?: number; snippet: string; score: number }>();

    const lines = output.split("\n");
    let currentFile = "";
    let currentSnippet = "";
    let currentLine: number | undefined;

    for (const line of lines) {
      // ripgrep format: "file:line:content" or "file-line-content" (context)
      const match = line.match(/^(.+?)[:-](\d+)[:-](.*)$/);
      if (match) {
        const [, file, lineNum, content] = match;
        const absFile = path.resolve(workingDir, file);

        if (file !== currentFile) {
          // Save previous file's results
          if (currentFile && currentSnippet) {
            const existing = results.get(currentFile);
            if (!existing || currentSnippet.length > existing.snippet.length) {
              results.set(currentFile, {
                file: path.resolve(workingDir, currentFile),
                line: currentLine,
                snippet: currentSnippet.trim(),
                score: 1,
              });
            }
          }
          currentFile = file;
          currentSnippet = "";
          currentLine = parseInt(lineNum, 10);
        }
        currentSnippet += content + "\n";
      } else if (line === "--") {
        // Separator between matches in the same file
        currentSnippet += "...\n";
      }
    }

    // Don't forget the last file
    if (currentFile && currentSnippet) {
      results.set(currentFile, {
        file: path.resolve(workingDir, currentFile),
        line: currentLine,
        snippet: currentSnippet.trim(),
        score: 1,
      });
    }

    return Array.from(results.values());
  }

  /**
   * Simple fallback search using Node.js file system.
   * Slower but works everywhere without external dependencies.
   */
  private searchSimple(
    query: string,
    workingDir: string,
  ): Array<{ file: string; line?: number; snippet: string; score: number }> {
    const results: Array<{ file: string; line?: number; snippet: string; score: number }> = [];
    const queryLower = query.toLowerCase();

    // Walk directory tree
    const walk = (dir: string, depth: number): void => {
      if (depth > 5 || results.length >= MAX_RESULTS * 2) return;

      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        if (entry.name.startsWith(".") && entry.name !== ".cdoing") continue;
        if (SKIP_DIRS.has(entry.name)) continue;

        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          walk(fullPath, depth + 1);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name);
          if (!CODE_EXTENSIONS.has(ext)) continue;

          try {
            const content = fs.readFileSync(fullPath, "utf-8");
            const contentLower = content.toLowerCase();

            // Check if query appears in content
            const index = contentLower.indexOf(queryLower);
            if (index >= 0) {
              // Extract a snippet around the match
              const linesBefore = content.substring(0, index).split("\n");
              const lineNum = linesBefore.length;
              const allLines = content.split("\n");
              const start = Math.max(0, lineNum - 4);
              const end = Math.min(allLines.length, lineNum + 4);
              const snippet = allLines.slice(start, end).join("\n");

              // Score based on match quality
              let score = 1;
              if (entry.name.toLowerCase().includes(queryLower)) score += 5; // Filename match
              if (content.toLowerCase().split(queryLower).length > 2) score += 2; // Multiple matches

              results.push({ file: fullPath, line: lineNum, snippet, score });
            }
          } catch {
            // Skip unreadable files
          }
        }
      }
    };

    walk(workingDir, 0);

    // Sort by score (highest first) and return top results
    return results.sort((a, b) => b.score - a.score).slice(0, MAX_RESULTS);
  }
}
