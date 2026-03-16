
# OAuth Authentication — Cdoing Agent

Use your **Claude Pro or Claude Max subscription** to authenticate without an API key. Works in both the **CLI** and the **VS Code Extension**.

---

## How It Works

Cdoing uses the same OAuth 2.0 PKCE flow as Claude Code:

1. Generate a PKCE code verifier + challenge
2. Open `claude.ai/oauth/authorize` in your browser
3. You approve the request
4. Browser redirects to `console.anthropic.com/oauth/code/callback` with a code
5. Copy the `code=` value from the redirect URL
6. Paste it into cdoing — it exchanges the code for an access token
7. Token is stored securely in your OS credential store

Both the CLI and VS Code extension share the **same token storage** — log in once, use everywhere.

---

## Supported Models

OAuth currently only works with **Claude Haiku 4.5** (`claude-haiku-4-5-20251001`). If you need Sonnet or Opus, use an API key instead. When OAuth is active, the model is automatically set to Haiku regardless of your config.

---

## Setup — CLI

### Option A: Interactive wizard (recommended)

Run inside the CLI:

```
/setup
```

1. Choose **Anthropic**
2. Choose **OAuth**
3. Choose **Claude Haiku 4.5** (only model supported with OAuth)
4. Browser opens automatically to `claude.ai/oauth/authorize`
5. Log in and approve — you land on a page with a code in the URL
6. Copy the `code=` value and paste it into the wizard
7. Done — token saved, agent rebuilds automatically

### Option B: CLI flag

```bash
cdoing --login
```

Same flow as above but outside the TUI (readline prompt).

---

## Setup — VS Code Extension

### Option A: Settings panel (recommended)

1. Open the Cdoing chat panel
2. Click the **gear icon** to open Settings
3. Under **Authentication**, select **OAuth (Free)**
4. Click **Login with Claude**
5. A browser window opens — log in and approve
6. VS Code shows an input box — paste the authorization code
7. Done — status shows "Logged in"

### Option B: Use CLI tokens

If you already logged in via the CLI (`cdoing --login` or `/setup`), the extension picks up the same tokens automatically — no extra setup needed. Just make sure no API key is configured in the extension settings (leave the API Key field empty).

### Auto-detection

When the extension starts with **no API key configured**, it automatically checks for stored OAuth tokens. If found, it uses them. This means:

- Log in once via CLI or extension
- Both use the same tokens from the OS credential store
- No need to set `authMethod` to "oauth" explicitly

---

## Token Storage

Tokens are stored in the OS credential manager:

| Platform | Storage |
|----------|---------|
| macOS | Keychain (`security` CLI) |
| Linux | libsecret via `secret-tool` (GNOME/KDE) |
| Windows | Windows Credential Manager (`cmdkey`) |
| Fallback | AES-256-CBC encrypted file at `~/.cdoing/.oauth-tokens.enc` |

The encryption key for the file fallback is derived from your hostname + username (machine-specific).

**Shared storage:** Both CLI and VS Code extension use the same keychain service (`cdoing-agent`) and the same core OAuth module (`@cdoing/core`). Logging in from either one makes the token available to both.

---

## Token Lifecycle

| Field | Description |
|-------|-------------|
| `access_token` | Used for API calls (Bearer auth) |
| `refresh_token` | Used to get a new access token when expired |
| `expires_at` | Epoch ms when the access token expires |

On startup, if the stored token is expired and a refresh token is available, cdoing automatically refreshes it. If refresh fails, you'll be prompted to log in again.

Check status at any time:

```
# CLI (inside TUI)
/auth-status

# VS Code Extension
Open Settings → Authentication section shows status
```

---

## Logout

```bash
# CLI flag
cdoing --logout

# Slash command (inside TUI)
/logout
```

In VS Code: Open Settings → Authentication → click **Logout**.

This clears tokens from the OS credential store and the encrypted file fallback.

---

## Architecture — Shared OAuth Module

All OAuth logic lives in `@cdoing/core` (the shared package). Both CLI and VS Code extension import from it:

```
@cdoing/core (packages/core/src/oauth.ts)
├── Credential storage (Keychain / libsecret / cmdkey / encrypted file)
├── PKCE helpers (code verifier + challenge)
├── Token management (save / load / clear / refresh)
├── resolveOAuthToken() — auto-refresh wrapper
├── generateOAuthUrl() — authorization URL
├── exchangeOAuthCode() — code-to-token exchange
└── getOAuthStatus() — check if active/expired/none

@cdoing/cli (packages/cli/src/oauth.ts)
├── Re-exports everything from @cdoing/core
├── oauthLogin() — CLI-specific (readline + browser opener)
├── oauthLogout() — returns status message string
└── oauthStatus() — detailed CLI status report

@cdoing/vscode-extension (packages/vscode-extension/src/oauth.ts)
├── Re-exports everything from @cdoing/core
└── oauthLogout() — void (no message needed)
```

This means:
- **Zero duplication** — credential storage, PKCE, token management written once
- **Fix once, fix everywhere** — a bug fix in core applies to both CLI and extension
- **Core has no UI dependencies** — it doesn't depend on CLI or VS Code

---

## How Bearer Auth Works

OAuth tokens use `Authorization: Bearer <token>` — **not** `x-api-key`. The Anthropic SDK requires these headers alongside the token:

```
anthropic-beta: oauth-2025-04-20,interleaved-thinking-2025-05-14
user-agent: claude-cli/2.1.7 (external, cli)
x-app: cli
```

LangChain normally injects `top_p: -1` and `temperature` into every request. The OAuth API rejects these, so cdoing strips them via a custom `fetch` interceptor before the request is sent.

---

## Key Resolution Order

When cdoing needs to authenticate with Anthropic, it checks in this order:

```
1. --api-key flag (CLI argument)
2. apiKeyHelper script (from config.json)
3. Environment variable (ANTHROPIC_API_KEY)
4. Stored key in ~/.cdoing/config.json
5. OAuth token (auto-detected, auto-refreshed if expired)
6. Interactive setup wizard (CLI only)
```

The VS Code extension follows the same order, minus the CLI-only options.

---

## Troubleshooting

**"Internal server error (500)"**
— You're using a model that OAuth doesn't support. OAuth only works with `claude-haiku-4-5-20251001`. Other models (Sonnet, Opus) require an API key.

**"Credit balance too low (400)"**
— The extension is using an API key instead of OAuth. Clear the API key from VS Code settings (leave it empty) and make sure OAuth tokens are stored (run `cdoing --login` or use the extension's Login button).

**"Token exchange failed (404)"**
— Wrong token URL. Cdoing uses `https://console.anthropic.com/v1/oauth/token`. Check you haven't set a custom `base-url` that overrides this.

**"invalid x-api-key" (401)**
— The token is being sent as an API key instead of Bearer auth. Run `/setup` or `cdoing --login` to re-authenticate.

**"Browser didn't open"**
— Copy the URL shown in the terminal/input box and open it manually. The flow works the same.

**"Token expired / refresh failed"**
— Run `/setup`, `cdoing --login`, or use the extension's Login button to get a new token.

**"secret-tool not found" (Linux)**
— Install libsecret: `sudo apt install libsecret-tools`. Without it, tokens fall back to the encrypted file at `~/.cdoing/.oauth-tokens.enc`.

**Extension stuck on "Thinking..." with no output**
— Check the Debug Console (View → Debug Console or Cmd+Shift+Y) for `[cdoing]` log lines. Common causes:
1. Wrong model (500) — OAuth only supports Haiku
2. No token found — run `cdoing --login` first
3. Stale bundle — rebuild with `cd packages/vscode-extension && npm run build`, then reload VS Code

---

## OAuth Endpoints

| Purpose | URL |
|---------|-----|
| Authorization | `https://claude.ai/oauth/authorize` |
| Token exchange | `https://console.anthropic.com/v1/oauth/token` |
| Redirect URI | `https://console.anthropic.com/oauth/code/callback` |
| Client ID | `9d1c250a-e61b-44d9-88ed-5944d1962f5e` |
| Scopes | `org:create_api_key user:profile user:inference` |

These match the endpoints used by the official Claude Code CLI.

---

## Development

### Adding OAuth support to a new package

Since all OAuth logic lives in `@cdoing/core`, adding OAuth to a new consumer is simple:

```typescript
import {
  resolveOAuthToken,
  getOAuthStatus,
  loadOAuthTokens,
  generateOAuthUrl,
  exchangeOAuthCode,
  clearOAuthTokens,
} from "@cdoing/core";

// Check if OAuth is available
const status = getOAuthStatus();
if (status.status === "active") {
  const tokens = loadOAuthTokens();
  // Use tokens.access_token with Bearer auth
}

// Or auto-resolve (refreshes if expired)
const token = await resolveOAuthToken();
if (token) {
  // Ready to use
}
```

### Testing OAuth locally

```bash
# Check token status
node -e "const { getOAuthStatus } = require('./packages/core/dist/oauth'); console.log(getOAuthStatus())"

# Test API call with OAuth
node -e "
const { resolveOAuthToken } = require('./packages/core/dist/oauth');
resolveOAuthToken().then(async (token) => {
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'authorization': 'Bearer ' + token,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'oauth-2025-04-20,interleaved-thinking-2025-05-14',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 50,
      messages: [{ role: 'user', content: 'Hi' }],
    }),
  });
  console.log('Status:', resp.status);
  console.log('Body:', await resp.text());
});
"
```

### Rebuilding after OAuth changes

OAuth code lives in `@cdoing/core`. After modifying it:

```bash
# 1. Build core
npx tsc -p packages/core/tsconfig.json

# 2. Rebuild CLI (uses core via npm link)
npx tsc -p packages/cli/tsconfig.json

# 3. Rebuild VS Code extension (bundles core via esbuild)
cd packages/vscode-extension && npm run build

# 4. Reload VS Code (Cmd+Shift+P → "Developer: Reload Window")
```

The VS Code extension uses **esbuild** to bundle all dependencies including `@cdoing/core` into a single `dist/extension.js`. This means you **must rebuild the extension** after any change to core — it won't pick up changes automatically.
