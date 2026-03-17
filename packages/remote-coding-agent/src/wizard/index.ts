/**
 * Wizard module — Modular setup wizard for the Remote Coding Agent.
 *
 * Architecture follows openclaw's onboard pattern:
 *   - WizardPrompter abstraction with multiSelect for skill toggles
 *   - Separate modules for auth, channels, skills, gateway, finalize
 *   - Onboard helpers: browser detection, SSH hints, workspace bootstrap, safe reset
 *   - Main orchestrator with QuickStart vs Advanced vs Non-interactive flows
 *   - Existing config detection and reset (trash-based)
 */

// Prompter
export { createCliPrompter, WizardCancelledError } from "./prompts";
export type {
  WizardPrompter,
  SelectOption,
  SelectParams,
  MultiSelectOption,
  MultiSelectParams,
  ConfirmParams,
  TextParams,
  PasswordParams,
  ProgressHandle,
} from "./prompts";

// Types
export type {
  WizardFlow,
  ResetScope,
  AuthChoice,
  GatewayBind,
  GatewayAuthMode,
  SkillOption,
  GatewayWizardSettings,
  QuickstartGatewayDefaults,
  SetupResult,
  ConfigSnapshot,
} from "./setup-types";

// Auth
export { buildProviderList, promptProvider, promptAuthChoice, promptModel, promptCodingModel } from "./setup-auth";
export type { ProviderDef, AuthResult, CodingModelResult } from "./setup-auth";

// Channels
export { setupChannels } from "./setup-channels";
export type { ChannelSetupResult } from "./setup-channels";

// Skills
export { setupSkills, SKILL_OPTIONS } from "./setup-skills";

// Gateway
export {
  probeGatewayReachable,
  waitForGatewayReachable,
  configureGateway,
  promptPermissionMode,
  promptWorkingDir,
  promptLogLevel,
} from "./setup-gateway";
export type { GatewayProbeResult } from "./setup-gateway";

// Finalize
export { writeSetupConfig, runHealthCheck, printSetupSummary, promptLaunchChoice, finalizeSetupWizard } from "./setup-finalize";
export type { LaunchChoice, FinalizeOptions } from "./setup-finalize";

// Onboard helpers
export {
  detectBrowserOpenSupport,
  openUrl,
  formatSshHint,
  resolveControlUiLinks,
  ensureWorkspaceAndSessions,
  moveToTrash,
  handleReset,
  printWizardHeader,
} from "./onboard-helpers";
export type { BrowserOpenSupport } from "./onboard-helpers";

// Main orchestrator
export { runSetupWizard } from "./setup";
export type { SetupWizardOptions, NonInteractiveOverrides } from "./setup";
