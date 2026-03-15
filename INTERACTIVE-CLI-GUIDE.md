# Building an Interactive CLI Chat — A Practical Guide

This guide walks through the key patterns used to build a real interactive CLI chat like this project. It covers readline, streaming output, arrow-key menus, and common gotchas.

---

## 1. The Foundation — `readline`

Node's built-in `readline` module is the backbone of any interactive CLI. It handles terminal input, line editing, history, and tab completion.

```ts
import * as readline from "readline";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  completer: (line) => myCompleter(line), // optional tab completion
});

rl.question("❯ ", (input) => {
  console.log(`You typed: ${input}`);
  rl.close();
});
```

**Key rule:** Only ever have **one** `readline.Interface` open at a time. Creating a second one on the same stdin without closing the first causes double input, memory leaks, and duplicate event listeners.

---

## 2. The REPL Loop (Read → Eval → Print → Loop)

The core of a chat CLI is a recursive prompt loop:

```ts
function promptUser() {
  rl.question("❯ ", async (input) => {
    const trimmed = input.trim();
    if (!trimmed) return promptUser(); // ignore empty lines

    if (trimmed === "/exit") {
      rl.close();
      process.exit(0);
    }

    await handleMessage(trimmed);
    promptUser(); // loop back
  });
}

promptUser();
```

---

## 3. Streaming AI Responses Token by Token

When calling an AI API, stream tokens as they arrive instead of waiting for the full response:

```ts
async function handleMessage(message: string) {
  process.stdout.write("\n");

  const stream = await anthropic.messages.stream({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    messages: [{ role: "user", content: message }],
  });

  for await (const chunk of stream) {
    if (chunk.type === "content_block_delta") {
      process.stdout.write(chunk.delta.text); // print each token immediately
    }
  }

  process.stdout.write("\n\n");
}
```

**Why not `console.log`?** `console.log` always adds a newline. `process.stdout.write` lets you print mid-line, which is what you need for streaming.

---

## 4. Arrow-Key Navigation Menus

For interactive selection menus (like provider/model pickers), you need raw mode — where each keypress fires immediately instead of waiting for Enter:

```ts
interface Option {
  label: string;
  value: string;
  hint?: string;
}

function selectMenu(title: string, options: Option[], defaultIndex = 0): Promise<string> {
  return new Promise((resolve) => {
    let idx = defaultIndex;

    const render = () => {
      // On re-render, move cursor up to overwrite previous output
      if ((render as any).drawn) {
        process.stdout.write(`\x1b[${options.length + 1}A`);
      }
      (render as any).drawn = true;

      process.stdout.write("\n");
      options.forEach((opt, i) => {
        const selected = i === idx;
        const pointer = selected ? "  ❯ " : "    ";
        const hint = opt.hint ? `  ${opt.hint}` : "";
        process.stdout.write(`${pointer}${opt.label}${hint}\n`);
      });
    };

    console.log(`\n  ${title}`);
    render();

    // Raw mode: each keypress fires immediately (no Enter needed)
    readline.emitKeypressEvents(process.stdin);
    if (process.stdin.isTTY) process.stdin.setRawMode(true);

    const onKey = (_: string, key: readline.Key) => {
      if (key.name === "up")     idx = (idx - 1 + options.length) % options.length;
      if (key.name === "down")   idx = (idx + 1) % options.length;
      if (key.name === "return") {
        if (process.stdin.isTTY) process.stdin.setRawMode(false);
        process.stdin.removeListener("keypress", onKey);
        process.stdout.write("\n");
        resolve(options[idx].value);
      }
      if (key.ctrl && key.name === "c") process.exit(0);
      render();
    };

    process.stdin.on("keypress", onKey);
  });
}
```

**Gotcha:** Always call `setRawMode(false)` and remove the listener when done. Otherwise the terminal stays in raw mode and breaks normal input.

---

## 5. Showing a Spinner While Waiting

Use `ora` for a spinner during async operations:

```ts
import ora from "ora";

const spinner = ora();

async function handleMessage(message: string) {
  spinner.start("  Thinking...");

  const response = await callAI(message); // async call

  spinner.stop();
  console.log(response);
}
```

For streaming, stop the spinner on the first token:

```ts
let firstToken = true;

onToken: (token) => {
  if (firstToken) {
    spinner.stop();
    firstToken = false;
  }
  process.stdout.write(token);
}
```

---

## 6. Slash Commands

Parse slash commands by checking the first character of the input:

```ts
function handleCommand(input: string): boolean {
  const [cmd, ...rest] = input.split(" ");
  const arg = rest.join(" ").trim();

  switch (cmd) {
    case "/help":
      printHelp();
      return true;

    case "/model":
      if (!arg) { console.log("Usage: /model <name>"); return true; }
      currentModel = arg;
      console.log(`Model set to: ${arg}`);
      return true;

    case "/clear":
      conversationHistory = [];
      console.log("Conversation cleared.");
      return true;

    default:
      return false; // not a command
  }
}

// In the REPL loop:
if (trimmed.startsWith("/")) {
  const handled = handleCommand(trimmed);
  if (!handled) console.log(`Unknown command: ${trimmed}`);
  promptUser();
  return;
}
```

---

## 7. Tab Autocomplete

Pass a `completer` function to `readline.createInterface`. It receives the current line and returns `[matches, originalLine]`:

```ts
const COMMANDS = ["/help", "/model", "/provider", "/clear", "/exit"];

function completer(line: string): [string[], string] {
  if (line.startsWith("/")) {
    const matches = COMMANDS.filter(c => c.startsWith(line));
    return [matches, line];
  }
  return [[], line];
}
```

---

## 8. Keeping Conversation History

Maintain a messages array and send it with every request so the AI has context:

```ts
type Message = { role: "user" | "assistant"; content: string };
const history: Message[] = [];

async function chat(userMessage: string) {
  history.push({ role: "user", content: userMessage });

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    messages: history, // send full history
  });

  const reply = response.content[0].text;
  history.push({ role: "assistant", content: reply });

  return reply;
}
```

---

## 9. Handling `Ctrl+C` Gracefully

```ts
// On first Ctrl+C: cancel current operation
// On second Ctrl+C: exit
let lastSigint = 0;

process.on("SIGINT", () => {
  const now = Date.now();
  if (now - lastSigint < 1000) {
    console.log("\n  Goodbye!");
    process.exit(0);
  }
  lastSigint = now;
  console.log("\n  Press Ctrl+C again to exit, or keep chatting.\n");
  promptUser();
});
```

---

## 10. The Double-Listener Gotcha

The most common bug when building CLI chats: adding event listeners repeatedly.

**Wrong** — `createReadline()` called on every message without cleanup:
```ts
function createReadline() {
  rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  process.stdin.on("keypress", handleKeypress); // adds a NEW listener each call!
}
```

**Right** — remove old listener before adding a new one:
```ts
let keypressHandler: ((char: string, key: readline.Key) => void) | null = null;

function createReadline() {
  // Clean up previous
  if (keypressHandler) {
    process.stdin.removeListener("keypress", keypressHandler);
    keypressHandler = null;
  }
  if (rl) rl.close();

  rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  keypressHandler = (char, key) => { /* ... */ };
  process.stdin.on("keypress", keypressHandler);
}
```

---

## 11. Switching Between Raw Mode and Readline

When you need to show an arrow-key menu mid-conversation (e.g., `/setup`), you temporarily take over stdin:

```ts
// 1. Close readline (it owns stdin normally)
rl.close();
process.stdin.resume(); // keep stdin alive or the process exits!

// 2. Show the menu (takes rawMode, adds its own listener)
const choice = await selectMenu("Pick one", options);

// 3. Restore readline for normal chat input
rl = readline.createInterface({ input: process.stdin, output: process.stdout });
promptUser();
```

**Gotcha:** Calling `rl.close()` can cause stdin to be unref'd, which lets the process exit before the menu runs. Always call `process.stdin.resume()` right after `rl.close()`.

---

## 12. Minimal Full Example

```ts
import * as readline from "readline";
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();
const history: { role: "user" | "assistant"; content: string }[] = [];
let rl: readline.Interface;

function createRl() {
  rl = readline.createInterface({ input: process.stdin, output: process.stdout });
}

async function chat(message: string) {
  history.push({ role: "user", content: message });

  process.stdout.write("\n");

  const stream = client.messages.stream({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    messages: history,
  });

  let reply = "";
  for await (const chunk of await stream) {
    if (chunk.type === "content_block_delta" && chunk.delta.type === "text_delta") {
      process.stdout.write(chunk.delta.text);
      reply += chunk.delta.text;
    }
  }

  process.stdout.write("\n\n");
  history.push({ role: "assistant", content: reply });
}

function prompt() {
  rl.question("❯ ", async (input) => {
    const trimmed = input.trim();
    if (!trimmed) return prompt();
    if (trimmed === "/exit") { rl.close(); process.exit(0); }
    if (trimmed === "/clear") { history.length = 0; console.log("  Cleared.\n"); return prompt(); }

    await chat(trimmed);
    prompt();
  });
}

createRl();
console.log('  Chat started. Type /exit to quit.\n');
prompt();
```

---

## Key Packages

| Package | Purpose |
|---|---|
| `readline` | Built-in Node.js — terminal input, line editing |
| `ora` | Spinner / loading indicator |
| `chalk` | Terminal colors and styling |
| `@anthropic-ai/sdk` | Claude API client with streaming support |
| `commander` | CLI argument/flag parsing |
