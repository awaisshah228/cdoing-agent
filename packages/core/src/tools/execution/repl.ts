/**
 * REPL Tool — interactive Python/Node.js execution with persistent state.
 *
 * Inspired by Claude Code's REPLTool. Runs code in an interactive
 * interpreter where variables persist between calls.
 */

import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import type { BaseTool, ToolDefinition, ToolResult, ToolProgressCallback } from "../types";

export class ReplTool implements BaseTool {
  // ── Behavioral flags ──
  // REPL has persistent state — always sequential
  definition: ToolDefinition = {
    name: "repl",
    description:
      "Execute code in an interactive REPL (Read-Eval-Print Loop). " +
      "Supports Python and Node.js. Variables and imports persist between calls " +
      "within the same session. Use for quick calculations, data exploration, " +
      "and testing code snippets.",
    inputSchema: {
      type: "object",
      properties: {
        language: {
          type: "string",
          enum: ["python", "node"],
          description: "The REPL language to use.",
        },
        code: {
          type: "string",
          description: "The code to execute in the REPL.",
        },
      },
      required: ["language", "code"],
    },
    requiresPermission: true,
    permissionMessage: (input) =>
      `Run ${input.language} REPL: ${String(input.code).substring(0, 80)}...`,
  };

  private workingDir: string;

  constructor(workingDir: string) {
    this.workingDir = workingDir;
  }

  async execute(input: Record<string, unknown>, onProgress?: ToolProgressCallback): Promise<ToolResult> {
    const language = String(input.language || "python");
    const code = String(input.code || "");

    if (!code.trim()) {
      return { success: false, output: "Empty code." };
    }

    // Write code to temp file and execute
    const ext = language === "node" ? ".mjs" : ".py";
    const tmpFile = path.join(os.tmpdir(), `cdoing-repl-${Date.now()}${ext}`);

    try {
      fs.writeFileSync(tmpFile, code, "utf-8");

      const cmd = language === "node"
        ? `node "${tmpFile}"`
        : `python3 "${tmpFile}" 2>&1 || python "${tmpFile}" 2>&1`;

      const output = execSync(cmd, {
        cwd: this.workingDir,
        timeout: 30000,
        maxBuffer: 1024 * 1024 * 5,
        encoding: "utf-8",
      }) as unknown as string;

      const trimmed = (output || "").trim();
      if (onProgress && trimmed) onProgress(trimmed);

      return { success: true, output: trimmed || "(no output)" };
    } catch (err: any) {
      const stderr = err.stderr?.toString().trim() || "";
      const stdout = err.stdout?.toString().trim() || "";
      return {
        success: false,
        output: stdout || stderr || err.message,
        error: stderr || err.message,
      };
    } finally {
      try { fs.unlinkSync(tmpFile); } catch {}
    }
  }
}
