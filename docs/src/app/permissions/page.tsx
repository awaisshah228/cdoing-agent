export default function Permissions() {
  return (
    <div>
      <h1 className="doc-title">Permissions & Sandbox</h1>
      <p className="doc-subtitle">
        The security layer that controls what the AI agent can do — permission
        modes, rule engine, filesystem sandbox, and network restrictions.
      </p>

      <h2 className="doc-h2">Permission Modes</h2>

      <p className="doc-p">
        Five modes control the default behavior when the agent tries to use a
        tool:
      </p>

      <table className="doc-table">
        <thead>
          <tr>
            <th>Mode</th>
            <th>Identifier</th>
            <th>Behavior</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><span className="badge badge-blue">Default</span></td>
            <td><span className="inline-code">default</span></td>
            <td>Prompt user on first use of each tool</td>
          </tr>
          <tr>
            <td><span className="badge badge-green">Accept Edits</span></td>
            <td><span className="inline-code">acceptEdits</span></td>
            <td>Auto-approve file edits, ask for shell commands</td>
          </tr>
          <tr>
            <td><span className="badge badge-purple">Plan</span></td>
            <td><span className="inline-code">plan</span></td>
            <td>Read-only mode — blocks write, exec, and delete tools</td>
          </tr>
          <tr>
            <td><span className="badge badge-yellow">Don&apos;t Ask</span></td>
            <td><span className="inline-code">dontAsk</span></td>
            <td>Deny all unless explicitly allowed by rules</td>
          </tr>
          <tr>
            <td>
              <span className="badge" style={{ background: "rgba(239,68,68,0.15)", color: "#f87171" }}>Bypass</span>
            </td>
            <td><span className="inline-code">bypassPermissions</span></td>
            <td>Auto-approve everything (unsafe, for trusted environments)</td>
          </tr>
        </tbody>
      </table>

      <h2 className="doc-h2">Rule Engine</h2>

      <p className="doc-p">
        The rule engine provides fine-grained control over tool permissions using
        a 3-tier evaluation system:
      </p>

      <h3 className="doc-h3">Rule Priority (Highest to Lowest)</h3>

      <div className="step">
        <div className="step-number">1</div>
        <div className="step-content">
          <div className="step-title" style={{ color: "#f87171" }}>Deny Rules</div>
          <div className="step-desc">
            Always win. Cannot be overridden by any other rule. Use these to
            block dangerous operations permanently.
          </div>
        </div>
      </div>

      <div className="step">
        <div className="step-number">2</div>
        <div className="step-content">
          <div className="step-title" style={{ color: "#fbbf24" }}>Ask Rules</div>
          <div className="step-desc">
            Override allow rules. Forces the agent to prompt the user for
            permission even if an allow rule would match.
          </div>
        </div>
      </div>

      <div className="step">
        <div className="step-number">3</div>
        <div className="step-content">
          <div className="step-title" style={{ color: "#34d399" }}>Allow Rules</div>
          <div className="step-desc">
            Auto-approve when no deny or ask rule matches. Use these for trusted
            operations.
          </div>
        </div>
      </div>

      <h3 className="doc-h3">Rule Syntax</h3>

      <table className="doc-table">
        <thead>
          <tr>
            <th>Pattern</th>
            <th>Description</th>
            <th>Example</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><span className="inline-code">Tool</span></td>
            <td>All uses of a tool</td>
            <td><span className="inline-code">Read</span></td>
          </tr>
          <tr>
            <td><span className="inline-code">Tool(*)</span></td>
            <td>Same as above (explicit wildcard)</td>
            <td><span className="inline-code">Edit(*)</span></td>
          </tr>
          <tr>
            <td><span className="inline-code">Bash(cmd *)</span></td>
            <td>Shell commands (wildcard with word boundaries)</td>
            <td><span className="inline-code">Bash(npm *)</span></td>
          </tr>
          <tr>
            <td><span className="inline-code">Read(path)</span></td>
            <td>Read a specific file or directory</td>
            <td><span className="inline-code">Read(src/**)</span></td>
          </tr>
          <tr>
            <td><span className="inline-code">Edit(path)</span></td>
            <td>Edit a specific file or directory</td>
            <td><span className="inline-code">Edit(src/**.ts)</span></td>
          </tr>
          <tr>
            <td><span className="inline-code">Delete(path)</span></td>
            <td>Delete a specific file</td>
            <td><span className="inline-code">Delete(tmp/**)</span></td>
          </tr>
          <tr>
            <td><span className="inline-code">WebFetch(domain:x)</span></td>
            <td>Fetch from a domain (wildcards allowed)</td>
            <td><span className="inline-code">WebFetch(domain:*.github.com)</span></td>
          </tr>
          <tr>
            <td><span className="inline-code">Agent(name)</span></td>
            <td>Sub-agent names</td>
            <td><span className="inline-code">Agent(researcher)</span></td>
          </tr>
        </tbody>
      </table>

      <h2 className="doc-h2">Settings Hierarchy</h2>

      <p className="doc-p">
        Permission rules can be defined at three levels. Higher-priority settings
        override lower-priority ones:
      </p>

      <div className="step">
        <div className="step-number">1</div>
        <div className="step-content">
          <div className="step-title">
            Local Project{" "}
            <span className="badge badge-purple">Highest Priority</span>
          </div>
          <div className="step-desc">
            <span className="inline-code">.claude/settings.local.json</span> —
            Personal overrides for this project (gitignored).
          </div>
        </div>
      </div>

      <div className="step">
        <div className="step-number">2</div>
        <div className="step-content">
          <div className="step-title">Shared Project</div>
          <div className="step-desc">
            <span className="inline-code">.claude/settings.json</span> — Shared
            project settings (committed to git, shared with team).
          </div>
        </div>
      </div>

      <div className="step">
        <div className="step-number">3</div>
        <div className="step-content">
          <div className="step-title">
            User Global{" "}
            <span className="badge badge-blue">Lowest Priority</span>
          </div>
          <div className="step-desc">
            <span className="inline-code">~/.claude/settings.json</span> —
            User-wide defaults that apply to all projects.
          </div>
        </div>
      </div>

      <h3 className="doc-h3">Settings File Format</h3>

      <div className="code-block">{`{
  "permissions": {
    "allow": [
      "Read",
      "Edit(src/**)",
      "Bash(npm test)",
      "Bash(npm run *)"
    ],
    "deny": [
      "Bash(rm -rf *)",
      "Delete(*.env)"
    ],
    "ask": [
      "Bash(git push *)",
      "WebFetch(domain:*)"
    ]
  }
}`}</div>

      <h2 className="doc-h2">Filesystem Sandbox</h2>

      <p className="doc-p">
        The filesystem sandbox restricts which paths the agent can read from and
        write to.
      </p>

      <h3 className="doc-h3">Sandbox Modes</h3>

      <table className="doc-table">
        <thead>
          <tr>
            <th>Mode</th>
            <th>Behavior</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><span className="inline-code">regular</span></td>
            <td>No sandbox — all filesystem access allowed</td>
          </tr>
          <tr>
            <td><span className="inline-code">auto-allow</span></td>
            <td>Auto-approve if path passes sandbox checks (no prompt)</td>
          </tr>
          <tr>
            <td><span className="inline-code">strict</span></td>
            <td>Deny by default, must explicitly allow paths</td>
          </tr>
        </tbody>
      </table>

      <h3 className="doc-h3">Sandbox Configuration</h3>

      <div className="code-block">{`{
  "sandbox": {
    "enabled": true,
    "mode": "auto-allow",
    "filesystem": {
      "allowWrite": ["~/Downloads", "/tmp"],
      "denyWrite": ["/etc", "/usr"],
      "denyRead": ["~/.ssh", "~/.aws", "~/.env"]
    },
    "network": {
      "allowedDomains": [
        "api.github.com",
        "*.npmjs.org"
      ],
      "allowManagedDomainsOnly": false
    }
  }
}`}</div>

      <h2 className="doc-h2">Network Sandbox</h2>

      <p className="doc-p">
        The network sandbox controls which domains the agent can access via the{" "}
        <span className="inline-code">web_fetch</span> tool:
      </p>

      <ul className="feature-list">
        <li>
          <strong>Domain allowlisting</strong> — Only specified domains are
          accessible (wildcards supported)
        </li>
        <li>
          <strong>Session approvals</strong> — Domains can be approved for the
          current session when prompted
        </li>
        <li>
          <strong>Managed domains only</strong> — Optional strict mode that
          blocks all non-allowlisted domains without prompting
        </li>
      </ul>

      <h2 className="doc-h2">Runtime Permission Storage</h2>

      <p className="doc-p">
        Permissions granted at runtime are stored in:
      </p>

      <table className="doc-table">
        <thead>
          <tr>
            <th>Scope</th>
            <th>Location</th>
            <th>Persistence</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Global</td>
            <td><span className="inline-code">~/.cdoing/permissions.json</span></td>
            <td>Persistent across all projects</td>
          </tr>
          <tr>
            <td>Project</td>
            <td><span className="inline-code">.cdoing/permissions.json</span></td>
            <td>Persistent for this project</td>
          </tr>
          <tr>
            <td>File edits</td>
            <td>In-memory</td>
            <td>Session only (cleared on restart)</td>
          </tr>
          <tr>
            <td>Shell commands</td>
            <td><span className="inline-code">.cdoing/permissions.json</span></td>
            <td>Persistent per-project</td>
          </tr>
        </tbody>
      </table>

      <h2 className="doc-h2">Shell Path Checking</h2>

      <p className="doc-p">
        When the agent runs a shell command, the permission system:
      </p>

      <ul className="feature-list">
        <li>Extracts file paths from the command string</li>
        <li>Checks extracted paths against Read/Edit/Delete rules</li>
        <li>
          Blocks compound commands with operators (&&, ||, |, ;) when using
          wildcard rules to prevent rule bypassing
        </li>
      </ul>

      <div className="callout callout-warning">
        <div className="callout-title">Security Note</div>
        The permission system is designed as a safety net, not a security
        boundary. A determined user can always bypass it. It&apos;s meant to
        prevent the AI from accidentally performing destructive operations.
      </div>
    </div>
  );
}
