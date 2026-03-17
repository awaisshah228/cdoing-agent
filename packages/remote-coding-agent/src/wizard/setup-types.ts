/**
 * Shared types for the setup wizard modules.
 */

export type WizardFlow = "quickstart" | "advanced";

export type ResetScope = "config" | "config+creds" | "full";

export type AuthChoice =
  | "oauth"
  | "apikey"
  | "env"
  | "skip";

export type GatewayBind = "loopback" | "lan" | "custom";

export type GatewayAuthMode = "token" | "password" | "none";

/** Skill option shown during setup. */
export interface SkillOption {
  id: string;
  name: string;
  desc: string;
  defaultOn: boolean;
}

/** Gateway wizard settings resolved during setup. */
export interface GatewayWizardSettings {
  port: number;
  bind: GatewayBind;
  authMode: GatewayAuthMode;
  authToken?: string;
  customBindHost?: string;
}

/** QuickStart defaults derived from existing config. */
export interface QuickstartGatewayDefaults {
  hasExisting: boolean;
  port: number;
  bind: GatewayBind;
  authMode: GatewayAuthMode;
  token?: string;
  customBindHost?: string;
}

/** Full result produced by the setup wizard. */
export interface SetupResult {
  provider: string;
  model: string;
  apiKey?: string;
  usedOAuth: boolean;
  hasCodingModel: boolean;
  codingProvider?: string;
  codingModel?: string;
  codingApiKey?: string;
  telegramEnabled: boolean;
  telegramToken?: string;
  authToken: string;
  allowedDirs: string[];
  workingDir: string;
  port: number;
  permissionMode: string;
  logLevel: string;
  enabledSkills: string[];
  gatewayBind: GatewayBind;
  gatewayAuthMode: GatewayAuthMode;
}

/** Existing config snapshot for detect/reset flow. */
export interface ConfigSnapshot {
  exists: boolean;
  valid: boolean;
  config: Record<string, unknown>;
  path: string | null;
  issues: string[];
}
