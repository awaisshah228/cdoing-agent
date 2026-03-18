/**
 * Todo/Task Manager
 *
 * Allows the LLM to create, update, and track tasks during a session.
 * Tasks have a status: pending, in_progress, completed, or blocked.
 */

export type TodoStatus = "pending" | "in_progress" | "completed" | "blocked";

export interface TodoItem {
  id: string;
  subject: string;
  description?: string;
  status: TodoStatus;
  createdAt: number;
  updatedAt: number;
  blockedBy?: string[];
  /** Parent task ID — if set, this is a subtask */
  parentId?: string;
  /** Child subtask IDs */
  subtaskIds: string[];
}

export class TodoStore {
  private todos: Map<string, TodoItem> = new Map();
  private nextId = 1;

  /** Create a new todo item, optionally as a subtask of a parent */
  create(subject: string, description?: string, parentId?: string): TodoItem {
    const id = String(this.nextId++);
    const todo: TodoItem = {
      id,
      subject,
      description,
      status: "pending",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      parentId,
      subtaskIds: [],
    };
    this.todos.set(id, todo);

    // Link to parent
    if (parentId) {
      const parent = this.todos.get(parentId);
      if (parent) {
        parent.subtaskIds.push(id);
        parent.updatedAt = Date.now();
      }
    }

    return todo;
  }

  /** Get a todo by ID */
  get(id: string): TodoItem | undefined {
    return this.todos.get(id);
  }

  /** Update a todo's status */
  updateStatus(id: string, status: TodoStatus): TodoItem | undefined {
    const todo = this.todos.get(id);
    if (todo) {
      todo.status = status;
      todo.updatedAt = Date.now();
    }
    return todo;
  }

  /** Update a todo's details */
  update(id: string, updates: Partial<Pick<TodoItem, "subject" | "description" | "status" | "blockedBy">>): TodoItem | undefined {
    const todo = this.todos.get(id);
    if (todo) {
      if (updates.subject !== undefined) todo.subject = updates.subject;
      if (updates.description !== undefined) todo.description = updates.description;
      if (updates.status !== undefined) todo.status = updates.status;
      if (updates.blockedBy !== undefined) todo.blockedBy = updates.blockedBy;
      todo.updatedAt = Date.now();

      // Auto-update parent status when subtask status changes
      if (updates.status && todo.parentId) {
        this.updateParentStatus(todo.parentId);
      }
    }
    return todo;
  }

  /**
   * Auto-update parent task status based on subtask states:
   * - All subtasks completed → parent completed
   * - Any subtask in_progress → parent in_progress
   * - Any subtask blocked → parent blocked (if none in_progress)
   */
  private updateParentStatus(parentId: string): void {
    const parent = this.todos.get(parentId);
    if (!parent || parent.subtaskIds.length === 0) return;

    const subtasks = parent.subtaskIds
      .map(id => this.todos.get(id))
      .filter((t): t is TodoItem => t !== undefined);

    if (subtasks.length === 0) return;

    const allCompleted = subtasks.every(t => t.status === "completed");
    const anyInProgress = subtasks.some(t => t.status === "in_progress");
    const anyBlocked = subtasks.some(t => t.status === "blocked");

    if (allCompleted) {
      parent.status = "completed";
    } else if (anyInProgress) {
      parent.status = "in_progress";
    } else if (anyBlocked) {
      parent.status = "blocked";
    } else {
      parent.status = "pending";
    }
    parent.updatedAt = Date.now();
  }

  /** Get subtasks of a parent todo */
  getSubtasks(parentId: string): TodoItem[] {
    const parent = this.todos.get(parentId);
    if (!parent) return [];
    return parent.subtaskIds
      .map(id => this.todos.get(id))
      .filter((t): t is TodoItem => t !== undefined);
  }

  /** Delete a todo and clean up parent/child references */
  delete(id: string): boolean {
    const todo = this.todos.get(id);
    if (!todo) return false;

    // Remove from parent's subtaskIds
    if (todo.parentId) {
      const parent = this.todos.get(todo.parentId);
      if (parent) {
        parent.subtaskIds = parent.subtaskIds.filter(sid => sid !== id);
        parent.updatedAt = Date.now();
      }
    }

    // Delete all subtasks recursively
    for (const subtaskId of todo.subtaskIds) {
      this.delete(subtaskId);
    }

    return this.todos.delete(id);
  }

  /** Get all todos (optionally filter to top-level only) */
  getAll(topLevelOnly = false): TodoItem[] {
    let items = Array.from(this.todos.values());
    if (topLevelOnly) {
      items = items.filter(t => !t.parentId);
    }
    return items.sort((a, b) => {
      // Sort by status priority: in_progress > pending > blocked > completed
      const statusOrder: Record<TodoStatus, number> = {
        in_progress: 0,
        pending: 1,
        blocked: 2,
        completed: 3,
      };
      const statusDiff = statusOrder[a.status] - statusOrder[b.status];
      if (statusDiff !== 0) return statusDiff;
      return a.createdAt - b.createdAt;
    });
  }

  /** Get todos by status */
  getByStatus(status: TodoStatus): TodoItem[] {
    return this.getAll().filter(t => t.status === status);
  }

  /** Get summary counts */
  getSummary(): { pending: number; in_progress: number; completed: number; blocked: number; total: number } {
    const todos = this.getAll();
    return {
      pending: todos.filter(t => t.status === "pending").length,
      in_progress: todos.filter(t => t.status === "in_progress").length,
      completed: todos.filter(t => t.status === "completed").length,
      blocked: todos.filter(t => t.status === "blocked").length,
      total: todos.length,
    };
  }

  /** Clear all todos */
  clear(): void {
    this.todos.clear();
    this.nextId = 1;
  }

  /** Check if there are any active (non-completed) todos */
  hasActiveTodos(): boolean {
    return this.getAll().some(t => t.status !== "completed");
  }
}
