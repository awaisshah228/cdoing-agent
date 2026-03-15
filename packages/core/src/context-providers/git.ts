/**
 * Git Context Provider — @git
 *
 * Provides git context: branch, status, recent commits, blame, log.
 * Usage:
 *   @git              — branch + status + recent commits
 *   @git log 20       — last 20 commits
 *   @git blame file   — blame for a file
 *   @git branch       — all branches
 */

import { exec } from "child_process";
import type { ContextProvider, ContextResult, ContextResolveOptions } from "./types";

export class GitContextProvider implements ContextProvider {
  id = "git";
  trigger = "@git";
  description = "Git context: branch, status, commits, blame";
  requiresArg = false;

  async resolve(arg?: string, options?: ContextResolveOptions): Promise<ContextResult> {
    const workingDir = options?.workingDir || process.cwd();
    const parts = (arg || "").trim().split(/\s+/);
    const subcommand = parts[0] || "";

    try {
      switch (subcommand) {
        case "log": {
          const count = parseInt(parts[1], 10) || 10;
          const log = await run(`git log --oneline -${count}`, workingDir);
          return { label: `Git log (${count})`, content: `## Git Log (last ${count} commits)\n\`\`\`\n${log}\n\`\`\`` };
        }
        case "blame": {
          const file = parts[1];
          if (!file) return { label: "Git blame", content: "Usage: @git blame <file>" };
          const blame = await run(`git blame --line-porcelain "${file}" | grep -E "^(author |summary |\t)" | head -100`, workingDir);
          return { label: `Git blame: ${file}`, content: `## Git Blame: ${file}\n\`\`\`\n${blame}\n\`\`\`` };
        }
        case "branch": {
          const branches = await run("git branch -a --no-color", workingDir);
          return { label: "Git branches", content: `## Git Branches\n\`\`\`\n${branches}\n\`\`\`` };
        }
        default: {
          // Default: branch + status + recent commits
          const [branch, status, log] = await Promise.all([
            run("git branch --show-current", workingDir),
            run("git status --short", workingDir),
            run("git log --oneline -10", workingDir),
          ]);
          const sections = [
            `## Git Context`,
            `**Branch:** ${branch.trim()}`,
            `\n### Status\n\`\`\`\n${status.trim() || "(clean)"}\n\`\`\``,
            `\n### Recent Commits\n\`\`\`\n${log.trim()}\n\`\`\``,
          ];
          return { label: `Git: ${branch.trim()}`, content: sections.join("\n") };
        }
      }
    } catch (err) {
      return { label: "Git", content: `Git error: ${(err as Error).message}` };
    }
  }
}

function run(command: string, cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(command, { cwd, timeout: 10000, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      if (err && !stdout) return reject(new Error(stderr?.trim() || err.message));
      resolve(stdout);
    });
  });
}
