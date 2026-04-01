/**
 * Web Search Tool — search the web using DuckDuckGo's HTML page.
 * No API key required — uses DDG's lite HTML interface.
 */

import type { BaseTool, ToolDefinition, ToolResult } from "../types";

export class WebSearchTool implements BaseTool {
  // ── Behavioral flags ──
  isReadOnly = () => true;
  concurrencyMode = () => "parallel" as const;
  definition: ToolDefinition = {
    name: "web_search",
    description:
      "Search the web for information. Returns search results with titles, URLs, and snippets. Useful for finding documentation, solutions, or current information.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The search query",
        },
        max_results: {
          type: "number",
          description: "Maximum number of results. Default: 5.",
        },
      },
      required: ["query"],
    },
    requiresPermission: true,
    permissionMessage: (input) => `Web search: ${input.query}`,
  };

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const query = input.query as string;
    const maxResults = (input.max_results as number) || 5;

    try {
      const encodedQuery = encodeURIComponent(query);
      const url = `https://lite.duckduckgo.com/lite/?q=${encodedQuery}`;

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);

      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent": "Cdoing-Agent/0.1.0",
          "Accept": "text/html",
        },
      });

      clearTimeout(timeout);

      if (!response.ok) {
        return {
          success: false,
          output: "",
          error: `Search failed: HTTP ${response.status}`,
        };
      }

      const html = await response.text();
      const results = parseSearchResults(html, maxResults);

      if (results.length === 0) {
        return { success: true, output: "No results found." };
      }

      const formatted = results
        .map((r, i) => `${i + 1}. **${r.title}**\n   ${r.url}\n   ${r.snippet}`)
        .join("\n\n");

      return {
        success: true,
        output: `Search results for "${query}":\n\n${formatted}`,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, output: "", error: `Search failed: ${message}` };
    }
  }
}

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

/** Parse DDG lite HTML for search results */
function parseSearchResults(html: string, maxResults: number): SearchResult[] {
  const results: SearchResult[] = [];

  // DDG lite puts results in table rows with class "result-link" for titles
  // and "result-snippet" for descriptions
  const linkRegex = /<a[^>]+class="result-link"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  const snippetRegex = /<td[^>]+class="result-snippet"[^>]*>([\s\S]*?)<\/td>/gi;

  const links: { url: string; title: string }[] = [];
  const snippets: string[] = [];

  let match;
  while ((match = linkRegex.exec(html)) !== null) {
    links.push({
      url: match[1].replace(/&amp;/g, "&"),
      title: match[2].replace(/<[^>]+>/g, "").trim(),
    });
  }

  while ((match = snippetRegex.exec(html)) !== null) {
    snippets.push(
      match[1]
        .replace(/<[^>]+>/g, "")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .trim()
    );
  }

  for (let i = 0; i < Math.min(links.length, maxResults); i++) {
    results.push({
      title: links[i].title || "(untitled)",
      url: links[i].url,
      snippet: snippets[i] || "",
    });
  }

  return results;
}
