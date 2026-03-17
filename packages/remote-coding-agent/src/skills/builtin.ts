/**
 * Built-in skills that ship with the remote coding agent.
 *
 * These are loaded by default and can be extended by adding
 * more skills in .cdoing/skills/ or ~/.cdoing/skills/.
 */

import type { Skill } from "./types";

export const builtinSkills: Skill[] = [
  // ── Core Skills (coding agent, math, weather) ────────────────────────
  {
    id: "coding-agent",
    name: "coding-agent",
    description: "Dedicated coding agent — delegates complex coding tasks to a powerful model with full file/shell access",
    userInvocable: true,
    always: false,
    location: "builtin",
    metadata: { category: "agent", requiresSetup: true },
    content: `The coding agent skill enables delegation of complex coding tasks to a dedicated, more powerful model.

When this skill is active, the personal assistant will automatically delegate tasks involving:
- File editing, creation, or deletion
- Running shell commands (build, test, install, git)
- Debugging and fixing bugs
- Refactoring or implementing features
- Code search and analysis

The coding agent uses the delegate_to_coder tool. Configure the coding model with:
- config_manager({ action: "set", key: "coding_model", value: "claude-sonnet-4-6" })
- config_manager({ action: "set", key: "coding_provider", value: "anthropic" })

If no coding model is configured, the assistant's own model is used for coding tasks.`,
  },
  {
    id: "math",
    name: "math",
    description: "Evaluate mathematical expressions and perform calculations",
    userInvocable: true,
    always: false,
    location: "builtin",
    metadata: { category: "utility" },
    content: `When the user asks you to calculate something or evaluate a math expression:

1. Use shell_exec to evaluate with Node.js: shell_exec({ command: "node -e \\"console.log(EXPRESSION)\\"" })
2. For complex math, you can use JavaScript's Math object:
   - Math.sqrt(), Math.pow(), Math.PI, Math.E
   - Math.sin(), Math.cos(), Math.tan() (radians)
   - Math.log(), Math.log2(), Math.log10()
   - Math.round(), Math.floor(), Math.ceil()
   - parseInt(), parseFloat(), Number()
3. For unit conversions, calculate directly.
4. Present the result clearly with the formula used.

Examples:
- "what is 15% of 340?" → node -e "console.log(340 * 0.15)"
- "convert 72°F to Celsius" → node -e "console.log((72 - 32) * 5/9)"
- "square root of 144" → node -e "console.log(Math.sqrt(144))"
- "compound interest: $1000 at 5% for 10 years" → node -e "console.log(1000 * Math.pow(1.05, 10))"`,
  },
  {
    id: "weather",
    name: "weather",
    description: "Fetch current weather for a location using wttr.in",
    userInvocable: true,
    always: false,
    location: "builtin",
    metadata: { category: "utility" },
    content: `When the user asks about weather:

1. Use web_fetch to get weather from wttr.in (no API key needed):
   web_fetch({ url: "https://wttr.in/CITY?format=j1" })
2. Parse the JSON response and extract:
   - Current temperature (°C and °F)
   - Weather description
   - Humidity, wind speed
   - Feels like temperature
3. Present it concisely:
   "London: 15°C (59°F), Partly cloudy, Humidity 72%, Wind 12 km/h"
4. If the user asks for a forecast, the JSON includes 3-day forecast in the "weather" array.

For a simple one-line format:
   web_fetch({ url: "https://wttr.in/CITY?format=%l:+%C+%t+(%f)+💨+%w+💧+%h" })`,
  },
  {
    id: "commit",
    name: "commit",
    description: "Create a well-structured git commit with a descriptive message",
    userInvocable: true,
    always: false,
    location: "builtin",
    content: `When asked to commit, follow these steps:
1. Run \`git status\` and \`git diff --staged\` to understand the changes.
2. If nothing is staged, stage the relevant files with \`git add\`.
3. Write a concise commit message following Conventional Commits format:
   - feat: for new features
   - fix: for bug fixes
   - refactor: for code restructuring
   - docs: for documentation changes
   - chore: for maintenance tasks
4. Create the commit with \`git commit -m "..."\`.
5. Confirm the commit was successful.`,
  },
  {
    id: "review",
    name: "review",
    description: "Review code changes and provide feedback",
    userInvocable: true,
    always: false,
    location: "builtin",
    content: `When asked to review code, follow these steps:
1. Run \`git diff\` to see uncommitted changes, or \`git log --oneline -5\` for recent commits.
2. Analyze the changes for:
   - Correctness: Does the logic make sense? Are there bugs?
   - Security: Any injection risks, exposed secrets, or unsafe patterns?
   - Performance: Any obvious inefficiencies?
   - Style: Does it follow project conventions?
3. Provide structured feedback with specific line references.
4. Suggest improvements where applicable.`,
  },
  {
    id: "explain",
    name: "explain",
    description: "Explain how a file or function works in plain language",
    userInvocable: true,
    always: false,
    location: "builtin",
    content: `When asked to explain code:
1. Read the file or function the user is asking about.
2. Break down the explanation into:
   - **Purpose**: What does this code do at a high level?
   - **How it works**: Step-by-step walkthrough of the logic.
   - **Key dependencies**: What does it rely on?
   - **Usage**: How is it called or used by other parts of the codebase?
3. Use simple, non-technical language where possible.
4. Include relevant code snippets to illustrate points.`,
  },
  {
    id: "test",
    name: "test",
    description: "Run tests and analyze results",
    userInvocable: true,
    always: false,
    location: "builtin",
    content: `When asked to run tests:
1. Detect the testing framework (jest, vitest, mocha, pytest, etc.) from package.json or config files.
2. Run the appropriate test command.
3. If tests fail:
   - Identify which tests failed and why.
   - Look at the failing test code to understand what's expected.
   - Suggest or apply fixes.
4. Report a summary: total tests, passed, failed, skipped.`,
  },
  {
    id: "deploy-check",
    name: "deploy-check",
    description: "Pre-deployment checklist and validation",
    userInvocable: true,
    always: false,
    location: "builtin",
    content: `When asked to check deployment readiness:
1. Run \`git status\` — ensure working directory is clean.
2. Check for any TODO/FIXME/HACK comments in changed files.
3. Verify .env.example is up to date if .env was modified.
4. Check that no debug/console.log statements were left in.
5. Run the build command to verify it compiles.
6. Run tests if available.
7. Check for any security issues (exposed keys, hardcoded secrets).
8. Provide a deploy-readiness summary.`,
  },
  {
    id: "summarize",
    name: "summarize",
    description: "Summarize recent changes or a codebase section",
    userInvocable: true,
    always: false,
    location: "builtin",
    content: `When asked to summarize:
1. If about recent changes: run \`git log --oneline -20\` and \`git diff HEAD~5\`.
2. If about a directory/file: read the relevant files and understand the structure.
3. Provide a concise summary with:
   - What changed and why (for commits)
   - Architecture overview (for code sections)
   - Key files and their responsibilities
   - Any notable patterns or concerns.`,
  },
];
