/**
 * CLI Configuration
 *
 * Handles parsing and validation of CLI options into
 * structured config objects for the model and permissions.
 */

import {
  PermissionManager,
  PermissionMode,
} from "@cdoing/core";
import {
  getApiKeyEnvVar,
  type ModelConfig,
} from "@cdoing/ai";

/** CLI options passed from Commander */
export interface CLIOptions {
  model?: string;
  provider: string;
  baseUrl?: string;
  apiKey?: string;
  mode: string;
  dir: string;
}

/**
 * Parse the --mode flag into a PermissionMode enum value.
 * Defaults to ASK if the value is unrecognized.
 */
export function parsePermissionMode(mode: string): PermissionMode {
  switch (mode) {
    case "auto":
      return PermissionMode.AUTO;
    case "auto-edit":
      return PermissionMode.AUTO_EDIT;
    default:
      return PermissionMode.ASK;
  }
}

/**
 * Build a ModelConfig from the CLI options.
 * Only includes fields that were explicitly provided.
 */
export function buildModelConfig(options: CLIOptions): Partial<ModelConfig> {
  return {
    provider: options.provider.toLowerCase(),
    model: options.model,
    baseURL: options.baseUrl,
    apiKey: options.apiKey,
  };
}

/**
 * Create a PermissionManager from the CLI --mode flag.
 */
export function createPermissionManager(options: CLIOptions): PermissionManager {
  const mode = parsePermissionMode(options.mode);
  return new PermissionManager(mode);
}

/**
 * Validate that an API key is available — either via --api-key flag
 * or the corresponding environment variable for the chosen provider.
 *
 * Exits with an error message if no key is found.
 */
export function validateApiKey(options: CLIOptions): void {
  if (options.apiKey) return;

  const provider = options.provider.toLowerCase();
  const envVar = getApiKeyEnvVar(provider);

  if (!process.env[envVar]) {
    console.error(`\n  Error: ${envVar} environment variable is not set.`);
    console.error(`  Set it with: export ${envVar}=your-api-key`);
    console.error(`  Or pass --api-key directly.\n`);
    process.exit(1);
  }
}
