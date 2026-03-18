/**
 * cdoing review — AI Code Review
 *
 * Gets the git diff and sends it to the AI for a structured review with
 * concrete improvement suggestions and patches.
 *
 * Usage:
 *   cdoing review                  — review staged + unstaged changes
 *   cdoing review HEAD~1           — review last commit
 *   cdoing review --staged         — review staged changes only
 *   cdoing review --base main      — review diff from main branch
 *   cdoing review --output json    — JSON output
 */

import { execSync } from "child_process";
import chalk from "chalk";
import { AgentRunner } from "@cdoing/ai";
import { HookManager, MemoryStore, loadProjectConfig } from "@cdoing/core";
import {
  buildModelConfig,
  createPermissionManager,
  resolveApiKey,
  type CLIOptions,
} from "./config";
import { createToolRegistry } from "./tools";

export interface ReviewOptions {
  base?: string;
  staged?: boolean;
  dir: string;
  model?: string;
  provider?: string;
  apiKey?: string;
  mode: string;
  output?: "text" | "json";
  verbose?: boolean;
}

function getDiff(opts: ReviewOptions): { diff: string; source: string } {
  const cwd = opts.dir;

  try {
    if (opts.staged) {
      const diff = execSync("git diff --cached", { cwd, encoding: "utf-8" });
      return { diff, source: "staged changes" };
    }

    if (opts.base) {
      const diff = execSync(`git diff ${opts.base}`, { cwd, encoding: "utf-8" });
      return { diff, source: `diff from ${opts.base}` };
    }

    // Default: staged + unstaged; fall back to last commit if clean
    const staged = execSync("git diff --cached", { cwd, encoding: "utf-8" });
    const unstaged = execSync("git diff", { cwd, encoding: "utf-8" });
    const combined = (staged + unstaged).trim();

    if (combined) {
      return { diff: combined, source: "current changes" };
    }

    // Nothing staged/unstaged — review last commit
    const lastCommit = execSync("git diff HEAD~1 HEAD", { cwd, encoding: "utf-8" });
    return { diff: lastCommit, source: "last commit" };
  } catch (e) {
    return { diff: "", source: "unknown" };
  }
}

function getRecentCommits(dir: string): string {
  try {
    return execSync("git log --oneline -5", { cwd: dir, encoding: "utf-8" }).trim();
  } catch {
    return "";
  }
}

function getFileSummary(diff: string): string {
  const files = new Set<string>();
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ b/") || line.startsWith("--- a/")) {
      const f = line.slice(6);
      if (f !== "/dev/null") files.add(f);
    }
  }
  return [...files].join(", ") || "(unknown files)";
}

const REVIEW_SYSTEM_PROMPT = `You are a senior staff engineer conducting a thorough code review. Analyze the provided git diff and give detailed, actionable feedback.

Structure your review as follows:

## Summary
Brief overview of what changed and the overall quality.

## Issues Found
For each issue, specify:
- **Severity**: Critical / Major / Minor / Nit
- **Location**: file:line
- **Problem**: what's wrong
- **Fix**: concrete code suggestion

## Security Concerns
Any security vulnerabilities, auth issues, data exposure, injection risks.

## Performance
Inefficient algorithms, unnecessary re-renders, N+1 queries, memory leaks.

## Missing Tests
What should be tested but isn't.

## Suggested Improvements
Additional improvements beyond bug fixes — readability, naming, patterns.

## Verdict
Overall: ✅ Approve / ⚠️ Approve with suggestions / ❌ Request changes

Be specific, cite line numbers, include before/after code snippets. Use markdown.`;

export async function runReview(opts: ReviewOptions): Promise<void> {
  console.log();
  console.log(chalk.bold.cyan("  🔍 AI Code Review"));
  console.log(chalk.gray("  ─────────────────────────────────────────"));

  const { diff, source } = getDiff(opts);

  if (!diff.trim()) {
    console.log(chalk.yellow("  No changes to review.\n"));
    console.log(chalk.dim("  Tips:"));
    console.log(chalk.dim("    cdoing review HEAD~1      — review last commit"));
    console.log(chalk.dim("    cdoing review --staged    — review staged changes"));
    console.log(chalk.dim("    cdoing review --base main — review diff from main"));
    console.log();
    return;
  }

  const lines = diff.split("\n").length;
  const files = getFileSummary(diff);
  const commits = getRecentCommits(opts.dir);

  console.log(chalk.white(`  Source:  `) + chalk.cyan(source));
  console.log(chalk.white(`  Files:   `) + chalk.gray(files));
  console.log(chalk.white(`  Lines:   `) + chalk.gray(String(lines)));
  console.log();
  console.log(chalk.dim("  Sending to AI for review..."));
  console.log();

  const cliOpts = {
    model: opts.model,
    provider: opts.provider || "anthropic",
    apiKey: opts.apiKey,
    dir: opts.dir,
    mode: opts.mode || "auto",
  } as CLIOptions;

  await resolveApiKey(cliOpts);

  const modelConfig = buildModelConfig(cliOpts);
  const permissionManager = createPermissionManager(cliOpts);
  const hookManager = new HookManager(opts.dir);
  const memoryStore = new MemoryStore(opts.dir);
  const projectConfig = loadProjectConfig(opts.dir);

  const toolRegistry = await createToolRegistry(opts.dir);
  const agent = new AgentRunner(
    modelConfig,
    toolRegistry,
    permissionManager,
    hookManager,
    {
      systemPrompt: REVIEW_SYSTEM_PROMPT,
      projectConfig: projectConfig || undefined,
      memory: memoryStore.formatForPrompt() || undefined,
    },
  );

  // Truncate very large diffs (keep first 60k chars)
  const truncatedDiff = diff.length > 60000
    ? diff.substring(0, 60000) + "\n\n... (diff truncated at 60k chars)"
    : diff;

  const prompt = [
    commits ? `Recent commits:\n${commits}\n` : "",
    `Please review the following git diff (${source}):\n`,
    "```diff",
    truncatedDiff,
    "```",
  ].filter(Boolean).join("\n");

  if (opts.output === "json") {
    let response = "";
    await agent.run(prompt, {
      onToken: (t) => { response += t; },
      onToolCall: () => {},
      onToolResult: () => {},
      onComplete: () => {
        console.log(JSON.stringify({ review: response, source, files, lines }, null, 2));
      },
      onError: (e) => {
        console.error(JSON.stringify({ error: e.message }));
        process.exit(1);
      },
    });
    return;
  }

  // Streamed text output
  let buffer = "";
  await agent.run(prompt, {
    onToken: (token) => {
      buffer += token;
      const parts = buffer.split("\n");
      for (let i = 0; i < parts.length - 1; i++) {
        process.stdout.write(parts[i] + "\n");
      }
      buffer = parts[parts.length - 1];
    },
    onToolCall: (name) => {
      if (opts.verbose) {
        process.stdout.write(chalk.dim(`\n  [${name}]\n`));
      }
    },
    onToolResult: () => {},
    onComplete: () => {
      if (buffer) process.stdout.write(buffer + "\n");
      console.log();
    },
    onError: (e) => {
      console.error(chalk.red(`\n  ❌ Error: ${e.message}\n`));
      process.exit(1);
    },
  });
}
