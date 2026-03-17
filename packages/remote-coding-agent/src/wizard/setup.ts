/**
 * Setup Wizard — Main orchestrator.
 *
 * Modular setup flow inspired by openclaw's runSetupWizard / onboard.
 * Supports:
 *   - QuickStart (sensible defaults, minimal prompts)
 *   - Advanced (full manual configuration)
 *   - Non-interactive (all values via flags)
 *   - Existing config detection with keep/update/reset (safe trash)
 *   - Risk acknowledgement
 *   - Browser detection + SSH tunnel hints
 *   - Workspace bootstrapping
 *   - Modular steps: auth → model → skills → coding → channels → gateway → finalize
 *
 * Usage:
 *   import { runSetupWizard } from "./wizard/setup";
 *   import { createCliPrompter } from "./wizard/prompts";
 *
 *   const result = await runSetupWizard({ prompter: createCliPrompter() });
 */

import * as fs from "fs";
import * as path from "path";
import type { WizardPrompter } from "./prompts";
import { WizardCancelledError } from "./prompts";
import type {
  WizardFlow,
  ResetScope,
  SetupResult,
  ConfigSnapshot,
  QuickstartGatewayDefaults,
} from "./setup-types";
import { promptProvider, promptAuthChoice, promptModel, promptCodingModel, buildProviderList } from "./setup-auth";
import { setupChannels } from "./setup-channels";
import { setupSkills, SKILL_OPTIONS } from "./setup-skills";
import {
  configureGateway,
  promptPermissionMode,
  promptWorkingDir,
  promptLogLevel,
} from "./setup-gateway";
import { writeSetupConfig, finalizeSetupWizard } from "./setup-finalize";
import type { LaunchChoice } from "./setup-finalize";
import {
  handleReset,
  ensureWorkspaceAndSessions,
  printWizardHeader,
} from "./onboard-helpers";

// ── Config Discovery ─────────────────────────────────────────────────────

const CONFIG_NAMES = [
  "remote-coding-agent.config.json",
  ".cdoing/remote.json",
];

function findConfigFile(startDir: string): string | null {
  let dir = path.resolve(startDir);
  const root = path.parse(dir).root;
  while (dir !== root) {
    for (const name of CONFIG_NAMES) {
      const p = path.join(dir, name);
      if (fs.existsSync(p)) return p;
    }
    dir = path.dirname(dir);
  }
  return null;
}

/**
 * Read and validate existing config file.
 */
function readConfigSnapshot(): ConfigSnapshot {
  const configPath = findConfigFile(process.cwd());

  if (!configPath) {
    return { exists: false, valid: false, config: {}, path: null, issues: [] };
  }

  try {
    const raw = fs.readFileSync(configPath, "utf-8");
    const config = JSON.parse(raw);
    const issues: string[] = [];

    if (!config.agent) issues.push("Missing 'agent' section");
    if (!config.gateway) issues.push("Missing 'gateway' section");
    if (config.agent && !config.agent.provider) issues.push("Missing 'agent.provider'");
    if (config.agent && !config.agent.model) issues.push("Missing 'agent.model'");

    return {
      exists: true,
      valid: issues.length === 0,
      config,
      path: configPath,
      issues,
    };
  } catch (err) {
    return {
      exists: true,
      valid: false,
      config: {},
      path: configPath,
      issues: [err instanceof Error ? err.message : String(err)],
    };
  }
}

/**
 * Format existing config for display.
 */
function summarizeExistingConfig(config: Record<string, unknown>): string {
  const agent = config.agent as Record<string, unknown> | undefined;
  const gateway = config.gateway as Record<string, unknown> | undefined;
  const channels = config.channels as Record<string, unknown> | undefined;
  const skills = config.skills as Record<string, unknown> | undefined;

  const lines: string[] = [];
  if (agent?.provider) lines.push(`Provider: ${agent.provider}`);
  if (agent?.model) lines.push(`Model: ${agent.model}`);
  if (agent?.codingModel) lines.push(`Coding model: ${agent.codingModel}`);
  if (agent?.permissionMode) lines.push(`Permission: ${agent.permissionMode}`);
  if (gateway?.port) lines.push(`Port: ${gateway.port}`);
  if (channels) {
    const channelIds = Object.keys(channels);
    if (channelIds.length > 0) lines.push(`Channels: ${channelIds.join(", ")}`);
  }
  if (skills && Array.isArray((skills as Record<string, unknown>).enabled)) {
    lines.push(`Skills: ${((skills as Record<string, unknown>).enabled as string[]).join(", ")}`);
  }
  if (config.workingDir) lines.push(`Working dir: ${config.workingDir}`);

  return lines.length > 0 ? lines.join("\n") : "Empty config";
}

// ── Risk Acknowledgement ─────────────────────────────────────────────────

async function requireRiskAcknowledgement(prompter: WizardPrompter, skipRisk?: boolean): Promise<void> {
  if (skipRisk) return;

  await prompter.note(
    [
      "Security warning — please read.",
      "",
      "This agent can read files, run commands, and access the network.",
      "A bad prompt can trick it into doing unsafe things.",
      "",
      "Recommended baseline:",
      "- Use the strongest available model.",
      "- Limit allowed directories.",
      "- Use permission modes to restrict tool access.",
      "- Keep secrets out of the agent's reachable filesystem.",
      "- Use auth tokens for API/dashboard access.",
      "",
      "If multiple users can message one tool-enabled agent,",
      "they share that delegated tool authority.",
    ].join("\n"),
    "Security",
  );

  const ok = await prompter.confirm({
    message: "I understand the security implications. Continue?",
    initialValue: false,
  });

  if (!ok) {
    throw new WizardCancelledError("risk not accepted");
  }
}

// ── Setup Options ────────────────────────────────────────────────────────

export interface SetupWizardOptions {
  prompter: WizardPrompter;
  /** Skip risk acknowledgement */
  acceptRisk?: boolean;
  /** Force a specific flow */
  flow?: WizardFlow;
  /** Skip channel setup */
  skipChannels?: boolean;
  /** Skip skills setup */
  skipSkills?: boolean;
  /** Skip health check */
  skipHealth?: boolean;
  /** Skip launch prompt */
  skipLaunch?: boolean;
  /** Output config path override */
  outputPath?: string;
  /** Non-interactive mode — all values must be provided via overrides */
  nonInteractive?: boolean;
  /** Override values for non-interactive mode */
  overrides?: NonInteractiveOverrides;
}

export interface NonInteractiveOverrides {
  provider?: string;
  model?: string;
  apiKey?: string;
  authChoice?: "oauth" | "apikey" | "env" | "skip";
  codingProvider?: string;
  codingModel?: string;
  codingApiKey?: string;
  telegramEnabled?: boolean;
  telegramToken?: string;
  port?: number;
  bind?: "loopback" | "lan" | "custom";
  authMode?: "token" | "password" | "none";
  authToken?: string;
  permissionMode?: string;
  workingDir?: string;
  logLevel?: string;
  enabledSkills?: string[];
}

// ── Non-Interactive Setup ────────────────────────────────────────────────

async function runNonInteractiveSetup(
  opts: SetupWizardOptions,
): Promise<{ result: SetupResult; configPath: string; launchChoice: LaunchChoice }> {
  const { prompter, overrides = {} } = opts;
  const providers = buildProviderList();

  if (!opts.acceptRisk) {
    throw new WizardCancelledError(
      "Non-interactive setup requires --accept-risk. Read the security warning first.",
    );
  }

  const provider = providers.find((p) => p.id === (overrides.provider || "anthropic"))
    || providers[0];

  const model = overrides.model || provider.defaultModel;
  const enabledSkills = overrides.enabledSkills
    || SKILL_OPTIONS.filter((s) => s.defaultOn).map((s) => s.id);

  const hasCodingModel = enabledSkills.includes("coding-agent");
  const codingProvider = hasCodingModel ? (overrides.codingProvider || provider.id) : undefined;
  const codingModel = hasCodingModel ? (overrides.codingModel || provider.defaultCodingModel) : undefined;

  const { generateSecretKey } = await import("../auth/secret");

  const result: SetupResult = {
    provider: provider.id,
    model,
    apiKey: overrides.apiKey,
    usedOAuth: false,
    hasCodingModel,
    codingProvider,
    codingModel,
    codingApiKey: overrides.codingApiKey,
    telegramEnabled: overrides.telegramEnabled ?? false,
    telegramToken: overrides.telegramToken,
    authToken: overrides.authToken || generateSecretKey(),
    allowedDirs: [overrides.workingDir || process.cwd()],
    workingDir: overrides.workingDir || process.cwd(),
    port: overrides.port ?? 4567,
    permissionMode: overrides.permissionMode || "auto",
    logLevel: overrides.logLevel || "info",
    enabledSkills,
    gatewayBind: overrides.bind || "loopback",
    gatewayAuthMode: overrides.authMode || "token",
  };

  // Save API key if provided
  if (overrides.apiKey) {
    const { CredentialManager } = await import("../auth/credentials");
    const creds = new CredentialManager();
    creds.saveApiKey(provider.id, overrides.apiKey, "assistant");
  }
  if (overrides.codingApiKey && codingProvider) {
    const { CredentialManager } = await import("../auth/credentials");
    const creds = new CredentialManager();
    creds.saveApiKey(codingProvider, overrides.codingApiKey, "coding");
  }

  // Ensure workspace
  await ensureWorkspaceAndSessions(result.workingDir);

  // Write config
  const configPath = writeSetupConfig(result, opts.outputPath);

  await prompter.note(
    `Config written to: ${configPath}\nNon-interactive setup complete.`,
    "Done",
  );

  return { result, configPath, launchChoice: "later" };
}

// ── Main Wizard ──────────────────────────────────────────────────────────

export async function runSetupWizard(opts: SetupWizardOptions): Promise<{
  result: SetupResult;
  configPath: string;
  launchChoice: LaunchChoice;
}> {
  const { prompter } = opts;

  // Print header
  printWizardHeader();

  // Non-interactive fast path
  if (opts.nonInteractive) {
    return runNonInteractiveSetup(opts);
  }

  await prompter.intro("Remote Coding Agent — Setup");

  // ── Risk acknowledgement ──
  await requireRiskAcknowledgement(prompter, opts.acceptRisk);

  // ── Existing config detection ──
  const snapshot = readConfigSnapshot();

  if (snapshot.exists && snapshot.path) {
    if (!snapshot.valid && snapshot.issues.length > 0) {
      await prompter.note(
        [
          "Config issues found:",
          ...snapshot.issues.map((i) => `  - ${i}`),
        ].join("\n"),
        "Invalid config",
      );
    }

    await prompter.note(
      summarizeExistingConfig(snapshot.config),
      "Existing config detected",
    );

    const action = await prompter.select({
      message: "Config handling",
      options: [
        { value: "keep", label: "Use existing values", hint: "skip to channels/gateway" },
        { value: "modify", label: "Update values", hint: "re-run full setup" },
        { value: "reset", label: "Reset", hint: "start fresh" },
      ],
    });

    if (action === "reset") {
      const resetScope = await prompter.select<ResetScope>({
        message: "Reset scope",
        options: [
          { value: "config", label: "Config only" },
          { value: "config+creds", label: "Config + credentials" },
          { value: "full", label: "Full reset (config + creds + sessions)" },
        ],
      });
      await handleReset(resetScope, snapshot.path, prompter);
    } else if (action === "keep") {
      await prompter.note(
        "Keeping existing config. You can update channels and gateway settings.",
      );
    }
  }

  // ── Flow selection — always advanced ──
  const flow: WizardFlow = opts.flow ?? "advanced";

  // ── Step 1: Provider ──
  const provider = await promptProvider(prompter);

  // ── Step 2: Authentication ──
  const { authChoice, apiKey, usedOAuth } = await promptAuthChoice(prompter, provider);

  // ── Step 3: Assistant Model ──
  const model = await promptModel(prompter, provider, "assistant");

  // ── Step 4: Skills (multiSelect toggle checklist) ──
  const enabledSkills = await setupSkills(prompter, {
    flow,
    skipSkills: opts.skipSkills,
  });

  // ── Step 5: Coding Model (if coding-agent skill enabled) ──
  let hasCodingModel = false;
  let codingProvider: string | undefined;
  let codingModel: string | undefined;
  let codingApiKey: string | undefined;

  if (enabledSkills.includes("coding-agent")) {
    const codingResult = await promptCodingModel(prompter, provider);
    hasCodingModel = codingResult.enabled;
    codingProvider = codingResult.codingProvider;
    codingModel = codingResult.codingModel;
    codingApiKey = codingResult.codingApiKey;
  }

  // ── Step 6: Channels ──
  const channelResult = await setupChannels(prompter, {
    flow,
    skipChannels: opts.skipChannels,
  });

  // ── Step 7: Gateway ──
  const quickstartDefaults: QuickstartGatewayDefaults | undefined =
    snapshot.exists && snapshot.config.gateway
      ? {
          hasExisting: true,
          port: (snapshot.config.gateway as Record<string, unknown>).port as number ?? 4567,
          bind: "loopback",
          authMode: "token",
          token: (snapshot.config.gateway as Record<string, unknown>).authToken as string | undefined,
        }
      : undefined;

  const gateway = await configureGateway({
    quickstartDefaults,
    prompter,
  });

  // ── Step 8: Permission mode ──
  const permissionMode = await promptPermissionMode(prompter);

  // ── Step 9: Working directory ──
  const workingDir = await promptWorkingDir(prompter);

  // ── Step 10: Log level ──
  const logLevel = await promptLogLevel(prompter);

  // ── Build result ──
  const result: SetupResult = {
    provider: provider.id,
    model,
    apiKey,
    usedOAuth,
    hasCodingModel,
    codingProvider,
    codingModel,
    codingApiKey,
    telegramEnabled: channelResult.telegramEnabled,
    telegramToken: channelResult.telegramToken,
    authToken: gateway.authToken || "",
    allowedDirs: [workingDir],
    workingDir,
    port: gateway.port,
    permissionMode,
    logLevel,
    enabledSkills,
    gatewayBind: gateway.bind,
    gatewayAuthMode: gateway.authMode,
  };

  // ── Ensure workspace dirs ──
  await ensureWorkspaceAndSessions(workingDir);

  // ── Write config ──
  const configPath = writeSetupConfig(result, opts.outputPath);

  // ── Finalize ──
  const { launchChoice } = await finalizeSetupWizard({
    flow,
    result,
    gateway,
    prompter,
    configPath,
    skipHealth: opts.skipHealth,
    skipLaunch: opts.skipLaunch,
  });

  return { result, configPath, launchChoice };
}
