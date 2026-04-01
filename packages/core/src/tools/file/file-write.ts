import * as fs from "fs";
import * as path from "path";
import type { BaseTool, ToolDefinition, ToolResult } from "../types";
import { safePath } from "../../utils/path-safety";
import { hasPlaceholders, expandPlaceholders } from "../../utils/lazy-apply";
import type { SandboxManager } from "../../sandbox";

/** Callback for running LSP diagnostics after writes — set by the host (CLI/extension) */
export type DiagnosticsCallback = (filePath: string) => Promise<string | null>;

// ── Line ending utilities ──────────────────────────────────────────────────
function detectLineEnding(text: string): "\n" | "\r\n" {
  return text.includes("\r\n") ? "\r\n" : "\n";
}
function convertToLineEnding(text: string, ending: "\n" | "\r\n"): string {
  if (ending === "\n") return text;
  return text.replaceAll("\n", "\r\n");
}

export class FileWriteTool implements BaseTool {
  // ── Behavioral flags ──
  concurrencyMode = () => "parallel-file" as const;
  isDestructive = () => true; // overwrites entire file
  getFilePath = (input: Record<string, unknown>) => input.file_path as string | undefined;

  definition: ToolDefinition = {
    name: "file_write",
    description:
      `Create a new file or completely overwrite an existing file. Creates parent directories if needed. Requires user permission.

Use this tool ONLY for:
- Creating new files that don't exist yet
- Complete file rewrites where the entire content changes

Do NOT use this for partial edits — use file_edit or multi_edit instead, which preserve unchanged code and provide diffs.`,
    inputSchema: {
      type: "object",
      properties: {
        file_path: {
          type: "string",
          description: "Path to the file to write",
        },
        content: {
          type: "string",
          description: "Content to write to the file",
        },
      },
      required: ["file_path", "content"],
    },
    requiresPermission: true,
    permissionMessage: (input) => `Write to file: ${input.file_path}`,
  };

  private workingDir: string;
  private sandboxManager?: SandboxManager;
  private diagnosticsCallback?: DiagnosticsCallback;

  constructor(workingDir: string, sandboxManager?: SandboxManager, diagnosticsCallback?: DiagnosticsCallback) {
    this.workingDir = workingDir;
    this.sandboxManager = sandboxManager;
    this.diagnosticsCallback = diagnosticsCallback;
  }

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    let filePath: string;
    try {
      filePath = safePath(input.file_path as string, this.workingDir);
    } catch (err) {
      return { success: false, output: "", error: (err as Error).message };
    }

    // Sandbox write check
    if (this.sandboxManager) {
      const check = this.sandboxManager.checkFileWrite(filePath);
      if (!check.allowed) {
        return { success: false, output: "", error: check.reason || "Sandbox: write access denied" };
      }
    }

    let content = input.content as string;

    try {
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      const existed = fs.existsSync(filePath);
      const oldContent = existed ? fs.readFileSync(filePath, "utf-8") : "";

      // Lazy apply: if content has placeholders and file exists, expand them
      if (existed && hasPlaceholders(content)) {
        const { content: expanded, placeholdersExpanded } = expandPlaceholders(oldContent, content);
        if (placeholdersExpanded > 0) {
          content = expanded;
        }
      }

      // Preserve original line endings when updating existing files
      let writeContent = content;
      if (existed && oldContent) {
        const originalEnding = detectLineEnding(oldContent);
        if (originalEnding === "\r\n") {
          writeContent = convertToLineEnding(content, originalEnding);
        }
      }

      fs.writeFileSync(filePath, writeContent, "utf-8");
      const lines = content.split("\n").length;

      // Generate diff for the extension to render
      let diff = "";
      if (existed && oldContent !== content) {
        const oldLines = oldContent.split("\n");
        const newLines = content.split("\n");
        diff = `--- a/${input.file_path}\n+++ b/${input.file_path}\n@@ -1,${oldLines.length} +1,${newLines.length} @@\n`;
        for (const line of oldLines) diff += `- ${line}\n`;
        for (const line of newLines) diff += `+ ${line}\n`;
      } else if (!existed) {
        const newLines = content.split("\n");
        diff = `--- /dev/null\n+++ b/${input.file_path}\n@@ -0,0 +1,${newLines.length} @@\n`;
        for (const line of newLines) diff += `+ ${line}\n`;
      }

      let summary = `${existed ? "Updated" : "Created"} file: ${filePath} (${lines} lines)`;

      // Run LSP diagnostics if available (like opencode's pattern)
      if (this.diagnosticsCallback) {
        try {
          const diagnosticsOutput = await this.diagnosticsCallback(filePath);
          if (diagnosticsOutput) {
            summary += `\n\n${diagnosticsOutput}`;
          }
        } catch { /* diagnostics are best-effort */ }
      }

      return {
        success: true,
        output: diff ? `${summary}\n\n${diff}` : summary,
      };
    } catch (err) {
      return { success: false, output: "", error: `Failed to write: ${err}` };
    }
  }
}
