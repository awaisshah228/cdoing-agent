/**
 * Shell command path extraction — shared between ShellExecTool and PermissionManager.
 *
 * Heuristically extracts file paths from a shell command and classifies them
 * as read / write / delete operations so permission rules can be applied.
 */

import * as path from "path";

/** Commands that READ files */
const READ_COMMANDS  = /\b(?:cat|less|more|head|tail|bat|view|open|code|vim|nano|emacs|pg|nl|od|xxd|strings|file|wc|cksum|md5|sha\w+sum|diff|cmp|sort|uniq|awk|sed|grep|rg|ag|fzf)\b/;
/** Commands that WRITE/MODIFY files */
const WRITE_COMMANDS = /\b(?:cp|mv|install|patch|chmod|chown|chgrp|touch|truncate|split|csplit|sed\s+-i|perl\s+-[pi])\b/;
/** Commands that DELETE files */
const DELETE_COMMANDS = /\b(?:rm|rmdir|del|rd|unlink|shred|trash|git\s+clean)\b/;

export interface ExtractedPaths {
  read:   string[];
  write:  string[];
  delete: string[];
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

    const parts = trimmed.split(/\s+/).filter((p) => !p.includes("=") || p.startsWith("-"));
    if (parts.length === 0) continue;

    const args = parts.slice(1).filter((a) => !a.startsWith("-") && a !== "");

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
  }

  result.read   = [...new Set(result.read)];
  result.write  = [...new Set(result.write)];
  result.delete = [...new Set(result.delete)];

  return result;
}
