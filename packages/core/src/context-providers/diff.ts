/**
 * Diff Context Provider — @diff
 *
 * Provides current working changes as context.
 * Usage:
 *   @diff           — unstaged working changes
 *   @diff staged    — staged changes
 *   @diff main      — diff against main branch
 */

import { exec } from "child_process";
import type { ContextProvider, ContextResult, ContextResolveOptions } from "./types";

const MAX_DIFF_CHARS = 30000;

export class DiffContextProvider implements ContextProvider {
  id = "diff";
  trigger = "@diff";
  description = "Current git diff (working changes, staged, or vs branch)";
  requiresArg = false;

  async resolve(arg?: string, options?: ContextResolveOptions): Promise<ContextResult> {
    const workingDir = options?.workingDir || process.cwd();
    const target = (arg || "").trim();

    let command = "git diff";
    let label = "Working changes";

    if (target === "staged") {
      command = "git diff --cached";
      label = "Staged changes";
    } else if (target) {
      // Sanitize
      if (!/^[a-zA-Z0-9_.\/~^@{}\-]+$/.test(target)) {
        return { label: "Diff", content: `Invalid git ref: "${target}"` };
      }
      command = `git diff ${target}`;
      label = `Diff vs ${target}`;
    }

    try {
      const diff = await new Promise<string>((resolve, reject) => {
        exec(command, { cwd: workingDir, timeout: 15000, maxBuffer: 5 * 1024 * 1024 }, (err, stdout, stderr) => {
          if (err && !stdout) return reject(new Error(stderr?.trim() || err.message));
          resolve(stdout);
        });
      });

      const trimmedDiff = diff.trim();
      if (!trimmedDiff) {
        return { label, content: `## ${label}\nNo changes.` };
      }

      const truncated = trimmedDiff.length > MAX_DIFF_CHARS
        ? trimmedDiff.substring(0, MAX_DIFF_CHARS) + "\n... [truncated]"
        : trimmedDiff;

      return {
        label,
        content: `## ${label}\n\`\`\`diff\n${truncated}\n\`\`\``,
      };
    } catch (err) {
      return { label: "Diff", content: `Diff error: ${(err as Error).message}` };
    }
  }
}
