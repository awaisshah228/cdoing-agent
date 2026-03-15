/**
 * Permission Manager
 *
 * Implements the Claude Code permission system:
 *   - Settings-based allow/ask/deny rules loaded from .claude/settings.json files
 *   - Permission modes: default, acceptEdits, plan, dontAsk, bypassPermissions
 *   - Rule evaluation order: deny → allow → ask (deny always wins)
 *   - Rule syntax: Tool, Tool(*), Bash(cmd *), Read(path), WebFetch(domain:x), Agent(name)
 *   - Settings precedence: local project → shared project → user (~/.claude/settings.json)
 *
 * Also supports legacy runtime stored rules (allow once / always / project).
 *
 * Backward compatible: legacy ASK / AUTO_EDIT / AUTO modes still accepted.
 */

import * as readline from "readline";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import type { ToolDefinition } from "../tools/types";
import { matchPath } from "../utils/path-matching";
import { extractShellPaths } from "../utils/shell-paths";
import type { SandboxManager } from "../sandbox";

// ── Constants ──────────────────────────────────────────────────────────────────

const HOME_DIR = os.homedir();
const GLOBAL_CDOING_DIR = path.join(HOME_DIR, ".cdoing");
const GLOBAL_PERMISSIONS_FILE = path.join(GLOBAL_CDOING_DIR, "permissions.json");
const USER_SETTINGS_FILE = path.join(HOME_DIR, ".claude", "settings.json");

// ── Public types ───────────────────────────────────────────────────────────────

/** A stored runtime permission rule (session / legacy format) */
export interface PermissionRule {
  tool: string;
  /** Optional: match only when this input value matches */
  inputMatch?: string;
  createdAt: string;
}

export type PermissionScope = "global" | "project";

/**
 * Permission modes as defined in Claude Code docs.
 * Legacy aliases (ask / auto-edit / auto) are kept for backward compatibility.
 */
export enum PermissionMode {
  // Canonical names
  DEFAULT      = "default",            // prompt on first use of each tool
  ACCEPT_EDITS = "acceptEdits",        // auto-approve file edits, ask for shell
  PLAN         = "plan",               // read-only: block write + exec tools
  DONT_ASK     = "dontAsk",            // deny all unless explicitly allowed
  BYPASS       = "bypassPermissions",  // skip all permission checks

  // Legacy aliases (normalised in constructor)
  ASK       = "ask",        // → DEFAULT
  AUTO_EDIT = "auto-edit",  // → ACCEPT_EDITS
  AUTO      = "auto",       // → BYPASS
}

export type PermissionPromptFn = (
  toolName: string,
  message: string,
  hasProject: boolean,
) => Promise<"allow" | "always" | "project" | "deny">;

// ── Internal types ─────────────────────────────────────────────────────────────

interface SettingsPermissions {
  allow: string[];
  ask:   string[];
  deny:  string[];
}

// ── Tool → Rule category mapping ───────────────────────────────────────────────

/**
 * Maps internal tool names to their Claude Code rule category.
 * Rule category is the prefix used in rule strings: Bash(…), Read(…), etc.
 */
const TOOL_CATEGORY: Record<string, string> = {
  shell_exec:   "Bash",
  file_run:     "Bash",
  file_read:    "Read",
  glob_search:  "Read",
  grep_search:  "Read",
  file_write:   "Edit",
  file_edit:    "Edit",
  multi_edit:   "Edit",
  file_delete:  "Delete",
  web_fetch:    "WebFetch",
  web_search:   "WebSearch",
  sub_agent:    "Agent",
};

/** Write/exec tools that are blocked in Plan mode */
const PLAN_BLOCKED = new Set(["shell_exec", "file_run", "file_write", "file_edit", "multi_edit", "file_delete"]);

/** File-edit tools that are auto-allowed in acceptEdits mode */
const ACCEPT_EDITS_AUTO = new Set(["file_write", "file_edit"]);

/**
 * Tools whose "don't ask again" approval is stored permanently to disk
 * (per project directory + command).  Matches the Bash row in the tiered table.
 */
const PERMANENT_APPROVAL_TOOLS = new Set(["shell_exec", "file_run"]);
// File-modification tools (file_write, file_edit) use session-only approval.

// ── Rule parsing ───────────────────────────────────────────────────────────────

interface ParsedRule {
  category:  string;        // e.g. "Bash", "Read", "Edit", "WebFetch", "Agent"
  specifier: string | null; // null = match all uses of this tool
}

function parseRule(rule: string): ParsedRule | null {
  const parenIdx = rule.indexOf("(");
  if (parenIdx === -1) {
    return { category: rule.trim(), specifier: null };
  }
  const closeIdx = rule.lastIndexOf(")");
  if (closeIdx === -1 || closeIdx < parenIdx) return null;

  const category = rule.substring(0, parenIdx).trim();
  let specifier  = rule.substring(parenIdx + 1, closeIdx).trim();

  // Tool(*) is identical to Tool (match all)
  if (specifier === "*") return { category, specifier: null };

  // Normalize deprecated ":*" suffix → " *"  (e.g. "git add:*" → "git add *")
  if (specifier.endsWith(":*") && category !== "WebFetch") {
    specifier = specifier.slice(0, -2) + " *";
  }

  return { category, specifier };
}

// ── Bash pattern matching ──────────────────────────────────────────────────────

/**
 * Shell operator pattern — used to block wildcard rules from matching
 * compound commands like "safe-cmd && evil-cmd".
 */
const SHELL_OP_RE = /(?:^|[\s;])(?:&&|\|\||;(?!;)|\|)(?:[\s]|$)/;

function escapeRegex(s: string): string {
  return s.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Match a Bash command against a specifier.
 *
 * Rules:
 *   - No wildcard → exact match only.
 *   - "ls *"  → matches "ls -la" but NOT "lsof" (space enforces word boundary).
 *   - "ls*"   → matches both.
 *   - Wildcard rules do NOT match commands that contain shell operators
 *     (&&, ||, ;, |) to prevent bypass via compound commands.
 */
function matchBash(command: string, specifier: string): boolean {
  if (!specifier.includes("*")) {
    return command === specifier;
  }
  // Wildcard: reject compound commands
  if (SHELL_OP_RE.test(command)) return false;

  // Convert glob-style specifier to anchored regex
  const regexStr = "^" + specifier.split("*").map(escapeRegex).join(".*") + "$";
  return new RegExp(regexStr).test(command);
}

// ── WebFetch domain matching ───────────────────────────────────────────────────

/**
 * Match a URL against a WebFetch specifier.
 *   "domain:example.com" matches example.com and *.example.com
 */
function matchWebFetch(url: string, specifier: string): boolean {
  if (specifier.startsWith("domain:")) {
    const domain = specifier.substring(7);
    try {
      const hostname = new URL(url).hostname;
      return hostname === domain || hostname.endsWith("." + domain);
    } catch {
      return false;
    }
  }
  return url === specifier;
}

// ── Settings file loading ──────────────────────────────────────────────────────

function loadSettingsFile(filePath: string): SettingsPermissions | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw  = fs.readFileSync(filePath, "utf-8");
    const data = JSON.parse(raw);
    if (!data.permissions) return null;
    const p = data.permissions;
    return {
      allow: Array.isArray(p.allow) ? p.allow : [],
      ask:   Array.isArray(p.ask)   ? p.ask   : [],
      deny:  Array.isArray(p.deny)  ? p.deny  : [],
    };
  } catch {
    return null;
  }
}

// ── PermissionManager ──────────────────────────────────────────────────────────

export class PermissionManager {
  private mode:           PermissionMode;
  private projectDir:     string | null = null;
  private cwd:            string;
  private customPromptFn: PermissionPromptFn | null = null;
  private sandboxManager: SandboxManager | null = null;

  // Runtime stored rules (legacy: allow once / always / project-scoped)
  private globalRules:  PermissionRule[] = [];
  private projectRules: PermissionRule[] = [];

  /**
   * Session-only approvals for file-modification tools (file_write, file_edit).
   * Per the tiered permission table: "Until session end" — not written to disk.
   * Key = toolName (no specifier needed; file edit approvals cover all paths).
   */
  private sessionApprovals: Set<string> = new Set();

  // Settings-based rules loaded from .claude/settings.json files
  private settingsAllow: string[] = [];
  private settingsAsk:   string[] = [];
  private settingsDeny:  string[] = [];

  constructor(mode: PermissionMode = PermissionMode.DEFAULT, projectDir?: string) {
    this.projectDir = projectDir || null;
    this.cwd        = projectDir || process.cwd();
    this.loadRuntimeRules();
    this.loadSettingsRules();
    // defaultMode from settings files can override the constructor argument
    const settingsMode = this.readDefaultModeFromSettings();
    this.mode = this.normalizeMode(settingsMode ?? mode);
  }

  // ── Mode normalisation ─────────────────────────────────────────────────────

  /** Collapse legacy aliases into canonical mode values. */
  private normalizeMode(mode: PermissionMode | string): PermissionMode {
    switch (mode as string) {
      case "ask":        return PermissionMode.DEFAULT;
      case "auto-edit":  return PermissionMode.ACCEPT_EDITS;
      case "auto":       return PermissionMode.BYPASS;
      default:           return mode as PermissionMode;
    }
  }

  /**
   * Read `defaultMode` from settings files (local → shared → user).
   * Higher-precedence files win. Returns null if no file sets it.
   */
  private readDefaultModeFromSettings(): PermissionMode | null {
    const candidates = [
      this.projectDir ? path.join(this.projectDir, ".claude", "settings.local.json") : null,
      this.projectDir ? path.join(this.projectDir, ".claude", "settings.json")        : null,
      USER_SETTINGS_FILE,
    ];
    for (const filePath of candidates) {
      if (!filePath) continue;
      try {
        if (!fs.existsSync(filePath)) continue;
        const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
        if (data.defaultMode) return this.normalizeMode(data.defaultMode);
      } catch { /* skip malformed files */ }
    }
    return null;
  }

  // ── Public API ────────────────────────────────────────────────────────────

  setPromptFn(fn: PermissionPromptFn): void {
    this.customPromptFn = fn;
  }

  setSandboxManager(sm: SandboxManager): void {
    this.sandboxManager = sm;
  }

  setMode(mode: PermissionMode): void {
    this.mode = this.normalizeMode(mode);
  }

  getMode(): PermissionMode {
    return this.mode;
  }

  /**
   * Check whether a specific file path is denied by settings rules for a given category.
   * Used by shell_exec to check extracted paths against Read/Edit/Delete rules.
   *
   * Returns "deny" if a deny rule matches the path for the given category.
   * Returns null otherwise (no deny found — the command can proceed through normal permission flow).
   */
  checkPathPermission(filePath: string, category: "Read" | "Edit" | "Delete"): "deny" | null {
    // Only check deny rules — we're not auto-allowing shell commands based on Edit/Read allow rules
    for (const rule of this.settingsDeny) {
      const parsed = parseRule(rule);
      if (!parsed) continue;
      if (parsed.category !== category) continue;
      if (parsed.specifier === null) return "deny"; // Deny all of this category
      if (matchPath(filePath, parsed.specifier, this.projectDir ?? this.cwd, this.cwd)) {
        return "deny";
      }
    }

    return null;
  }

  /** Check whether a file path matches any ask rule for the given category. */
  private pathMatchesAsk(filePath: string, category: "Read" | "Edit" | "Delete"): boolean {
    for (const rule of this.settingsAsk) {
      const parsed = parseRule(rule);
      if (!parsed) continue;
      if (parsed.category !== category) continue;
      if (parsed.specifier === null) return true;
      if (matchPath(filePath, parsed.specifier, this.projectDir ?? this.cwd, this.cwd)) {
        return true;
      }
    }
    return false;
  }

  setProjectDir(dir: string): void {
    this.projectDir = dir;
    this.cwd = dir;
    this.loadProjectRules();
    this.loadSettingsRules();
    // Re-evaluate defaultMode when project changes (local settings may differ)
    const settingsMode = this.readDefaultModeFromSettings();
    if (settingsMode) this.mode = settingsMode;
  }

  // ── Settings rules loading ─────────────────────────────────────────────────

  /**
   * Load and merge permission rules from settings files.
   *
   * Precedence (highest to lowest, docs order):
   *   1. Local project  — <project>/.claude/settings.local.json  (highest)
   *   2. Shared project — <project>/.claude/settings.json
   *   3. User           — ~/.claude/settings.json                 (lowest)
   *
   * Rule evaluation uses "first match wins", so higher-precedence rules are
   * stored at the front of the allow/ask arrays.
   *
   * Deny rules from ALL sources are merged — a deny at any level cannot be
   * overridden by an allow at any other level.
   */
  loadSettingsRules(): void {
    // Load each layer (null if file doesn't exist)
    const local   = this.projectDir
      ? loadSettingsFile(path.join(this.projectDir, ".claude", "settings.local.json"))
      : null;
    const shared  = this.projectDir
      ? loadSettingsFile(path.join(this.projectDir, ".claude", "settings.json"))
      : null;
    const user    = loadSettingsFile(USER_SETTINGS_FILE);

    // For allow/ask: highest precedence first so "first match wins" works correctly.
    // Order: local → shared → user
    const orderedSources = [local, shared, user];

    const allow: string[] = [];
    const ask:   string[] = [];
    const deny:  string[] = [];

    for (const src of orderedSources) {
      if (!src) continue;
      allow.push(...src.allow);
      ask.push(...src.ask);
      // Deny rules are collected from every layer — any deny wins
      deny.push(...src.deny);
    }

    this.settingsAllow = allow;
    this.settingsAsk   = ask;
    this.settingsDeny  = deny;
  }

  /** Return the currently loaded settings rules (for display / debugging). */
  getSettingsRules(): { allow: string[]; ask: string[]; deny: string[] } {
    return {
      allow: [...this.settingsAllow],
      ask:   [...this.settingsAsk],
      deny:  [...this.settingsDeny],
    };
  }

  // ── Rule matching ──────────────────────────────────────────────────────────

  /**
   * Test whether a settings rule string covers a specific tool invocation.
   */
  private matchesRule(
    rule: string,
    toolName: string,
    input: Record<string, unknown>,
  ): boolean {
    const parsed = parseRule(rule);
    if (!parsed) return false;

    const category = TOOL_CATEGORY[toolName] || toolName;

    // Rule must target this tool's category (or the raw tool name)
    if (parsed.category !== category && parsed.category !== toolName) return false;

    // No specifier → match all uses of this tool
    if (parsed.specifier === null) return true;

    // Specifier matching is category-specific
    switch (category) {
      case "Bash": {
        const cmd = String(input.command || "");
        return matchBash(cmd, parsed.specifier);
      }
      case "Read":
      case "Edit":
      case "Delete": {
        const fp = String(input.file_path || input.path || input.pattern || "");
        if (!fp) return false;
        return matchPath(fp, parsed.specifier, this.projectDir ?? this.cwd, this.cwd);
      }
      case "WebFetch": {
        const url = String(input.url || "");
        return matchWebFetch(url, parsed.specifier);
      }
      case "Agent": {
        const name = String(input.name || input.agent_name || "");
        return name === parsed.specifier;
      }
      default: {
        // Fallback: compare specifier against first input value
        const first = String(Object.values(input)[0] ?? "");
        return first === parsed.specifier;
      }
    }
  }

  /**
   * Evaluate all settings rules for a tool call.
   *
   * Evaluation order per docs: deny → ask → allow.
   *   - deny wins over everything.
   *   - ask overrides allow (lets you "ask for rm *" even when "allow Bash").
   *   - allow auto-approves when no deny/ask rule matched.
   * Returns null when no rule matches (fall back to mode behaviour).
   */
  private evaluateRules(
    toolName: string,
    input: Record<string, unknown>,
  ): "deny" | "allow" | "ask" | null {
    // 1. Deny — checked first, always wins
    for (const rule of this.settingsDeny) {
      if (this.matchesRule(rule, toolName, input)) return "deny";
    }
    // 2. Ask — overrides allow for fine-grained "still prompt" control
    for (const rule of this.settingsAsk) {
      if (this.matchesRule(rule, toolName, input)) return "ask";
    }
    // 3. Allow — auto-approve if no deny/ask matched
    for (const rule of this.settingsAllow) {
      if (this.matchesRule(rule, toolName, input)) return "allow";
    }
    return null;
  }

  // ── Permission request ─────────────────────────────────────────────────────

  /**
   * Determine whether a tool call is allowed.
   *
   * Decision flow:
   *   1. bypassPermissions mode → allow all.
   *   2. Tools that never require permission → allow.
   *   3. Settings deny rule matches → deny.
   *   4. Settings ask rule matches → prompt user (overrides stored/allow).
   *   5. Settings allow rule matches → allow.
   *   6. Session-only approval exists (file-edit tools) → allow.
   *   7. Runtime stored rule matches (Bash tools, persisted) → allow.
   *   8. Fall back to mode:
   *      - plan        → deny write/exec tools.
   *      - dontAsk     → deny anything not explicitly allowed.
   *      - acceptEdits → allow file edits; prompt for others.
   *      - default     → prompt user.
   */
  async requestPermission(
    toolDef: ToolDefinition,
    input: Record<string, unknown>,
  ): Promise<boolean> {
    if (this.mode === PermissionMode.BYPASS) return true;
    if (!toolDef.requiresPermission) return true;

    const toolName   = toolDef.name;
    const ruleResult = this.evaluateRules(toolName, input);

    if (ruleResult === "deny") return false;

    // ask rule: prompt even if a stored/allow rule would otherwise bypass it
    if (ruleResult === "ask") {
      return this.askUser(toolName, this.describeAction(toolDef, input));
    }

    if (ruleResult === "allow") return true;

    // For Bash tools: check path-level ask rules against files extracted from the command.
    // e.g. "ask": ["Edit(src/sensitive/*)"] triggers when mv/cp/> targets that path.
    if (ruleResult === null && TOOL_CATEGORY[toolName] === "Bash") {
      const cmd = String(input.command || "");
      if (cmd) {
        const paths = extractShellPaths(cmd, this.cwd);
        const needsAsk =
          paths.read.some((p)   => this.pathMatchesAsk(p, "Read"))   ||
          paths.write.some((p)  => this.pathMatchesAsk(p, "Edit"))   ||
          paths.delete.some((p) => this.pathMatchesAsk(p, "Delete"));
        if (needsAsk) {
          return this.askUser(toolName, this.describeAction(toolDef, input));
        }
      }
    }

    // Session-only approval for file-modification tools ("until session end")
    if (this.sessionApprovals.has(toolName)) return true;

    // Persistent stored rules for Bash tools ("permanently per project + command")
    if (this.hasStoredPermission(toolName, input)) return true;

    if (this.mode === PermissionMode.PLAN)     return !PLAN_BLOCKED.has(toolName);
    if (this.mode === PermissionMode.DONT_ASK) return false;

    if (this.mode === PermissionMode.ACCEPT_EDITS && ACCEPT_EDITS_AUTO.has(toolName)) return true;

    // Sandbox auto-allow mode: if sandbox is enabled and in auto-allow mode,
    // auto-approve commands that pass sandbox checks (no user prompt needed).
    if (this.sandboxManager?.isEnabled() && this.sandboxManager.getMode() === "auto-allow") {
      const category = TOOL_CATEGORY[toolName];
      if (category === "Bash") {
        const cmd = String(input.command || "");
        const check = this.sandboxManager.checkShellCommand(cmd, input.dangerouslyDisableSandbox as boolean);
        if (check.allowed) return true;
      } else if (category === "Edit") {
        const fp = String(input.file_path || "");
        if (fp) {
          const check = this.sandboxManager.checkFileWrite(fp);
          if (check.allowed) return true;
        }
      }
    }

    return this.askUser(toolName, this.describeAction(toolDef, input));
  }

  // ── Runtime stored rules (legacy) ─────────────────────────────────────────

  private getProjectPermissionsFile(): string | null {
    if (!this.projectDir) return null;
    return path.join(this.projectDir, ".cdoing", "permissions.json");
  }

  private loadRuntimeRules(): void {
    this.loadGlobalRules();
    this.loadProjectRules();
  }

  private loadGlobalRules(): void {
    try {
      if (fs.existsSync(GLOBAL_PERMISSIONS_FILE)) {
        const data = JSON.parse(fs.readFileSync(GLOBAL_PERMISSIONS_FILE, "utf-8"));
        this.globalRules = Array.isArray(data.rules) ? data.rules : [];
      }
    } catch {
      this.globalRules = [];
    }
  }

  private loadProjectRules(): void {
    this.projectRules = [];
    const file = this.getProjectPermissionsFile();
    if (!file) return;
    try {
      if (fs.existsSync(file)) {
        const data = JSON.parse(fs.readFileSync(file, "utf-8"));
        this.projectRules = Array.isArray(data.rules) ? data.rules : [];
      }
    } catch {
      this.projectRules = [];
    }
  }

  private saveGlobalRules(): void {
    if (!fs.existsSync(GLOBAL_CDOING_DIR)) {
      fs.mkdirSync(GLOBAL_CDOING_DIR, { recursive: true });
    }
    fs.writeFileSync(
      GLOBAL_PERMISSIONS_FILE,
      JSON.stringify({ rules: this.globalRules }, null, 2),
      "utf-8",
    );
  }

  private saveProjectRules(): void {
    const file = this.getProjectPermissionsFile();
    if (!file) return;
    const dir = path.dirname(file);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ rules: this.projectRules }, null, 2), "utf-8");
  }

  private hasStoredPermission(toolName: string, input: Record<string, unknown>): boolean {
    const all = [...this.globalRules, ...this.projectRules];
    return all.some((rule) => {
      if (rule.tool !== toolName) return false;
      if (!rule.inputMatch) return true;
      const value = String(
        input.file_path ?? input.command ?? input.pattern ?? Object.values(input)[0] ?? "",
      );
      return value === rule.inputMatch;
    });
  }

  private addRule(toolName: string, scope: PermissionScope, inputMatch?: string): void {
    // Build a settings-style rule string (e.g., "Edit", "Bash(npm test *)")
    const category = TOOL_CATEGORY[toolName] || toolName;
    const ruleString = inputMatch ? `${category}(${inputMatch})` : category;

    // Persist to settings.json (like Claude Code does)
    this.addToSettingsAllow(ruleString, scope);

    // Also add session approval for immediate effect
    this.sessionApprovals.add(toolName);

    // Legacy: persist to permissions.json for backward compat
    if (PERMANENT_APPROVAL_TOOLS.has(toolName)) {
      const rules  = scope === "project" ? this.projectRules : this.globalRules;
      const exists = rules.some((r) => r.tool === toolName && r.inputMatch === inputMatch);
      if (!exists) {
        rules.push({ tool: toolName, inputMatch, createdAt: new Date().toISOString() });
        scope === "project" ? this.saveProjectRules() : this.saveGlobalRules();
      }
    }
  }

  /**
   * Persist a permission rule to .claude/settings.json (project) or ~/.claude/settings.json (global).
   * This is the same format Claude Code uses, making permissions portable and editable.
   */
  private addToSettingsAllow(rule: string, scope: PermissionScope): void {
    const filePath = scope === "project" && this.projectDir
      ? path.join(this.projectDir, ".claude", "settings.json")
      : USER_SETTINGS_FILE;

    try {
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      let data: Record<string, unknown> = {};
      if (fs.existsSync(filePath)) {
        data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      }

      if (!data.permissions) data.permissions = {};
      const perms = data.permissions as Record<string, string[]>;
      if (!Array.isArray(perms.allow)) perms.allow = [];

      // Don't add duplicates
      if (!perms.allow.includes(rule)) {
        perms.allow.push(rule);
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf-8");

        // Reload settings so the new rule takes effect immediately
        this.loadSettingsRules();
      }
    } catch {
      // If we can't write settings, fall back to session-only
    }
  }

  removeRule(toolName?: string, scope?: PermissionScope): void {
    if (scope === "project" || !scope) {
      this.projectRules = toolName
        ? this.projectRules.filter((r) => r.tool !== toolName)
        : [];
      this.saveProjectRules();
    }
    if (scope === "global" || !scope) {
      this.globalRules = toolName
        ? this.globalRules.filter((r) => r.tool !== toolName)
        : [];
      this.saveGlobalRules();
    }
  }

  getStoredRules(): {
    global:  ReadonlyArray<PermissionRule>;
    project: ReadonlyArray<PermissionRule>;
  } {
    return { global: this.globalRules, project: this.projectRules };
  }

  // ── User prompt ────────────────────────────────────────────────────────────

  private describeAction(toolDef: ToolDefinition, input: Record<string, unknown>): string {
    if (toolDef.permissionMessage) {
      const msg = toolDef.permissionMessage(input);
      if (msg && !msg.includes("undefined")) return msg;
    }
    const value =
      input.file_path ?? input.command ?? input.pattern ?? Object.values(input)[0];
    return `${toolDef.name.replace(/_/g, " ")}: ${value ?? "(no details)"}`;
  }

  /**
   * Ask the user whether to allow a tool call.
   *
   * Options:
   *   y / Enter → Allow once
   *   a         → Always allow globally (~/.cdoing/permissions.json)
   *   p         → Allow for this project (.cdoing/permissions.json)
   *   n         → Deny
   *
   * Uses customPromptFn if set (e.g. VS Code UI), otherwise falls back to CLI readline.
   */
  private async askUser(toolName: string, message: string): Promise<boolean> {
    const hasProject = !!this.projectDir;
    const label      = toolName.replace(/_/g, " ");

    if (this.customPromptFn) {
      const choice = await this.customPromptFn(toolName, message, hasProject);
      if (choice === "always") {
        this.addRule(toolName, "global");
        return true;
      }
      if (choice === "project" && hasProject) {
        this.addRule(toolName, "project");
        return true;
      }
      if (choice === "deny") return false;
      return choice === "allow";
    }

    // CLI readline fallback
    return new Promise((resolve) => {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const projectHint = hasProject ? ` · (p)roject only` : "";

      rl.question(
        `\n  \x1b[33m⚡ Permission:\x1b[0m ${message}\n` +
        `  \x1b[2m(y)es, allow once · (a)lways allow${projectHint} · (n)o, deny\x1b[0m\n` +
        `  \x1b[2mChoice [Y/a${hasProject ? "/p" : ""}/n]:\x1b[0m `,
        (answer: string) => {
          rl.close();
          const a = answer.trim().toLowerCase();
          if (a === "a" || a === "always") {
            this.addRule(toolName, "global");
            console.log(`  \x1b[32m✓ Permission saved globally for ${label}\x1b[0m`);
            resolve(true);
          } else if ((a === "p" || a === "project") && hasProject) {
            this.addRule(toolName, "project");
            console.log(`  \x1b[32m✓ Permission saved for project for ${label}\x1b[0m`);
            resolve(true);
          } else if (a === "n" || a === "no") {
            resolve(false);
          } else {
            resolve(true); // y / Enter → allow once
          }
        },
      );
    });
  }
}
