/**
 * Auth Setup Module — Handles provider selection and authentication.
 *
 * Supports:
 *   - OAuth (PKCE flow via @cdoing/core)
 *   - Manual API key input
 *   - Environment variable detection
 *   - Skip (configure later)
 *
 * Follows openclaw's grouped auth-choice pattern.
 */

import type { WizardPrompter } from "./prompts";
import type { AuthChoice } from "./setup-types";
import { CredentialManager } from "../auth/credentials";
import { getProviders } from "@cdoing/ai";
import { supportsOAuth } from "@cdoing/core";

// ── Provider Catalog ─────────────────────────────────────────────────────

export interface ProviderDef {
  id: string;
  name: string;
  envKey: string;
  supportsOAuth: boolean;
  models: { id: string; label: string; hint?: string }[];
  defaultModel: string;
  defaultCodingModel: string;
}

export function buildProviderList(): ProviderDef[] {
  const catalog = getProviders();
  return catalog.map((p) => ({
    id: p.id,
    name: p.label,
    envKey: p.envVar || "",
    supportsOAuth: p.supportsOAuth || supportsOAuth(p.id),
    models: p.models.map((m) => ({
      id: m.id,
      label: m.label,
      hint: m.hint,
    })),
    defaultModel: p.models[0]?.id || "",
    defaultCodingModel: p.models.length > 1 ? p.models[1].id : p.models[0]?.id || "",
  }));
}

// ── Auth Result ──────────────────────────────────────────────────────────

export interface AuthResult {
  provider: ProviderDef;
  model: string;
  apiKey?: string;
  usedOAuth: boolean;
  authChoice: AuthChoice;
}

// ── Provider Selection ───────────────────────────────────────────────────

export async function promptProvider(prompter: WizardPrompter): Promise<ProviderDef> {
  const providers = buildProviderList();

  const providerId = await prompter.select({
    message: "AI Provider",
    options: providers.map((p) => ({
      value: p.id,
      label: p.name,
      hint: p.supportsOAuth ? "OAuth supported" : undefined,
    })),
    initialValue: "anthropic",
  });

  return providers.find((p) => p.id === providerId)!;
}

// ── Auth Choice ──────────────────────────────────────────────────────────

export async function promptAuthChoice(
  prompter: WizardPrompter,
  provider: ProviderDef,
): Promise<{ authChoice: AuthChoice; apiKey?: string; usedOAuth: boolean }> {
  const creds = new CredentialManager();

  await prompter.note(
    "Credentials are stored in ~/.cdoing/remote/ (separate from CLI).",
    "Authentication",
  );

  // Build auth options based on provider capabilities
  const options: { value: AuthChoice; label: string; hint: string }[] = [];

  if (provider.supportsOAuth) {
    options.push({
      value: "oauth",
      label: "OAuth",
      hint: "opens browser — recommended",
    });
  }

  options.push(
    { value: "apikey", label: "API Key", hint: "paste manually" },
    { value: "env", label: "Environment Variable", hint: "already set in shell" },
    { value: "skip", label: "Skip", hint: "configure later" },
  );

  const authChoice = await prompter.select({
    message: `Authenticate with ${provider.name}`,
    options,
    initialValue: provider.supportsOAuth ? "oauth" : "apikey",
  });

  let apiKey: string | undefined;
  let usedOAuth = false;

  if (authChoice === "oauth") {
    const progress = prompter.progress("OAuth");
    try {
      progress.update("Starting OAuth server...");
      const result = await creds.oauthLogin(provider.id);
      usedOAuth = true;
      progress.stop("OAuth login successful!");
      if (result.expiresAt) {
        await prompter.note(
          `Expires: ${new Date(result.expiresAt).toLocaleString()}\nStored in ~/.cdoing/remote/ (not shared with CLI).`,
        );
      }
    } catch (err) {
      progress.stop("OAuth failed");
      await prompter.note(
        `OAuth failed: ${err instanceof Error ? err.message : err}\nYou can try again later or use an API key.`,
        "Error",
      );
      // Fallback to API key
      apiKey = await prompter.password({
        message: `Enter ${provider.name} API key instead`,
      });
      if (apiKey) {
        creds.saveApiKey(provider.id, apiKey, "assistant");
      }
    }
  } else if (authChoice === "apikey") {
    apiKey = await prompter.password({
      message: `Enter your ${provider.name} API key`,
      validate: (v) => (!v ? "API key cannot be empty" : undefined),
    });
    if (apiKey) {
      creds.saveApiKey(provider.id, apiKey, "assistant");
    }
  } else if (authChoice === "env") {
    const envValue = process.env[provider.envKey];
    if (envValue) {
      await prompter.note(`Found ${provider.envKey} in environment.`);
    } else {
      await prompter.note(
        `${provider.envKey} not found in environment.\nSet it before starting the agent.`,
        "Warning",
      );
    }
  }

  return { authChoice, apiKey, usedOAuth };
}

// ── Model Selection ──────────────────────────────────────────────────────

export async function promptModel(
  prompter: WizardPrompter,
  provider: ProviderDef,
  role: "assistant" | "coding" = "assistant",
): Promise<string> {
  const hint =
    role === "assistant"
      ? "Use a fast/cheap model for chat and routing."
      : "Use a powerful model for file edits, builds, and complex tasks.";

  await prompter.note(hint);

  const defaultModel =
    role === "coding" ? provider.defaultCodingModel : provider.defaultModel;

  const modelId = await prompter.select({
    message: role === "assistant" ? "Assistant model" : "Coding model",
    options: provider.models.map((m) => ({
      value: m.id,
      label: m.label,
      hint: m.hint,
    })),
    initialValue: defaultModel,
  });

  return modelId;
}

// ── Coding Model Setup ───────────────────────────────────────────────────

export interface CodingModelResult {
  enabled: boolean;
  codingProvider?: string;
  codingModel?: string;
  codingApiKey?: string;
}

export async function promptCodingModel(
  prompter: WizardPrompter,
  mainProvider: ProviderDef,
): Promise<CodingModelResult> {
  await prompter.note(
    "The coding agent handles file edits, builds, and complex tasks.\nThe assistant delegates to this model when coding skills are needed.",
    "Coding Agent Setup",
  );

  const useSame = await prompter.confirm({
    message: `Use ${mainProvider.name} for coding too?`,
    initialValue: true,
  });

  let codingProvider: ProviderDef;
  if (useSame) {
    codingProvider = mainProvider;
  } else {
    codingProvider = await promptProvider(prompter);

    // Auth for different provider
    if (codingProvider.id !== mainProvider.id) {
      const { apiKey } = await promptAuthChoice(prompter, codingProvider);
      if (apiKey) {
        const creds = new CredentialManager();
        creds.saveApiKey(codingProvider.id, apiKey, "coding");
      }
    }
  }

  const codingModel = await promptModel(prompter, codingProvider, "coding");

  return {
    enabled: true,
    codingProvider: codingProvider.id,
    codingModel,
  };
}
