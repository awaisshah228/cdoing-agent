import React, { useState, useCallback, useRef } from "react";
import { Box, Text, useInput } from "ink";
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import { getTheme } from "./theme";
import type { ImageAttachment } from "@cdoing/ai";

const SLASH_COMMANDS = [
  { cmd: "/help",        desc: "Show help" },
  { cmd: "/clear",       desc: "Clear conversation" },
  { cmd: "/new",         desc: "New conversation" },
  { cmd: "/ls",          desc: "Browse sessions (interactive TUI)" },
  { cmd: "/history",     desc: "List saved conversations (text)" },
  { cmd: "/resume",      desc: "Resume a conversation" },
  { cmd: "/view",        desc: "View messages in a conversation" },
  { cmd: "/fork",        desc: "Fork current or given conversation" },
  { cmd: "/delete",      desc: "Delete a conversation" },
  { cmd: "/config",      desc: "View/update config" },
  { cmd: "/model",       desc: "Switch model" },
  { cmd: "/provider",    desc: "Switch provider" },
  { cmd: "/mode",        desc: "Change permission mode" },
  { cmd: "/dir",         desc: "Change working directory" },
  { cmd: "/permissions", desc: "View/clear permissions" },
  { cmd: "/memory",      desc: "View/manage memory" },
  { cmd: "/hooks",       desc: "View configured hooks" },
  { cmd: "/usage",       desc: "Token usage" },
  { cmd: "/compact",     desc: "Compact context" },
  { cmd: "/tasks",       desc: "Show task list" },
  { cmd: "/plan",        desc: "Plan mode (approve/reject/show/off)" },
  { cmd: "/effort",      desc: "Set analysis depth" },
  { cmd: "/btw",         desc: "Ask without adding to history" },
  { cmd: "/bg",          desc: "Run prompt as background job" },
  { cmd: "/jobs",        desc: "Show background jobs" },
  { cmd: "/rules",       desc: "View project rules" },
  { cmd: "/mcp",         desc: "MCP server status / interactive picker" },
  { cmd: "/context",     desc: "List context providers" },
  { cmd: "/queue",       desc: "Show message queue" },
  { cmd: "/theme",       desc: "Switch theme (dark/light/auto)" },
  { cmd: "/setup",       desc: "View & change provider / model / API key" },
  { cmd: "/doctor",      desc: "Check system health" },
  { cmd: "/index",       desc: "Index codebase for search" },
  { cmd: "/init",        desc: "Initialize project" },
  { cmd: "/login",       desc: "Open setup wizard to authenticate" },
  { cmd: "/logout",      desc: "Clear OAuth tokens" },
  { cmd: "/auth-status", desc: "Show auth status" },
  { cmd: "/exit",        desc: "Quit" },
];

const AT_PROVIDERS = [
  { cmd: "@terminal", desc: "Recent terminal output" },
  { cmd: "@url",      desc: "Fetch a URL  (@url https://...)" },
  { cmd: "@tree",     desc: "Project file tree" },
  { cmd: "@codebase", desc: "Full codebase context" },
  { cmd: "@clip",     desc: "Paste clipboard content" },
  { cmd: "@file",     desc: "Include a file's contents  (@file src/foo.ts)" },
];

// Shell commands that always take a path argument (hardcoded core set)
const PATH_COMMANDS_CORE = new Set([
  "cd", "ls", "ll", "la", "cat", "less", "more", "head", "tail",
  "vim", "vi", "nvim", "nano", "code", "open",
  "cp", "mv", "rm", "mkdir", "rmdir", "touch", "ln", "chmod", "chown",
  "diff", "wc", "file", "stat", "find",
]);

// Lazily resolved: all executable names found on $PATH
let _pathBinaries: Set<string> | null = null;
function getPathBinaries(): Set<string> {
  if (_pathBinaries) return _pathBinaries;
  _pathBinaries = new Set(PATH_COMMANDS_CORE);
  try {
    const dirs = (process.env.PATH || "").split(path.delimiter).filter(Boolean);
    for (const dir of dirs) {
      try {
        const entries = fs.readdirSync(dir);
        for (const e of entries) _pathBinaries.add(e);
      } catch { /* skip unreadable dir */ }
    }
  } catch { /* ignore */ }
  return _pathBinaries;
}

// ── Tool / subcommand suggestions ────────────────────────────────────────────

interface SubcmdSuggestion { cmd: string; desc: string; }

const TOOL_SUBCOMMANDS: Record<string, SubcmdSuggestion[]> = {
  npm: [
    { cmd: "install",   desc: "Install dependencies" },
    { cmd: "install -g",desc: "Install package globally" },
    { cmd: "run",       desc: "Run a script" },
    { cmd: "run dev",   desc: "Start dev server" },
    { cmd: "run build", desc: "Build project" },
    { cmd: "run test",  desc: "Run tests" },
    { cmd: "run lint",  desc: "Lint code" },
    { cmd: "start",     desc: "Start application" },
    { cmd: "test",      desc: "Run tests" },
    { cmd: "publish",   desc: "Publish package" },
    { cmd: "update",    desc: "Update dependencies" },
    { cmd: "uninstall", desc: "Remove a package" },
    { cmd: "ls",        desc: "List installed packages" },
    { cmd: "audit",     desc: "Security audit" },
    { cmd: "outdated",  desc: "Show outdated packages" },
    { cmd: "init",      desc: "Create package.json" },
    { cmd: "ci",        desc: "Clean install" },
  ],
  npx: [
    { cmd: "create-react-app", desc: "Create React app" },
    { cmd: "create-next-app",  desc: "Create Next.js app" },
    { cmd: "tsc",              desc: "TypeScript compiler" },
    { cmd: "eslint",           desc: "Run ESLint" },
    { cmd: "prettier",         desc: "Format code" },
  ],
  yarn: [
    { cmd: "install",   desc: "Install dependencies" },
    { cmd: "add",       desc: "Add a package" },
    { cmd: "add -D",    desc: "Add dev dependency" },
    { cmd: "remove",    desc: "Remove a package" },
    { cmd: "run dev",   desc: "Start dev server" },
    { cmd: "run build", desc: "Build project" },
    { cmd: "run test",  desc: "Run tests" },
    { cmd: "upgrade",   desc: "Upgrade packages" },
    { cmd: "workspace", desc: "Run command in workspace" },
    { cmd: "workspaces",desc: "Run command in all workspaces" },
  ],
  pnpm: [
    { cmd: "install",   desc: "Install dependencies" },
    { cmd: "add",       desc: "Add a package" },
    { cmd: "add -D",    desc: "Add dev dependency" },
    { cmd: "remove",    desc: "Remove a package" },
    { cmd: "run dev",   desc: "Start dev server" },
    { cmd: "run build", desc: "Build project" },
    { cmd: "run test",  desc: "Run tests" },
  ],
  git: [
    { cmd: "status",          desc: "Show working tree status" },
    { cmd: "add .",           desc: "Stage all changes" },
    { cmd: "add -p",          desc: "Interactive staging" },
    { cmd: "commit -m",       desc: "Commit with message" },
    { cmd: "push",            desc: "Push to remote" },
    { cmd: "pull",            desc: "Pull from remote" },
    { cmd: "checkout",        desc: "Switch branch / restore file" },
    { cmd: "checkout -b",     desc: "Create and switch branch" },
    { cmd: "branch",          desc: "List / create branches" },
    { cmd: "branch -d",       desc: "Delete branch" },
    { cmd: "merge",           desc: "Merge branch" },
    { cmd: "rebase",          desc: "Rebase onto branch" },
    { cmd: "log --oneline",   desc: "Compact commit log" },
    { cmd: "diff",            desc: "Show unstaged diff" },
    { cmd: "diff --staged",   desc: "Show staged diff" },
    { cmd: "stash",           desc: "Stash changes" },
    { cmd: "stash pop",       desc: "Apply stashed changes" },
    { cmd: "fetch",           desc: "Fetch from remote" },
    { cmd: "remote -v",       desc: "List remotes" },
    { cmd: "clone",           desc: "Clone repository" },
    { cmd: "init",            desc: "Initialize repository" },
    { cmd: "reset --hard",    desc: "Discard all local changes" },
    { cmd: "cherry-pick",     desc: "Apply specific commit" },
    { cmd: "tag",             desc: "Create / list tags" },
  ],
  gh: [
    { cmd: "pr create",     desc: "Create pull request" },
    { cmd: "pr list",       desc: "List pull requests" },
    { cmd: "pr checkout",   desc: "Check out pull request" },
    { cmd: "pr merge",      desc: "Merge pull request" },
    { cmd: "issue create",  desc: "Create issue" },
    { cmd: "issue list",    desc: "List issues" },
    { cmd: "repo clone",    desc: "Clone repository" },
    { cmd: "run list",      desc: "List workflow runs" },
    { cmd: "run view",      desc: "View workflow run" },
    { cmd: "auth login",    desc: "Authenticate with GitHub" },
  ],
  python: [
    { cmd: "-m venv",          desc: "Create virtual environment" },
    { cmd: "-m pip install",   desc: "Install packages" },
    { cmd: "-m pip freeze",    desc: "List installed packages" },
    { cmd: "-m pytest",        desc: "Run tests" },
    { cmd: "-m http.server",   desc: "Start HTTP server" },
    { cmd: "-c",               desc: "Execute inline code" },
  ],
  python3: [
    { cmd: "-m venv",          desc: "Create virtual environment" },
    { cmd: "-m pip install",   desc: "Install packages" },
    { cmd: "-m pip freeze",    desc: "List installed packages" },
    { cmd: "-m pytest",        desc: "Run tests" },
    { cmd: "-m http.server",   desc: "Start HTTP server" },
    { cmd: "-c",               desc: "Execute inline code" },
  ],
  pip: [
    { cmd: "install",   desc: "Install package" },
    { cmd: "install -r requirements.txt", desc: "Install from requirements" },
    { cmd: "uninstall", desc: "Uninstall package" },
    { cmd: "list",      desc: "List packages" },
    { cmd: "freeze",    desc: "Output installed packages" },
    { cmd: "show",      desc: "Show package info" },
    { cmd: "search",    desc: "Search PyPI" },
  ],
  pip3: [
    { cmd: "install",   desc: "Install package" },
    { cmd: "install -r requirements.txt", desc: "Install from requirements" },
    { cmd: "uninstall", desc: "Uninstall package" },
    { cmd: "list",      desc: "List packages" },
    { cmd: "freeze",    desc: "Output installed packages" },
  ],
  docker: [
    { cmd: "ps",              desc: "List running containers" },
    { cmd: "ps -a",           desc: "List all containers" },
    { cmd: "images",          desc: "List images" },
    { cmd: "build -t",        desc: "Build image" },
    { cmd: "run",             desc: "Run container" },
    { cmd: "run -it",         desc: "Run interactive container" },
    { cmd: "exec -it",        desc: "Exec into container" },
    { cmd: "stop",            desc: "Stop container" },
    { cmd: "rm",              desc: "Remove container" },
    { cmd: "rmi",             desc: "Remove image" },
    { cmd: "pull",            desc: "Pull image" },
    { cmd: "push",            desc: "Push image" },
    { cmd: "logs",            desc: "Show container logs" },
    { cmd: "compose up",      desc: "Start compose services" },
    { cmd: "compose down",    desc: "Stop compose services" },
    { cmd: "compose build",   desc: "Build compose services" },
  ],
  kubectl: [
    { cmd: "get pods",          desc: "List pods" },
    { cmd: "get services",      desc: "List services" },
    { cmd: "get deployments",   desc: "List deployments" },
    { cmd: "describe pod",      desc: "Describe pod" },
    { cmd: "apply -f",          desc: "Apply config file" },
    { cmd: "delete -f",         desc: "Delete from config file" },
    { cmd: "logs",              desc: "Print pod logs" },
    { cmd: "exec -it",          desc: "Exec into pod" },
    { cmd: "port-forward",      desc: "Forward port" },
    { cmd: "rollout status",    desc: "Check rollout status" },
    { cmd: "scale",             desc: "Scale deployment" },
  ],
  cargo: [
    { cmd: "build",      desc: "Build package" },
    { cmd: "build --release", desc: "Build release" },
    { cmd: "run",        desc: "Run binary" },
    { cmd: "test",       desc: "Run tests" },
    { cmd: "add",        desc: "Add dependency" },
    { cmd: "check",      desc: "Type-check without build" },
    { cmd: "fmt",        desc: "Format code" },
    { cmd: "clippy",     desc: "Run linter" },
    { cmd: "update",     desc: "Update dependencies" },
    { cmd: "publish",    desc: "Publish crate" },
  ],
  go: [
    { cmd: "run",        desc: "Run Go program" },
    { cmd: "build",      desc: "Build package" },
    { cmd: "test",       desc: "Run tests" },
    { cmd: "test ./...", desc: "Run all tests" },
    { cmd: "mod tidy",   desc: "Clean up modules" },
    { cmd: "mod init",   desc: "Initialize module" },
    { cmd: "get",        desc: "Add dependency" },
    { cmd: "fmt",        desc: "Format code" },
    { cmd: "vet",        desc: "Vet code" },
    { cmd: "install",    desc: "Install package" },
  ],
  turbo: [
    { cmd: "run build",  desc: "Build all packages" },
    { cmd: "run dev",    desc: "Dev all packages" },
    { cmd: "run test",   desc: "Test all packages" },
    { cmd: "run lint",   desc: "Lint all packages" },
    { cmd: "prune",      desc: "Prune for deployment" },
  ],
  bun: [
    { cmd: "install",    desc: "Install dependencies" },
    { cmd: "add",        desc: "Add a package" },
    { cmd: "add -d",     desc: "Add dev dependency" },
    { cmd: "remove",     desc: "Remove a package" },
    { cmd: "run dev",    desc: "Start dev server" },
    { cmd: "run build",  desc: "Build project" },
    { cmd: "run test",   desc: "Run tests" },
    { cmd: "test",       desc: "Run tests (built-in)" },
    { cmd: "init",       desc: "Create package.json" },
    { cmd: "create",     desc: "Create from template" },
    { cmd: "upgrade",    desc: "Upgrade packages" },
  ],
  deno: [
    { cmd: "run",        desc: "Run a script" },
    { cmd: "test",       desc: "Run tests" },
    { cmd: "fmt",        desc: "Format code" },
    { cmd: "lint",       desc: "Lint code" },
    { cmd: "compile",    desc: "Compile to executable" },
    { cmd: "task",       desc: "Run a task" },
    { cmd: "install",    desc: "Install dependency" },
    { cmd: "check",      desc: "Type-check" },
  ],
  make: [
    { cmd: "all",        desc: "Build all targets" },
    { cmd: "clean",      desc: "Clean build artifacts" },
    { cmd: "install",    desc: "Install" },
    { cmd: "test",       desc: "Run tests" },
    { cmd: "build",      desc: "Build" },
  ],
  cat: [
    { cmd: "-n",         desc: "Show line numbers" },
  ],
  ls: [
    { cmd: "-la",        desc: "Long format, show hidden" },
    { cmd: "-lh",        desc: "Long format, human sizes" },
    { cmd: "-R",         desc: "Recursive listing" },
    { cmd: "-t",         desc: "Sort by time" },
  ],
  grep: [
    { cmd: "-r",         desc: "Recursive search" },
    { cmd: "-rn",        desc: "Recursive with line numbers" },
    { cmd: "-i",         desc: "Case insensitive" },
    { cmd: "-l",         desc: "Files with matches only" },
    { cmd: "-c",         desc: "Count matches" },
  ],
  find: [
    { cmd: ". -name",    desc: "Find by name" },
    { cmd: ". -type f",  desc: "Find files only" },
    { cmd: ". -type d",  desc: "Find directories only" },
    { cmd: ". -mtime",   desc: "Find by modification time" },
  ],
  curl: [
    { cmd: "-X GET",     desc: "GET request" },
    { cmd: "-X POST",    desc: "POST request" },
    { cmd: "-H",         desc: "Add header" },
    { cmd: "-d",         desc: "Send data" },
    { cmd: "-o",         desc: "Save to file" },
    { cmd: "-s",         desc: "Silent mode" },
    { cmd: "-v",         desc: "Verbose output" },
  ],
};

// ── Path helpers ─────────────────────────────────────────────────────────────

interface PathEntry {
  name: string;
  isDir: boolean;
  /** The full replacement value for the input (e.g. "cd packages/") */
  full: string;
}

function readPathEntries(partial: string, workingDir: string, cmdPrefix: string): PathEntry[] {
  try {
    const resolved = path.resolve(workingDir, partial);
    const isDir    = partial.endsWith("/") || partial === "";
    const dir      = isDir ? resolved : path.dirname(resolved);
    const prefix   = isDir ? "" : path.basename(resolved).toLowerCase();

    if (!fs.existsSync(dir)) return [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    return entries
      .filter((e) => !e.name.startsWith(".") || prefix.startsWith("."))
      .filter((e) => prefix === "" || e.name.toLowerCase().startsWith(prefix))
      .slice(0, 40)
      .map((e) => {
        const rel = path.join(path.relative(workingDir, dir), e.name);
        const suffix = e.isDirectory() ? "/" : "";
        return {
          name: e.name + suffix,
          isDir: e.isDirectory(),
          full: cmdPrefix + rel + suffix,
        };
      });
  } catch {
    return [];
  }
}


function getProjectFiles(workingDir: string, partial: string): { cmd: string; desc: string }[] {
  const results: { cmd: string; desc: string }[] = [];
  const IGNORE = new Set(["node_modules", "dist", ".git", ".next", "build", ".turbo", "coverage"]);

  function walk(dir: string, prefix: string, depth: number) {
    if (depth > 2) return;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const e of entries) {
        if (IGNORE.has(e.name)) continue;
        if (e.name.startsWith(".") && !partial.startsWith(".")) continue;
        const rel = prefix ? `${prefix}/${e.name}` : e.name;
        const matchStr = rel.toLowerCase();
        const partialLower = partial.toLowerCase();
        if (!partial || matchStr.includes(partialLower) || e.name.toLowerCase().startsWith(partialLower)) {
          results.push({
            cmd: "@file " + rel + (e.isDirectory() ? "/" : ""),
            desc: e.isDirectory() ? "dir" : "file",
          });
        }
        if (e.isDirectory()) walk(path.join(dir, e.name), rel, depth + 1);
        if (results.length >= 30) return;
      }
    } catch {}
  }

  walk(workingDir, "", 0);
  return results.slice(0, 20);
}

function getFirstPathCompletion(partial: string, workingDir: string): string {
  try {
    const resolved = path.resolve(workingDir, partial);
    const isDir    = partial.endsWith("/") || partial === "";
    const dir      = isDir ? resolved : path.dirname(resolved);
    const prefix   = isDir ? "" : path.basename(resolved).toLowerCase();
    if (!fs.existsSync(dir)) return "";
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const match = entries.find(
      (e) => !e.name.startsWith(".") && (prefix === "" || e.name.toLowerCase().startsWith(prefix)),
    );
    if (!match) return "";
    const rel = path.join(path.relative(workingDir, dir), match.name);
    return rel + (match.isDirectory() ? "/" : "");
  } catch {
    return "";
  }
}

// ── Ghost suggestion ──────────────────────────────────────────────────────────

interface GhostResult { suffix: string; full: string; }

function computeGhost(line: string, history: string[], workingDir: string): GhostResult | null {
  if (!line) return null;

  for (const h of history) {
    if (h.startsWith(line) && h !== line) return { suffix: h.slice(line.length), full: h };
  }

  if (line.startsWith("/")) {
    const match = SLASH_COMMANDS.find((c) => c.cmd.startsWith(line) && c.cmd !== line);
    if (match) return { suffix: match.cmd.slice(line.length), full: match.cmd };
  }

  const atMatch = line.match(/@(\S*)$/);
  if (atMatch) {
    const atToken = "@" + atMatch[1];
    const fileArgMatch = line.match(/@file\s+(\S*)$/);
    if (fileArgMatch) {
      const completed = getFirstPathCompletion(fileArgMatch[1], workingDir);
      if (completed) {
        const full = line.replace(/@file\s+\S*$/, "@file " + completed);
        return { suffix: full.slice(line.length), full };
      }
      return null;
    }
    const match = AT_PROVIDERS.find((p) => p.cmd.startsWith(atToken) && p.cmd !== atToken);
    if (match) {
      const full = line.replace(/@\S*$/, match.cmd);
      return { suffix: full.slice(line.length), full };
    }
  }

  const shellPathMatch = line.match(/^(!?\w[\w\-]*\s+)(\S+)$/);
  if (shellPathMatch) {
    const prefix = shellPathMatch[1];
    const partial = shellPathMatch[2];
    const completed = getFirstPathCompletion(partial, workingDir);
    if (completed && completed !== partial) {
      const full = prefix + completed;
      return { suffix: full.slice(line.length), full };
    }
  }

  return null;
}

/**
 * Detect if the current input is a shell command that wants path completions.
 * Returns { cmdPrefix, partial } or null.
 */
function detectPathContext(line: string): { cmdPrefix: string; partial: string } | null {
  // Match: (optional !) + command + space + optional partial path
  const m = line.match(/^(!?)(\w[\w\-]*)(\s+)(\S*)$/);
  if (!m) {
    // "cd " with trailing space, no path yet
    const m2 = line.match(/^(!?)(\w[\w\-]*)(\s+)$/);
    if (m2) {
      const cmd = m2[2].toLowerCase();
      if (PATH_COMMANDS_CORE.has(cmd) || getPathBinaries().has(cmd)) {
        return { cmdPrefix: m2[1] + m2[2] + m2[3], partial: "" };
      }
    }
    return null;
  }
  const cmd = m[2].toLowerCase();
  // Only show path completions for core path commands or binaries on $PATH
  // that are NOT tools with their own subcommand suggestions
  if (TOOL_SUBCOMMANDS[cmd]) return null;
  if (!PATH_COMMANDS_CORE.has(cmd) && !getPathBinaries().has(cmd)) return null;
  return { cmdPrefix: m[1] + m[2] + m[3], partial: m[4] };
}

// ── PathMenu component ────────────────────────────────────────────────────────

interface PathMenuProps {
  entries: PathEntry[];
  selectedIdx: number;
  label: string;
}

const PathMenu: React.FC<PathMenuProps> = ({ entries, selectedIdx, label }) => {
  const t = getTheme();
  const termWidth = process.stdout.columns || 100;
  const padWidth  = 2;

  const maxName   = Math.max(...entries.map((e) => e.name.length), 4);
  const colWidth  = Math.min(maxName + padWidth, Math.floor(termWidth / 2));
  const numCols   = Math.max(1, Math.floor((termWidth - 4) / colWidth));

  const rows: PathEntry[][] = [];
  for (let i = 0; i < entries.length; i += numCols) {
    rows.push(entries.slice(i, i + numCols));
  }

  return (
    <Box flexDirection="column" paddingLeft={2}>
      <Text dimColor={t.useDim} color={t.textDim}>{label}</Text>
      {rows.map((row, rowIdx) => (
        <Box key={rowIdx} flexDirection="row">
          {row.map((e, colIdx) => {
            const globalIdx = rowIdx * numCols + colIdx;
            const isSelected = globalIdx === selectedIdx;
            const padded = e.name.padEnd(colWidth);
            return isSelected ? (
              <Text key={e.full} backgroundColor={t.selectedBg} color={t.selected === "white" ? "black" : t.selected}>{padded}</Text>
            ) : (
              <Text key={e.full} color={e.isDir ? t.accent : t.text}>{padded}</Text>
            );
          })}
        </Box>
      ))}
      <Text dimColor={t.useDim} color={t.textDim}>{"Tab=cycle  →=accept  ESC=close"}</Text>
    </Box>
  );
};

// ── Suggestion icon helpers ───────────────────────────────────────────────────

function getSuggestionColor(s: { cmd: string; desc: string }): string {
  const t = getTheme();
  if (s.cmd.startsWith("@file")) return t.suggestionFile;
  if (s.cmd.startsWith("@")) return t.suggestionProvider;
  const toolMatch = s.cmd.match(/^!?(\w[\w-]*)\s/);
  if (toolMatch && TOOL_SUBCOMMANDS[toolMatch[1].toLowerCase()]) return t.suggestionTool;
  return t.suggestionDefault;
}

// ── Component ─────────────────────────────────────────────────────────────────

interface UserInputProps {
  isProcessing: boolean;
  queueLength: number;
  workingDir: string;
  permissionMode: string;
  onSubmit: (value: string, images?: ImageAttachment[]) => void;
  onCancel: () => void;
  onModeChange: (mode: string) => void;
}

export const UserInput: React.FC<UserInputProps> = ({
  isProcessing,
  queueLength: _queueLength,
  workingDir,
  permissionMode,
  onSubmit,
  onCancel,
  onModeChange,
}) => {
  const [input, setInput]           = useState("");
  const [history, setHistory]       = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);

  // Vertical dropdown for /commands and @providers
  const [suggestions, setSuggestions]           = useState<{ cmd: string; desc: string }[]>([]);
  const [selectedSuggestion, setSelectedSuggestion] = useState(-1);

  // Horizontal zsh-style path menu
  const [pathEntries, setPathEntries]       = useState<PathEntry[]>([]);
  const [selectedPath, setSelectedPath]     = useState(0);
  const [pathContext, setPathContext]        = useState<{ cmdPrefix: string; partial: string } | null>(null);

  // Inline ghost
  const [ghost, setGhost] = useState<GhostResult | null>(null);

  // Clipboard images pending submission
  const [pendingImages, setPendingImages] = useState<ImageAttachment[]>([]);
  const imageCountRef = useRef(0);

  const clearAll = () => {
    setSuggestions([]);
    setSelectedSuggestion(-1);
    setPathEntries([]);
    setSelectedPath(0);
    setPathContext(null);
    setGhost(null);
  };

  const updateAll = useCallback((line: string, hist: string[]) => {
    // ── /commands dropdown ──
    if (line.startsWith("/")) {
      const matches = SLASH_COMMANDS.filter((c) => c.cmd.startsWith(line) && c.cmd !== line);
      setSuggestions(matches);
      setSelectedSuggestion(0);
      setPathEntries([]);
      setPathContext(null);
      setGhost(computeGhost(line, hist, workingDir));
      return;
    }

    // ── @provider / file dropdown ──
    const atMatch = line.match(/@(\S*)$/);
    if (atMatch) {
      const partial = atMatch[1]; // everything after @

      // Match providers
      const providerMatches = AT_PROVIDERS.filter((p) =>
        partial === "" || p.cmd.slice(1).toLowerCase().startsWith(partial.toLowerCase())
      );
      // Project files — displayed as @path (inserted as @file path)
      const fileMatches = getProjectFiles(workingDir, partial);

      const combined = [...providerMatches, ...fileMatches].slice(0, 50);
      setSuggestions(combined);
      setSelectedSuggestion(0);
      setPathEntries([]);
      setPathContext(null);
      setGhost(null);
      return;
    }

    // ── Tool subcommand suggestions (npm, git, python, docker…) ──
    // Matches: "npm " or "!git " or "npm ins" etc.
    const toolMatch = line.match(/^!?(\w[\w-]*)(\s+)(\S*)$/);
    if (toolMatch) {
      const tool = toolMatch[1].toLowerCase();
      const subcmdPartial = toolMatch[3].toLowerCase();
      const subcmds = TOOL_SUBCOMMANDS[tool];
      if (subcmds) {
        const matches = subcmds.filter((s) =>
          subcmdPartial === "" || s.cmd.toLowerCase().startsWith(subcmdPartial)
        );
        if (matches.length > 0) {
          // Prefix each suggestion with the tool name so acceptSuggestion inserts correctly
          const prefixed = matches.map((s) => ({
            cmd: (line.startsWith("!") ? "!" : "") + tool + " " + s.cmd,
            desc: s.desc,
          }));
          setSuggestions(prefixed.slice(0, 10));
          setSelectedSuggestion(0);
          setPathEntries([]);
          setPathContext(null);
          setGhost(null);
          return;
        }
      }
    }

    // ── Path completion for shell commands (cd, ls, vim…) ──
    const pc = detectPathContext(line);
    if (pc) {
      const entries = readPathEntries(pc.partial, workingDir, pc.cmdPrefix);
      setSuggestions([]);
      setSelectedSuggestion(-1);
      setPathEntries(entries);
      setSelectedPath(0);
      setPathContext(pc);
      setGhost(computeGhost(line, hist, workingDir));
      return;
    }

    setSuggestions([]);
    setSelectedSuggestion(-1);
    setPathEntries([]);
    setPathContext(null);
    setGhost(computeGhost(line, hist, workingDir));
  }, [workingDir]);

  const acceptSuggestion = useCallback((chosen: { cmd: string; desc: string }, submit = false) => {
    let newVal: string;
    if (chosen.cmd.startsWith("@")) {
      newVal = input.replace(/@\S*$/, chosen.cmd);
      // directories keep the "/" but no space — continue drilling in
      if (!newVal.endsWith("/")) newVal += " ";
    } else {
      newVal = chosen.cmd + " ";
    }
    setInput(newVal);
    if (submit) {
      setHistory((h) => [newVal.trim(), ...h].slice(0, 200));
      setHistoryIdx(-1);
      setInput("");
      clearAll();
      onSubmit(newVal.trim());
    } else {
      // re-run updateAll so directory drilldown populates new suggestions
      updateAll(newVal, history);
    }
  }, [input, history, workingDir, onSubmit, updateAll]);

  useInput((char, key) => {
    // Ctrl+L — clear screen
    if (key.ctrl && char === "l") {
      process.stdout.write("\x1b[2J\x1b[H");
      return;
    }

    // Ctrl+V — paste from clipboard (text or image)
    if (key.ctrl && char === "v") {
      try {
        // First, try to get clipboard image (macOS only for now)
        if (process.platform === "darwin") {
          try {
            // Check if clipboard has image data
            const hasImage = execSync(
              `osascript -e 'clipboard info' 2>/dev/null | grep -q "TIFF\\|PNG\\|JPEG"  && echo "yes" || echo "no"`,
              { encoding: "utf-8", timeout: 1000 },
            ).trim();

            if (hasImage === "yes") {
              // Extract clipboard image as PNG base64
              const base64 = execSync(
                `osascript -e 'set theImage to the clipboard as «class PNGf»' -e 'return theImage' 2>/dev/null | base64`,
                { encoding: "utf-8", timeout: 3000, maxBuffer: 20 * 1024 * 1024 },
              ).trim();

              if (base64 && base64.length > 100) {
                imageCountRef.current += 1;
                setPendingImages((prev) => [...prev, { data: base64, mimeType: "image/png" }]);
                const placeholder = `[Image #${imageCountRef.current} pasted]`;
                const next = input + placeholder;
                setInput(next);
                updateAll(next, history);
                return;
              }
            }
          } catch { /* not an image, fall through to text paste */ }
        }

        // Fall back to text paste
        let pasted = "";
        try {
          pasted = execSync("pbpaste", { encoding: "utf-8", timeout: 500 }).trim();
        } catch {
          try {
            pasted = execSync("xclip -o -selection clipboard", { encoding: "utf-8", timeout: 500 }).trim();
          } catch {
            try {
              pasted = execSync("xsel -ob", { encoding: "utf-8", timeout: 500 }).trim();
            } catch { /* no clipboard tool */ }
          }
        }

        if (pasted) {
          const cleaned = pasted.replace(/\n/g, " ").replace(/\r/g, "");
          const next = input + cleaned;
          setInput(next);
          updateAll(next, history);
        }
      } catch { /* skip on any error */ }
      return;
    }

    // Shift+Tab — cycle permission mode
    if (char === "\x1b[Z") {
      const modes = ["ask", "auto-edit", "auto"];
      const idx = modes.indexOf(permissionMode);
      const next = modes[(idx + 1) % modes.length];
      onModeChange(next);
      return;
    }

    // ESC
    if (key.escape) {
      if (suggestions.length > 0 || pathEntries.length > 0) { clearAll(); return; }
      if (ghost) { setGhost(null); return; }
      if (isProcessing) onCancel();
      return;
    }

    // ── Path menu navigation — Tab cycles, → accepts, Enter always submits ──
    if (pathEntries.length > 0) {
      if (key.tab) {
        const next = (selectedPath + 1) % pathEntries.length;
        setSelectedPath(next);
        const entry = pathEntries[next];
        setGhost({ suffix: entry.full.slice(input.length), full: entry.full });
        return;
      }
      if (key.rightArrow || (char === "\x05")) {
        // → accepts the highlighted entry into the input
        const entry = pathEntries[selectedPath];
        if (entry) {
          setInput(entry.full);
          setPathEntries([]);
          setPathContext(null);
          setGhost(null);
          if (entry.isDir) updateAll(entry.full, history);
        }
        return;
      }
      if (key.upArrow) {
        setSelectedPath((p) => (p - 1 + pathEntries.length) % pathEntries.length);
        return;
      }
      if (key.downArrow) {
        setSelectedPath((p) => (p + 1) % pathEntries.length);
        return;
      }
      // Enter falls through to the normal submit logic below
    }

    // → accept ghost
    if ((key.rightArrow || (char === "\x05")) && ghost && suggestions.length === 0 && pathEntries.length === 0) {
      setInput(ghost.full);
      setGhost(computeGhost(ghost.full, history, workingDir));
      return;
    }

    // Tab — dropdown or ghost
    if (key.tab) {
      if (suggestions.length > 0) {
        const idx = selectedSuggestion >= 0 ? selectedSuggestion : 0;
        const chosen = suggestions[idx];
        if (chosen) acceptSuggestion(chosen);
      } else if (ghost) {
        setInput(ghost.full);
        setSuggestions([]);
        setGhost(computeGhost(ghost.full, history, workingDir));
      }
      return;
    }

    // Ctrl+Arrow keys are reserved for ScrollBox scrolling — don't handle here
    if (key.ctrl && (key.upArrow || key.downArrow)) return;

    // Dropdown navigation
    if (suggestions.length > 0) {
      if (key.upArrow) {
        setSelectedSuggestion((s) => (s <= 0 ? suggestions.length - 1 : s - 1));
        return;
      }
      if (key.downArrow) {
        setSelectedSuggestion((s) => (s >= suggestions.length - 1 ? 0 : s + 1));
        return;
      }
      if (key.return) {
        const chosen = suggestions[selectedSuggestion >= 0 ? selectedSuggestion : 0];
        if (chosen) acceptSuggestion(chosen, chosen.cmd.startsWith("/"));
        return;
      }
    } else {
      // History navigation
      if (key.upArrow) {
        const nextIdx = Math.min(historyIdx + 1, history.length - 1);
        setHistoryIdx(nextIdx);
        const val = history[nextIdx] || "";
        setInput(val);
        updateAll(val, history);
        return;
      }
      if (key.downArrow) {
        const nextIdx = Math.max(historyIdx - 1, -1);
        setHistoryIdx(nextIdx);
        const val = nextIdx >= 0 ? history[nextIdx] : "";
        setInput(val);
        updateAll(val, history);
        return;
      }
    }

    // Enter — submit
    if (key.return) {
      const trimmed = input.trim();
      if (!trimmed && pendingImages.length === 0) return;
      const newHistory = [trimmed, ...history].slice(0, 200);
      const imgs = pendingImages.length > 0 ? [...pendingImages] : undefined;
      clearAll();
      setHistory(newHistory);
      setHistoryIdx(-1);
      setInput("");
      setPendingImages([]);
      onSubmit(trimmed || "Describe this image.", imgs);
      return;
    }

    // Backspace
    if (key.backspace || key.delete) {
      const next = input.slice(0, -1);
      setInput(next);
      updateAll(next, history);
      return;
    }

    // Regular character
    if (char && !key.ctrl && !key.meta) {
      const next = input + char;
      setInput(next);
      updateAll(next, history);
    }
  });

  // Compute windowed suggestions (used in render)
  const WINDOW = 8;
  const sel = selectedSuggestion >= 0 ? selectedSuggestion : 0;
  const windowStart = suggestions.length > 0
    ? Math.max(0, Math.min(sel - Math.floor(WINDOW / 2), suggestions.length - WINDOW))
    : 0;
  const windowEnd = Math.min(windowStart + WINDOW, suggestions.length);
  const visibleSuggestions = suggestions.slice(windowStart, windowEnd);

  const t = getTheme();

  return (
    <Box flexDirection="column">

      {/* zsh-style path menu — outside the border, above input */}
      {pathEntries.length > 0 ? (
        <PathMenu
          entries={pathEntries}
          selectedIdx={selectedPath}
          label={pathContext?.partial === "" || pathContext?.partial == null ? "directory" : "matches"}
        />
      ) : null}

      {/* Main bordered box — contains dropdown (when open) + input line */}
      <Box borderStyle="round" borderColor={t.border} flexDirection="column" paddingLeft={1} paddingRight={1}>

        {/* Dropdown lives INSIDE the border so no extra border line appears below it */}
        {suggestions.length > 0 ? (
          <Box flexDirection="column">
            {/* ▲ more above indicator */}
            {windowStart > 0 ? (
              <Text dimColor={t.useDim} color={t.textDim}>{`  ▲ ${windowStart} more`}</Text>
            ) : null}

            {visibleSuggestions.map((s, vi) => {
              const gi = windowStart + vi;
              const isSelected = gi === sel;
              const display = s.cmd.startsWith("@file ") ? "@" + s.cmd.slice(6) : s.cmd;
              const color = getSuggestionColor(s);
              return isSelected ? (
                <Box key={s.cmd}>
                  <Text color={t.selected} bold>{`  ${display}`}</Text>
                  {s.desc && s.desc !== "file" && s.desc !== "dir" ? (
                    <Text color={t.textDim}>{`  ${s.desc}`}</Text>
                  ) : null}
                </Box>
              ) : (
                <Box key={s.cmd}>
                  <Text color={color} dimColor={t.useDim}>{`  ${display}`}</Text>
                </Box>
              );
            })}

            {/* ▼ more below indicator */}
            {windowEnd < suggestions.length ? (
              <Text dimColor={t.useDim} color={t.textDim}>{`  ▼ ${suggestions.length - windowEnd} more`}</Text>
            ) : null}

            {/* hint + position counter */}
            <Text dimColor={t.useDim} color={t.textDim}>{`  ↑/↓ navigate  Enter select  Esc close    ${sel + 1}/${suggestions.length}`}</Text>
          </Box>
        ) : null}

        {/* Pending images indicator */}
        {pendingImages.length > 0 && (
          <Box>
            <Text color={t.accent}>{`  🖼 ${pendingImages.length} image${pendingImages.length > 1 ? "s" : ""} attached`}</Text>
          </Box>
        )}

        {/* Input line */}
        <Box>
          <Text color={t.accent}>{"● "}</Text>
          {input.length > 0 ? <Text color={t.text}>{input}</Text> : null}
          <Text color={t.cursor}>{"▊"}</Text>
          {input.length === 0 ? (
            <Text color={t.placeholder} dimColor={t.useDim}>{"Ask anything, @ for context, / for commands, ! for shell"}</Text>
          ) : ghost && suggestions.length === 0 && pathEntries.length === 0 ? (
            <Text color={t.placeholder} dimColor={t.useDim}>{ghost.suffix}</Text>
          ) : null}
        </Box>
      </Box>

      {/* Keyboard hints below input */}
      <Box paddingLeft={2}>
        <Text color={t.accent} dimColor={t.useDim}>{"Ctrl+V paste text/image  ·  Ctrl+L clear  ·  Shift+Tab cycle mode"}</Text>
      </Box>

    </Box>
  );
};
