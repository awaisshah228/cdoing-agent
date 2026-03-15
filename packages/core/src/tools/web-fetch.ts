/**
 * Web Fetch Tool — fetch content from URLs.
 * Supports HTML pages (extracts text), JSON APIs, and plain text.
 */

import type { BaseTool, ToolDefinition, ToolResult } from "./types";
import type { SandboxManager } from "../sandbox";

export class WebFetchTool implements BaseTool {
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
          description: "Maximum characters to return. Default: 10000.",
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
    const maxLength = (input.max_length as number) || 10000;

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

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);

      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent": "Cdoing-Agent/0.1.0",
          "Accept": "text/html,application/json,text/plain,*/*",
        },
      });

      clearTimeout(timeout);

      if (!response.ok) {
        return {
          success: false,
          output: "",
          error: `HTTP ${response.status}: ${response.statusText}`,
        };
      }

      const contentType = response.headers.get("content-type") || "";
      let text = await response.text();

      // If HTML, strip tags and extract text content
      if (contentType.includes("text/html")) {
        text = stripHtml(text);
      }

      // Truncate if too long
      if (text.length > maxLength) {
        text = text.substring(0, maxLength) + `\n\n... [truncated at ${maxLength} characters]`;
      }

      return { success: true, output: text || "(empty response)" };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, output: "", error: `Fetch failed: ${message}` };
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
