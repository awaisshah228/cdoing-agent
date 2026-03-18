/**
 * SubAgentManager — Tracks all spawned sub-agents.
 *
 * Provides lifecycle management: spawn with custom timeout,
 * check status/output, and terminate running agents.
 */

export type SubAgentStatus = "running" | "completed" | "failed" | "terminated" | "timed_out";

export interface SubAgentEntry {
  id: string;
  task: string;
  status: SubAgentStatus;
  output: string;
  error?: string;
  startedAt: number;
  finishedAt?: number;
  /** AbortController to cancel a running agent */
  abort?: AbortController;
}

export class SubAgentManager {
  private agents: Map<string, SubAgentEntry> = new Map();
  private idCounter = 0;

  /** Generate a unique agent ID */
  private nextId(): string {
    this.idCounter++;
    return `agent_${this.idCounter}_${Date.now().toString(36)}`;
  }

  /**
   * Spawn a sub-agent. Runs in background — returns the ID immediately.
   * The caller provides runnerFn which actually executes the agent.
   */
  spawn(
    task: string,
    runnerFn: (signal: AbortSignal) => Promise<string>,
    timeoutMs?: number,
  ): string {
    const id = this.nextId();
    const abort = new AbortController();

    const entry: SubAgentEntry = {
      id,
      task,
      status: "running",
      output: "",
      startedAt: Date.now(),
      abort,
    };
    this.agents.set(id, entry);

    // Set up timeout if requested
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    if (timeoutMs && timeoutMs > 0) {
      timeoutHandle = setTimeout(() => {
        if (entry.status === "running") {
          entry.status = "timed_out";
          entry.error = `Timed out after ${timeoutMs}ms`;
          entry.finishedAt = Date.now();
          abort.abort();
        }
      }, timeoutMs);
    }

    // Run the agent in background
    runnerFn(abort.signal)
      .then((result) => {
        if (entry.status === "running") {
          entry.status = "completed";
          entry.output = result;
          entry.finishedAt = Date.now();
        }
      })
      .catch((err) => {
        if (entry.status === "running") {
          const msg = err instanceof Error ? err.message : String(err);
          if (msg === "__cancelled__" || abort.signal.aborted) {
            // Only set terminated if not already timed_out
            if (entry.status === "running") {
              entry.status = "terminated";
              entry.error = "Terminated by user";
              entry.finishedAt = Date.now();
            }
          } else {
            entry.status = "failed";
            entry.error = msg;
            entry.finishedAt = Date.now();
          }
        }
      })
      .finally(() => {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        delete entry.abort; // clean up reference
      });

    return id;
  }

  /**
   * Spawn and wait — runs synchronously (blocks until done or timeout).
   * Used when the LLM does NOT request background mode.
   */
  async spawnAndWait(
    task: string,
    runnerFn: (signal: AbortSignal) => Promise<string>,
    timeoutMs?: number,
  ): Promise<SubAgentEntry> {
    const id = this.spawn(task, runnerFn, timeoutMs);
    const entry = this.agents.get(id)!;

    // Poll until done (the promise is already running)
    await new Promise<void>((resolve) => {
      const check = () => {
        if (entry.status !== "running") {
          resolve();
        } else {
          setTimeout(check, 50);
        }
      };
      check();
    });

    return entry;
  }

  /** Get a specific agent's info */
  get(id: string): SubAgentEntry | undefined {
    return this.agents.get(id);
  }

  /** Get status of a specific agent */
  getStatus(id: string): { id: string; status: SubAgentStatus; task: string; output: string; error?: string; durationMs?: number } | null {
    const entry = this.agents.get(id);
    if (!entry) return null;

    const durationMs = entry.finishedAt
      ? entry.finishedAt - entry.startedAt
      : Date.now() - entry.startedAt;

    return {
      id: entry.id,
      status: entry.status,
      task: entry.task,
      output: entry.output,
      error: entry.error,
      durationMs,
    };
  }

  /** List all agents with their statuses */
  listAll(): Array<{ id: string; task: string; status: SubAgentStatus; durationMs: number }> {
    return Array.from(this.agents.values()).map((entry) => ({
      id: entry.id,
      task: entry.task,
      status: entry.status,
      durationMs: entry.finishedAt
        ? entry.finishedAt - entry.startedAt
        : Date.now() - entry.startedAt,
    }));
  }

  /** Terminate a running agent */
  terminate(id: string): boolean {
    const entry = this.agents.get(id);
    if (!entry || entry.status !== "running") return false;

    entry.status = "terminated";
    entry.error = "Terminated by user";
    entry.finishedAt = Date.now();
    if (entry.abort) {
      entry.abort.abort();
      delete entry.abort;
    }
    return true;
  }

  /** Check if any agents are still running */
  hasRunning(): boolean {
    return Array.from(this.agents.values()).some((e) => e.status === "running");
  }

  /** Terminate all running sub-agents (cleanup) */
  terminateAll(): number {
    let terminated = 0;
    for (const entry of this.agents.values()) {
      if (entry.status === "running") {
        if (this.terminate(entry.id)) terminated++;
      }
    }
    return terminated;
  }
}
