import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { exec } from "child_process";
import type { BaseTool, ToolDefinition, ToolResult } from "./types";
import { safePath } from "../utils/path-safety";
import type { SandboxManager } from "../sandbox";

const IS_WINDOWS = os.platform() === "win32";
const SHELL = IS_WINDOWS ? process.env.COMSPEC || "cmd.exe" : process.env.SHELL || "/bin/sh";

/** Map file extensions to the command that runs them */
const RUNNERS: Record<string, string> = {
  ".js": "node", ".mjs": "node", ".cjs": "node",
  ".ts": "npx ts-node", ".tsx": "npx ts-node",
  ".py": IS_WINDOWS ? "python" : "python3", ".rb": "ruby",
  ".sh": "bash", ".bash": "bash", ".zsh": "zsh",
  ".bat": "cmd /c", ".cmd": "cmd /c", ".ps1": "powershell -File",
  ".go": "go run", ".swift": "swift", ".lua": "lua",
  ".php": "php", ".pl": "perl",
};

export class FileRunTool implements BaseTool {
  definition: ToolDefinition = {
    name: "file_run",
    description:
      "Run a file. Auto-detects language from extension (node for .js, python3 for .py, etc). Use after writing a program to test it. Requires user permission. Subject to sandbox restrictions.",
    inputSchema: {
      type: "object",
      properties: {
        file_path: { type: "string", description: "Path to the file to run" },
        args: { type: "string", description: "Command-line arguments (optional)" },
        timeout: { type: "number", description: "Timeout in ms. Default: 30000" },
        env_vars: {
          type: "object",
          description: "Environment variables to set (e.g., {\"PORT\": \"3001\", \"NODE_ENV\": \"test\"})",
          additionalProperties: { type: "string" },
        },
        debug: {
          type: "boolean",
          description: "Enable debug/verbose mode. Sets DEBUG=*, NODE_DEBUG=*, RUST_BACKTRACE=1, PYTHONTRACEBACK=1. Default: false",
        },
      },
      required: ["file_path"],
    },
    requiresPermission: true,
    permissionMessage: (input) => `Run file: ${input.file_path}`,
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

    const args = (input.args as string) || "";
    const timeout = (input.timeout as number) || 30000;

    // Sandbox read check
    if (this.sandboxManager) {
      const check = this.sandboxManager.checkFileRead(filePath);
      if (!check.allowed) {
        return { success: false, output: "", error: check.reason || "Sandbox: read access denied" };
      }
    }

    if (!fs.existsSync(filePath))
      return { success: false, output: "", error: `File not found: ${filePath}` };

    const ext = path.extname(filePath).toLowerCase();
    const runner = RUNNERS[ext];
    if (!runner)
      return { success: false, output: "", error: `Can't run ${ext} files. Supported: ${Object.keys(RUNNERS).join(", ")}` };

    const command = `${runner} "${filePath}"${args ? ` ${args}` : ""}`;

    // Build environment
    const env = this.sandboxManager ? this.sandboxManager.getShellEnv() : { ...process.env };

    // Merge user-provided env vars
    const envVars = input.env_vars as Record<string, string> | undefined;
    if (envVars && typeof envVars === "object") {
      for (const [key, val] of Object.entries(envVars)) {
        env[key] = String(val);
      }
    }

    // Debug mode — set common debug env vars
    if (input.debug) {
      env.DEBUG = env.DEBUG || "*";
      env.NODE_DEBUG = env.NODE_DEBUG || "*";
      env.RUST_BACKTRACE = env.RUST_BACKTRACE || "1";
      env.PYTHONTRACEBACK = env.PYTHONTRACEBACK || "1";
      env.PYTHONFAULTHANDLER = env.PYTHONFAULTHANDLER || "1";
    }

    return new Promise((resolve) => {
      const child = exec(command, { cwd: this.workingDir, timeout, maxBuffer: 10 * 1024 * 1024, env, shell: SHELL },
        (error, stdout, stderr) => {
          const outputParts: string[] = [];
          if (stdout) outputParts.push(stdout.trimEnd());
          if (stderr) {
            // Filter out common non-error warnings
            const filteredStderr = stderr.split("\n")
              .filter((l) => !l.includes("DeprecationWarning") && !l.includes("ExperimentalWarning"))
              .join("\n").trim();
            if (filteredStderr) outputParts.push(`STDERR:\n${filteredStderr}`);
          }
          const output = outputParts.join("\n\n") || "(no output)";

          if (error?.killed) {
            // Timed out — but if we got output, it's likely a server/long-running process
            // Treat as success with note, not as an error
            if (output && output !== "(no output)") {
              resolve({
                success: true,
                output: output + `\n\n[Process timed out after ${timeout / 1000}s — this is normal for servers and long-running processes. The output above was captured before timeout. Use shell_exec instead if you need to start a server in the background.]`,
              });
            } else {
              resolve({ success: false, output, error: `Timed out after ${timeout}ms with no output` });
            }
            return;
          }

          if (error) {
            resolve({ success: false, output, error: `Exit code: ${error.code}` });
          } else {
            resolve({ success: true, output });
          }
        });

      // For server-like processes: if we get output early, don't wait for timeout
      // Kill after 5s if stdout has content (server started successfully)
      let earlyOutput = "";
      child.stdout?.on("data", (chunk: string) => {
        earlyOutput += chunk;
        // If output contains typical server-started messages, kill early
        if (/listening|started|running|ready|server/i.test(earlyOutput)) {
          setTimeout(() => {
            if (!child.killed) {
              child.kill("SIGTERM");
            }
          }, 2000); // Give 2s for any additional startup output
        }
      });
    });
  }
}
