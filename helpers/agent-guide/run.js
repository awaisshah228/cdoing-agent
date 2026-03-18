#!/usr/bin/env node
/**
 * ============================================================
 *  HOW AN AI CODING AGENT WORKS — Beginner-Friendly Demo
 * ============================================================
 *
 *  Run:  node helpers/agent-guide/run.js
 *  (no API key needed — everything is simulated locally)
 *
 *  This pulls together the helper files to show the full flow:
 *    tools.js     → what tools look like
 *    registry.js  → how tools are registered and looked up
 *    fake-llm.js  → simulated AI responses
 *    agent-loop.js → the core loop that ties it all together
 */

const { file_read, list_dir, file_write, shell_exec } = require("./tools");
const { SimpleToolRegistry } = require("./registry");
const { simulateAI } = require("./fake-llm");
const { runAgentLoop } = require("./agent-loop");

// ── STEP 1: Register tools ──────────────────────────────

console.log("═══════════════════════════════════════════");
console.log("  STEP 1: Register Tools");
console.log("═══════════════════════════════════════════\n");

const registry = new SimpleToolRegistry();
registry.register(file_read);
registry.register(list_dir);
registry.register(file_write);
registry.register(shell_exec);

for (const name of registry.listNames()) {
  const tool = registry.get(name);
  console.log(`  + ${name} → ${tool.definition.description}`);
}

// ── STEP 2: Show what the AI sees ───────────────────────

console.log("\n═══════════════════════════════════════════");
console.log("  STEP 2: Tool Schemas (sent to the AI)");
console.log("═══════════════════════════════════════════\n");

const defs = registry.getDefinitionsForLLM();
console.log(`  ${defs.length} tools sent as JSON Schema to the AI.`);
console.log("  Names:", defs.map((d) => d.function.name).join(", "));
console.log("\n  Example (file_read):");
console.log(JSON.stringify(defs[0], null, 2));

// ── STEP 3: Run the agentic loop ───────────────────────

console.log("\n═══════════════════════════════════════════");
console.log("  STEP 3: The Agentic Loop");
console.log("═══════════════════════════════════════════\n");

async function main() {
  const messages = await runAgentLoop(
    registry,
    simulateAI,
    "What is this project about?",
    {
      onTurnStart: (turn) => {
        console.log(`  ┌─── Turn ${turn} ───────────────────────────┐`);
      },
      onText: (text) => {
        console.log(`  │ AI: "${text}"`);
      },
      onToolCall: (name, args) => {
        console.log(`  │ TOOL CALL: ${name}(${JSON.stringify(args)})`);
      },
      onToolResult: (name, result) => {
        const preview = (result.output || result.error || "").substring(0, 80);
        console.log(`  │ RESULT:    ${result.success ? preview : "ERROR: " + result.error}`);
        console.log(`  └──────────────────────────────────────────┘\n`);
      },
      onDone: (msgs) => {
        console.log("  ── Done! Message history ──\n");
        console.log(`  ${msgs.length} messages total:\n`);
        for (const msg of msgs) {
          const role = msg.role.toUpperCase().padEnd(6);
          const preview = (msg.content || "").substring(0, 65).replace(/\n/g, "\\n");
          const tc = msg.tool_calls ? ` + ${msg.tool_calls.length} tool call(s)` : "";
          const tid = msg.tool_call_id ? ` [for ${msg.tool_call_id}]` : "";
          console.log(`    [${role}] ${preview}${tc}${tid}`);
        }
      },
    }
  );

  // ── STEP 4: How the real agent adds more ────────────────

  console.log("\n═══════════════════════════════════════════");
  console.log("  STEP 4: What the Real Agent Adds");
  console.log("═══════════════════════════════════════════");
  console.log(`
  The real AgentRunner (packages/ai/src/agent-runner.ts) adds:

  1. PERMISSIONS     → check if user allows a tool before running it
  2. PARALLEL EXEC   → safe tools (file_read, grep) run concurrently
  3. STREAMING       → text arrives token-by-token, not all at once
  4. HOOKS           → run scripts before/after tool calls
  5. CONTEXT COMPRESS → summarize old messages when conversation is too long
  6. DOOM LOOP       → stop if same tool called 4x with identical args
  7. SMART SELECTION  → only send ~8 relevant tools (not all 20+)

  But the CORE is exactly what we built: message → AI → tools → repeat
  `);

  console.log("═══════════════════════════════════════════");
  console.log("  Real code lives at:");
  console.log("    packages/ai/src/agent-runner.ts    (agentic loop)");
  console.log("    packages/core/src/tools/registry.ts (registry)");
  console.log("    packages/core/src/tools/types.ts    (tool interface)");
  console.log("    packages/core/src/tools/groups.ts   (tool registration)");
  console.log("═══════════════════════════════════════════\n");
}

main().catch(console.error);
