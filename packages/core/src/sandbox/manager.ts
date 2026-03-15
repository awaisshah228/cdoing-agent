/**
 * Sandbox Manager — orchestrates filesystem and network sandbox enforcement.
 *
 * Loads sandbox configuration from .claude/settings.json files using the
 * same hierarchy as the permission system (local → shared → user).
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import type { SandboxConfig, SandboxCheckResult, SandboxMode } from "./types";
import { defaultSandboxConfig } from "./types";
import { checkReadAccess, checkWriteAccess, checkShellCommandPaths } from "./filesystem";
import { checkDomainAccess, buildSandboxedEnv } from "./network";

const HOME_DIR = os.homedir();
const USER_SETTINGS_FILE = path.join(HOME_DIR, ".claude", "settings.json");

export class SandboxManager {
  private config: SandboxConfig;
  private workingDir: string;
  private projectDir: string;
  private sessionApprovedDomains = new Set<string>();
  private domainPromptFn: ((domain: string) => Promise<boolean>) | null = null;

  constructor(workingDir: string, projectDir?: string) {
    this.workingDir = path.resolve(workingDir);
    this.projectDir = projectDir ? path.resolve(projectDir) : this.workingDir;
    this.config = defaultSandboxConfig();
    this.loadConfig();
  }

  // ── Config loading ──────────────────────────────────────────────────────────

  /**
   * Load and merge sandbox config from settings files.
   * Precedence: local project → shared project → user (highest to lowest).
   * Arrays are merged (not replaced) across scopes.
   */
  loadConfig(): void {
    const candidates = [
      path.join(this.projectDir, ".claude", "settings.local.json"),
      path.join(this.projectDir, ".claude", "settings.json"),
      USER_SETTINGS_FILE,
    ];

    const merged = defaultSandboxConfig();

    for (const filePath of candidates) {
      try {
        if (!fs.existsSync(filePath)) continue;
        const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
        if (!data.sandbox) continue;

        const sb = data.sandbox;

        // enabled: any scope can enable
        if (sb.enabled === true) merged.enabled = true;

        // mode: highest-precedence scope wins (first found)
        if (sb.mode && merged.mode === "regular") {
          merged.mode = sb.mode as SandboxMode;
        }

        // Filesystem arrays are merged
        if (sb.filesystem) {
          if (Array.isArray(sb.filesystem.allowWrite)) {
            merged.filesystem.allowWrite.push(...sb.filesystem.allowWrite);
          }
          if (Array.isArray(sb.filesystem.denyWrite)) {
            merged.filesystem.denyWrite.push(...sb.filesystem.denyWrite);
          }
          if (Array.isArray(sb.filesystem.denyRead)) {
            merged.filesystem.denyRead.push(...sb.filesystem.denyRead);
          }
        }

        // Network: merge domains
        if (sb.network) {
          if (Array.isArray(sb.network.allowedDomains)) {
            merged.network.allowedDomains.push(...sb.network.allowedDomains);
          }
          if (sb.network.allowManagedDomainsOnly === true) {
            merged.network.allowManagedDomainsOnly = true;
          }
        }

        // Excluded commands: merge
        if (Array.isArray(sb.excludedCommands)) {
          merged.excludedCommands.push(...sb.excludedCommands);
        }

        // allowUnsandboxedCommands: false from any scope wins (restrictive)
        if (sb.allowUnsandboxedCommands === false) {
          merged.allowUnsandboxedCommands = false;
        }
      } catch {
        // Skip malformed files
      }
    }

    // Deduplicate arrays
    merged.filesystem.allowWrite = [...new Set(merged.filesystem.allowWrite)];
    merged.filesystem.denyWrite = [...new Set(merged.filesystem.denyWrite)];
    merged.filesystem.denyRead = [...new Set(merged.filesystem.denyRead)];
    merged.network.allowedDomains = [...new Set(merged.network.allowedDomains)];
    merged.excludedCommands = [...new Set(merged.excludedCommands)];

    this.config = merged;
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  getConfig(): Readonly<SandboxConfig> {
    return this.config;
  }

  isEnabled(): boolean {
    return this.config.enabled;
  }

  getMode(): SandboxMode {
    return this.config.mode;
  }

  setDomainPromptFn(fn: (domain: string) => Promise<boolean>): void {
    this.domainPromptFn = fn;
  }

  approveDomain(domain: string): void {
    this.sessionApprovedDomains.add(domain);
  }

  // ── Access checks ─────────────────────────────────────────────────────────

  checkFileRead(filePath: string): SandboxCheckResult {
    return checkReadAccess(filePath, this.config, this.workingDir, this.projectDir);
  }

  checkFileWrite(filePath: string): SandboxCheckResult {
    return checkWriteAccess(filePath, this.config, this.workingDir, this.projectDir);
  }

  /**
   * Check if a shell command is allowed by sandbox rules.
   * Returns denied if dangerouslyDisableSandbox is used but not allowed.
   */
  checkShellCommand(command: string, dangerouslyDisableSandbox?: boolean): SandboxCheckResult {
    if (!this.config.enabled) return { allowed: true };

    // Handle dangerouslyDisableSandbox escape hatch
    if (dangerouslyDisableSandbox) {
      if (!this.config.allowUnsandboxedCommands) {
        return {
          allowed: false,
          reason: "Sandbox: dangerouslyDisableSandbox is not allowed (allowUnsandboxedCommands is false)",
        };
      }
      // Allowed to bypass sandbox — permission system still applies
      return { allowed: true };
    }

    // Check if command is excluded from sandbox
    if (this.isExcludedCommand(command)) {
      return { allowed: true };
    }

    // Check command paths heuristically
    return checkShellCommandPaths(command, this.config, this.workingDir, this.projectDir);
  }

  /**
   * Check if network access to a URL is allowed.
   * If the domain needs user approval, triggers the domain prompt.
   */
  async checkNetworkAccess(url: string): Promise<SandboxCheckResult> {
    const result = checkDomainAccess(url, this.config, this.sessionApprovedDomains);

    if (result.promptUser && result.domain && this.domainPromptFn) {
      const approved = await this.domainPromptFn(result.domain);
      if (approved) {
        this.sessionApprovedDomains.add(result.domain);
        return { allowed: true };
      }
      return {
        allowed: false,
        reason: `Sandbox: user denied network access to domain "${result.domain}"`,
      };
    }

    return result;
  }

  /**
   * Check if a command prefix matches any excluded command.
   */
  isExcludedCommand(command: string): boolean {
    const trimmed = command.trimStart();
    for (const excluded of this.config.excludedCommands) {
      if (trimmed === excluded || trimmed.startsWith(excluded + " ") || trimmed.startsWith(excluded + "\t")) {
        return true;
      }
    }
    return false;
  }

  /**
   * Get a sandboxed environment for shell command execution.
   */
  getShellEnv(): NodeJS.ProcessEnv {
    return buildSandboxedEnv(this.config, process.env);
  }
}
