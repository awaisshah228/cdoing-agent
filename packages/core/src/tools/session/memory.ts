/**
 * Memory Tool — lets the LLM save, search, and forget memories.
 *
 * This is the key feature that makes the agent learn across conversations.
 * The LLM can:
 *   - save: Store information for future conversations
 *   - search: Find relevant memories by keyword
 *   - forget: Remove outdated memories
 *   - list: See all stored memories
 */

import type { BaseTool, ToolDefinition, ToolResult } from "../types";
import type { MemoryStore, MemoryType } from "../../utils/memory";

export class MemoryTool implements BaseTool {
  // ── Behavioral flags ──
  concurrencyMode = () => "parallel" as const; // in-memory store, independent operations
  definition: ToolDefinition = {
    name: "memory",
    description:
      "Save, search, or forget persistent memories that survive across conversations. " +
      "Use this to remember user preferences, project decisions, feedback, and external references. " +
      "Memories are scoped: user/feedback are global, project/reference are per-project.",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["save", "search", "forget", "list"],
          description: "Action to perform",
        },
        key: {
          type: "string",
          description: "Unique key for the memory (for save/forget). Use snake_case, e.g. 'user_role', 'feedback_testing'",
        },
        name: {
          type: "string",
          description: "Human-readable name for the memory (for save)",
        },
        description: {
          type: "string",
          description: "One-line description of what this memory is about (for save)",
        },
        type: {
          type: "string",
          enum: ["user", "feedback", "project", "reference"],
          description: "Memory type: user (about the person), feedback (guidance/corrections), project (ongoing work), reference (external systems)",
        },
        content: {
          type: "string",
          description: "The memory content to store (for save)",
        },
        query: {
          type: "string",
          description: "Search query (for search)",
        },
      },
      required: ["action"],
    },
    requiresPermission: false,
  };

  constructor(private memoryStore: MemoryStore) {}

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const action = input.action as string;

    switch (action) {
      case "save": {
        const key = input.key as string;
        const content = input.content as string;
        if (!key || !content) {
          return { success: false, output: "", error: "Both 'key' and 'content' are required for save" };
        }
        const type = (input.type as MemoryType) || "reference";
        const name = (input.name as string) || key;
        const description = (input.description as string) || content.substring(0, 80);

        this.memoryStore.set(key, content, type, { name, description });
        return {
          success: true,
          output: `Saved memory "${name}" [${type}]: ${description}`,
        };
      }

      case "search": {
        const query = input.query as string;
        if (!query) {
          return { success: false, output: "", error: "Query is required for search" };
        }
        const results = this.memoryStore.search(query);
        if (results.length === 0) {
          return { success: true, output: `No memories found for "${query}"` };
        }
        const lines = results.map((m) =>
          `[${m.type}] **${m.name}** (${m.key}): ${m.content}`
        );
        return {
          success: true,
          output: `Found ${results.length} memor${results.length === 1 ? "y" : "ies"}:\n${lines.join("\n")}`,
        };
      }

      case "forget": {
        const key = input.key as string;
        if (!key) {
          return { success: false, output: "", error: "Key is required for forget" };
        }
        const deleted = this.memoryStore.forget(key);
        return deleted
          ? { success: true, output: `Forgot memory "${key}"` }
          : { success: false, output: "", error: `Memory "${key}" not found` };
      }

      case "list": {
        const all = this.memoryStore.getAll();
        if (all.length === 0) {
          return { success: true, output: "No memories stored" };
        }

        const byType = new Map<string, typeof all>();
        for (const m of all) {
          const list = byType.get(m.type) || [];
          list.push(m);
          byType.set(m.type, list);
        }

        const typeLabels: Record<string, string> = {
          user: "User", feedback: "Feedback", project: "Project", reference: "Reference",
        };

        const lines: string[] = [];
        for (const [type, entries] of byType) {
          lines.push(`\n## ${typeLabels[type] || type}`);
          for (const e of entries) {
            lines.push(`- **${e.name}** (${e.key}) [${e.type}]: ${e.description}`);
          }
        }
        return {
          success: true,
          output: `${all.length} memor${all.length === 1 ? "y" : "ies"} stored:${lines.join("\n")}`,
        };
      }

      default:
        return { success: false, output: "", error: `Unknown action: ${action}` };
    }
  }
}
