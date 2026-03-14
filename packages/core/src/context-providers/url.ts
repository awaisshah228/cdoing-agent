/**
 * URL Context Provider — @url
 *
 * Fetches a web page and converts it to clean markdown for context.
 * Reuses the existing web_fetch tool logic under the hood.
 *
 * Usage: @url https://docs.example.com/api
 *
 * How it works:
 *   1. User types @url followed by a URL
 *   2. We fetch the page HTML
 *   3. Strip tags, scripts, styles → extract readable text
 *   4. Format as markdown and inject into the conversation
 *
 * Learning note: This provider REQUIRES an argument (the URL).
 * The `requiresArg` flag tells the UI to keep the input open
 * until the user provides the URL after the @ trigger.
 */

import type { ContextProvider, ContextResult, ContextResolveOptions } from "./types";

/** Max chars for fetched content */
const DEFAULT_MAX_CHARS = 15000;

export class UrlContextProvider implements ContextProvider {
  id = "url";
  trigger = "@url";
  description = "Fetch and attach web page content";
  requiresArg = true;

  async resolve(arg?: string, options?: ContextResolveOptions): Promise<ContextResult> {
    if (!arg || !arg.trim()) {
      return {
        label: "URL",
        content: "[Please provide a URL after @url, e.g.: @url https://docs.example.com]",
        metadata: { source: "web" },
      };
    }

    const url = arg.trim();
    const maxChars = options?.maxContentLength ?? DEFAULT_MAX_CHARS;

    try {
      // Fetch the URL content
      const response = await fetch(url, {
        headers: {
          "User-Agent": "Cdoing-Agent/1.0 (Context Fetcher)",
          "Accept": "text/html,text/plain,application/json",
        },
        signal: AbortSignal.timeout(15000), // 15 second timeout
      });

      if (!response.ok) {
        return {
          label: `URL: ${url}`,
          content: `[Failed to fetch ${url}: HTTP ${response.status} ${response.statusText}]`,
          metadata: { source: "web" },
        };
      }

      const contentType = response.headers.get("content-type") || "";
      let body = await response.text();

      // Convert HTML to readable text
      if (contentType.includes("html")) {
        body = htmlToText(body);
      }

      // Truncate if needed
      let truncated = false;
      if (body.length > maxChars) {
        body = body.substring(0, maxChars);
        truncated = true;
      }

      return {
        label: `URL: ${url}`,
        content: `## Web Content: ${url}\n\n${body}${truncated ? "\n\n... [content truncated]" : ""}`,
        metadata: {
          source: url,
          truncated,
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        label: `URL: ${url}`,
        content: `[Error fetching ${url}: ${message}]`,
        metadata: { source: "web" },
      };
    }
  }
}

/**
 * Convert HTML to readable plain text.
 * Strips tags, scripts, styles, and normalizes whitespace.
 *
 * Learning note: This is a simple regex-based approach that works
 * well enough for most pages. For production, you'd use a proper
 * HTML parser like cheerio or jsdom.
 */
function htmlToText(html: string): string {
  return html
    // Remove script and style blocks entirely
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, "")
    // Convert common elements to markdown equivalents
    .replace(/<h1[^>]*>(.*?)<\/h1>/gi, "\n# $1\n")
    .replace(/<h2[^>]*>(.*?)<\/h2>/gi, "\n## $1\n")
    .replace(/<h3[^>]*>(.*?)<\/h3>/gi, "\n### $1\n")
    .replace(/<h[4-6][^>]*>(.*?)<\/h[4-6]>/gi, "\n#### $1\n")
    .replace(/<li[^>]*>(.*?)<\/li>/gi, "- $1\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<p[^>]*>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<code[^>]*>(.*?)<\/code>/gi, "`$1`")
    .replace(/<pre[^>]*>(.*?)<\/pre>/gis, "\n```\n$1\n```\n")
    .replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, "[$2]($1)")
    .replace(/<strong[^>]*>(.*?)<\/strong>/gi, "**$1**")
    .replace(/<b[^>]*>(.*?)<\/b>/gi, "**$1**")
    .replace(/<em[^>]*>(.*?)<\/em>/gi, "*$1*")
    .replace(/<i[^>]*>(.*?)<\/i>/gi, "*$1*")
    // Strip remaining HTML tags
    .replace(/<[^>]+>/g, "")
    // Decode common HTML entities
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    // Normalize whitespace
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+/g, " ")
    .trim();
}
