/**
 * Onboard Helpers — Browser detection, SSH hints, workspace bootstrap, safe reset.
 *
 * Ported from openclaw's onboard-helpers.ts pattern:
 *   - detectBrowserOpenSupport() — platform-aware browser detection
 *   - openUrl()                  — safe URL opener with WSL/SSH fallback
 *   - formatSshHint()            — SSH tunnel instructions for headless servers
 *   - resolveControlUiLinks()    — build dashboard/WS URLs from bind config
 *   - ensureWorkspaceAndSessions() — create workspace dirs + session dirs
 *   - moveToTrash()              — safe file removal (trash instead of delete)
 *   - handleReset()              — config/creds/full reset with trash
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { execSync, spawn } from "child_process";
import type { WizardPrompter } from "./prompts";
import type { ResetScope, GatewayBind } from "./setup-types";

// ── Paths ────────────────────────────────────────────────────────────────

const CDOING_DIR = path.join(os.homedir(), ".cdoing");
const REMOTE_DIR = path.join(CDOING_DIR, "remote");
const SESSIONS_DIR = path.join(REMOTE_DIR, "sessions");
const WORKSPACE_DIR = path.join(CDOING_DIR, "workspace");

// ── Browser Detection ────────────────────────────────────────────────────

export interface BrowserOpenSupport {
  ok: boolean;
  reason?: string;
  command?: string;
}

interface BrowserOpenCommand {
  argv: string[] | null;
  reason?: string;
  command?: string;
  /** Whether URL must be quoted (Windows cmd /c start). */
  quoteUrl?: boolean;
}

/** Detect if a binary is available on PATH. */
async function detectBinary(name: string): Promise<boolean> {
  if (!name?.trim()) return false;
  try {
    const cmd = process.platform === "win32" ? `where ${name}` : `which ${name}`;
    execSync(cmd, { stdio: "ignore", timeout: 2000 });
    return true;
  } catch {
    return false;
  }
}

/** Detect if running inside WSL. */
async function isWSL(): Promise<boolean> {
  if (process.platform !== "linux") return false;
  try {
    const release = fs.readFileSync("/proc/version", "utf-8");
    return /microsoft|wsl/i.test(release);
  } catch {
    return false;
  }
}

/**
 * Resolve the platform-appropriate browser-open command.
 * Handles: macOS, Windows, Linux (X11/Wayland), WSL, SSH (no display).
 */
export async function resolveBrowserOpenCommand(): Promise<BrowserOpenCommand> {
  const platform = process.platform;
  const hasDisplay = Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);
  const isSsh =
    Boolean(process.env.SSH_CLIENT) ||
    Boolean(process.env.SSH_TTY) ||
    Boolean(process.env.SSH_CONNECTION);

  // SSH without display — can't open browser
  if (isSsh && !hasDisplay && platform !== "win32") {
    return { argv: null, reason: "ssh-no-display" };
  }

  if (platform === "win32") {
    return { argv: ["cmd", "/c", "start", ""], command: "cmd", quoteUrl: true };
  }

  if (platform === "darwin") {
    const hasOpen = await detectBinary("open");
    return hasOpen ? { argv: ["open"], command: "open" } : { argv: null, reason: "missing-open" };
  }

  if (platform === "linux") {
    const wsl = await isWSL();
    if (!hasDisplay && !wsl) {
      return { argv: null, reason: "no-display" };
    }
    if (wsl) {
      const hasWslview = await detectBinary("wslview");
      if (hasWslview) return { argv: ["wslview"], command: "wslview" };
      if (!hasDisplay) return { argv: null, reason: "wsl-no-wslview" };
    }
    const hasXdgOpen = await detectBinary("xdg-open");
    return hasXdgOpen
      ? { argv: ["xdg-open"], command: "xdg-open" }
      : { argv: null, reason: "missing-xdg-open" };
  }

  return { argv: null, reason: "unsupported-platform" };
}

/**
 * Check whether we can open a browser on this system.
 */
export async function detectBrowserOpenSupport(): Promise<BrowserOpenSupport> {
  const resolved = await resolveBrowserOpenCommand();
  if (!resolved.argv) {
    return { ok: false, reason: resolved.reason };
  }
  return { ok: true, command: resolved.command };
}

/**
 * Open a URL in the user's browser.
 * Returns true if successful, false if no browser available.
 */
export async function openUrl(url: string): Promise<boolean> {
  const resolved = await resolveBrowserOpenCommand();
  if (!resolved.argv) return false;

  try {
    const args = [...resolved.argv];
    if (resolved.quoteUrl) {
      args.push(`"${url}"`);
    } else {
      args.push(url);
    }
    const child = spawn(args[0], args.slice(1), {
      stdio: "ignore",
      detached: true,
    });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

// ── SSH Hints ────────────────────────────────────────────────────────────

/**
 * Resolve SSH target hint (user@host) from SSH_CONNECTION env var.
 */
function resolveSshTargetHint(): string {
  const user = process.env.USER || process.env.LOGNAME || "user";
  const conn = process.env.SSH_CONNECTION?.trim().split(/\s+/);
  const host = conn?.[2] ?? "<host>";
  return `${user}@${host}`;
}

/**
 * Format SSH tunnel instructions for headless/remote servers.
 */
export function formatSshHint(params: {
  port: number;
  token?: string;
}): string {
  const sshTarget = resolveSshTargetHint();
  const localUrl = `http://localhost:${params.port}/dashboard/`;
  const authedUrl = params.token
    ? `${localUrl}?token=${encodeURIComponent(params.token)}`
    : localUrl;

  return [
    "No GUI detected. To access the dashboard from your computer:",
    "",
    `  ssh -N -L ${params.port}:127.0.0.1:${params.port} ${sshTarget}`,
    "",
    "Then open in your browser:",
    `  ${authedUrl}`,
  ].join("\n");
}

// ── Control UI Links ─────────────────────────────────────────────────────

/**
 * Resolve dashboard HTTP and gateway WS URLs from bind configuration.
 */
export function resolveControlUiLinks(params: {
  port: number;
  bind: GatewayBind;
  customBindHost?: string;
}): { httpUrl: string; wsUrl: string } {
  const { port, bind, customBindHost } = params;

  let host: string;
  if (bind === "custom" && customBindHost) {
    host = customBindHost;
  } else if (bind === "lan") {
    host = getLocalIpAddress() || "0.0.0.0";
  } else {
    host = "127.0.0.1";
  }

  return {
    httpUrl: `http://${host}:${port}/dashboard/`,
    wsUrl: `ws://${host}:${port}`,
  };
}

/** Get primary LAN IPv4 address. */
function getLocalIpAddress(): string | null {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === "IPv4" && !iface.internal) {
        return iface.address;
      }
    }
  }
  return null;
}

// ── Workspace Bootstrap ──────────────────────────────────────────────────

/**
 * Ensure workspace and session directories exist.
 * Creates bootstrap files if missing (like openclaw's ensureWorkspaceAndSessions).
 */
export async function ensureWorkspaceAndSessions(
  workspaceDir: string,
): Promise<{ workspaceDir: string; sessionsDir: string }> {
  const resolvedWorkspace = workspaceDir.startsWith("~")
    ? path.join(os.homedir(), workspaceDir.substring(1))
    : path.resolve(workspaceDir);

  // Create workspace dir
  if (!fs.existsSync(resolvedWorkspace)) {
    fs.mkdirSync(resolvedWorkspace, { recursive: true });
  }

  // Create sessions dir
  if (!fs.existsSync(SESSIONS_DIR)) {
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
  }

  // Create a bootstrap file if workspace is empty
  const bootstrapPath = path.join(resolvedWorkspace, ".cdoing-workspace");
  if (!fs.existsSync(bootstrapPath)) {
    fs.writeFileSync(
      bootstrapPath,
      JSON.stringify(
        {
          created: new Date().toISOString(),
          description: "Cdoing remote coding agent workspace",
        },
        null,
        2,
      ),
      "utf-8",
    );
  }

  return { workspaceDir: resolvedWorkspace, sessionsDir: SESSIONS_DIR };
}

// ── Safe Reset (Trash) ──────────────────────────────────────────────────

/**
 * Move a file/directory to trash (recoverable) instead of deleting.
 * Falls back to direct delete if trash command unavailable.
 */
export async function moveToTrash(pathname: string): Promise<{ ok: boolean; method: "trash" | "delete" | "skipped" }> {
  if (!pathname || !fs.existsSync(pathname)) {
    return { ok: true, method: "skipped" };
  }

  // Try platform-specific trash command
  if (process.platform === "darwin") {
    try {
      execSync(`osascript -e 'tell application "Finder" to delete POSIX file "${pathname}"'`, {
        stdio: "ignore",
        timeout: 5000,
      });
      return { ok: true, method: "trash" };
    } catch { /* fall through */ }
  } else if (process.platform === "linux") {
    // Try trash-cli or gio
    for (const cmd of ["trash-put", "gio trash"]) {
      try {
        execSync(`${cmd} "${pathname}"`, { stdio: "ignore", timeout: 5000 });
        return { ok: true, method: "trash" };
      } catch { /* try next */ }
    }
  }

  // Fallback: direct delete
  try {
    const stat = fs.statSync(pathname);
    if (stat.isDirectory()) {
      fs.rmSync(pathname, { recursive: true, force: true });
    } else {
      fs.unlinkSync(pathname);
    }
    return { ok: true, method: "delete" };
  } catch {
    return { ok: false, method: "delete" };
  }
}

/**
 * Handle config reset with safe trash-based removal.
 * Like openclaw's handleReset but uses moveToTrash.
 */
export async function handleReset(
  scope: ResetScope,
  configPath: string,
  prompter: WizardPrompter,
): Promise<void> {
  const results: string[] = [];

  // Always remove config
  const configResult = await moveToTrash(configPath);
  results.push(
    configResult.method === "trash"
      ? `Config moved to trash: ${configPath}`
      : configResult.method === "delete"
        ? `Config deleted: ${configPath}`
        : `Config not found: ${configPath}`,
  );

  if (scope === "config+creds" || scope === "full") {
    // Remove credential files
    const credFiles = ["credentials.enc", "oauth-tokens.enc"];
    for (const file of credFiles) {
      const filePath = path.join(REMOTE_DIR, file);
      const r = await moveToTrash(filePath);
      if (r.method !== "skipped") {
        results.push(`Credentials ${r.method === "trash" ? "trashed" : "deleted"}: ${file}`);
      }
    }
  }

  if (scope === "full") {
    // Remove sessions
    const sessResult = await moveToTrash(SESSIONS_DIR);
    if (sessResult.method !== "skipped") {
      results.push(`Sessions ${sessResult.method === "trash" ? "trashed" : "deleted"}`);
    }
  }

  await prompter.note(results.join("\n"), `Reset complete (${scope})`);
}

// ── Wizard Header ────────────────────────────────────────────────────────

/**
 * Print the branded wizard header (like openclaw's printWizardHeader).
 */
export function printWizardHeader(): void {
  const header = [
    "┌──────────────────────────────────────────────┐",
    "│        CDOING — Remote Coding Agent          │",
    "│            Onboarding Wizard                 │",
    "└──────────────────────────────────────────────┘",
  ].join("\n");
  console.log(header);
}
