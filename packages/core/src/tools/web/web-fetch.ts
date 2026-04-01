/**
 * Web Fetch Tool — fetch content from URLs.
 * Supports HTML pages (extracts text), JSON APIs, and plain text.
 * Includes Cloudflare bypass via realistic User-Agent headers.
 */

import type { BaseTool, ToolDefinition, ToolResult } from "../types";
import type { SandboxManager } from "../../sandbox";
import { isBlockedAddress } from "../../sandbox/network";

const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const FALLBACK_USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
];

export class WebFetchTool implements BaseTool {
  // ── Behavioral flags ──
  isReadOnly = () => true;
  concurrencyMode = () => "parallel" as const;
  definition: ToolDefinition = {
    name: "web_fetch",
    description:
      "Fetch content from a URL. Returns the text content of the page. Useful for reading documentation, APIs, or web pages. Requires user permission. Network access is controlled by sandbox domain rules — requests to non-allowed domains may be blocked.",
    inputSchema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "The URL to fetch",
        },
        max_length: {
          type: "number",
          description: "Maximum characters to return. Default: 50000.",
        },
        headers: {
          type: "object",
          description: "Custom HTTP headers to include in the request",
        },
        format: {
          type: "string",
          enum: ["text", "markdown", "html"],
          description: "Output format: 'text' (default, strips HTML), 'markdown' (basic conversion), 'html' (raw HTML)",
        },
      },
      required: ["url"],
    },
    requiresPermission: true,
    permissionMessage: (input) => `Fetch URL: ${input.url}`,
  };

  private sandboxManager?: SandboxManager;

  constructor(sandboxManager?: SandboxManager) {
    this.sandboxManager = sandboxManager;
  }

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const url = input.url as string;
    const maxLength = (input.max_length as number) || 50000;
    const customHeaders = (input.headers as Record<string, string>) || {};
    const format = (input.format as string) || "text";

    // Validate URL
    try {
      new URL(url);
    } catch {
      return { success: false, output: "", error: `Invalid URL: ${url}` };
    }

    // Sandbox network check
    if (this.sandboxManager) {
      const check = await this.sandboxManager.checkNetworkAccess(url);
      if (!check.allowed) {
        return { success: false, output: "", error: check.reason || "Sandbox: network access denied" };
      }
    }

    // Try with browser User-Agent first, then fallbacks on 403
    const userAgents = [BROWSER_USER_AGENT, ...FALLBACK_USER_AGENTS];
    let lastError: string | null = null;

    for (const userAgent of userAgents) {
      try {
        const result = await this.fetchWithUA(url, userAgent, customHeaders, maxLength, format);
        if (result) return result;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        // If it's a 403, try next UA; otherwise break
        if (!lastError.includes("403")) break;
      }
    }

    return { success: false, output: "", error: `Fetch failed: ${lastError}` };
  }

  /** Max redirects to follow manually */
  private static readonly MAX_REDIRECTS = 5;

  private async fetchWithUA(
    url: string,
    userAgent: string,
    customHeaders: Record<string, string>,
    maxLength: number,
    format: string,
  ): Promise<ToolResult | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    try {
      // Follow redirects manually to validate each hop against SSRF rules
      let currentUrl = url;
      let redirectCount = 0;
      let response: Response;

      while (true) {
        // SSRF check on each hop
        try {
          const hostname = new URL(currentUrl).hostname;
          const blockedReason = isBlockedAddress(hostname);
          if (blockedReason) {
            clearTimeout(timeout);
            return {
              success: false,
              output: "",
              error: `SSRF protection: blocked ${hostname} (${blockedReason})`,
            };
          }
        } catch {
          clearTimeout(timeout);
          return { success: false, output: "", error: `Invalid URL: ${currentUrl}` };
        }

        response = await fetch(currentUrl, {
          signal: controller.signal,
          redirect: "manual", // Don't auto-follow — validate each hop
          headers: {
            "User-Agent": userAgent,
            "Accept": "text/html,application/json,text/plain,*/*",
            "Accept-Language": "en-US,en;q=0.9",
            "Accept-Encoding": "gzip, deflate, br",
            ...customHeaders,
          },
        });

        // Handle redirects manually
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          const location = response.headers.get("location");
          if (!location || redirectCount >= WebFetchTool.MAX_REDIRECTS) {
            clearTimeout(timeout);
            return {
              success: false,
              output: "",
              error: location
                ? `Too many redirects (>${WebFetchTool.MAX_REDIRECTS})`
                : `Redirect ${response.status} without Location header`,
            };
          }
          currentUrl = new URL(location, currentUrl).toString();
          redirectCount++;
          continue;
        }

        break; // Not a redirect — proceed with this response
      }

      clearTimeout(timeout);

      if (response.status === 403) {
        throw new Error(`HTTP 403: Forbidden`);
      }

      if (!response.ok) {
        return {
          success: false,
          output: "",
          error: `HTTP ${response.status}: ${response.statusText}`,
        };
      }

      const contentType = response.headers.get("content-type") || "";
      let text = await response.text();

      // Format based on content type and requested format
      if (contentType.includes("text/html")) {
        switch (format) {
          case "html":
            // Return raw HTML
            break;
          case "markdown":
            text = htmlToMarkdown(text);
            break;
          case "text":
          default:
            text = stripHtml(text);
            break;
        }
      }

      // Truncate if too long
      if (text.length > maxLength) {
        text = text.substring(0, maxLength) + `\n\n... [truncated at ${maxLength} characters]`;
      }

      return { success: true, output: text || "(empty response)" };
    } catch (err) {
      clearTimeout(timeout);
      throw err;
    }
  }
}

/** Simple HTML-to-text: remove tags, decode common entities, collapse whitespace */
function stripHtml(html: string): string {
  return html
    // Remove script and style blocks
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    // Remove HTML tags
    .replace(/<[^>]+>/g, " ")
    // Decode common entities
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    // Collapse whitespace
    .replace(/\s+/g, " ")
    .trim();
}

/** Basic HTML-to-markdown conversion */
function htmlToMarkdown(html: string): string {
  return html
    // Remove script and style
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    // Headings
    .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, "\n# $1\n")
    .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, "\n## $1\n")
    .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, "\n### $1\n")
    .replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, "\n#### $1\n")
    // Bold and italic
    .replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, "**$2**")
    .replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi, "*$2*")
    // Links
    .replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, "[$2]($1)")
    // Code blocks
    .replace(/<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi, "\n```\n$1\n```\n")
    .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, "`$1`")
    // Lists
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, "- $1\n")
    // Paragraphs and line breaks
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, "\n$1\n")
    // Remove remaining tags
    .replace(/<[^>]+>/g, "")
    // Decode entities
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    // Clean up whitespace
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
