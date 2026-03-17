/**
 * Finalize Setup Module — Post-config steps.
 *
 * Handles:
 *   - Writing config file
 *   - Health check against running gateway
 *   - Summary display
 *   - Browser detection + SSH tunnel hint
 *   - Dashboard URL resolution
 *   - Launch options (start gateway, open dashboard, TUI, or later)
 *
 * Follows openclaw's finalizeSetupWizard pattern.
 */

import * as fs from "fs";
import * as path from "path";
import type { WizardPrompter } from "./prompts";
import type { SetupResult, GatewayWizardSettings, WizardFlow } from "./setup-types";
import { probeGatewayReachable } from "./setup-gateway";
import {
  detectBrowserOpenSupport,
  formatSshHint,
  resolveControlUiLinks,
} from "./onboard-helpers";

// ── Config Writing ───────────────────────────────────────────────────────

/**
 * Write the setup result to a JSON config file.
 * Returns the path where the config was written.
 */
export function writeSetupConfig(result: SetupResult, outputPath?: string): string {
  const configPath = outputPath || path.resolve("remote-coding-agent.config.json");

  const config = {
    agent: {
      provider: result.provider,
      model: result.model,
      ...(result.apiKey ? { apiKey: result.apiKey } : {}),
      maxTurns: 25,
      permissionMode: result.permissionMode,
      ...(result.codingProvider ? { codingProvider: result.codingProvider } : {}),
      ...(result.codingModel ? { codingModel: result.codingModel } : {}),
      ...(result.codingApiKey ? { codingApiKey: result.codingApiKey } : {}),
    },
    gateway: {
      port: result.port,
      ...(result.authToken ? { authToken: result.authToken } : {}),
      bind: result.gatewayBind,
      ...(result.gatewayAuthMode !== "token" ? { authMode: result.gatewayAuthMode } : {}),
    },
    session: {
      ttlMs: 1800000,
      maxHistoryMessages: 50,
      maxSessions: 100,
    },
    security: {
      channelRules: {},
      rateLimitPerMinute: 20,
      allowedDirs: result.allowedDirs,
    },
    channels: {
      ...(result.telegramEnabled
        ? {
            telegram: {
              enabled: true,
              ...(result.telegramToken ? { botToken: result.telegramToken } : {}),
            },
          }
        : {}),
    },
    workingDir: result.workingDir,
    logLevel: result.logLevel,
    skills: {
      enabled: result.enabledSkills,
    },
  };

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
  return configPath;
}

// ── Health Check ─────────────────────────────────────────────────────────

export async function runHealthCheck(
  prompter: WizardPrompter,
  gateway: GatewayWizardSettings,
): Promise<boolean> {
  const host = gateway.bind === "loopback" ? "127.0.0.1" : "0.0.0.0";

  const progress = prompter.progress("Health check");
  progress.update("Probing gateway...");

  const result = await probeGatewayReachable({
    host,
    port: gateway.port,
    token: gateway.authMode === "token" ? gateway.authToken : undefined,
  });

  if (result.ok) {
    progress.stop("Gateway is reachable.");
    return true;
  }

  progress.stop(`Gateway not reachable: ${result.detail || "unknown"}`);
  return false;
}

// ── Summary ──────────────────────────────────────────────────────────────

export async function printSetupSummary(
  prompter: WizardPrompter,
  result: SetupResult,
  configPath: string,
): Promise<void> {
  const channels: string[] = [];
  if (result.telegramEnabled) channels.push("Telegram");

  const authMethod = result.usedOAuth
    ? "OAuth"
    : result.apiKey
      ? "API Key"
      : "Environment Variable";

  const lines = [
    `Config saved to: ${configPath}`,
    "",
    `Assistant:    ${result.provider} / ${result.model}`,
    `Auth:         ${authMethod}`,
    ...(result.hasCodingModel
      ? [`Coding:       ${result.codingProvider} / ${result.codingModel}`]
      : []),
    `Skills:       ${result.enabledSkills.join(", ")}`,
    `Channels:     ${channels.length > 0 ? channels.join(", ") : "none"}`,
    `Permission:   ${result.permissionMode}`,
    `Working dir:  ${result.workingDir}`,
    `Gateway:      port ${result.port}, bind ${result.gatewayBind}`,
    `Log level:    ${result.logLevel}`,
  ];

  if (result.authToken) {
    lines.push("", `Auth token:   ${result.authToken.substring(0, 8)}...`);
  }

  await prompter.note(lines.join("\n"), "Configuration Summary");
}

// ── Launch Options ───────────────────────────────────────────────────────

export type LaunchChoice = "start" | "dashboard" | "tui" | "later";

export async function promptLaunchChoice(
  prompter: WizardPrompter,
  result: SetupResult,
): Promise<LaunchChoice> {
  // Resolve dashboard links
  const links = resolveControlUiLinks({
    port: result.port,
    bind: result.gatewayBind,
    customBindHost: undefined,
  });

  const authedUrl = result.authToken
    ? `${links.httpUrl}?token=${encodeURIComponent(result.authToken)}`
    : links.httpUrl;

  // Detect browser support
  const browserSupport = await detectBrowserOpenSupport();

  const nextStepsLines = [
    "Your agent is configured and ready to run.",
    "",
    "Next steps:",
    "  remote-coding-agent start             # Headless mode",
    "  remote-coding-agent dashboard         # With web dashboard",
    "  remote-coding-agent tui               # Terminal UI",
    "",
    `Dashboard:   ${links.httpUrl}`,
    `Gateway WS:  ${links.wsUrl}`,
  ];

  if (result.authToken) {
    nextStepsLines.push(`Dashboard (with token): ${authedUrl}`);
  }

  // SSH hint if no browser available
  if (!browserSupport.ok) {
    nextStepsLines.push(
      "",
      formatSshHint({ port: result.port, token: result.authToken }),
    );
  }

  await prompter.note(nextStepsLines.join("\n"), "Ready");

  // Check if gateway is already running
  const probe = await probeGatewayReachable({
    host: "127.0.0.1",
    port: result.port,
    token: result.authToken,
  });

  if (probe.ok) {
    await prompter.note("Gateway is already running!", "Status");
  }

  // Token note (like openclaw's)
  if (result.authToken) {
    await prompter.note(
      [
        "Gateway token: shared auth for the Gateway + Dashboard.",
        "Stored in your config file (gateway.authToken).",
        "Keep this secret! You need it to access the dashboard.",
      ].join("\n"),
      "Token",
    );
  }

  // Build launch options — include dashboard-open only if browser available
  const launchOptions: { value: LaunchChoice; label: string; hint: string }[] = [
    { value: "tui", label: "Open TUI (recommended)", hint: "terminal interface" },
    { value: "start", label: "Start the agent (headless)", hint: "runs in background" },
  ];

  if (browserSupport.ok) {
    launchOptions.push({
      value: "dashboard",
      label: "Open the web dashboard",
      hint: "opens browser",
    });
  }

  launchOptions.push({ value: "later", label: "Do this later", hint: "exit setup" });

  return prompter.select<LaunchChoice>({
    message: "What do you want to do now?",
    options: launchOptions,
    initialValue: "tui",
  });
}

// ── Full Finalize Flow ───────────────────────────────────────────────────

export interface FinalizeOptions {
  flow: WizardFlow;
  result: SetupResult;
  gateway: GatewayWizardSettings;
  prompter: WizardPrompter;
  configPath: string;
  skipHealth?: boolean;
  skipLaunch?: boolean;
}

export async function finalizeSetupWizard(opts: FinalizeOptions): Promise<{
  launchChoice: LaunchChoice;
  dashboardOpened: boolean;
}> {
  const { result, gateway, prompter, configPath, skipHealth, skipLaunch } = opts;

  // Print summary
  await printSetupSummary(prompter, result, configPath);

  // Security reminder
  await prompter.note(
    [
      "Security reminder:",
      "- Keep your auth token secret.",
      "- Running agents on your computer can be risky.",
      "- Use permission modes to limit agent capabilities.",
      "- Review allowed directories in the config.",
    ].join("\n"),
    "Security",
  );

  // Workspace backup reminder
  await prompter.note(
    "Back up your agent workspace directory regularly.",
    "Workspace backup",
  );

  // Health check (if gateway might be running)
  if (!skipHealth) {
    await runHealthCheck(prompter, gateway);
  }

  // Launch choice
  let launchChoice: LaunchChoice = "later";
  let dashboardOpened = false;

  if (!skipLaunch) {
    launchChoice = await promptLaunchChoice(prompter, result);

    // Dashboard opening is deferred to the CLI handler which starts the engine first.
    // This avoids opening a URL before the gateway is actually running.
  }

  await prompter.outro("Setup complete.");

  return { launchChoice, dashboardOpened };
}
