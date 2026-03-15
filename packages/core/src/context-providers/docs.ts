/**
 * Docs Context Provider — @docs
 *
 * Fetches documentation for packages/libraries and injects into context.
 * Usage:
 *   @docs react          — fetch React docs summary
 *   @docs express/Router — fetch specific section
 *   @docs https://...    — fetch docs from URL directly
 */

import * as fs from "fs";
import * as path from "path";
import type { ContextProvider, ContextResult, ContextResolveOptions } from "./types";

const MAX_CHARS = 30000;

/**
 * Docs registry is loaded from ~/.cdoing/docs-registry.json if it exists.
 * Users can add their own package → URL mappings there.
 * Format: { "react": "https://...", "express": "https://..." }
 */
function loadDocsRegistry(): Record<string, string> {
  try {
    const registryPath = require("path").join(require("os").homedir(), ".cdoing", "docs-registry.json");
    if (require("fs").existsSync(registryPath)) {
      return JSON.parse(require("fs").readFileSync(registryPath, "utf-8"));
    }
  } catch { /* ignore */ }
  return {};
}

export class DocsContextProvider implements ContextProvider {
  id = "docs";
  trigger = "@docs";
  description = "Fetch documentation for a package or URL (@docs react, @docs https://...)";
  requiresArg = true;

  async resolve(arg?: string, options?: ContextResolveOptions): Promise<ContextResult> {
    if (!arg?.trim()) {
      return {
        label: "Docs",
        content: `Usage: @docs <package-name> or @docs <url>\n\nSupported packages: ${Object.keys(loadDocsRegistry()).join(", ")}`,
      };
    }

    const query = arg.trim().toLowerCase();

    // Direct URL
    if (query.startsWith("http://") || query.startsWith("https://")) {
      return this.fetchUrl(query);
    }

    // Check registry
    const registryUrl = loadDocsRegistry()[query];
    if (registryUrl) {
      return this.fetchUrl(registryUrl, query);
    }

    // Try to find local docs (README.md in node_modules)
    const workingDir = options?.workingDir || process.cwd();
    const localResult = this.findLocalDocs(workingDir, query);
    if (localResult) return localResult;

    // Try npm registry as fallback
    return this.fetchNpmReadme(query);
  }

  private async fetchUrl(url: string, packageName?: string): Promise<ContextResult> {
    try {
      const response = await fetch(url, {
        headers: { "User-Agent": "cdoing-agent/1.0" },
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        return {
          label: `Docs: ${packageName || url}`,
          content: `Failed to fetch docs: HTTP ${response.status}`,
        };
      }

      let text = await response.text();
      if (text.length > MAX_CHARS) {
        text = text.substring(0, MAX_CHARS) + "\n\n... [truncated]";
      }

      return {
        label: `Docs: ${packageName || url}`,
        content: `<docs source="${packageName || url}">\n${text}\n</docs>`,
        metadata: { source: url, truncated: text.length >= MAX_CHARS },
      };
    } catch (err) {
      return {
        label: `Docs: ${packageName || url}`,
        content: `Failed to fetch docs: ${(err as Error).message}`,
      };
    }
  }

  private findLocalDocs(workingDir: string, packageName: string): ContextResult | null {
    const candidates = [
      path.join(workingDir, "node_modules", packageName, "README.md"),
      path.join(workingDir, "node_modules", packageName, "readme.md"),
      path.join(workingDir, "node_modules", packageName, "Readme.md"),
      path.join(workingDir, "node_modules", `@${packageName.split("/")[0]}`, packageName.split("/")[1] || "", "README.md"),
    ];

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        try {
          let content = fs.readFileSync(candidate, "utf-8");
          if (content.length > MAX_CHARS) {
            content = content.substring(0, MAX_CHARS) + "\n\n... [truncated]";
          }
          return {
            label: `Docs: ${packageName} (local)`,
            content: `<docs source="${packageName}" local="true">\n${content}\n</docs>`,
            metadata: { source: candidate },
          };
        } catch { /* skip */ }
      }
    }

    return null;
  }

  private async fetchNpmReadme(packageName: string): Promise<ContextResult> {
    try {
      const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(packageName)}`, {
        headers: { "Accept": "application/json", "User-Agent": "cdoing-agent/1.0" },
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        return {
          label: `Docs: ${packageName}`,
          content: `Package "${packageName}" not found. Available packages: ${Object.keys(loadDocsRegistry()).join(", ")}`,
        };
      }

      const data = await response.json() as { readme?: string; description?: string };
      let readme = data.readme || data.description || "(no documentation found)";

      if (readme.length > MAX_CHARS) {
        readme = readme.substring(0, MAX_CHARS) + "\n\n... [truncated]";
      }

      return {
        label: `Docs: ${packageName} (npm)`,
        content: `<docs source="${packageName}" npm="true">\n${readme}\n</docs>`,
        metadata: { source: `npm:${packageName}`, truncated: readme.length >= MAX_CHARS },
      };
    } catch (err) {
      return {
        label: `Docs: ${packageName}`,
        content: `Failed to fetch docs for "${packageName}": ${(err as Error).message}`,
      };
    }
  }
}
