/**
 * Test OAuth models — verifies which Anthropic models work with your OAuth token.
 *
 * Usage:
 *   npx tsx helpers/test-oauth-models.ts
 *
 * What it does:
 *   1. Loads your stored OAuth token from Keychain / encrypted file
 *   2. Shows token status (active/expired, refresh token available)
 *   3. Tests each Anthropic OAuth model with and without thinking
 *   4. Reports which models work and which fail
 *
 * Requirements:
 *   - Must have run OAuth login first (via setup wizard or /login)
 *   - Requires billing header for Sonnet/Opus models
 */

import {
  loadOAuthTokens,
  isOAuthExpired,
  resolveOAuthToken,
  getOAuthProvider,
} from "../packages/core/src/oauth";

const ANTHROPIC_MODELS = [
  "claude-haiku-4-5",
  "claude-sonnet-4-5",
  "claude-sonnet-4-6",
  "claude-opus-4-5",
  "claude-opus-4-6",
];

const BETA_HEADER =
  "claude-code-20250219,oauth-2025-04-20,interleaved-thinking-2025-05-14";

async function testModel(
  model: string,
  token: string,
  useThinking: boolean,
): Promise<{ model: string; status: string; error?: string; thinking: boolean }> {
  // Billing header is REQUIRED for Sonnet/Opus via OAuth
  const billingHeader = {
    type: "text",
    text: "x-anthropic-billing-header: cc_version=1.0.0; cc_entrypoint=cli;",
  };

  const body: Record<string, unknown> = {
    model,
    max_tokens: useThinking ? 2048 : 256,
    system: [billingHeader, { type: "text", text: "You are a helpful assistant." }],
    messages: [{ role: "user", content: "Say hi in one word." }],
  };

  if (useThinking) {
    body.thinking = { type: "enabled", budget_tokens: 1024 };
  }

  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "anthropic-beta": BETA_HEADER,
        "anthropic-version": "2023-06-01",
        "user-agent": "claude-cli/1.0.83 (external, cli)",
        "x-app": "cli",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify(body),
    });

    if (resp.ok) {
      const data = (await resp.json()) as Record<string, unknown>;
      const usage = data.usage as Record<string, number> | undefined;
      return {
        model,
        thinking: useThinking,
        status: `✓ OK (${usage?.input_tokens || "?"}in/${usage?.output_tokens || "?"}out tokens)`,
      };
    } else {
      const text = await resp.text();
      let errorMsg: string;
      try {
        const err = JSON.parse(text);
        errorMsg =
          err.error?.message || err.message || JSON.stringify(err).substring(0, 400);
      } catch {
        errorMsg = text.substring(0, 400);
      }
      return { model, thinking: useThinking, status: `✗ ${resp.status}`, error: errorMsg };
    }
  } catch (err) {
    return {
      model,
      thinking: useThinking,
      status: "✗ NETWORK_ERROR",
      error: (err as Error).message,
    };
  }
}

async function main() {
  console.log("=== OAuth Token Check ===\n");

  const tokens = loadOAuthTokens("anthropic");
  if (!tokens) {
    console.log("✗ No OAuth tokens found for Anthropic.");
    console.log("  Run the setup wizard or /login to authenticate.");
    process.exit(1);
  }

  console.log("Token found:");
  console.log(
    `  access_token: ${tokens.access_token.substring(0, 20)}...${tokens.access_token.substring(tokens.access_token.length - 10)}`,
  );
  console.log(`  token_type:   ${tokens.token_type}`);
  console.log(`  has refresh:  ${!!tokens.refresh_token}`);
  if (tokens.expires_at) {
    const expiresIn = Math.round((tokens.expires_at - Date.now()) / 1000 / 60);
    console.log(
      `  expires:      ${new Date(tokens.expires_at).toISOString()} (${expiresIn > 0 ? `in ${expiresIn}m` : "EXPIRED"})`,
    );
  }
  console.log(`  expired:      ${isOAuthExpired(tokens)}`);

  const resolvedToken = await resolveOAuthToken("anthropic");
  if (!resolvedToken) {
    console.log("\n✗ Failed to resolve OAuth token (expired + no refresh token).");
    process.exit(1);
  }
  console.log(`\nResolved token: ${resolvedToken.substring(0, 20)}...`);

  const oauthConfig = getOAuthProvider("anthropic");
  console.log(`\nOAuth config:`);
  console.log(`  Token URL:     ${oauthConfig?.tokenUrl}`);
  console.log(`  Redirect URI:  ${oauthConfig?.redirectUri}`);
  console.log(`  Default model: ${oauthConfig?.defaultModel}`);
  console.log(`  Models:        ${oauthConfig?.models?.map((m) => m.id).join(", ")}`);

  console.log("\n=== Testing Anthropic OAuth Models ===\n");

  for (const model of ANTHROPIC_MODELS) {
    const isThinkingCapable = model.includes("opus") || model.includes("sonnet");

    process.stdout.write(`  ${model.padEnd(25)} [no-think] `);
    const r1 = await testModel(model, resolvedToken, false);
    console.log(r1.status);
    if (r1.error) console.log(`    → ${r1.error}`);

    if (isThinkingCapable) {
      process.stdout.write(`  ${"".padEnd(25)} [thinking] `);
      const r2 = await testModel(model, resolvedToken, true);
      console.log(r2.status);
      if (r2.error) console.log(`    → ${r2.error}`);
    }
  }

  console.log("\nDone.");
}

main().catch(console.error);
