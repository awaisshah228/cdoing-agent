import * as fs from "fs";
import * as path from "path";
import type { ContextProvider, ContextResult, ContextResolveOptions } from "./types";

const MAX_BYTES = 100_000; // ~100 KB cap

/**
 * @file <path> — reads a file and injects its content into the prompt.
 * Also handles bare relative/absolute paths that look like files.
 */
export class FileIncludeContextProvider implements ContextProvider {
  id = "file";
  trigger = "@file";
  description = "Include a file's contents in the message  (@file src/foo.ts)";
  requiresArg = true;

  async resolve(arg?: string, opts?: ContextResolveOptions): Promise<ContextResult> {
    const base = opts?.workingDir || process.cwd();
    const filePath = arg ? path.resolve(base, arg.trim()) : "";

    if (!filePath) {
      return { label: "File", content: "(no file path provided — usage: @file path/to/file)" };
    }

    if (!fs.existsSync(filePath)) {
      return { label: "File", content: `(file not found: ${filePath})` };
    }

    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      // List directory contents instead
      const entries = fs.readdirSync(filePath).slice(0, 100).join("\n");
      return {
        label: "Directory",
        content: `<directory path="${filePath}">\n${entries}\n</directory>`,
      };
    }

    const raw = fs.readFileSync(filePath);
    const truncated = raw.length > MAX_BYTES;
    const text = truncated
      ? raw.slice(0, MAX_BYTES).toString("utf8") + "\n... [truncated]"
      : raw.toString("utf8");

    const rel = path.relative(base, filePath);
    const ext = path.extname(filePath).slice(1) || "text";

    return {
      label: "File",
      content: `<file path="${rel}">\n\`\`\`${ext}\n${text}\n\`\`\`\n</file>`,
      metadata: { source: rel, truncated },
    };
  }
}
