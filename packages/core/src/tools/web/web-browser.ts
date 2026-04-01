/**
 * WebBrowser Tool — browser automation with screenshots and navigation.
 *
 * Inspired by Claude Code's WebBrowserTool. Uses Puppeteer (when available)
 * for headless browser interaction: screenshots, page navigation, clicking,
 * form filling, and content extraction.
 *
 * Puppeteer is lazily loaded — if not installed, the tool gracefully degrades
 * with an informative error.
 */

import type { BaseTool, ToolDefinition, ToolResult } from "../types";

let puppeteer: any = null;
let puppeteerLoaded = false;

function loadPuppeteer(): any {
  if (puppeteerLoaded) return puppeteer;
  puppeteerLoaded = true;
  try {
    puppeteer = require("puppeteer");
  } catch {
    try {
      puppeteer = require("puppeteer-core");
    } catch {
      puppeteer = null;
    }
  }
  return puppeteer;
}

export class WebBrowserTool implements BaseTool {
  definition: ToolDefinition = {
    name: "web_browser",
    description:
      "Interact with a web page in a headless browser. Actions: " +
      "'screenshot' (capture page as image), " +
      "'navigate' (go to URL), " +
      "'click' (click element by selector), " +
      "'type' (fill input by selector), " +
      "'extract' (get text content from selector), " +
      "'evaluate' (run JS in page context). " +
      "Requires puppeteer or puppeteer-core installed.",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["screenshot", "navigate", "click", "type", "extract", "evaluate"],
          description: "The browser action to perform.",
        },
        url: {
          type: "string",
          description: "URL to navigate to (required for 'navigate' and 'screenshot').",
        },
        selector: {
          type: "string",
          description: "CSS selector for 'click', 'type', and 'extract' actions.",
        },
        text: {
          type: "string",
          description: "Text to type (for 'type' action).",
        },
        script: {
          type: "string",
          description: "JavaScript to evaluate (for 'evaluate' action).",
        },
        output_path: {
          type: "string",
          description: "File path to save screenshot (for 'screenshot' action). Defaults to /tmp/screenshot.png.",
        },
      },
      required: ["action"],
    },
    requiresPermission: true,
    permissionMessage: (input) => {
      const action = String(input.action);
      if (action === "navigate") return `Navigate browser to: ${input.url}`;
      if (action === "screenshot") return `Take screenshot of: ${input.url || "current page"}`;
      if (action === "evaluate") return `Run JS in browser: ${String(input.script).substring(0, 60)}`;
      return `Browser ${action}: ${input.selector || input.url || ""}`;
    },
  };

  private browser: any = null;
  private page: any = null;

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const pup = loadPuppeteer();
    if (!pup) {
      return {
        success: false,
        output: "Puppeteer not installed. Run: npm install puppeteer\n" +
          "Or for lighter install: npm install puppeteer-core",
      };
    }

    const action = String(input.action || "");

    try {
      // Ensure browser is launched
      if (!this.browser || !this.browser.isConnected()) {
        this.browser = await pup.launch({
          headless: "new",
          args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
        });
        this.page = await this.browser.newPage();
        await this.page.setViewport({ width: 1280, height: 720 });
      }

      switch (action) {
        case "navigate": {
          const url = String(input.url || "");
          if (!url) return { success: false, output: "Missing 'url' for navigate." };
          await this.page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
          const title = await this.page.title();
          return { success: true, output: `Navigated to: ${url}\nTitle: ${title}` };
        }

        case "screenshot": {
          if (input.url) {
            await this.page.goto(String(input.url), { waitUntil: "networkidle2", timeout: 30000 });
          }
          const outPath = String(input.output_path || "/tmp/screenshot.png");
          await this.page.screenshot({ path: outPath, fullPage: false });
          return { success: true, output: `Screenshot saved to: ${outPath}` };
        }

        case "click": {
          const sel = String(input.selector || "");
          if (!sel) return { success: false, output: "Missing 'selector' for click." };
          await this.page.click(sel);
          return { success: true, output: `Clicked: ${sel}` };
        }

        case "type": {
          const sel = String(input.selector || "");
          const text = String(input.text || "");
          if (!sel) return { success: false, output: "Missing 'selector' for type." };
          await this.page.type(sel, text);
          return { success: true, output: `Typed "${text}" into: ${sel}` };
        }

        case "extract": {
          const sel = String(input.selector || "body");
          const content = await this.page.$eval(sel, (el: Element) => el.textContent?.trim() || "");
          const truncated = content.length > 5000 ? content.substring(0, 5000) + "\n[...truncated]" : content;
          return { success: true, output: truncated || "(empty)" };
        }

        case "evaluate": {
          const script = String(input.script || "");
          if (!script) return { success: false, output: "Missing 'script' for evaluate." };
          const result = await this.page.evaluate(script);
          return { success: true, output: String(result ?? "(undefined)") };
        }

        default:
          return { success: false, output: `Unknown action: ${action}` };
      }
    } catch (err: any) {
      return { success: false, output: `Browser error: ${err.message || err}` };
    }
  }
}
