/**
 * Tool Checker — Detects which CLI tools are installed on the host PC.
 *
 * The personal agent runs on someone's PC and delegates coding tasks to a
 * coding agent that uses shell commands (git, gh, vercel, docker, etc.).
 * If a required tool isn't installed, the coding agent wastes turns failing.
 *
 * This module:
 *   1. Defines a registry of known CLI tools with install instructions
 *   2. Probes `which` / `where` to check if each tool exists
 *   3. Optionally runs `<tool> --version` to get the installed version
 *   4. Returns a structured report the assistant can use to inform the owner
 *
 * Used by:
 *   - Engine startup (scan once, cache results)
 *   - setup_tool tool (on-demand checks + guided install)
 *   - System prompt builder (inject available tool list into coding prompt)
 */

import { execSync } from "child_process";

// ── Known Tool Definitions ──────────────────────────────────────────────────

export interface KnownTool {
  /** CLI binary name (what you type in shell) */
  id: string;
  /** Human-readable name */
  name: string;
  /** What it's used for */
  description: string;
  /** Category for grouping in UI */
  category: "vcs" | "deploy" | "runtime" | "package" | "container" | "cloud" | "database" | "utility";
  /** Command to check version (usually --version) */
  versionCmd: string;
  /** Install instructions per platform */
  install: {
    darwin?: string;
    linux?: string;
    win32?: string;
    /** Fallback / universal instructions */
    universal: string;
  };
  /** Optional: URL for setup docs */
  docsUrl?: string;
  /** Optional: post-install config steps (e.g., `gh auth login`) */
  setupSteps?: string[];
  /**
   * Optional: command to check if the tool is authenticated/configured.
   * If this command exits 0, the tool is considered "authenticated".
   * If it fails or the output contains error patterns, it's "not authenticated".
   */
  authCheckCmd?: string;
  /** Human-readable description of what credentials are needed. */
  authDescription?: string;
}

export const KNOWN_TOOLS: KnownTool[] = [
  // ── Version Control ─────────────────────────────────────────────────────
  {
    id: "git",
    name: "Git",
    description: "Version control system — required for commits, branches, and collaboration",
    category: "vcs",
    versionCmd: "git --version",
    install: {
      darwin: "brew install git",
      linux: "sudo apt install git  # or: sudo dnf install git",
      win32: "winget install Git.Git",
      universal: "https://git-scm.com/downloads",
    },
    docsUrl: "https://git-scm.com/doc",
    setupSteps: [
      'git config --global user.name "Your Name"',
      'git config --global user.email "your@email.com"',
    ],
    authCheckCmd: "git config --global user.email",
    authDescription: "Git user identity (name + email) — needed for commits",
  },
  {
    id: "gh",
    name: "GitHub CLI",
    description: "GitHub from the command line — PRs, issues, repos, actions",
    category: "vcs",
    versionCmd: "gh --version",
    install: {
      darwin: "brew install gh",
      linux: "sudo apt install gh  # or see: https://github.com/cli/cli/blob/trunk/docs/install_linux.md",
      win32: "winget install GitHub.cli",
      universal: "https://cli.github.com/",
    },
    docsUrl: "https://cli.github.com/manual/",
    setupSteps: ["gh auth login"],
    authCheckCmd: "gh auth status",
    authDescription: "GitHub account — needed for PRs, issues, pushing code",
  },

  // ── Deploy / Hosting ────────────────────────────────────────────────────
  {
    id: "vercel",
    name: "Vercel CLI",
    description: "Deploy frontend apps and serverless functions to Vercel",
    category: "deploy",
    versionCmd: "vercel --version",
    install: {
      universal: "npm install -g vercel",
    },
    docsUrl: "https://vercel.com/docs/cli",
    setupSteps: ["vercel login"],
    authCheckCmd: "vercel whoami",
    authDescription: "Vercel account — needed for deploying apps",
  },
  {
    id: "netlify",
    name: "Netlify CLI",
    description: "Deploy sites and functions to Netlify",
    category: "deploy",
    versionCmd: "netlify --version",
    install: {
      universal: "npm install -g netlify-cli",
    },
    docsUrl: "https://docs.netlify.com/cli/get-started/",
    setupSteps: ["netlify login"],
    authCheckCmd: "netlify status",
    authDescription: "Netlify account — needed for deploying sites",
  },
  {
    id: "fly",
    name: "Fly.io CLI",
    description: "Deploy apps globally on Fly.io",
    category: "deploy",
    versionCmd: "fly version",
    install: {
      darwin: "brew install flyctl",
      linux: "curl -L https://fly.io/install.sh | sh",
      win32: "powershell -Command \"iwr https://fly.io/install.ps1 -useb | iex\"",
      universal: "https://fly.io/docs/hands-on/install-flyctl/",
    },
    setupSteps: ["fly auth login"],
    authCheckCmd: "fly auth whoami",
    authDescription: "Fly.io account — needed for deploying apps",
  },
  {
    id: "railway",
    name: "Railway CLI",
    description: "Deploy apps on Railway",
    category: "deploy",
    versionCmd: "railway --version",
    install: {
      universal: "npm install -g @railway/cli",
    },
    setupSteps: ["railway login"],
    authCheckCmd: "railway whoami",
    authDescription: "Railway account — needed for deploying apps",
  },

  // ── Runtimes ────────────────────────────────────────────────────────────
  {
    id: "node",
    name: "Node.js",
    description: "JavaScript runtime — required for most JS/TS projects",
    category: "runtime",
    versionCmd: "node --version",
    install: {
      darwin: "brew install node  # or: nvm install --lts",
      linux: "curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash - && sudo apt install nodejs",
      win32: "winget install OpenJS.NodeJS.LTS",
      universal: "https://nodejs.org/",
    },
  },
  {
    id: "python3",
    name: "Python 3",
    description: "Python runtime for scripting and ML projects",
    category: "runtime",
    versionCmd: "python3 --version",
    install: {
      darwin: "brew install python3",
      linux: "sudo apt install python3",
      win32: "winget install Python.Python.3.12",
      universal: "https://python.org/downloads/",
    },
  },
  {
    id: "deno",
    name: "Deno",
    description: "Modern JavaScript/TypeScript runtime",
    category: "runtime",
    versionCmd: "deno --version",
    install: {
      darwin: "brew install deno",
      linux: "curl -fsSL https://deno.land/install.sh | sh",
      win32: "irm https://deno.land/install.ps1 | iex",
      universal: "https://deno.land/",
    },
  },
  {
    id: "bun",
    name: "Bun",
    description: "Fast JavaScript runtime, bundler, and package manager",
    category: "runtime",
    versionCmd: "bun --version",
    install: {
      darwin: "brew install oven-sh/bun/bun",
      linux: "curl -fsSL https://bun.sh/install | bash",
      universal: "https://bun.sh/",
    },
  },

  // ── Package Managers ────────────────────────────────────────────────────
  {
    id: "npm",
    name: "npm",
    description: "Node package manager (ships with Node.js)",
    category: "package",
    versionCmd: "npm --version",
    install: { universal: "Installed with Node.js — install Node first" },
  },
  {
    id: "yarn",
    name: "Yarn",
    description: "Fast, reliable package manager for Node.js",
    category: "package",
    versionCmd: "yarn --version",
    install: { universal: "npm install -g yarn  # or: corepack enable" },
  },
  {
    id: "pnpm",
    name: "pnpm",
    description: "Efficient package manager for Node.js",
    category: "package",
    versionCmd: "pnpm --version",
    install: { universal: "npm install -g pnpm  # or: corepack enable && corepack prepare pnpm@latest --activate" },
  },
  {
    id: "pip",
    name: "pip",
    description: "Python package installer",
    category: "package",
    versionCmd: "pip3 --version",
    install: { universal: "Installed with Python 3 — install Python first" },
  },

  // ── Containers ──────────────────────────────────────────────────────────
  {
    id: "docker",
    name: "Docker",
    description: "Container runtime for building and running isolated environments",
    category: "container",
    versionCmd: "docker --version",
    install: {
      darwin: "brew install --cask docker  # Docker Desktop",
      linux: "curl -fsSL https://get.docker.com | sh",
      win32: "winget install Docker.DockerDesktop",
      universal: "https://docs.docker.com/get-docker/",
    },
  },
  {
    id: "docker-compose",
    name: "Docker Compose",
    description: "Multi-container orchestration",
    category: "container",
    versionCmd: "docker compose version",
    install: { universal: "Included with Docker Desktop, or: sudo apt install docker-compose-plugin" },
  },

  // ── Cloud CLIs ──────────────────────────────────────────────────────────
  {
    id: "aws",
    name: "AWS CLI",
    description: "Amazon Web Services command-line interface",
    category: "cloud",
    versionCmd: "aws --version",
    install: {
      darwin: "brew install awscli",
      linux: "curl 'https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip' -o awscliv2.zip && unzip awscliv2.zip && sudo ./aws/install",
      universal: "https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html",
    },
    setupSteps: ["aws configure"],
    authCheckCmd: "aws sts get-caller-identity",
    authDescription: "AWS credentials (access key + secret) — needed for cloud operations",
  },
  {
    id: "gcloud",
    name: "Google Cloud CLI",
    description: "Google Cloud Platform command-line interface",
    category: "cloud",
    versionCmd: "gcloud --version",
    install: {
      darwin: "brew install --cask google-cloud-sdk",
      universal: "https://cloud.google.com/sdk/docs/install",
    },
    setupSteps: ["gcloud init", "gcloud auth login"],
    authCheckCmd: "gcloud auth list --filter=status:ACTIVE --format='value(account)'",
    authDescription: "Google Cloud account — needed for GCP operations",
  },
  {
    id: "az",
    name: "Azure CLI",
    description: "Microsoft Azure command-line interface",
    category: "cloud",
    versionCmd: "az --version",
    install: {
      darwin: "brew install azure-cli",
      linux: "curl -sL https://aka.ms/InstallAzureCLIDeb | sudo bash",
      universal: "https://learn.microsoft.com/en-us/cli/azure/install-azure-cli",
    },
    setupSteps: ["az login"],
    authCheckCmd: "az account show",
    authDescription: "Azure account — needed for Azure operations",
  },

  // ── Databases ───────────────────────────────────────────────────────────
  {
    id: "psql",
    name: "PostgreSQL Client",
    description: "PostgreSQL command-line client",
    category: "database",
    versionCmd: "psql --version",
    install: {
      darwin: "brew install libpq && brew link --force libpq",
      linux: "sudo apt install postgresql-client",
      universal: "https://www.postgresql.org/download/",
    },
  },
  {
    id: "redis-cli",
    name: "Redis CLI",
    description: "Redis command-line client",
    category: "database",
    versionCmd: "redis-cli --version",
    install: {
      darwin: "brew install redis",
      linux: "sudo apt install redis-tools",
      universal: "https://redis.io/docs/getting-started/",
    },
  },

  // ── Utilities ───────────────────────────────────────────────────────────
  {
    id: "curl",
    name: "cURL",
    description: "HTTP client for API testing and downloads",
    category: "utility",
    versionCmd: "curl --version",
    install: {
      linux: "sudo apt install curl",
      universal: "Usually pre-installed on macOS/Linux",
    },
  },
  {
    id: "jq",
    name: "jq",
    description: "Command-line JSON processor",
    category: "utility",
    versionCmd: "jq --version",
    install: {
      darwin: "brew install jq",
      linux: "sudo apt install jq",
      win32: "winget install jqlang.jq",
      universal: "https://jqlang.github.io/jq/download/",
    },
  },
  {
    id: "ffmpeg",
    name: "FFmpeg",
    description: "Media processing — audio, video, image conversion",
    category: "utility",
    versionCmd: "ffmpeg -version",
    install: {
      darwin: "brew install ffmpeg",
      linux: "sudo apt install ffmpeg",
      win32: "winget install Gyan.FFmpeg",
      universal: "https://ffmpeg.org/download.html",
    },
  },
];

// ── Checker ─────────────────────────────────────────────────────────────────

export interface ToolStatus {
  id: string;
  name: string;
  description: string;
  category: string;
  installed: boolean;
  version?: string;
  /** Whether the tool is authenticated/configured (only checked if authCheckCmd exists). */
  authenticated?: boolean;
  /** Human-readable auth info (e.g., the logged-in account). */
  authInfo?: string;
  /** What credentials are needed if not authenticated. */
  authDescription?: string;
  error?: string;
}

export interface ToolReport {
  /** All checked tools with their status */
  tools: ToolStatus[];
  /** Timestamp of the scan */
  scannedAt: number;
  /** Platform this was scanned on */
  platform: string;
}

/**
 * Check if a single CLI tool is installed, get its version, and check auth.
 */
export function checkTool(tool: KnownTool): ToolStatus {
  const status: ToolStatus = {
    id: tool.id,
    name: tool.name,
    description: tool.description,
    category: tool.category,
    installed: false,
  };

  try {
    // Use `which` on unix, `where` on windows
    const whichCmd = process.platform === "win32" ? "where" : "which";
    execSync(`${whichCmd} ${tool.id}`, { stdio: "pipe", timeout: 5000 });

    // Tool binary exists — try to get version
    status.installed = true;
    try {
      const versionOutput = execSync(tool.versionCmd, {
        stdio: "pipe",
        timeout: 5000,
        encoding: "utf-8",
      }).trim();
      // Extract first line, trim to reasonable length
      status.version = versionOutput.split("\n")[0].substring(0, 120);
    } catch {
      status.version = "(installed, version unknown)";
    }

    // Check authentication/credentials if the tool has an auth check command
    if (tool.authCheckCmd) {
      status.authDescription = tool.authDescription;
      try {
        const authOutput = execSync(tool.authCheckCmd, {
          stdio: "pipe",
          timeout: 10000,
          encoding: "utf-8",
          env: { ...process.env, GH_NO_UPDATE_NOTIFIER: "1" },
        }).trim();
        status.authenticated = true;
        // Extract useful auth info (first non-empty line, trimmed)
        const firstLine = authOutput.split("\n").find((l) => l.trim().length > 0);
        if (firstLine) {
          status.authInfo = firstLine.substring(0, 120);
        }
      } catch {
        status.authenticated = false;
      }
    }
  } catch {
    status.installed = false;
  }

  return status;
}

/**
 * Scan all known tools and return a full report.
 */
export function scanAllTools(): ToolReport {
  const tools = KNOWN_TOOLS.map(checkTool);
  return {
    tools,
    scannedAt: Date.now(),
    platform: process.platform,
  };
}

/**
 * Scan a subset of tools by their IDs.
 */
export function scanTools(ids: string[]): ToolReport {
  const selected = KNOWN_TOOLS.filter((t) => ids.includes(t.id));
  const tools = selected.map(checkTool);
  return {
    tools,
    scannedAt: Date.now(),
    platform: process.platform,
  };
}

/**
 * Check a single tool by ID. Returns null if not in the known list.
 */
export function checkToolById(id: string): ToolStatus | null {
  const tool = KNOWN_TOOLS.find((t) => t.id === id);
  if (!tool) return null;
  return checkTool(tool);
}

/**
 * Get install instructions for a tool on the current platform.
 */
export function getInstallInstructions(toolId: string): string | null {
  const tool = KNOWN_TOOLS.find((t) => t.id === toolId);
  if (!tool) return null;

  const platform = process.platform as "darwin" | "linux" | "win32";
  const platformCmd = tool.install[platform];
  const universalCmd = tool.install.universal;

  const lines: string[] = [`## Install ${tool.name}\n`];
  lines.push(`${tool.description}\n`);

  if (platformCmd) {
    lines.push(`**Recommended (${platform}):**`);
    lines.push(`\`\`\`\n${platformCmd}\n\`\`\``);
  }

  if (universalCmd && universalCmd !== platformCmd) {
    lines.push(`\n**Alternative:**`);
    lines.push(universalCmd.startsWith("http")
      ? `Download from: ${universalCmd}`
      : `\`\`\`\n${universalCmd}\n\`\`\``);
  }

  if (tool.setupSteps && tool.setupSteps.length > 0) {
    lines.push(`\n**After installing, run:**`);
    for (const step of tool.setupSteps) {
      lines.push(`\`\`\`\n${step}\n\`\`\``);
    }
  }

  if (tool.docsUrl) {
    lines.push(`\nDocs: ${tool.docsUrl}`);
  }

  return lines.join("\n");
}

/**
 * Build a concise summary of installed/missing tools for the system prompt.
 * Includes auth status so the coding agent knows what it can and can't do.
 */
export function buildToolEnvironmentSummary(report: ToolReport): string {
  const installed = report.tools.filter((t) => t.installed);
  const missing = report.tools.filter((t) => !t.installed);
  const notAuthed = installed.filter((t) => t.authenticated === false);

  const lines: string[] = ["## CLI Tools Available on This Machine\n"];

  if (installed.length > 0) {
    lines.push("**Installed:**");
    for (const t of installed) {
      let authTag = "";
      if (t.authenticated === true) authTag = " [authenticated]";
      else if (t.authenticated === false) authTag = " [NOT authenticated — credentials missing]";
      lines.push(`- ${t.id} (${t.name})${t.version ? ` — ${t.version}` : ""}${authTag}`);
    }
  }

  if (notAuthed.length > 0) {
    lines.push(
      "\n**CREDENTIAL WARNING:** The following tools are installed but NOT authenticated. " +
      "Commands that require auth (push, deploy, API calls) WILL FAIL:"
    );
    for (const t of notAuthed) {
      lines.push(`- ${t.id}: ${t.authDescription || "credentials not configured"}`);
    }
    lines.push(
      "\nIf a task requires an unauthenticated tool, STOP and report: " +
      '"This task requires `<tool>` to be authenticated. ' +
      "It's installed but not logged in. Please ask me to set up credentials.\""
    );
  }

  if (missing.length > 0) {
    lines.push("\n**NOT installed (do not attempt to use these):**");
    for (const t of missing) {
      lines.push(`- ${t.id} (${t.name}) — ${t.description}`);
    }
    lines.push(
      "\nIf a task requires a missing tool, STOP and report it clearly. " +
      "Do NOT try to install tools yourself. Say: " +
      '"This task requires [tool] which is not installed on your machine. ' +
      'Please ask me to set it up for you."'
    );
  }

  return lines.join("\n");
}
