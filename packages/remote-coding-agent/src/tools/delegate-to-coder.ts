/**
 * Delegate to Coder Tool
 *
 * Hands off coding tasks to a dedicated coding agent running a more powerful
 * model with full tool access (file_read, file_write, file_edit, shell_exec,
 * grep_search, glob_search, git, etc.).
 *
 * The personal assistant calls this tool when it detects a coding task —
 * anything involving reading/editing files, running commands, debugging,
 * refactoring, building, testing, or deploying code.
 *
 * Flow:
 *   1. User sends a message to the personal assistant
 *   2. Assistant recognizes it as a coding task
 *   3. Assistant calls delegate_to_coder with a refined task description
 *   4. This tool spawns a coding agent (separate AgentRunner instance)
 *   5. Coding agent executes the task with full tool access
 *   6. Coding agent's final response is returned as the tool result
 *   7. Assistant summarizes/formats the result for the chat channel
 *
 * This tool lives in remote-coding-agent (not core) because it manages
 * cross-agent delegation specific to the dual-model architecture.
 */

import type { BaseTool, ToolDefinition, ToolResult } from "@cdoing/core";

/** Maximum time (ms) the coding agent is allowed to run before being aborted. */
const CODING_AGENT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

/**
 * State required by the delegate tool, provided by the AgentBridge
 * when the tool is instantiated.
 */
export interface DelegateState {
  /**
   * Function to run the coding agent with a given task.
   * Provided by the AgentBridge — it creates a new AgentRunner with
   * the coding model/provider and full tool access, then runs it.
   *
   * @param task - The refined task description for the coding agent
   * @param sessionId - Current session ID for workspace isolation
   * @returns The coding agent's final text response
   */
  runCodingAgent: (task: string, sessionId: string) => Promise<string>;

  /** Current session ID — used for workspace isolation */
  sessionId: string;
}

/**
 * DelegateToCoder — A tool that lets the personal assistant hand off
 * coding work to a dedicated coding agent with a more powerful model.
 *
 * @example
 * ```ts
 * const delegateTool = new DelegateToCoder({
 *   runCodingAgent: async (task, sessionId) => {
 *     const runner = createCodingAgentRunner(sessionId);
 *     return runner.run(task);
 *   },
 *   sessionId: "user-123",
 * });
 * ```
 */
export class DelegateToCoder implements BaseTool {
  definition: ToolDefinition = {
    name: "delegate_to_coder",
    description:
      "Delegate a coding task to the dedicated coding agent which has a more " +
      "powerful model and full file/shell access. Use this for any task " +
      "involving reading/editing files, running commands, debugging, " +
      "refactoring, building, testing, or deploying code. The coding agent " +
      "will execute the task and return a detailed result.",
    inputSchema: {
      type: "object",
      properties: {
        task: {
          type: "string",
          description:
            "Clear, detailed description of the coding task to perform. " +
            "Include relevant file paths, error messages, or requirements. " +
            "The coding agent has no prior context — provide everything it needs.",
        },
        context: {
          type: "string",
          description:
            "Optional additional context or constraints for the coding agent. " +
            "For example: 'Only modify files in src/utils/', 'Do not run tests', " +
            "'The project uses ESM modules'.",
        },
      },
      required: ["task"],
    },
    requiresPermission: false,
    permissionMessage: (input) =>
      `Delegate coding task: ${(input.task as string).substring(0, 100)}${
        (input.task as string).length > 100 ? "..." : ""
      }`,
  };

  private state: DelegateState;

  constructor(state: DelegateState) {
    this.state = state;
  }

  /**
   * Execute the delegation — runs the coding agent with the provided task
   * and returns its response.
   *
   * @param input - Tool input with `task` (required) and `context` (optional)
   * @returns ToolResult with the coding agent's response or an error message
   */
  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const task = input.task as string;
    const context = input.context as string | undefined;

    if (!task || task.trim().length === 0) {
      return {
        success: false,
        output: "",
        error: "Task description is required. Provide a clear description of the coding work to perform.",
      };
    }

    // Build the full task prompt for the coding agent
    const fullTask = context
      ? `${task}\n\nAdditional context:\n${context}`
      : task;

    try {
      // Run the coding agent with a timeout
      const result = await Promise.race([
        this.state.runCodingAgent(fullTask, this.state.sessionId),
        this.createTimeout(),
      ]);

      if (result === "__TIMEOUT__") {
        return {
          success: false,
          output: "",
          error:
            "The coding agent timed out after 5 minutes. " +
            "The task may be too large — try breaking it into smaller steps.",
        };
      }

      return {
        success: true,
        output: result,
      };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : String(err);

      return {
        success: false,
        output: "",
        error: `Coding agent failed: ${message}. You can retry the task or try a simpler approach.`,
      };
    }
  }

  /**
   * Creates a timeout promise that resolves with a sentinel value
   * after CODING_AGENT_TIMEOUT_MS.
   */
  private createTimeout(): Promise<string> {
    return new Promise((resolve) => {
      setTimeout(() => resolve("__TIMEOUT__"), CODING_AGENT_TIMEOUT_MS);
    });
  }
}
