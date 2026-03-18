/**
 * Todo Tool
 *
 * Allows the LLM to create, update, and manage tasks during a session.
 * This helps users see what the agent is working on and track progress.
 */

import type { BaseTool, ToolDefinition, ToolResult } from "../types";
import { TodoStore, type TodoStatus } from "../../utils/todo";

export class TodoTool implements BaseTool {
  definition: ToolDefinition = {
    name: "todo",
    description: `Manage tasks and subtasks for the current session. Use this to:
- Create tasks to track what needs to be done
- Create subtasks under a parent task to break work into steps
- Update task status as you work (pending -> in_progress -> completed)
- Help the user see your progress

Actions:
- create: Create a new task or subtask (returns task ID). Use parent_id to create a subtask.
- update: Update a task's status or details. When all subtasks complete, parent auto-completes.
- list: Show all tasks with subtask hierarchy
- delete: Remove a task (also deletes its subtasks)

Always mark tasks as in_progress when starting work, and completed when done.`,
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["create", "update", "list", "delete"],
          description: "The action to perform",
        },
        subject: {
          type: "string",
          description: "Task title (for create)",
        },
        description: {
          type: "string",
          description: "Task description (for create/update)",
        },
        id: {
          type: "string",
          description: "Task ID (for update/delete)",
        },
        parent_id: {
          type: "string",
          description: "Parent task ID — creates this as a subtask of the parent (for create)",
        },
        status: {
          type: "string",
          enum: ["pending", "in_progress", "completed", "blocked"],
          description: "Task status (for update)",
        },
      },
      required: ["action"],
    },
    requiresPermission: false,
  };

  constructor(private todoStore: TodoStore) {}

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const action = input.action as string;

    switch (action) {
      case "create": {
        const subject = input.subject as string;
        if (!subject) {
          return { success: false, output: "", error: "Subject is required for create" };
        }
        const description = input.description as string | undefined;
        const parentId = input.parent_id as string | undefined;

        if (parentId && !this.todoStore.get(parentId)) {
          return { success: false, output: "", error: `Parent task #${parentId} not found` };
        }

        const todo = this.todoStore.create(subject, description, parentId);
        const prefix = parentId ? `Created subtask #${todo.id} under #${parentId}` : `Created task #${todo.id}`;
        return {
          success: true,
          output: `${prefix}: ${todo.subject}`,
        };
      }

      case "update": {
        const id = input.id as string;
        if (!id) {
          return { success: false, output: "", error: "Task ID is required for update" };
        }
        const todo = this.todoStore.get(id);
        if (!todo) {
          return { success: false, output: "", error: `Task #${id} not found` };
        }

        const updates: Partial<{ subject: string; description: string; status: TodoStatus }> = {};
        if (input.status) updates.status = input.status as TodoStatus;
        if (input.subject) updates.subject = input.subject as string;
        if (input.description) updates.description = input.description as string;

        const updated = this.todoStore.update(id, updates);
        if (!updated) {
          return { success: false, output: "", error: `Failed to update task #${id}` };
        }

        const statusIcon = this.getStatusIcon(updated.status);
        return {
          success: true,
          output: `Updated task #${id}: ${statusIcon} ${updated.subject} [${updated.status}]`,
        };
      }

      case "list": {
        const topLevel = this.todoStore.getAll(true);
        if (topLevel.length === 0) {
          return { success: true, output: "No tasks" };
        }

        const lines: string[] = [];
        for (const t of topLevel) {
          lines.push(...this.formatTodoTree(t, 0));
        }

        const summary = this.todoStore.getSummary();
        lines.push("");
        lines.push(`Summary: ${summary.completed}/${summary.total} completed`);
        if (summary.in_progress > 0) lines.push(`  In progress: ${summary.in_progress}`);
        if (summary.blocked > 0) lines.push(`  Blocked: ${summary.blocked}`);

        return { success: true, output: lines.join("\n") };
      }

      case "delete": {
        const id = input.id as string;
        if (!id) {
          return { success: false, output: "", error: "Task ID is required for delete" };
        }
        const deleted = this.todoStore.delete(id);
        if (!deleted) {
          return { success: false, output: "", error: `Task #${id} not found` };
        }
        return { success: true, output: `Deleted task #${id}` };
      }

      default:
        return { success: false, output: "", error: `Unknown action: ${action}` };
    }
  }

  private getStatusIcon(status: TodoStatus): string {
    switch (status) {
      case "pending": return "[ ]";
      case "in_progress": return "[~]";
      case "completed": return "[x]";
      case "blocked": return "[!]";
    }
  }

  /** Format a todo and its subtasks as an indented tree */
  private formatTodoTree(todo: import("../../utils/todo").TodoItem, depth: number): string[] {
    const indent = "  ".repeat(depth);
    const icon = this.getStatusIcon(todo.status);
    const desc = todo.description ? ` - ${todo.description}` : "";
    const subtaskCount = todo.subtaskIds.length > 0 ? ` (${todo.subtaskIds.length} subtasks)` : "";
    const lines: string[] = [`${indent}${icon} #${todo.id} [${todo.status}] ${todo.subject}${desc}${subtaskCount}`];

    // Render subtasks indented
    for (const subtask of this.todoStore.getSubtasks(todo.id)) {
      lines.push(...this.formatTodoTree(subtask, depth + 1));
    }

    return lines;
  }
}
