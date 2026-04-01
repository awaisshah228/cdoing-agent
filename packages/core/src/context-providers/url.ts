/**
 * URL Context Provider — @url
 *
 * Fetches a web page and converts it to clean markdown for context.
 *
 * Security features:
 *   - Manual redirect handling (validates each hop against SSRF rules)
 *   - Max 5 redirects
 *   - URL escaped in markdown output to prevent injection
 *   - SSRF protection (blocks private/internal IPs)
 *
 * Usage: @url https://docs.example.com/api
 */

import type { ContextProvider, ContextResult, ContextResolveOptions } from "./types";
import { isBlockedAddress } from "../sandbox/network";

/** Max chars for fetched content */
const DEFAULT_MAX_CHARS = 15000;

/** Max redirects to follow */
const MAX_REDIRECTS = 5;

/**
 * Escape a URL for safe inclusion in markdown.
 * Prevents injection via URLs like: http://evil.com/?p=## Injected Header
 */
function escapeMarkdownUrl(url: string): string {
  return url
    .replace(/\[/g, "%5B")
    .replace(/\]/g, "%5D")
    .replace(/\(/g, "%28")
    .replace(/\)/g, "%29")
    .replace(/\n/g, "%0A")
    .replace(/\r/g, "%0D")
    .replace(/#/g, "%23");
}

/**
 * Fetch a URL with manual redirect handling to validate each hop.
 * Prevents SSRF via redirect chains (e.g., trusted.com → 169.254.169.254).
 */
async function fetchWithRedirectValidation(
  url: string,
  maxRedirects: number = MAX_REDIRECTS,
): Promise<Response> {
  let currentUrl = url;
  let redirectCount = 0;

  while (redirectCount <= maxRedirects) {
    // SSRF check on each hop
    let hostname: string;
    try {
      hostname = new URL(currentUrl).hostname;
    } catch {
      throw new Error(`Invalid URL: ${currentUrl}`);
    }

    const blockedReason = isBlockedAddress(hostname);
    if (blockedReason) {
      throw new Error(`SSRF protection: blocked ${hostname} (${blockedReason})`);
    }

    const response = await fetch(currentUrl, {
      headers: {
        "User-Agent": "Cdoing-Agent/1.0 (Context Fetcher)",
        "Accept": "text/html,text/plain,application/json",
      },
      redirect: "manual", // Don't auto-follow redirects
      signal: AbortSignal.timeout(15000),
    });

    // Handle redirects manually
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) {
        throw new Error(`Redirect ${response.status} without Location header`);
      }

      // Resolve relative redirects
      currentUrl = new URL(location, currentUrl).toString();
      redirectCount++;
      continue;
    }

    return response;
  }

  throw new Error(`Too many redirects (>${maxRedirects})`);
}

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

    // Escape URL for display in markdown output
    const safeUrl = escapeMarkdownUrl(url);

    try {
      // Fetch with redirect validation (SSRF-safe)
      const response = await fetchWithRedirectValidation(url);

      if (!response.ok) {
        return {
          label: `URL: ${safeUrl}`,
          content: `[Failed to fetch ${safeUrl}: HTTP ${response.status} ${response.statusText}]`,
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
        label: `URL: ${safeUrl}`,
        content: `## Web Content: ${safeUrl}\n\n${body}${truncated ? "\n\n... [content truncated]" : ""}`,
        metadata: {
          source: url,
          truncated,
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        label: `URL: ${safeUrl}`,
        content: `[Error fetching ${safeUrl}: ${message}]`,
        metadata: { source: "web" },
      };
    }
  }
}

/**
 * Convert HTML to readable plain text.
 * Strips tags, scripts, styles, and normalizes whitespace.
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
