import React, { useState, useCallback, useRef } from "react";
import { Box, Text, useInput } from "ink";
import * as fs from "fs";
import * as path from "path";

const SLASH_COMMANDS = [
  { cmd: "/help",        desc: "Show help" },
  { cmd: "/clear",       desc: "Clear conversation" },
  { cmd: "/new",         desc: "New conversation" },
  { cmd: "/ls",          desc: "Browse sessions (interactive TUI)" },
  { cmd: "/history",     desc: "List saved conversations (text)" },
  { cmd: "/resume",      desc: "Resume a conversation" },
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
  { cmd: "/plan",        desc: "Toggle plan mode" },
  { cmd: "/effort",      desc: "Set analysis depth" },
  { cmd: "/btw",         desc: "Ask without adding to history" },
  { cmd: "/bg",          desc: "Run prompt as background job" },
  { cmd: "/jobs",        desc: "Show background jobs" },
  { cmd: "/rules",       desc: "View project rules" },
  { cmd: "/mcp",         desc: "MCP server status / interactive picker" },
  { cmd: "/context",     desc: "List context providers" },
  { cmd: "/queue",       desc: "Show message queue" },
  { cmd: "/doctor",      desc: "Check system health" },
  { cmd: "/init",        desc: "Initialize project" },
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

// Shell commands that take a path argument
const PATH_COMMANDS = new Set([
  "cd", "ls", "ll", "la", "cat", "less", "more", "head", "tail",
  "vim", "vi", "nvim", "nano", "code", "open",
  "cp", "mv", "rm", "mkdir", "rmdir", "touch",
]);

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
  // Match: (optional !) + known command + space + optional partial path
  const m = line.match(/^(!?)(\w[\w\-]*)(\s+)(\S*)$/);
  if (!m) {
    // "cd " with trailing space, no path yet
    const m2 = line.match(/^(!?)(\w[\w\-]*)(\s+)$/);
    if (m2) {
      const cmd = m2[2].toLowerCase();
      if (PATH_COMMANDS.has(cmd)) return { cmdPrefix: m2[1] + m2[2] + m2[3], partial: "" };
    }
    return null;
  }
  const cmd = m[2].toLowerCase();
  if (!PATH_COMMANDS.has(cmd)) return null;
  return { cmdPrefix: m[1] + m[2] + m[3], partial: m[4] };
}

// ── PathMenu component ────────────────────────────────────────────────────────

interface PathMenuProps {
  entries: PathEntry[];
  selectedIdx: number;
  label: string;
}

const PathMenu: React.FC<PathMenuProps> = ({ entries, selectedIdx, label }) => {
  const termWidth = process.stdout.columns || 100;
  const padWidth  = 2; // spaces between columns

  // Column width = longest name + padding, capped so at least 2 cols fit
  const maxName   = Math.max(...entries.map((e) => e.name.length), 4);
  const colWidth  = Math.min(maxName + padWidth, Math.floor(termWidth / 2));
  const numCols   = Math.max(1, Math.floor((termWidth - 4) / colWidth));

  // Split entries into rows
  const rows: PathEntry[][] = [];
  for (let i = 0; i < entries.length; i += numCols) {
    rows.push(entries.slice(i, i + numCols));
  }

  return (
    <Box flexDirection="column" paddingLeft={2}>
      <Text dimColor>{label}</Text>
      {rows.map((row, rowIdx) => (
        <Box key={rowIdx} flexDirection="row">
          {row.map((e, colIdx) => {
            const globalIdx = rowIdx * numCols + colIdx;
            const isSelected = globalIdx === selectedIdx;
            const padded = e.name.padEnd(colWidth);
            return isSelected ? (
              <Text key={e.full} backgroundColor="cyan" color="black">{padded}</Text>
            ) : (
              <Text key={e.full} color={e.isDir ? "cyan" : "white"}>{padded}</Text>
            );
          })}
        </Box>
      ))}
      <Text dimColor>{"Tab=cycle  →=accept  ESC=close"}</Text>
    </Box>
  );
};

// ── Suggestion icon helpers ───────────────────────────────────────────────────

function getSuggestionColor(s: { cmd: string; desc: string }): string {
  if (s.cmd.startsWith("@file")) return "magenta";
  if (s.cmd.startsWith("@")) return "yellow";
  return "cyan";
}

// ── Component ─────────────────────────────────────────────────────────────────

interface UserInputProps {
  isProcessing: boolean;
  queueLength: number;
  workingDir: string;
  permissionMode: string;
  onSubmit: (value: string) => void;
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

  // Counter for clipboard image placeholders
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
      setSuggestions(matches.slice(0, 8));
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

    // Ctrl+V — paste from clipboard (text or image placeholder)
    if (key.ctrl && char === "v") {
      try {
        const { execSync } = require("child_process") as typeof import("child_process");
        // macOS: pbpaste, Linux: xclip -o or xsel -ob
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
          // Replace newlines with spaces for single-line input
          const cleaned = pasted.replace(/\n/g, " ").replace(/\r/g, "");
          const next = input + cleaned;
          setInput(next);
          updateAll(next, history);
        } else {
          // Clipboard might contain an image — insert placeholder
          imageCountRef.current += 1;
          const placeholder = `[Image #${imageCountRef.current}]`;
          const next = input + placeholder;
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
      if (!trimmed) return;
      const newHistory = [trimmed, ...history].slice(0, 200);
      clearAll();
      setHistory(newHistory);
      setHistoryIdx(-1);
      setInput("");
      onSubmit(trimmed);
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

  return (
    <Box flexDirection="column">

      {/* /command and @provider vertical dropdown — windowed, 8 visible */}
      {suggestions.length > 0 ? (
        <Box flexDirection="column" paddingLeft={2}>
          {(() => {
            const WINDOW = 8;
            const sel = selectedSuggestion >= 0 ? selectedSuggestion : 0;
            const start = Math.max(0, Math.min(sel - Math.floor(WINDOW / 2), suggestions.length - WINDOW));
            const visible = suggestions.slice(start, start + WINDOW);
            return visible.map((s, vi) => {
              const gi = start + vi; // global index
              const isSelected = gi === sel;
              // For @file entries show @path instead of "@file path"
              const display = s.cmd.startsWith("@file ") ? "@" + s.cmd.slice(6) : s.cmd;
              const color = getSuggestionColor(s);
              return isSelected ? (
                <Box key={s.cmd}>
                  <Text color="white" bold>{`  ${display}`}</Text>
                  {s.desc && s.desc !== "file" && s.desc !== "dir" ? (
                    <Text color="gray">{`  ${s.desc}`}</Text>
                  ) : null}
                </Box>
              ) : (
                <Box key={s.cmd}>
                  <Text color={color} dimColor>{`  ${display}`}</Text>
                </Box>
              );
            });
          })()}
          <Box marginTop={0} paddingLeft={1}>
            <Text dimColor>{"↑/↓ to navigate  Enter to select  Tab to complete  Esc to close"}</Text>
          </Box>
        </Box>
      ) : null}

      {/* zsh-style path menu — entries in a column-aligned grid */}
      {pathEntries.length > 0 ? (
        <PathMenu
          entries={pathEntries}
          selectedIdx={selectedPath}
          label={pathContext?.partial === "" || pathContext?.partial == null ? "directory" : "matches"}
        />
      ) : null}

      {/* Bordered input with placeholder */}
      <Box borderStyle="round" borderColor="gray" paddingLeft={1} paddingRight={1}>
        <Box>
          <Text color="cyan">{"● "}</Text>
          {input.length > 0 ? <Text>{input}</Text> : null}
          <Text color="green">{"▊"}</Text>
          {input.length === 0 ? (
            <Text color="gray" dimColor>{"Ask anything, @ for context, / for commands, ! for shell"}</Text>
          ) : ghost && suggestions.length === 0 && pathEntries.length === 0 ? (
            <Text color="gray" dimColor>{ghost.suffix}</Text>
          ) : null}
        </Box>
      </Box>

      {/* Keyboard hints below input */}
      <Box paddingLeft={2}>
        <Text color="cyan" dimColor>{"Press Ctrl+V to paste  ·  Ctrl+L to clear  ·  Shift+Tab to cycle mode"}</Text>
      </Box>

    </Box>
  );
};
