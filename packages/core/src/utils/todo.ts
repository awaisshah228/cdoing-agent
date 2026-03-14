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
}

export class TodoStore {
  private todos: Map<string, TodoItem> = new Map();
  private nextId = 1;

  /** Create a new todo item */
  create(subject: string, description?: string): TodoItem {
    const id = String(this.nextId++);
    const todo: TodoItem = {
      id,
      subject,
      description,
      status: "pending",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.todos.set(id, todo);
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
    }
    return todo;
  }

  /** Delete a todo */
  delete(id: string): boolean {
    return this.todos.delete(id);
  }

  /** Get all todos */
  getAll(): TodoItem[] {
    return Array.from(this.todos.values()).sort((a, b) => {
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
