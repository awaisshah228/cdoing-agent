/**
 * Sandbox Types — configuration and check result interfaces.
 */

export interface SandboxFilesystemConfig {
  /** Additional paths (beyond workingDir) where writes are allowed */
  allowWrite: string[];
  /** Paths where writes are denied */
  denyWrite: string[];
  /** Paths where reads are denied */
  denyRead: string[];
}

export interface SandboxNetworkConfig {
  /** Whitelisted domains for network access */
  allowedDomains: string[];
  /** If true, block non-allowed domains without prompting the user */
  allowManagedDomainsOnly: boolean;
}

/** Sandbox operation mode */
export type SandboxMode = "auto-allow" | "regular";

/** Full sandbox configuration (loaded from settings files) */
export interface SandboxConfig {
  enabled: boolean;
  mode: SandboxMode;
  filesystem: SandboxFilesystemConfig;
  network: SandboxNetworkConfig;
  /** Commands that bypass the sandbox (e.g. "docker") */
  excludedCommands: string[];
  /** Whether dangerouslyDisableSandbox param is respected */
  allowUnsandboxedCommands: boolean;
}

/** Result of a sandbox access check */
export interface SandboxCheckResult {
  allowed: boolean;
  reason?: string;
  /** For network checks: whether the user should be prompted about a new domain */
  promptUser?: boolean;
  /** The domain being requested (when promptUser is true) */
  domain?: string;
}

/**
 * Default sensitive paths that should be denied for reads.
 * Matches Claude Code's approach of protecting credentials and keys.
 */
export const DEFAULT_DENY_READ_PATHS: string[] = [
  "~/.ssh",
  "~/.aws",
  "~/.gnupg",
  "~/.config/gcloud",
  "~/.azure",
  "~/.kube/config",
  "~/.netrc",
  "~/.npmrc",
  "~/.git-credentials",
  "~/.docker/config.json",
  "~/.password-store",
  "~/.op",
];

/**
 * Default sensitive paths that should be denied for writes.
 */
export const DEFAULT_DENY_WRITE_PATHS: string[] = [
  "~/.ssh",
  "~/.aws",
  "~/.gnupg",
  "~/.config/gcloud",
  "~/.azure",
  "~/.kube/config",
  "~/.netrc",
  "~/.npmrc",
  "~/.git-credentials",
  "~/.docker/config.json",
  "/etc",
  "/System",
  "/usr",
  "/bin",
  "/sbin",
];

/** Returns a default sandbox config — disabled by default */
export function defaultSandboxConfig(): SandboxConfig {
  return {
    enabled: false,
    mode: "regular",
    filesystem: {
      allowWrite: [],
      denyWrite: [...DEFAULT_DENY_WRITE_PATHS],
      denyRead: [...DEFAULT_DENY_READ_PATHS],
    },
    network: {
      allowedDomains: [],
      allowManagedDomainsOnly: false,
    },
    excludedCommands: [],
    allowUnsandboxedCommands: false,
  };
}
