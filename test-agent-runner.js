/**
 * ============================================================
 *  HOW AN AI CODING AGENT WORKS — Beginner-Friendly Demo
 * ============================================================
 *
 *  Run:  node test-agent-runner.js
 *  (no API key needed — everything is simulated locally)
 *
 *  This script builds a tiny agent FROM SCRATCH so you can see
 *  every moving part. No imports, no frameworks, just plain JS.
 *
 *  Think of an AI agent like a chef in a kitchen:
 *    - The TOOLS are the kitchen equipment (oven, knife, blender)
 *    - The TOOL REGISTRY is the kitchen — it knows what equipment exists
 *    - The LLM (AI brain) is the chef — it decides WHICH tool to use
 *    - The AGENT LOOP is the cooking process — chef thinks, uses a tool,
 *      looks at the result, thinks again, uses another tool, until done
 *    - The MESSAGES are the conversation history — the recipe so far
 */

const fs = require("fs");
const path = require("path");

// ╔══════════════════════════════════════════════════════╗
// ║  PART 1: WHAT IS A TOOL?                            ║
// ╚══════════════════════════════════════════════════════╝
//
// A tool is just an object with:
//   1. A DEFINITION  → tells the AI what this tool does (name + description + what inputs it needs)
//   2. An EXECUTE fn → the actual code that runs when the AI calls it

console.log("═══════════════════════════════════════════");
console.log("  PART 1: DEFINING TOOLS");
console.log("═══════════════════════════════════════════\n");

const tools = {
  // Tool 1: Read a file
  file_read: {
    definition: {
      name: "file_read",
      description: "Read the contents of a file",
      // This JSON Schema tells the AI what arguments this tool accepts
      // The AI uses this to know HOW to call the tool correctly
      inputSchema: {
        type: "object",
        properties: {
          file_path: {
            type: "string",
            description: "Path to the file to read",
          },
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
  },

  // Tool 2: List files in a directory
  list_dir: {
    definition: {
      name: "list_dir",
      description: "List files and folders in a directory",
      inputSchema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Directory path to list",
          },
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
  },

  // Tool 3: Write a file
  file_write: {
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
      // (we won't actually write in this demo)
      return {
        success: true,
        output: `[SIMULATED] Would write ${input.content.length} chars to ${input.file_path}`,
      };
    },
  },

  // Tool 4: Run a shell command
  shell_exec: {
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
      // (simulated for safety)
      return {
        success: true,
        output: `[SIMULATED] Would run: ${input.command}`,
      };
    },
  },
};

// Show what we defined
for (const [name, tool] of Object.entries(tools)) {
  console.log(`  ✅ Tool: "${name}" → ${tool.definition.description}`);
}

// ╔══════════════════════════════════════════════════════╗
// ║  PART 2: THE TOOL REGISTRY                          ║
// ╚══════════════════════════════════════════════════════╝
//
// The registry is like a phone book for tools.
// The agent looks up tools by name when the AI asks to use one.

console.log("\n═══════════════════════════════════════════");
console.log("  PART 2: TOOL REGISTRY");
console.log("═══════════════════════════════════════════\n");

class SimpleToolRegistry {
  constructor() {
    // Just a Map: tool name → tool object
    this.tools = new Map();
  }

  // Add a tool to the registry
  register(tool) {
    this.tools.set(tool.definition.name, tool);
    console.log(`  📦 Registered: "${tool.definition.name}"`);
  }

  // Find a tool by name
  get(name) {
    return this.tools.get(name);
  }

  // Run a tool by name with given inputs
  async execute(name, input) {
    const tool = this.tools.get(name);
    if (!tool) {
      return { success: false, output: "", error: `Unknown tool: ${name}` };
    }
    return await tool.execute(input);
  }

  // Get all tool definitions (this is what we send to the AI)
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
}

const registry = new SimpleToolRegistry();
for (const tool of Object.values(tools)) {
  registry.register(tool);
}

// ╔══════════════════════════════════════════════════════╗
// ║  PART 3: WHAT THE AI SEES                           ║
// ╚══════════════════════════════════════════════════════╝
//
// Before calling the AI, we convert our tools into a format
// the AI understands. This tells the AI:
//   "Hey, you can use these tools. Here's how to call each one."

console.log("\n═══════════════════════════════════════════");
console.log("  PART 3: WHAT THE AI SEES (tool schemas)");
console.log("═══════════════════════════════════════════\n");

const toolDefsForAI = registry.getDefinitionsForLLM();
console.log("  We send this JSON to the AI alongside the user's message:");
console.log("  " + JSON.stringify(toolDefsForAI.map((d) => d.function.name)));
console.log("\n  Example tool definition the AI receives:\n");
console.log(JSON.stringify(toolDefsForAI[0], null, 2));

// ╔══════════════════════════════════════════════════════╗
// ║  PART 4: HOW THE AI RESPONDS WITH TOOL CALLS        ║
// ╚══════════════════════════════════════════════════════╝
//
// When the AI decides to use a tool, it doesn't return text.
// Instead it returns a special "tool_call" object like:
//   { id: "call_123", name: "file_read", args: { file_path: "./README.md" } }
//
// The AI can also return MULTIPLE tool calls at once!

console.log("\n═══════════════════════════════════════════");
console.log("  PART 4: HOW TOOL CALLS LOOK IN THE AI RESPONSE");
console.log("═══════════════════════════════════════════\n");

// This is what the AI's response looks like when it wants to use tools.
// (In real code, LangChain parses this from the streaming response)
const exampleAIResponse = {
  // The AI might say some text AND call tools in the same response
  text: "Let me look at the project structure first.",

  // These are the tool calls the AI wants to make
  tool_calls: [
    {
      id: "call_001",
      name: "list_dir",
      args: { path: "." },
    },
    {
      id: "call_002",
      name: "file_read",
      args: { file_path: "./package.json" },
    },
  ],
};

console.log("  AI says:", exampleAIResponse.text);
console.log("  AI wants to call", exampleAIResponse.tool_calls.length, "tools:");
for (const tc of exampleAIResponse.tool_calls) {
  console.log(`    → ${tc.name}(${JSON.stringify(tc.args)})`);
}

// ╔══════════════════════════════════════════════════════╗
// ║  PART 5: THE MESSAGE HISTORY                        ║
// ╚══════════════════════════════════════════════════════╝
//
// The agent keeps a conversation history. Every message has a ROLE:
//   "system"    → instructions for the AI (you are a coding assistant...)
//   "human"     → what the user said
//   "ai"        → what the AI responded (text + tool calls)
//   "tool"      → the result of running a tool
//
// This history is sent to the AI on EVERY turn so it remembers
// what happened before.

console.log("\n═══════════════════════════════════════════");
console.log("  PART 5: MESSAGE HISTORY");
console.log("═══════════════════════════════════════════\n");

// Here's what the message history looks like during a conversation:
const messageHistory = [
  // Turn 1: user asks something
  { role: "human", content: "What files are in this project?" },

  // Turn 1: AI decides to use a tool (instead of just guessing)
  {
    role: "ai",
    content: "Let me check.",
    tool_calls: [{ id: "call_001", name: "list_dir", args: { path: "." } }],
  },

  // Turn 1: We ran the tool and got this result
  {
    role: "tool",
    tool_call_id: "call_001",
    content: "package.json\nsrc\nREADME.md\ntsconfig.json",
  },

  // Turn 2: AI sees the tool result and responds with text (no more tool calls = DONE)
  {
    role: "ai",
    content: "This project has: package.json, src/, README.md, and tsconfig.json.",
  },
];

console.log("  Message history (what the AI sees each turn):\n");
for (const msg of messageHistory) {
  const role = msg.role.toUpperCase().padEnd(6);
  const preview = (msg.content || "").substring(0, 60);
  const tcInfo = msg.tool_calls ? ` + ${msg.tool_calls.length} tool call(s)` : "";
  const tidInfo = msg.tool_call_id ? ` [result for ${msg.tool_call_id}]` : "";
  console.log(`  [${role}] ${preview}${tcInfo}${tidInfo}`);
}

// ╔══════════════════════════════════════════════════════╗
// ║  PART 6: THE AGENTIC LOOP — THE HEART OF IT ALL     ║
// ╚══════════════════════════════════════════════════════╝
//
// This is where the magic happens. The loop:
//   1. Send messages to AI
//   2. AI responds with text or tool calls
//   3. If tool calls → run them → add results to history → go to 1
//   4. If just text → we're done!
//
// That's it. That's the whole agent. Everything else is optimization.

console.log("\n═══════════════════════════════════════════");
console.log("  PART 6: THE AGENTIC LOOP (running it!)");
console.log("═══════════════════════════════════════════\n");

// We'll simulate the AI with pre-scripted responses
// In real life, this calls the actual AI API
function simulateAI(messages) {
  const turnCount = messages.filter((m) => m.role === "human" || m.role === "tool").length;

  // Turn 1: AI sees user message, decides to list directory
  if (turnCount === 1) {
    return {
      text: "I'll look at the project structure first.",
      tool_calls: [
        { id: "call_001", name: "list_dir", args: { path: "." } },
      ],
    };
  }

  // Turn 2: AI sees directory listing, wants to read package.json
  if (turnCount === 2) {
    return {
      text: "Let me read the package.json to understand the project.",
      tool_calls: [
        { id: "call_002", name: "file_read", args: { file_path: "./package.json" } },
      ],
    };
  }

  // Turn 3: AI has enough info, responds with just text (loop ends!)
  return {
    text: "This is a TypeScript monorepo with Turbo. It has 4 packages: core, ai, cli, and vscode-extension.",
    tool_calls: [], // ← empty = no more tools = DONE
  };
}

async function runAgentLoop() {
  const messages = [
    { role: "system", content: "You are a helpful coding assistant." },
    { role: "human", content: "What is this project about?" },
  ];

  let turn = 0;
  const MAX_TURNS = 10; // safety limit so we don't loop forever

  while (turn < MAX_TURNS) {
    turn++;
    console.log(`  ┌─── Turn ${turn} ───────────────────────────┐`);

    // STEP A: Send messages to AI (simulated)
    const aiResponse = simulateAI(messages);

    // STEP B: Show what the AI said
    if (aiResponse.text) {
      console.log(`  │ 🤖 AI says: "${aiResponse.text}"`);
    }

    // STEP C: Check if AI wants to use any tools
    if (!aiResponse.tool_calls || aiResponse.tool_calls.length === 0) {
      // No tool calls = AI is done!
      console.log(`  │ ✅ No tool calls → conversation complete!`);
      console.log(`  └──────────────────────────────────────────┘\n`);

      // Save final AI message to history
      messages.push({ role: "ai", content: aiResponse.text });
      break;
    }

    // STEP D: AI wants tools — save its message (with tool calls) to history
    messages.push({
      role: "ai",
      content: aiResponse.text,
      tool_calls: aiResponse.tool_calls,
    });

    // STEP E: Execute each tool call
    for (const tc of aiResponse.tool_calls) {
      console.log(`  │ 🔧 Tool call: ${tc.name}(${JSON.stringify(tc.args)})`);

      // Run the tool through the registry
      const result = await registry.execute(tc.name, tc.args);

      // Show the result
      const preview = result.output.substring(0, 80);
      console.log(`  │ 📋 Result: ${result.success ? preview : "ERROR: " + result.error}`);

      // STEP F: Save tool result to message history
      // This is CRITICAL — the AI needs to see what the tool returned
      messages.push({
        role: "tool",
        tool_call_id: tc.id,
        content: result.success ? result.output : `ERROR: ${result.error}`,
      });
    }

    console.log(`  │ 🔄 Looping back to AI with tool results...`);
    console.log(`  └──────────────────────────────────────────┘\n`);

    // STEP G: Loop back to step A — AI sees the tool results and decides what's next
  }

  // Show the final message history
  console.log("  Final message history:");
  console.log(`  ${messages.length} messages total\n`);
  for (const msg of messages) {
    const role = msg.role.toUpperCase().padEnd(6);
    const preview = (msg.content || "").substring(0, 70).replace(/\n/g, "\\n");
    console.log(`    [${role}] ${preview}`);
  }
}

// ╔══════════════════════════════════════════════════════╗
// ║  PART 7: BONUS — HOW THE REAL AGENT RUNNER ADDS     ║
// ║  PERMISSIONS, PARALLEL EXECUTION & DOOM LOOPS       ║
// ╚══════════════════════════════════════════════════════╝

function explainRealAgent() {
  console.log("\n═══════════════════════════════════════════");
  console.log("  PART 7: WHAT THE REAL AGENT ADDS ON TOP");
  console.log("═══════════════════════════════════════════");
  console.log(`
  The real AgentRunner (packages/ai/src/agent-runner.ts) adds:

  1. PERMISSIONS — Before running a tool, check if user allows it:
     "shell_exec wants to run 'rm -rf /'. Allow? [y/n]"

  2. PARALLEL EXECUTION — Safe tools (file_read, grep) run at the
     same time. Dangerous tools (shell_exec) run one at a time.

     Safe to parallelize:   file_read, grep_search, glob_search
     Must be sequential:    shell_exec, file_write, file_run

  3. STREAMING — Text comes back token by token (not all at once).
     callbacks.onToken("H") → callbacks.onToken("e") → callbacks.onToken("llo")

  4. HOOKS — Run custom scripts before/after tool calls:
     pre:shell_exec  → "log this command"
     post:file_write → "run linter on saved file"

  5. CONTEXT COMPRESSION — If conversation gets too long (>75% of
     limit), older messages get summarized to free up space.

  6. DOOM LOOP DETECTION — If the AI calls the same tool with the
     same arguments 4 times in a row, force it to stop and try
     something different.

  7. SMART TOOL SELECTION — Don't send ALL 20+ tools to the AI every
     time. Pick the ~8 most relevant ones based on the user's message,
     plus a "get_tool" meta-tool so the AI can request any others.

  But the CORE LOOP is exactly what we built above:
     User message → AI thinks → Tool calls → Execute → Repeat
  `);
}

// ╔══════════════════════════════════════════════════════╗
// ║  RUN EVERYTHING                                     ║
// ╚══════════════════════════════════════════════════════╝

async function main() {
  await runAgentLoop();
  explainRealAgent();

  console.log("═══════════════════════════════════════════");
  console.log("  DONE! You now understand how an AI agent works.");
  console.log("  The real code lives at:");
  console.log("    packages/ai/src/agent-runner.ts    (the agentic loop)");
  console.log("    packages/core/src/tools/registry.ts (tool registry)");
  console.log("    packages/core/src/tools/types.ts    (tool interface)");
  console.log("    packages/core/src/tools/groups.ts   (tool registration)");
  console.log("═══════════════════════════════════════════\n");
}

main().catch(console.error);
