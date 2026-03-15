import { OAuthFlowDiagram } from "@/components/ArchitectureDiagram";

export default function OAuthPage() {
  return (
    <div>
      <h1 className="doc-title">OAuth Authentication</h1>
      <p className="doc-subtitle">
        Use your Claude Pro or Max subscription to authenticate without an API
        key. Works in both CLI and VS Code Extension.
      </p>

      <h2 className="doc-h2">How It Works</h2>

      <p className="doc-p">
        Cdoing uses the same OAuth 2.0 PKCE flow as Claude Code. Log in once,
        and both CLI and VS Code extension share the same token.
      </p>

      <OAuthFlowDiagram />

      <div className="callout callout-warning">
        <div className="callout-title">Model Limitation</div>
        OAuth currently only supports{" "}
        <strong>Claude Haiku 4.5</strong> (
        <span className="inline-code">claude-haiku-4-5-20251001</span>). For
        Sonnet or Opus, use an API key.
      </div>

      <h2 className="doc-h2">Setup — CLI</h2>

      <div className="step">
        <div className="step-number">1</div>
        <div className="step-content">
          <div className="step-title">Run the setup wizard</div>
          <div className="step-desc">
            Type <span className="inline-code">/setup</span> inside the CLI or
            run <span className="inline-code">cdoing --login</span> from your
            terminal.
          </div>
        </div>
      </div>

      <div className="step">
        <div className="step-number">2</div>
        <div className="step-content">
          <div className="step-title">Choose Anthropic → OAuth</div>
          <div className="step-desc">
            Select Anthropic as provider, then OAuth as auth method, then Claude
            Haiku 4.5 as the model.
          </div>
        </div>
      </div>

      <div className="step">
        <div className="step-number">3</div>
        <div className="step-content">
          <div className="step-title">Authorize in browser</div>
          <div className="step-desc">
            A browser window opens to{" "}
            <span className="inline-code">claude.ai/oauth/authorize</span>. Log
            in and approve the request.
          </div>
        </div>
      </div>

      <div className="step">
        <div className="step-number">4</div>
        <div className="step-content">
          <div className="step-title">Paste the code</div>
          <div className="step-desc">
            Copy the authorization code from the redirect URL and paste it into
            the CLI. Done — token saved securely.
          </div>
        </div>
      </div>

      <h2 className="doc-h2">Setup — VS Code Extension</h2>

      <div className="step">
        <div className="step-number">1</div>
        <div className="step-content">
          <div className="step-title">Open Settings</div>
          <div className="step-desc">
            Click the gear icon in the Cdoing chat panel to open Settings.
          </div>
        </div>
      </div>

      <div className="step">
        <div className="step-number">2</div>
        <div className="step-content">
          <div className="step-title">Select OAuth (Free)</div>
          <div className="step-desc">
            Under Authentication, switch from &quot;API Key&quot; to{" "}
            &quot;OAuth (Free)&quot;. Click &quot;Login with Claude&quot;.
          </div>
        </div>
      </div>

      <div className="step">
        <div className="step-number">3</div>
        <div className="step-content">
          <div className="step-title">Paste the code</div>
          <div className="step-desc">
            VS Code shows an input box — paste the authorization code from your
            browser. Status changes to &quot;Logged in&quot;.
          </div>
        </div>
      </div>

      <div className="callout callout-tip">
        <div className="callout-title">Auto-detection</div>
        If you already logged in via the CLI, the extension picks up the same
        tokens automatically — no extra setup needed. Just leave the API Key
        field empty.
      </div>

      <h2 className="doc-h2">Token Storage</h2>

      <table className="doc-table">
        <thead>
          <tr>
            <th>Platform</th>
            <th>Storage</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>macOS</td>
            <td>
              Keychain via{" "}
              <span className="inline-code">security</span> CLI
            </td>
          </tr>
          <tr>
            <td>Linux</td>
            <td>
              libsecret via{" "}
              <span className="inline-code">secret-tool</span>
            </td>
          </tr>
          <tr>
            <td>Windows</td>
            <td>
              Credential Manager via{" "}
              <span className="inline-code">cmdkey</span>
            </td>
          </tr>
          <tr>
            <td>Fallback</td>
            <td>
              AES-256-CBC encrypted file at{" "}
              <span className="inline-code">
                ~/.cdoing/.oauth-tokens.enc
              </span>
            </td>
          </tr>
        </tbody>
      </table>

      <p className="doc-p">
        Both CLI and VS Code extension use the same keychain service (
        <span className="inline-code">cdoing-agent</span>) via the shared{" "}
        <span className="inline-code">@cdoing/core</span> OAuth module. Log in
        from either one and the token is available everywhere.
      </p>

      <h2 className="doc-h2">Architecture — Shared Module</h2>

      <p className="doc-p">
        All OAuth logic lives in{" "}
        <span className="inline-code">@cdoing/core</span>. Both CLI and
        extension import from it — zero code duplication:
      </p>

      <div className="code-block">{`@cdoing/core (packages/core/src/oauth.ts)
├── Credential storage (Keychain / libsecret / cmdkey)
├── PKCE helpers (code verifier + challenge)
├── Token management (save / load / clear / refresh)
├── resolveOAuthToken() — auto-refresh wrapper
├── generateOAuthUrl() — authorization URL
├── exchangeOAuthCode() — code-to-token exchange
└── getOAuthStatus() — active / expired / none

@cdoing/cli → re-exports core + adds CLI UI (readline, chalk)
@cdoing/vscode → re-exports core + adds VS Code UI (input box)`}</div>

      <h2 className="doc-h2">Key Resolution Order</h2>

      <p className="doc-p">
        When authenticating with Anthropic, cdoing checks in this order:
      </p>

      <div className="code-block">{`1. --api-key flag (CLI argument)
2. apiKeyHelper script (from config.json)
3. Environment variable (ANTHROPIC_API_KEY)
4. Stored key in ~/.cdoing/config.json
5. OAuth token (auto-detected, auto-refreshed)
6. Interactive setup wizard (CLI only)`}</div>

      <h2 className="doc-h2">Troubleshooting</h2>

      <table className="doc-table">
        <thead>
          <tr>
            <th>Error</th>
            <th>Cause & Fix</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>500 Internal Server Error</td>
            <td>
              Wrong model — OAuth only supports{" "}
              <span className="inline-code">claude-haiku-4-5-20251001</span>.
              The system auto-selects it, but check your config.
            </td>
          </tr>
          <tr>
            <td>400 Credit balance too low</td>
            <td>
              Extension is using an API key instead of OAuth. Clear the API key
              in settings and ensure OAuth tokens exist.
            </td>
          </tr>
          <tr>
            <td>401 Invalid API key</td>
            <td>
              Token sent as x-api-key instead of Bearer. Re-run{" "}
              <span className="inline-code">/setup</span> or{" "}
              <span className="inline-code">cdoing --login</span>.
            </td>
          </tr>
          <tr>
            <td>Extension stuck on &quot;Thinking...&quot;</td>
            <td>
              Rebuild extension after core changes:{" "}
              <span className="inline-code">
                cd packages/vscode-extension && npm run build
              </span>
              , then reload VS Code.
            </td>
          </tr>
          <tr>
            <td>Token expired</td>
            <td>
              Auto-refresh should handle this. If it fails, re-login via{" "}
              <span className="inline-code">/setup</span> or the extension
              settings.
            </td>
          </tr>
        </tbody>
      </table>

      <h2 className="doc-h2">OAuth Endpoints</h2>

      <table className="doc-table">
        <thead>
          <tr>
            <th>Purpose</th>
            <th>URL</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Authorization</td>
            <td>
              <span className="inline-code">
                https://claude.ai/oauth/authorize
              </span>
            </td>
          </tr>
          <tr>
            <td>Token exchange</td>
            <td>
              <span className="inline-code">
                https://console.anthropic.com/v1/oauth/token
              </span>
            </td>
          </tr>
          <tr>
            <td>Redirect URI</td>
            <td>
              <span className="inline-code">
                https://console.anthropic.com/oauth/code/callback
              </span>
            </td>
          </tr>
          <tr>
            <td>Client ID</td>
            <td>
              <span className="inline-code">
                9d1c250a-e61b-44d9-88ed-5944d1962f5e
              </span>
            </td>
          </tr>
          <tr>
            <td>Scopes</td>
            <td>
              <span className="inline-code">
                org:create_api_key user:profile user:inference
              </span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
