# OAuth Authentication — Cdoing Agent

Use your **Claude Pro or Claude Max subscription** to authenticate without an API key.

---

## How It Works

Cdoing uses the same OAuth 2.0 PKCE flow as Claude Code:

1. Generate a PKCE code verifier + challenge
2. Open `claude.ai/oauth/authorize` in your browser
3. You approve → browser redirects to `console.anthropic.com/oauth/code/callback`
4. Copy the `code=` value from the redirect URL
5. Paste it into cdoing — it exchanges the code for an access token
6. Token is stored securely in your OS credential store

---

## Setup

### Option A — Interactive wizard (recommended)

Run inside the CLI:

```
/setup
```

Steps:
1. Choose **Anthropic**
2. Choose **OAuth**
3. Choose **Claude Haiku 4.5** (only model supported with OAuth)
4. Browser opens automatically to `claude.ai/oauth/authorize`
5. Log in and approve → you land on a page with a code in the URL
6. Copy the `code=` value and paste it into the wizard
7. Done — token saved, agent rebuilds automatically

### Option B — CLI flag

```bash
cdoing --login
```

Same flow as above but outside the TUI (readline prompt).

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
/auth-status
```

---

## Logout

```bash
# CLI flag
cdoing --logout

# Slash command (inside TUI)
/logout
```

This clears tokens from the OS credential store and the encrypted file fallback.

---

## How Bearer Auth Works

OAuth tokens use `Authorization: Bearer <token>` — **not** `x-api-key`. The Anthropic SDK requires these beta headers alongside the token:

```
anthropic-beta: oauth-2025-04-20,interleaved-thinking-2025-05-14
user-agent: claude-cli/2.1.7 (external, cli)
x-app: cli
```

LangChain normally injects `top_p: -1` and `temperature` into every request. The OAuth API rejects these, so cdoing strips them via a custom `fetch` interceptor before the request is sent.

---

## Supported Models

OAuth currently only works with **Claude Haiku 4.5**. Other models require an API key.

---

## Troubleshooting

**"Token exchange failed (404)"**
— Wrong token URL. Cdoing uses `https://console.anthropic.com/v1/oauth/token`. Check you haven't accidentally set a custom `base-url` that overrides this.

**"invalid x-api-key" (401)**
— The token is being sent as an API key instead of Bearer auth. Make sure you ran `/setup` after the latest build. Run `/auth-status` to confirm the OAuth token is stored.

**"Browser didn't open"**
— The wizard shows the full URL. Copy it and open it manually. The flow works the same.

**"Token expired / refresh failed"**
— Run `/setup` or `cdoing --login` to get a new token.

**"secret-tool not found" (Linux)**
— Install libsecret: `sudo apt install libsecret-tools`. Without it, tokens fall back to the encrypted file at `~/.cdoing/.oauth-tokens.enc`.

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
