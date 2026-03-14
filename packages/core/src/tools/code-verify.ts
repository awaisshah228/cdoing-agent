import * as fs from "fs";
import * as path from "path";
import { exec } from "child_process";
import type { BaseTool, ToolDefinition, ToolResult } from "./types";
import { safePath } from "../utils/path-safety";

/** Map file extensions to the command that checks their syntax/types */
const CHECKERS: Record<string, (filePath: string, cwd: string) => string> = {
  // JavaScript — Node's --check flag validates syntax without running
  ".js": (f) => `node --check "${f}"`,
  ".mjs": (f) => `node --check "${f}"`,
  ".cjs": (f) => `node --check "${f}"`,

  // TypeScript — tsc with --noEmit to type-check without producing output
  ".ts": (f, cwd) => {
    const tsconfig = path.join(cwd, "tsconfig.json");
    if (fs.existsSync(tsconfig)) {
      return `npx tsc --noEmit --pretty "${f}"`;
    }
    return `npx tsc --noEmit --pretty --esModuleInterop --resolveJsonModule "${f}"`;
  },
  ".tsx": (f, cwd) => {
    const tsconfig = path.join(cwd, "tsconfig.json");
    if (fs.existsSync(tsconfig)) {
      return `npx tsc --noEmit --pretty --jsx react-jsx "${f}"`;
    }
    return `npx tsc --noEmit --pretty --esModuleInterop --resolveJsonModule --jsx react-jsx "${f}"`;
  },

  // Python — py_compile checks syntax
  ".py": (f) => `python3 -m py_compile "${f}"`,

  // Ruby — -c flag checks syntax
  ".rb": (f) => `ruby -c "${f}"`,

  // Shell — bash -n checks syntax without executing
  ".sh": (f) => `bash -n "${f}"`,
  ".bash": (f) => `bash -n "${f}"`,
  ".zsh": (f) => `zsh -n "${f}"`,

  // Go — vet checks for common errors
  ".go": (f) => `go vet "${f}"`,

  // PHP — lint mode
  ".php": (f) => `php -l "${f}"`,

  // Perl — check syntax
  ".pl": (f) => `perl -c "${f}"`,

  // Swift — just parse/typecheck
  ".swift": (f) => `swiftc -typecheck "${f}"`,

  // JSON — validate structure
  ".json": (f) => `node -e "JSON.parse(require('fs').readFileSync('${f.replace(/'/g, "\\'")}','utf8'));console.log('Valid JSON')"`,
};

export class CodeVerifyTool implements BaseTool {
  definition: ToolDefinition = {
    name: "code_verify",
    description:
      "Verify that code in a file is syntactically correct and (where possible) type-safe. " +
      "Runs language-specific checks: node --check for JS, tsc --noEmit for TS, py_compile for Python, etc. " +
      "Use after writing or editing code to catch errors before running.",
    inputSchema: {
      type: "object",
      properties: {
        file_path: {
          type: "string",
          description: "Path to the file to verify",
        },
        timeout: {
          type: "number",
          description: "Timeout in ms. Default: 30000",
        },
      },
      required: ["file_path"],
    },
    requiresPermission: false,
    permissionMessage: (input) => `Verify code: ${input.file_path}`,
  };

  private workingDir: string;
  constructor(workingDir: string) {
    this.workingDir = workingDir;
  }

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    let filePath: string;
    try {
      filePath = safePath(input.file_path as string, this.workingDir);
    } catch (err) {
      return { success: false, output: "", error: (err as Error).message };
    }

    const timeout = (input.timeout as number) || 30000;

    if (!fs.existsSync(filePath)) {
      return { success: false, output: "", error: `File not found: ${filePath}` };
    }

    const ext = path.extname(filePath).toLowerCase();
    const checkerFn = CHECKERS[ext];
    if (!checkerFn) {
      return {
        success: false,
        output: "",
        error: `No verifier for ${ext} files. Supported: ${Object.keys(CHECKERS).join(", ")}`,
      };
    }

    const command = checkerFn(filePath, this.workingDir);

    return new Promise((resolve) => {
      exec(
        command,
        { cwd: this.workingDir, timeout, maxBuffer: 10 * 1024 * 1024, env: { ...process.env } },
        (error, stdout, stderr) => {
          const outputParts: string[] = [];
          if (stdout) outputParts.push(stdout.trimEnd());
          if (stderr) outputParts.push(stderr.trimEnd());
          const output = outputParts.join("\n") || "(no output)";

          if (error?.killed) {
            return resolve({ success: false, output, error: `Timed out after ${timeout}ms` });
          }

          if (error) {
            resolve({
              success: false,
              output,
              error: `Verification failed (exit code ${error.code}). See output for details.`,
            });
          } else {
            resolve({
              success: true,
              output: output === "(no output)" ? "Code verification passed — no errors found." : output,
            });
          }
        },
      );
    });
  }
}
