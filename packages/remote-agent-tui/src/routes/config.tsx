/**
 * Config Route — Read-only display of the engine's current configuration.
 *
 * Shows a tree-view of all config sections:
 *   - Agent (assistant)
 *   - Agent (coding)
 *   - Gateway
 *   - Session
 *   - Security
 *   - Channels
 *   - Skills
 */

import { TextAttributes } from "@opentui/core";
import { useTheme } from "../context/theme";
import { useEngine } from "../context/engine";
import type { Engine } from "@cdoing/remote-coding-agent";

export function Config() {
  const { theme } = useTheme();
  const t = theme;
  const engine = useEngine();

  const config = engine.getConfig();
  const agent = config.agent;
  const gateway = config.gateway;
  const session = config.session;
  const security = config.security;
  const channels = config.channels;
  const skillRegistry = engine.getSkillRegistry();
  const enabledSkills = skillRegistry.getAll().filter((e) => e.enabled);

  const maskKey = (key?: string) => {
    if (!key) return "(from env)";
    return "***" + key.slice(-4);
  };

  return (
    <box flexDirection="column" flexGrow={1} paddingX={2} paddingY={1} overflow="hidden">
      <text fg={t.primary} attributes={TextAttributes.BOLD}>
        {"Configuration"}
      </text>
      <text>{""}</text>

      {/* Agent (assistant) */}
      <text fg={t.primary} attributes={TextAttributes.BOLD}>
        {"  Agent (Assistant)"}
      </text>
      <text fg={t.text}>{`    provider:        ${agent.provider}`}</text>
      <text fg={t.text}>{`    model:           ${agent.model}`}</text>
      <text fg={t.text}>{`    api_key:         ${maskKey(agent.apiKey)}`}</text>
      <text fg={t.text}>{`    max_turns:       ${agent.maxTurns}`}</text>
      <text fg={t.text}>{`    max_tokens:      ${agent.maxTokens || "default"}`}</text>
      <text fg={t.text}>{`    permission_mode: ${agent.permissionMode}`}</text>
      <text fg={t.text}>{`    system_prompt:   ${agent.systemPrompt ? agent.systemPrompt.substring(0, 60) + "..." : "(default)"}`}</text>
      <text>{""}</text>

      {/* Agent (coding) */}
      <text fg={t.primary} attributes={TextAttributes.BOLD}>
        {"  Agent (Coding)"}
      </text>
      <text fg={t.text}>{`    coding_provider:   ${agent.codingProvider || agent.provider}`}</text>
      <text fg={t.text}>{`    coding_model:      ${agent.codingModel || agent.model}`}</text>
      <text fg={t.text}>{`    coding_api_key:    ${agent.codingApiKey ? maskKey(agent.codingApiKey) : "(from assistant)"}`}</text>
      <text fg={t.text}>{`    coding_max_tokens: ${agent.codingMaxTokens || agent.maxTokens || "default"}`}</text>
      <text>{""}</text>

      {/* Gateway */}
      <text fg={t.primary} attributes={TextAttributes.BOLD}>
        {"  Gateway"}
      </text>
      <text fg={t.text}>{`    port:       ${gateway.port}`}</text>
      <text fg={t.text}>{`    auth_token: ${gateway.authToken ? maskKey(gateway.authToken) : "(none)"}`}</text>
      <text fg={t.text}>{`    cors:       ${gateway.corsOrigin}`}</text>
      <text>{""}</text>

      {/* Session */}
      <text fg={t.primary} attributes={TextAttributes.BOLD}>
        {"  Session"}
      </text>
      <text fg={t.text}>{`    ttl:          ${session.ttlMs / 1000}s`}</text>
      <text fg={t.text}>{`    max_history:  ${session.maxHistoryMessages}`}</text>
      <text fg={t.text}>{`    max_sessions: ${session.maxSessions}`}</text>
      <text>{""}</text>

      {/* Security */}
      <text fg={t.primary} attributes={TextAttributes.BOLD}>
        {"  Security"}
      </text>
      <text fg={t.text}>{`    rate_limit:   ${security.rateLimitPerMinute}/min`}</text>
      <text fg={t.text}>{`    allowed_dirs: ${security.allowedDirs.length > 0 ? security.allowedDirs.join(", ") : "(unrestricted)"}`}</text>
      <text>{""}</text>

      {/* Channels */}
      <text fg={t.primary} attributes={TextAttributes.BOLD}>
        {"  Channels"}
      </text>
      {Object.keys(channels).length === 0 ? (
        <text fg={t.textMuted}>{"    (none configured)"}</text>
      ) : (
        Object.entries(channels).map(([id, ch]) => (
          <text key={id} fg={t.text}>
            {`    ${id}: ${ch.enabled ? "enabled" : "disabled"}`}
          </text>
        ))
      )}
      <text>{""}</text>

      {/* Skills */}
      <text fg={t.primary} attributes={TextAttributes.BOLD}>
        {"  Skills"}
      </text>
      {enabledSkills.length === 0 ? (
        <text fg={t.textMuted}>{"    (none enabled)"}</text>
      ) : (
        enabledSkills.map((entry) => (
          <text key={entry.skill.id} fg={t.text}>
            {`    ${entry.skill.name}: ${entry.skill.description}`}
          </text>
        ))
      )}

      <text>{""}</text>
      <text fg={t.textDim}>{`  working_dir: ${config.workingDir}`}</text>
      <text fg={t.textDim}>{`  log_level:   ${config.logLevel}`}</text>
    </box>
  );
}
