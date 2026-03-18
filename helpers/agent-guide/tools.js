/**
 * tools.js — Tool Definitions
 *
 * A tool is just an object with:
 *   1. A DEFINITION  → tells the AI what this tool does (name + description + what inputs it needs)
 *   2. An EXECUTE fn → the actual code that runs when the AI calls it
 *
 * The definition uses JSON Schema so the AI knows exactly what arguments to pass.
 */

const fs = require("fs");

const file_read = {
  definition: {
    name: "file_read",
    description: "Read the contents of a file",
    inputSchema: {
      type: "object",
      properties: {
        file_path: { type: "string", description: "Path to the file to read" },
      },
      required: ["file_path"],
    },
  },
  execute: async (input) => {
    try {
      const content = fs.readFileSync(input.file_path, "utf-8");
      return { success: true, output: content };
    } catch (err) {
      return { success: false, output: "", error: err.message };
    }
  },
};

const list_dir = {
  definition: {
    name: "list_dir",
    description: "List files and folders in a directory",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Directory path to list" },
      },
      required: ["path"],
    },
  },
  execute: async (input) => {
    try {
      const entries = fs.readdirSync(input.path);
      return { success: true, output: entries.join("\n") };
    } catch (err) {
      return { success: false, output: "", error: err.message };
    }
  },
};

const file_write = {
  definition: {
    name: "file_write",
    description: "Write content to a file",
    inputSchema: {
      type: "object",
      properties: {
        file_path: { type: "string", description: "Path to write to" },
        content: { type: "string", description: "Content to write" },
      },
      required: ["file_path", "content"],
    },
  },
  execute: async (input) => {
    return {
      success: true,
      output: `[SIMULATED] Would write ${input.content.length} chars to ${input.file_path}`,
    };
  },
};

const shell_exec = {
  definition: {
    name: "shell_exec",
    description: "Run a shell command and return its output",
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string", description: "The command to run" },
      },
      required: ["command"],
    },
  },
  execute: async (input) => {
    return {
      success: true,
      output: `[SIMULATED] Would run: ${input.command}`,
    };
  },
};

module.exports = { file_read, list_dir, file_write, shell_exec };
