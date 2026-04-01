/**
 * Shell command path extraction — shared between ShellExecTool and PermissionManager.
 *
 * Heuristically extracts file paths from a shell command and classifies them
 * as read / write / delete operations so permission rules can be applied.
 *
 * Security features:
 *   - POSIX `--` option terminator handling
 *   - Per-command argument position awareness (cp/mv: last arg is destination)
 *   - Redirect and tee detection
 *   - Compound command splitting (&&, ||, ;, |)
 *   - Skips interpreter code args (python -c "code", node -e "code")
 */

import * as path from "path";

/** Commands that READ files */
const READ_COMMANDS  = /\b(?:cat|less|more|head|tail|bat|view|open|code|vim|nano|emacs|pg|nl|od|xxd|strings|file|wc|cksum|md5|sha\w+sum|diff|cmp|sort|uniq|awk|sed|grep|rg|ag|fzf)\b/;
/** Commands that WRITE/MODIFY files */
const WRITE_COMMANDS = /\b(?:cp|mv|install|patch|chmod|chown|chgrp|touch|truncate|split|csplit|sed\s+-i|perl\s+-[pi])\b/;
/** Commands that DELETE files */
const DELETE_COMMANDS = /\b(?:rm|rmdir|del|rd|unlink|shred|trash|git\s+clean)\b/;

/**
 * Commands that take code as an argument (not file paths).
 * When these are detected with their code flag, skip the code argument.
 */
const CODE_ARG_COMMANDS: Record<string, Set<string>> = {
  python:  new Set(["-c"]),
  python3: new Set(["-c"]),
  node:    new Set(["-e", "--eval", "-p", "--print"]),
  ruby:    new Set(["-e"]),
  perl:    new Set(["-e"]),
  php:     new Set(["-r"]),
  lua:     new Set(["-e"]),
  bash:    new Set(["-c"]),
  sh:      new Set(["-c"]),
  zsh:     new Set(["-c"]),
};

/**
 * Flags that consume the next argument as a value (not a file path).
 * Prevents extracting flag values as paths.
 */
const FLAGS_WITH_VALUES: Record<string, Set<string>> = {
  curl: new Set(["-o", "--output", "-d", "--data", "-H", "--header", "-X", "--request", "-u", "--user"]),
  wget: new Set(["-O", "--output-document", "-P", "--directory-prefix"]),
  docker: new Set(["-v", "--volume", "-p", "--publish", "-e", "--env", "--name", "-w", "--workdir"]),
  git: new Set(["-C", "-c", "--git-dir", "--work-tree", "-m", "--message"]),
};

export interface ExtractedPaths {
  read:   string[];
  write:  string[];
  delete: string[];
}

/**
 * Parse command arguments respecting POSIX `--` option terminator.
 * After `--`, all arguments are treated as positional (not flags).
 *
 * Also handles:
 *   - Code flags (-c, -e) that consume the next arg as code, not a path
 *   - Flags with values that consume the next arg
 */
function parseArgs(parts: string[], commandName: string): {
  flags: string[];
  positional: string[];
} {
  const flags: string[] = [];
  const positional: string[] = [];
  let afterDoubleDash = false;
  const codeFlags = CODE_ARG_COMMANDS[commandName];
  const valueFlags = FLAGS_WITH_VALUES[commandName];

  for (let i = 0; i < parts.length; i++) {
    const arg = parts[i];

    if (afterDoubleDash) {
      // Everything after -- is positional
      positional.push(arg);
      continue;
    }

    if (arg === "--") {
      afterDoubleDash = true;
      continue;
    }

    if (arg.startsWith("-")) {
      flags.push(arg);

      // Skip code argument (e.g., python -c "print(1)")
      if (codeFlags?.has(arg) && i + 1 < parts.length) {
        i++; // Skip the code string — it's not a file path
        continue;
      }

      // Skip flag values (e.g., curl -o output.txt)
      if (valueFlags?.has(arg) && i + 1 < parts.length) {
        i++; // Skip the value — handle it based on flag type
        // For output flags, treat as write target
        if (arg === "-o" || arg === "--output" || arg === "-O" || arg === "--output-document") {
          positional.push(parts[i]); // This is actually a write target
        }
        continue;
      }

      // Handle --flag=value format
      if (arg.includes("=")) {
        continue; // Value is embedded in the flag
      }

      continue;
    }

    // Not a flag — it's a positional argument (potential file path)
    positional.push(arg);
  }

  return { flags, positional };
}

/**
 * Extract file paths from a shell command and classify by operation type.
 * Best-effort heuristic — compound commands are split on operators and analyzed per segment.
 */
export function extractShellPaths(command: string, workingDir: string): ExtractedPaths {
  const result: ExtractedPaths = { read: [], write: [], delete: [] };

  const segments = command.split(/\s*(?:&&|\|\||;|\|)\s*/);

  for (const seg of segments) {
    const trimmed = seg.trim();
    if (!trimmed) continue;

    // Split into parts, keeping quoted strings together (basic)
    const parts = trimmed.split(/\s+/).filter(Boolean);
    if (parts.length === 0) continue;

    const commandName = parts[0].replace(/^.*\//, ""); // basename
    const argParts = parts.slice(1);
    const { positional } = parseArgs(argParts, commandName);

    // Filter out things that don't look like file paths
    const args = positional.filter((a) =>
      a !== "" && !a.includes("=") && !a.startsWith("http://") && !a.startsWith("https://")
    );

    const resolvePath = (p: string): string => {
      if (p.startsWith("/") || p.startsWith("~")) return p;
      return path.resolve(workingDir, p);
    };

    if (DELETE_COMMANDS.test(trimmed)) {
      for (const a of args) result.delete.push(resolvePath(a));
    } else if (WRITE_COMMANDS.test(trimmed)) {
      // cp/mv: last arg is destination (write), rest are sources (read)
      if (/\b(?:cp|mv)\b/.test(trimmed) && args.length >= 2) {
        for (let i = 0; i < args.length - 1; i++) result.read.push(resolvePath(args[i]));
        result.write.push(resolvePath(args[args.length - 1]));
      } else {
        for (const a of args) result.write.push(resolvePath(a));
      }
    } else if (READ_COMMANDS.test(trimmed)) {
      for (const a of args) result.read.push(resolvePath(a));
    }

    // Redirect writes: > file, >> file
    let m;
    const redirectRe = />{1,2}\s*([^\s;|&>]+)/g;
    while ((m = redirectRe.exec(trimmed)) !== null) {
      result.write.push(resolvePath(m[1]));
    }

    // tee writes
    const teeRe = /\btee\s+(?:-[a-zA-Z]\s+)*([^\s;|&]+)/g;
    while ((m = teeRe.exec(trimmed)) !== null) {
      result.write.push(resolvePath(m[1]));
    }

    // curl/wget -o output.txt writes (already handled by parseArgs for known commands)
    // But also catch generic patterns
    const outputFlagRe = /\b(?:curl|wget)\b.*?(?:-o|--output)\s+([^\s;|&]+)/g;
    while ((m = outputFlagRe.exec(trimmed)) !== null) {
      result.write.push(resolvePath(m[1]));
    }
  }

  result.read   = [...new Set(result.read)];
  result.write  = [...new Set(result.write)];
  result.delete = [...new Set(result.delete)];

  return result;
}
