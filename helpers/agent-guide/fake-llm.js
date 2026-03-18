/**
 * fake-llm.js — Simulated AI Responses
 *
 * In the real agent, this is where LangChain calls the actual AI API.
 * The AI streams back chunks, and we accumulate them to extract tool calls.
 *
 * Here we simulate it with pre-scripted responses so you can see
 * the flow without needing an API key.
 *
 * Real code: packages/ai/src/agent-runner.ts → streamWithRetry()
 */

/**
 * Simulates what the AI returns each turn.
 *
 * The AI can return:
 *   - text only        → "Here's my answer"  (conversation done)
 *   - text + tool_calls → "Let me check" + [{ name: "file_read", args: {...} }]
 *   - tool_calls only  → [{ name: "file_read", args: {...} }]
 *
 * If tool_calls is non-empty, the agent runs those tools
 * and sends the results back to the AI for the next turn.
 */
function simulateAI(messages) {
  const turnCount = messages.filter(
    (m) => m.role === "human" || m.role === "tool"
  ).length;

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
    tool_calls: [],
  };
}

module.exports = { simulateAI };
