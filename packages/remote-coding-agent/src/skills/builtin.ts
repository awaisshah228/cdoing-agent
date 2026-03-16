/**
 * Built-in skills that ship with the remote coding agent.
 *
 * These are loaded by default and can be extended by adding
 * more skills in .cdoing/skills/ or ~/.cdoing/skills/.
 */

import type { Skill } from "./types";

export const builtinSkills: Skill[] = [
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
