/**
 * ProcessManager — Manages background shell processes (servers, watchers, builds).
 *
 * Unlike SubAgentManager (which spawns LLM agents), ProcessManager spawns
 * raw shell processes that run in the background. Output is buffered so the
 * LLM can read it later, and processes can be killed by ID.
 *
 * Typical workflow:
 *   1. spawn_process({ command: "node server.js", port: 3000 })  → returns process ID
 *   2. shell_exec("curl http://localhost:3000/health")            → test it
 *   3. process_status({ process_id: "proc_1_..." })               → read output
 *   4. process_kill({ process_id: "proc_1_..." })                 → stop it
 */

import { spawn, type ChildProcess } from "child_process";
import * as os from "os";

const IS_WINDOWS = os.platform() === "win32";

export type ProcessStatus = "running" | "exited" | "killed" | "errored";

export interface ProcessEntry {
  id: string;
  command: string;
  status: ProcessStatus;
  pid?: number;
  exitCode?: number | null;
  /** Rolling output buffer (stdout + stderr interleaved) */
  output: string;
  startedAt: number;
  finishedAt?: number;
  /** The underlying child process — cleared after exit */
  child?: ChildProcess;
}

/** Max output buffer per process (256KB) */
const MAX_OUTPUT_SIZE = 256 * 1024;

export class ProcessManager {
  private processes: Map<string, ProcessEntry> = new Map();
  private idCounter = 0;

  private nextId(): string {
    this.idCounter++;
    return `proc_${this.idCounter}_${Date.now().toString(36)}`;
  }

  /**
   * Spawn a background process. Returns the process ID immediately.
   * Output is buffered and can be read via getStatus().
   */
  spawn(
    command: string,
    workingDir: string,
    env?: Record<string, string>,
  ): { id: string; pid?: number } {
    const id = this.nextId();

    const shellEnv = { ...process.env, ...env };

    // Use login shell so PATH, nvm, etc. are available
    let shell: string;
    let args: string[];
    if (IS_WINDOWS) {
      shell = "powershell.exe";
      args = ["-NoLogo", "-ExecutionPolicy", "Bypass", "-Command", command];
    } else {
      shell = process.env.SHELL || "/bin/bash";
      args = ["-l", "-c", command];
    }

    const child = spawn(shell, args, {
      cwd: workingDir,
      env: shellEnv,
      stdio: ["ignore", "pipe", "pipe"],
      detached: !IS_WINDOWS,
    });

    const entry: ProcessEntry = {
      id,
      command,
      status: "running",
      pid: child.pid,
      output: "",
      startedAt: Date.now(),
      child,
    };

    // Buffer stdout
    child.stdout?.on("data", (chunk: Buffer) => {
      this.appendOutput(entry, chunk.toString());
    });

    // Buffer stderr (prefixed)
    child.stderr?.on("data", (chunk: Buffer) => {
      this.appendOutput(entry, chunk.toString());
    });

    child.on("error", (err) => {
      if (entry.status === "running") {
        entry.status = "errored";
        this.appendOutput(entry, `\n[PROCESS ERROR] ${err.message}\n`);
        entry.finishedAt = Date.now();
        delete entry.child;
      }
    });

    child.on("exit", (code) => {
      if (entry.status === "running") {
        entry.status = "exited";
        entry.exitCode = code;
        entry.finishedAt = Date.now();
      }
      delete entry.child;
    });

    this.processes.set(id, entry);
    return { id, pid: child.pid };
  }

  /** Append to output buffer, trimming if over limit */
  private appendOutput(entry: ProcessEntry, text: string): void {
    entry.output += text;
    if (entry.output.length > MAX_OUTPUT_SIZE) {
      // Keep the last MAX_OUTPUT_SIZE chars
      entry.output = "[...truncated...]\n" + entry.output.slice(-MAX_OUTPUT_SIZE);
    }
  }

  /** Get process info and output */
  getStatus(id: string): {
    id: string;
    command: string;
    status: ProcessStatus;
    pid?: number;
    exitCode?: number | null;
    output: string;
    durationMs: number;
  } | null {
    const entry = this.processes.get(id);
    if (!entry) return null;

    return {
      id: entry.id,
      command: entry.command,
      status: entry.status,
      pid: entry.pid,
      exitCode: entry.exitCode,
      output: entry.output,
      durationMs: entry.finishedAt
        ? entry.finishedAt - entry.startedAt
        : Date.now() - entry.startedAt,
    };
  }

  /** Get recent output (last N bytes). Useful for tailing logs. */
  getRecentOutput(id: string, bytes: number = 4096): string | null {
    const entry = this.processes.get(id);
    if (!entry) return null;
    if (entry.output.length <= bytes) return entry.output;
    return "..." + entry.output.slice(-bytes);
  }

  /** List all tracked processes */
  listAll(): Array<{
    id: string;
    command: string;
    status: ProcessStatus;
    pid?: number;
    durationMs: number;
  }> {
    return Array.from(this.processes.values()).map((e) => ({
      id: e.id,
      command: e.command,
      status: e.status,
      pid: e.pid,
      durationMs: e.finishedAt
        ? e.finishedAt - e.startedAt
        : Date.now() - e.startedAt,
    }));
  }

  /** Kill a running process */
  kill(id: string): boolean {
    const entry = this.processes.get(id);
    if (!entry || entry.status !== "running" || !entry.child) return false;

    entry.status = "killed";
    entry.finishedAt = Date.now();

    try {
      // Kill the entire process group on Unix
      if (!IS_WINDOWS && entry.child.pid) {
        process.kill(-entry.child.pid, "SIGTERM");
        // Force kill after 3 seconds if still alive
        setTimeout(() => {
          try {
            if (entry.child?.pid) process.kill(-entry.child.pid, "SIGKILL");
          } catch {
            // already dead
          }
        }, 3000);
      } else {
        entry.child.kill("SIGTERM");
      }
    } catch {
      // Process may already be dead
    }

    delete entry.child;
    return true;
  }

  /** Check if any processes are still running */
  hasRunning(): boolean {
    return Array.from(this.processes.values()).some((e) => e.status === "running");
  }

  /** Kill all running processes (cleanup) */
  killAll(): number {
    let killed = 0;
    for (const entry of this.processes.values()) {
      if (entry.status === "running") {
        if (this.kill(entry.id)) killed++;
      }
    }
    return killed;
  }
}
