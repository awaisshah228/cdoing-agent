import * as fs from "fs";
import * as path from "path";
import type { BaseTool, ToolDefinition, ToolResult } from "../types";
import { safePath } from "../../utils/path-safety";
import type { SandboxManager } from "../../sandbox";

/** Binary/image extensions we can describe but not read as text */
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp", ".svg", ".ico"]);
const PDF_EXTENSION = ".pdf";

/** Max bytes per file read — prevents context blowout from huge files */
const MAX_READ_BYTES = 50_000; // 50KB, same as opencode
/** Max characters per line before truncation */
const MAX_LINE_LENGTH = 2000;

export class FileReadTool implements BaseTool {
  definition: ToolDefinition = {
    name: "file_read",
    description:
      "Read the contents of a file. Returns content with line numbers. Supports text files, images (returns metadata), and PDFs (extracts text). Always read before editing. Access is governed by the permission system — certain paths may be denied by sandbox or permission rules.",
    inputSchema: {
      type: "object",
      properties: {
        file_path: {
          type: "string",
          description: "Path to the file to read",
        },
        offset: {
          type: "number",
          description: "Line number to start from (1-based). Optional.",
        },
        limit: {
          type: "number",
          description: "Max lines to read. Default: 2000.",
        },
      },
      required: ["file_path"],
    },
    requiresPermission: false,
  };

  private workingDir: string;
  private sandboxManager?: SandboxManager;

  constructor(workingDir: string, sandboxManager?: SandboxManager) {
    this.workingDir = workingDir;
    this.sandboxManager = sandboxManager;
  }

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    let filePath: string;
    try {
      filePath = safePath(input.file_path as string, this.workingDir);
    } catch (err) {
      return { success: false, output: "", error: (err as Error).message };
    }

    // Sandbox read check
    if (this.sandboxManager) {
      const check = this.sandboxManager.checkFileRead(filePath);
      if (!check.allowed) {
        return { success: false, output: "", error: check.reason || "Sandbox: read access denied" };
      }
    }

    if (!fs.existsSync(filePath))
      return { success: false, output: "", error: `File not found: ${filePath}` };

    const stat = fs.statSync(filePath);

    // Handle directory listing (like opencode's read tool)
    if (stat.isDirectory()) {
      return this.readDirectory(filePath, input);
    }

    const ext = path.extname(filePath).toLowerCase();

    // Handle image files
    if (IMAGE_EXTENSIONS.has(ext)) {
      return this.readImage(filePath, ext);
    }

    // Handle PDF files
    if (ext === PDF_EXTENSION) {
      return this.readPdf(filePath);
    }

    // Skip binary files over max bytes
    if (stat.size > MAX_READ_BYTES * 10) {
      return {
        success: true,
        output: `Binary or very large file: ${filePath} (${formatBytes(stat.size)}). Use offset/limit to read specific sections.`,
      };
    }

    // Regular text file
    const offset = (input.offset as number) || 1;
    const limit = (input.limit as number) || 2000;

    try {
      const content = fs.readFileSync(filePath, "utf-8");
      const lines = content.split("\n");
      const selected = lines.slice(offset - 1, offset - 1 + limit);

      // Apply line length truncation and byte budget
      let totalBytes = 0;
      let truncatedByBytes = false;
      const processedLines: string[] = [];

      for (const line of selected) {
        const truncatedLine = line.length > MAX_LINE_LENGTH
          ? line.substring(0, MAX_LINE_LENGTH) + "... (line truncated...)"
          : line;

        totalBytes += truncatedLine.length + 1; // +1 for newline
        if (totalBytes > MAX_READ_BYTES && processedLines.length > 0) {
          truncatedByBytes = true;
          break;
        }
        processedLines.push(truncatedLine);
      }

      const numbered = processedLines
        .map((line, i) => `${String(offset + i).padStart(5)}  ${line}`)
        .join("\n");

      const totalLines = lines.length;
      const showing = processedLines.length;
      const infoParts: string[] = [];
      if (totalLines > showing) {
        infoParts.push(`[Showing lines ${offset}-${offset + showing - 1} of ${totalLines}]`);
      }
      if (truncatedByBytes) {
        infoParts.push(`[Output truncated at ${formatBytes(MAX_READ_BYTES)} — use offset/limit to read specific sections]`);
      }
      const info = infoParts.length > 0 ? `\n\n${infoParts.join("\n")}` : "";

      return { success: true, output: (numbered || "(empty file)") + info };
    } catch {
      // Might be a binary file
      return {
        success: true,
        output: `Binary file: ${filePath} (${formatBytes(stat.size)})`,
      };
    }
  }

  /** List directory contents with pagination support */
  private readDirectory(dirPath: string, input: Record<string, unknown>): ToolResult {
    try {
      const entries = fs.readdirSync(dirPath);
      entries.sort((a, b) => a.localeCompare(b));

      const offset = (input.offset as number) || 1;
      const limit = (input.limit as number) || 200;

      const selected = entries.slice(offset - 1, offset - 1 + limit);
      const output = selected
        .map((entry) => {
          try {
            const full = path.join(dirPath, entry);
            const s = fs.statSync(full);
            return s.isDirectory() ? `${entry}/` : entry;
          } catch {
            return entry;
          }
        })
        .join("\n");

      const total = entries.length;
      const showing = selected.length;
      const info = total > showing
        ? `\n\n[Showing ${offset}-${offset + showing - 1} of ${total} entries]`
        : `\n\n[${total} entries]`;

      return { success: true, output: (output || "(empty directory)") + info };
    } catch (err) {
      return { success: false, output: "", error: `Failed to list directory: ${err}` };
    }
  }

  private readImage(filePath: string, ext: string): ToolResult {
    const stat = fs.statSync(filePath);
    const info = [
      `Image file: ${filePath}`,
      `Format: ${ext.substring(1).toUpperCase()}`,
      `Size: ${formatBytes(stat.size)}`,
    ];

    // For SVG, we can actually read the content
    if (ext === ".svg") {
      try {
        const content = fs.readFileSync(filePath, "utf-8");
        info.push(`\nSVG Content:\n${content.substring(0, 5000)}`);
        if (content.length > 5000) info.push(`\n... [truncated at 5000 chars]`);
      } catch {
        // skip
      }
    }

    return { success: true, output: info.join("\n") };
  }

  private readPdf(filePath: string): ToolResult {
    const stat = fs.statSync(filePath);

    // Basic PDF text extraction — reads raw text strings from PDF
    try {
      const buffer = fs.readFileSync(filePath);
      const text = extractPdfText(buffer);

      if (text.trim()) {
        const truncated = text.length > 10000
          ? text.substring(0, 10000) + "\n\n... [truncated at 10000 chars]"
          : text;
        return {
          success: true,
          output: `PDF: ${filePath} (${formatBytes(stat.size)})\n\n${truncated}`,
        };
      }

      return {
        success: true,
        output: `PDF: ${filePath} (${formatBytes(stat.size)})\n(Could not extract text — may be image-based or encrypted)`,
      };
    } catch {
      return {
        success: true,
        output: `PDF: ${filePath} (${formatBytes(stat.size)})\n(Unable to read PDF content)`,
      };
    }
  }
}

/** Very basic PDF text extraction — finds text between parentheses in PDF stream */
function extractPdfText(buffer: Buffer): string {
  const content = buffer.toString("latin1");
  const textParts: string[] = [];

  // Extract text from Tj and TJ operators (basic PDF text rendering)
  const tjRegex = /\(([^)]*)\)\s*Tj/g;
  let match;
  while ((match = tjRegex.exec(content)) !== null) {
    const decoded = match[1]
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "\r")
      .replace(/\\t/g, "\t")
      .replace(/\\\\/g, "\\")
      .replace(/\\([()])/g, "$1");
    textParts.push(decoded);
  }

  // Also try TJ arrays
  const tjArrayRegex = /\[((?:\([^)]*\)|[^\]])*)\]\s*TJ/gi;
  while ((match = tjArrayRegex.exec(content)) !== null) {
    const innerRegex = /\(([^)]*)\)/g;
    let inner;
    while ((inner = innerRegex.exec(match[1])) !== null) {
      textParts.push(inner[1]);
    }
  }

  return textParts.join(" ").replace(/\s+/g, " ").trim();
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
