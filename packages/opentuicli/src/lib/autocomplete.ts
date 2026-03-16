/**
 * Autocomplete engine — slash commands, @mentions, path completion, tool subcommands
 *
 * Ported from @cdoing/cli UserInput.tsx logic for the OpenTUI terminal.
 */

import * as fs from "fs";
import * as path from "path";

// ── Slash Commands ────────────────────────────────────────

export interface SlashCommand {
  name: string;
  description: string;
}

export const SLASH_COMMANDS: SlashCommand[] = [
  { name: "/help", description: "Show available commands" },
  { name: "/clear", description: "Clear chat history" },
  { name: "/new", description: "Start new conversation" },
  { name: "/model", description: "Show/change model" },
  { name: "/provider", description: "Show/change provider" },
  { name: "/mode", description: "Cycle permission mode" },
  { name: "/usage", description: "Show token usage & cost" },
  { name: "/compact", description: "Compress context" },
  { name: "/config", description: "Show/set configuration" },
  { name: "/dir", description: "Change working directory" },
  { name: "/history", description: "Browse past sessions" },
  { name: "/ls", description: "List conversations" },
  { name: "/resume", description: "Resume conversation by ID" },
  { name: "/view", description: "View a conversation" },
  { name: "/fork", description: "Fork current conversation" },
  { name: "/delete", description: "Delete a conversation" },
  { name: "/plan", description: "Toggle plan mode" },
  { name: "/tasks", description: "Show active tasks" },
  { name: "/memory", description: "Show agent memory" },
  { name: "/permissions", description: "Show permission rules" },
  { name: "/hooks", description: "Show configured hooks" },
  { name: "/rules", description: "Show project rules" },
  { name: "/mcp", description: "MCP server management" },
  { name: "/context", description: "Show context providers" },
  { name: "/effort", description: "Set effort level" },
  { name: "/theme", description: "Switch theme" },
  { name: "/bg", description: "Run in background" },
  { name: "/jobs", description: "Show background jobs" },
  { name: "/login", description: "OAuth login" },
  { name: "/logout", description: "OAuth logout" },
  { name: "/setup", description: "Run setup wizard" },
  { name: "/doctor", description: "Check system health" },
  { name: "/init", description: "Initialize project config" },
  { name: "/exit", description: "Quit the TUI" },
  { name: "/quit", description: "Quit the TUI" },
  { name: "/btw", description: "Ask without adding to history" },
  { name: "/auth-status", description: "Show authentication status" },
  { name: "/queue", description: "Show message queue" },
];

// ── @Mention Providers ────────────────────────────────────

export interface MentionProvider {
  trigger: string;
  description: string;
}

export const MENTION_PROVIDERS: MentionProvider[] = [
  { trigger: "@terminal", description: "Recent terminal output" },
  { trigger: "@url", description: "Fetch URL content" },
  { trigger: "@tree", description: "Project file tree" },
  { trigger: "@codebase", description: "Full codebase context" },
  { trigger: "@clip", description: "Clipboard content" },
  { trigger: "@file", description: "Include a file" },
];

// ── Tool Subcommands ──────────────────────────────────────

const TOOL_SUBCOMMANDS: Record<string, string[]> = {
  npm: ["install", "run", "test", "start", "build", "init", "publish", "uninstall", "update", "ls", "audit", "ci"],
  yarn: ["install", "add", "remove", "run", "build", "test", "start", "dev", "upgrade", "info", "why"],
  pnpm: ["install", "add", "remove", "run", "build", "test", "dev", "update", "store"],
  bun: ["install", "add", "remove", "run", "build", "test", "dev", "init", "create"],
  git: ["status", "add", "commit", "push", "pull", "fetch", "checkout", "branch", "merge", "rebase", "log", "diff", "stash", "reset", "clone", "remote", "tag", "cherry-pick", "bisect", "show", "blame", "reflog"],
  docker: ["build", "run", "exec", "ps", "images", "pull", "push", "stop", "rm", "logs", "compose"],
  python: ["-m", "-c", "--version", "manage.py"],
  python3: ["-m", "-c", "--version", "manage.py"],
  pip: ["install", "uninstall", "freeze", "list", "show"],
  cargo: ["build", "run", "test", "check", "clippy", "fmt", "new", "init", "add", "publish"],
  go: ["build", "run", "test", "get", "mod", "fmt", "vet", "install", "generate"],
  make: ["build", "test", "clean", "install", "all"],
  kubectl: ["get", "describe", "apply", "delete", "logs", "exec", "port-forward", "scale"],
  gh: ["pr", "issue", "repo", "run", "release", "api", "auth", "browse"],
  turbo: ["build", "dev", "test", "lint", "run"],
  npx: ["tsc", "ts-node", "eslint", "prettier", "jest", "vitest", "playwright"],
};

// ── Suggestion Types ──────────────────────────────────────

export interface Suggestion {
  text: string;
  description?: string;
  type: "command" | "mention" | "file" | "subcommand";
}

// ── Autocomplete Logic ────────────────────────────────────

export function getCompletions(input: string, workingDir: string): Suggestion[] {
  if (!input) return [];

  // Slash commands
  if (input.startsWith("/")) {
    return SLASH_COMMANDS
      .filter((c) => c.name.startsWith(input))
      .map((c) => ({ text: c.name, description: c.description, type: "command" as const }));
  }

  // @mentions
  if (input.startsWith("@") || input.includes(" @")) {
    const atIdx = input.lastIndexOf("@");
    const query = input.substring(atIdx);

    const results: Suggestion[] = [];

    // Provider matches
    for (const p of MENTION_PROVIDERS) {
      if (p.trigger.startsWith(query)) {
        results.push({ text: p.trigger, description: p.description, type: "mention" });
      }
    }

    // File matches for @file or bare @
    if (query === "@" || query.startsWith("@file ") || query.startsWith("@f")) {
      const fileQuery = query.startsWith("@file ") ? query.substring(6) : "";
      const files = getProjectFiles(workingDir, fileQuery);
      for (const f of files.slice(0, 10)) {
        results.push({ text: `@file ${f}`, description: "", type: "file" });
      }
    }

    return results;
  }

  // Tool subcommands (e.g. "npm " → show npm subcommands)
  const parts = input.split(" ");
  if (parts.length >= 1) {
    const tool = parts[0];
    const subcommands = TOOL_SUBCOMMANDS[tool];
    if (subcommands && parts.length <= 2) {
      const sub = parts[1] || "";
      return subcommands
        .filter((s) => s.startsWith(sub))
        .map((s) => ({ text: `${tool} ${s}`, description: "", type: "subcommand" as const }));
    }
  }

  // Path completion for shell commands (cd, ls, cat, etc.)
  if (parts.length >= 2) {
    const pathResults = getPathCompletions(input, workingDir);
    if (pathResults.length > 0) {
      const prefix = parts.slice(0, -1).join(" ") + " ";
      return pathResults.map((p) => ({
        text: prefix + p,
        description: p.endsWith("/") ? "directory" : "file",
        type: "file" as const,
      }));
    }
  }

  return [];
}

// ── Ghost Text ────────────────────────────────────────────

export function getGhostText(input: string, workingDir: string): string {
  if (!input) return "";

  // Slash command ghost
  if (input.startsWith("/")) {
    const match = SLASH_COMMANDS.find((c) => c.name.startsWith(input) && c.name !== input);
    return match ? match.name.substring(input.length) : "";
  }

  // @mention ghost
  const atIdx = input.lastIndexOf("@");
  if (atIdx >= 0 && atIdx === input.length - input.substring(atIdx).length) {
    const query = input.substring(atIdx);
    const match = MENTION_PROVIDERS.find((p) => p.trigger.startsWith(query) && p.trigger !== query);
    return match ? match.trigger.substring(query.length) : "";
  }

  return "";
}

// ── Path Completion ───────────────────────────────────────

export function getPathCompletions(input: string, workingDir: string): string[] {
  // Detect path context: commands like cd, ls, cat, etc.
  const pathCommands = ["cd", "ls", "cat", "head", "tail", "less", "more", "vim", "nano", "code", "open", "rm", "cp", "mv", "mkdir", "touch", "chmod"];
  const parts = input.split(" ");
  if (parts.length < 2) return [];

  const cmd = parts[0];
  if (!pathCommands.includes(cmd)) return [];

  const partial = parts[parts.length - 1] || "";
  return readPathEntries(workingDir, partial);
}

function readPathEntries(workingDir: string, partial: string): string[] {
  try {
    const dir = partial.includes("/")
      ? path.resolve(workingDir, partial.substring(0, partial.lastIndexOf("/") + 1))
      : workingDir;
    const prefix = partial.includes("/") ? partial.substring(partial.lastIndexOf("/") + 1) : partial;

    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return [];

    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const base = partial.includes("/") ? partial.substring(0, partial.lastIndexOf("/") + 1) : "";

    return entries
      .filter((e) => !e.name.startsWith(".") || partial.startsWith("."))
      .filter((e) => e.name.toLowerCase().startsWith(prefix.toLowerCase()))
      .sort((a, b) => {
        if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
        return a.name.localeCompare(b.name);
      })
      .slice(0, 20)
      .map((e) => base + e.name + (e.isDirectory() ? "/" : ""));
  } catch {
    return [];
  }
}

function getProjectFiles(workingDir: string, query: string): string[] {
  const results: string[] = [];
  const lower = query.toLowerCase();
  const skipDirs = new Set(["node_modules", ".git", "dist", "build", "__pycache__", ".cache", "coverage"]);

  const walk = (dir: string, rel: string, depth: number) => {
    if (depth > 3 || results.length >= 15) return;
    try {
      const entries = fs.readdirSync(path.join(workingDir, dir), { withFileTypes: true });
      for (const e of entries) {
        if (e.name.startsWith(".") || skipDirs.has(e.name)) continue;
        if (results.length >= 15) break;
        const p = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) {
          if (!query || p.toLowerCase().includes(lower)) results.push(p + "/");
          walk(path.join(dir, e.name), p, depth + 1);
        } else {
          if (!query || p.toLowerCase().includes(lower)) results.push(p);
        }
      }
    } catch { /* skip */ }
  };

  walk("", "", 0);
  return results;
}
