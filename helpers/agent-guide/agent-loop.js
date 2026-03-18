/**
 * agent-loop.js — The Agentic Loop
 *
 * This is the HEART of any AI coding agent. The loop:
 *   1. Send messages to AI
 *   2. AI responds with text or tool calls
 *   3. If tool calls → run them → add results to history → go to 1
 *   4. If just text → we're done!
 *
 * That's it. That's the whole agent. Everything else is optimization.
 *
 * Real code: packages/ai/src/agent-runner.ts → run()
 */

/**
 * Run the agentic loop.
 *
 * @param {object}   registry   - Tool registry (has .execute(name, args))
 * @param {function} askAI      - Function that takes messages[] and returns { text, tool_calls }
 * @param {string}   userMessage - What the user asked
 * @param {object}   [callbacks] - Optional callbacks to observe the loop
 * @param {number}   [maxTurns=10] - Safety limit
 */
async function runAgentLoop(registry, askAI, userMessage, callbacks = {}, maxTurns = 10) {
  const messages = [
    { role: "system", content: "You are a helpful coding assistant." },
    { role: "human", content: userMessage },
  ];

  let turn = 0;

  while (turn < maxTurns) {
    turn++;
    if (callbacks.onTurnStart) callbacks.onTurnStart(turn);

    // STEP 1: Send messages to AI
    const aiResponse = askAI(messages);

    // STEP 2: AI said some text — emit it
    if (aiResponse.text && callbacks.onText) {
      callbacks.onText(aiResponse.text);
    }

    // STEP 3: No tool calls? AI is done.
    if (!aiResponse.tool_calls || aiResponse.tool_calls.length === 0) {
      messages.push({ role: "ai", content: aiResponse.text });
      if (callbacks.onDone) callbacks.onDone(messages);
      return messages;
    }

    // STEP 4: Save AI message (with tool calls) to history
    messages.push({
      role: "ai",
      content: aiResponse.text,
      tool_calls: aiResponse.tool_calls,
    });

    // STEP 5: Execute each tool call
    for (const tc of aiResponse.tool_calls) {
      if (callbacks.onToolCall) callbacks.onToolCall(tc.name, tc.args);

      const result = await registry.execute(tc.name, tc.args);

      if (callbacks.onToolResult) callbacks.onToolResult(tc.name, result);

      // STEP 6: Save tool result to history (AI needs to see this)
      messages.push({
        role: "tool",
        tool_call_id: tc.id,
        content: result.success ? result.output : `ERROR: ${result.error}`,
      });
    }

    // STEP 7: Loop back → AI sees tool results, decides what's next
  }

  if (callbacks.onDone) callbacks.onDone(messages);
  return messages;
}

module.exports = { runAgentLoop };
