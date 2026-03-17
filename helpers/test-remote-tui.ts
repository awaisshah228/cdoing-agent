/**
 * Test the remote agent TUI dashboard with simulated events.
 * No API keys or Telegram needed — generates fake events to see the UI.
 *
 * Usage:
 *   npx tsx helpers/test-remote-tui.ts
 */

import { Engine } from "../packages/remote-coding-agent/src/core/engine";
import { renderDashboard } from "../packages/remote-coding-agent/src/tui/app";
import type { AppConfig } from "../packages/remote-coding-agent/src/types";

const config: AppConfig = {
  agent: {
    provider: "anthropic",
    model: "claude-haiku-4-5",
    maxTurns: 10,
    permissionMode: "auto",
    codingProvider: "anthropic",
    codingModel: "claude-sonnet-4-6",
  },
  gateway: { port: 0, corsOrigin: "*" },  // port 0 = don't start
  session: { ttlMs: 30 * 60 * 1000, maxHistoryMessages: 50, maxSessions: 100 },
  security: { channelRules: {}, rateLimitPerMinute: 20, allowedDirs: [] },
  channels: {},
  workingDir: process.cwd(),
  logLevel: "info",
};

async function main() {
  const engine = new Engine(config);

  // Don't start channels/gateway — just the engine internals
  console.log("Starting TUI dashboard with simulated events...\n");

  // Simulate events after a short delay
  setTimeout(() => {
    const emit = (engine as any).emit?.bind(engine) || (() => {});
    // If engine doesn't have emit, use the bridge event system
    const bridge = engine.getBridge();

    // Simulate channel connections
    (bridge as any).listeners?.forEach?.((l: any) => {
      try { l({ type: "channel:connected", channel: "telegram" }); } catch {}
    });

    // Simulate messages and agent activity
    let i = 0;
    const interval = setInterval(() => {
      const listeners = (bridge as any).listeners || [];
      const emit = (event: any) => listeners.forEach((l: any) => { try { l(event); } catch {} });

      switch (i % 6) {
        case 0:
          emit({ type: "message:received", channel: "telegram", chatId: "123", userId: "user1", text: "Fix the bug in auth.ts" });
          break;
        case 1:
          emit({ type: "agent:start", channel: "telegram", chatId: "123", role: "assistant" });
          break;
        case 2:
          emit({ type: "agent:delegated", channel: "telegram", chatId: "123", task: "Fix authentication bug in src/auth.ts" });
          break;
        case 3:
          emit({ type: "agent:start", channel: "telegram", chatId: "123", role: "coding" });
          break;
        case 4:
          emit({ type: "agent:tool_call", channel: "telegram", chatId: "123", name: "file_edit" });
          break;
        case 5:
          emit({ type: "agent:complete", channel: "telegram", chatId: "123", reply: { text: "Fixed!", durationMs: 3200 }, role: "coding" });
          break;
      }
      i++;
      if (i > 30) clearInterval(interval);
    }, 2000);
  }, 1000);

  await renderDashboard(engine);
}

main().catch(console.error);
