/**
 * registry.js — Tool Registry
 *
 * The registry is like a phone book for tools.
 * The agent looks up tools by name when the AI asks to use one.
 *
 * Real code: packages/core/src/tools/registry.ts
 */

class SimpleToolRegistry {
  constructor() {
    this.tools = new Map();
  }

  register(tool) {
    this.tools.set(tool.definition.name, tool);
  }

  get(name) {
    return this.tools.get(name);
  }

  async execute(name, input) {
    const tool = this.tools.get(name);
    if (!tool) {
      return { success: false, output: "", error: `Unknown tool: ${name}` };
    }
    return await tool.execute(input);
  }

  /** Convert tool definitions to the format the AI expects (OpenAI function-calling format) */
  getDefinitionsForLLM() {
    const defs = [];
    for (const tool of this.tools.values()) {
      defs.push({
        type: "function",
        function: {
          name: tool.definition.name,
          description: tool.definition.description,
          parameters: tool.definition.inputSchema,
        },
      });
    }
    return defs;
  }

  listNames() {
    return Array.from(this.tools.keys());
  }
}

module.exports = { SimpleToolRegistry };
