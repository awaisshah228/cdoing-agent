/**
 * Multi-Agent Coordinator — Orchestrates multiple sub-agents for complex tasks.
 *
 * The coordinator pattern splits complex tasks into subtasks, assigns each
 * to a specialized sub-agent, and merges results.
 *
 * Architecture:
 *   User Request
 *       │
 *   ┌───▼───┐
 *   │Coordinator│ ← Breaks task into subtasks
 *   └───┬───┘
 *       │
 *   ┌───┼───┬───┐
 *   │   │   │   │
 *   ▼   ▼   ▼   ▼
 *  Agent Agent Agent Agent  ← Run in parallel
 *   │   │   │   │
 *   └───┼───┴───┘
 *       │
 *   ┌───▼───┐
 *   │ Merge  │ ← Combine results
 *   └───────┘
 *
 * Learning note: This is the Scatter-Gather pattern. The coordinator
 * "scatters" work to sub-agents and "gathers" their results. This is
 * particularly effective for:
 *   - Searching across many files simultaneously
 *   - Making independent changes to different files
 *   - Running analysis tasks that don't depend on each other
 */

/**
 * A subtask assigned to a sub-agent.
 */
export interface Subtask {
  /** Unique subtask ID */
  id: string;

  /** Description of what this subtask should accomplish */
  description: string;

  /** System prompt override for this subtask's agent */
  systemPrompt?: string;

  /** Whether this subtask can run in parallel with others */
  parallel: boolean;

  /** Dependencies: IDs of subtasks that must complete first */
  dependsOn: string[];

  /** Current status */
  status: "pending" | "running" | "completed" | "failed";

  /** Result of the subtask (populated after completion) */
  result?: string;

  /** Error message if the subtask failed */
  error?: string;
}

/**
 * Callback interface for coordinator events.
 */
export interface CoordinatorCallbacks {
  /** Called when a subtask starts */
  onSubtaskStart: (subtask: Subtask) => void;

  /** Called when a subtask completes */
  onSubtaskComplete: (subtask: Subtask) => void;

  /** Called when a subtask fails */
  onSubtaskError: (subtask: Subtask, error: Error) => void;

  /** Called when all subtasks are complete */
  onAllComplete: (results: Subtask[]) => void;
}

/**
 * The function signature for running a sub-agent.
 * This is provided by the AgentRunner — we don't import it directly
 * to avoid circular dependencies between core and ai packages.
 */
export type SubAgentRunner = (prompt: string, systemPrompt?: string) => Promise<string>;

export class AgentCoordinator {
  private subtasks: Subtask[] = [];
  private runAgent: SubAgentRunner;

  constructor(runAgent: SubAgentRunner) {
    this.runAgent = runAgent;
  }

  /**
   * Add a subtask to the coordinator.
   */
  addSubtask(
    description: string,
    options?: {
      systemPrompt?: string;
      parallel?: boolean;
      dependsOn?: string[];
    },
  ): Subtask {
    const subtask: Subtask = {
      id: `subtask_${this.subtasks.length + 1}`,
      description,
      systemPrompt: options?.systemPrompt,
      parallel: options?.parallel ?? true,
      dependsOn: options?.dependsOn || [],
      status: "pending",
    };

    this.subtasks.push(subtask);
    return subtask;
  }

  /**
   * Execute all subtasks respecting dependencies and parallelism.
   *
   * Algorithm:
   *   1. Find all subtasks whose dependencies are met
   *   2. Run parallel-safe ones concurrently
   *   3. Run sequential ones in order
   *   4. Repeat until all done
   *
   * Learning note: This is a topological sort execution — we process
   * subtasks in dependency order, maximizing parallelism where possible.
   */
  async execute(callbacks?: Partial<CoordinatorCallbacks>): Promise<Subtask[]> {
    const completed = new Set<string>();

    while (completed.size < this.subtasks.length) {
      // Find ready subtasks (all dependencies met)
      const ready = this.subtasks.filter(
        (t) =>
          t.status === "pending" &&
          t.dependsOn.every((dep) => completed.has(dep)),
      );

      if (ready.length === 0) {
        // No ready tasks but not all complete — there's a dependency cycle
        const stuck = this.subtasks.filter((t) => t.status === "pending");
        for (const t of stuck) {
          t.status = "failed";
          t.error = "Dependency cycle detected";
        }
        break;
      }

      // Separate parallel and sequential tasks
      const parallelTasks = ready.filter((t) => t.parallel);
      const sequentialTasks = ready.filter((t) => !t.parallel);

      // Run parallel tasks concurrently
      if (parallelTasks.length > 0) {
        await Promise.all(
          parallelTasks.map((task) => this.runSubtask(task, callbacks)),
        );

        for (const task of parallelTasks) {
          if (task.status === "completed") {
            completed.add(task.id);
          }
        }
      }

      // Run sequential tasks one at a time
      for (const task of sequentialTasks) {
        await this.runSubtask(task, callbacks);
        if (task.status === "completed") {
          completed.add(task.id);
        }
      }
    }

    callbacks?.onAllComplete?.(this.subtasks);
    return this.subtasks;
  }

  /**
   * Run a single subtask using the sub-agent runner.
   */
  private async runSubtask(
    subtask: Subtask,
    callbacks?: Partial<CoordinatorCallbacks>,
  ): Promise<void> {
    subtask.status = "running";
    callbacks?.onSubtaskStart?.(subtask);

    try {
      const result = await this.runAgent(subtask.description, subtask.systemPrompt);
      subtask.result = result;
      subtask.status = "completed";
      callbacks?.onSubtaskComplete?.(subtask);
    } catch (err) {
      subtask.status = "failed";
      subtask.error = err instanceof Error ? err.message : String(err);
      callbacks?.onSubtaskError?.(subtask, err instanceof Error ? err : new Error(String(err)));
    }
  }

  /**
   * Get all subtask results as a formatted summary.
   */
  getSummary(): string {
    const lines: string[] = ["## Agent Coordinator Results\n"];

    for (const task of this.subtasks) {
      const icon = task.status === "completed" ? "✅"
        : task.status === "failed" ? "❌"
        : task.status === "running" ? "⏳"
        : "⬜";

      lines.push(`${icon} **${task.description}**`);
      if (task.result) {
        lines.push(`   ${task.result.substring(0, 200)}`);
      }
      if (task.error) {
        lines.push(`   Error: ${task.error}`);
      }
    }

    return lines.join("\n");
  }

  /**
   * Get all subtasks.
   */
  getSubtasks(): Subtask[] {
    return [...this.subtasks];
  }

  /**
   * Clear all subtasks.
   */
  clear(): void {
    this.subtasks = [];
  }
}
