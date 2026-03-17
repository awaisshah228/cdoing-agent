/**
 * Gateway Setup Module — Configure the gateway server.
 *
 * Handles:
 *   - Port selection
 *   - Bind address (loopback vs LAN vs custom)
 *   - Auth mode (token vs password vs none)
 *   - Token generation
 *   - Gateway reachability probing
 *   - Permission mode
 */

import * as http from "http";
import * as net from "net";
import type { WizardPrompter } from "./prompts";
import type {
  GatewayBind,
  GatewayAuthMode,
  GatewayWizardSettings,
  QuickstartGatewayDefaults,
} from "./setup-types";
import { generateSecretKey } from "../auth/secret";

// ── Port Availability ─────────────────────────────────────────────────────

/**
 * Check if a port is available by attempting to listen on it.
 * Returns true if the port is free, false if it's in use.
 */
export function checkPortAvailable(port: number, host = "127.0.0.1"): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        resolve(false);
      } else {
        resolve(false);
      }
    });
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, host);
  });
}

// ── Permission Modes ─────────────────────────────────────────────────────

const PERMISSION_MODES = [
  { id: "auto", label: "Auto — Agent runs all tools without asking" },
  { id: "auto-edit", label: "Auto-Edit — Auto for reads, asks for writes" },
  { id: "ask", label: "Ask — Agent asks before every tool call" },
];

// ── Gateway Probing ──────────────────────────────────────────────────────

export interface GatewayProbeResult {
  ok: boolean;
  detail?: string;
}

/**
 * Probe whether a gateway is reachable at the given URL.
 */
export async function probeGatewayReachable(params: {
  host: string;
  port: number;
  token?: string;
  timeoutMs?: number;
}): Promise<GatewayProbeResult> {
  const { host, port, token, timeoutMs = 5000 } = params;

  return new Promise((resolve) => {
    const headers: Record<string, string> = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;

    const req = http.request(
      {
        hostname: host,
        port,
        path: "/api/health",
        method: "GET",
        headers,
        timeout: timeoutMs,
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          if (res.statusCode === 200) {
            resolve({ ok: true });
          } else {
            resolve({ ok: false, detail: `HTTP ${res.statusCode}` });
          }
        });
      },
    );

    req.on("error", (err) => {
      resolve({ ok: false, detail: err.message });
    });

    req.on("timeout", () => {
      req.destroy();
      resolve({ ok: false, detail: "timeout" });
    });

    req.end();
  });
}

/**
 * Wait for gateway to become reachable, with retries.
 */
export async function waitForGatewayReachable(params: {
  host: string;
  port: number;
  token?: string;
  deadlineMs?: number;
}): Promise<GatewayProbeResult> {
  const { deadlineMs = 15000 } = params;
  const start = Date.now();

  while (Date.now() - start < deadlineMs) {
    const result = await probeGatewayReachable({ ...params, timeoutMs: 3000 });
    if (result.ok) return result;
    // Wait 1s before retrying
    await new Promise((r) => setTimeout(r, 1000));
  }

  return { ok: false, detail: "deadline exceeded" };
}

// ── Gateway Config ───────────────────────────────────────────────────────

export async function configureGateway(params: {
  quickstartDefaults?: QuickstartGatewayDefaults;
  prompter: WizardPrompter;
}): Promise<GatewayWizardSettings> {
  const { quickstartDefaults, prompter } = params;

  // Port — prompt until we find an available one
  let port: number;
  while (true) {
    const portStr = await prompter.text({
      message: "Gateway port",
      initialValue: String(quickstartDefaults?.port ?? 4567),
      validate: (v) => {
        const n = parseInt(v, 10);
        if (isNaN(n) || n < 1 || n > 65535) return "Must be a valid port (1-65535)";
        return undefined;
      },
    });
    port = parseInt(portStr, 10);

    const available = await checkPortAvailable(port);
    if (available) {
      await prompter.note(`Port ${port} is available.`, "Port check");
      break;
    }

    // Port is in use — tell the user and let them pick another
    await prompter.note(
      `Port ${port} is already in use by another process.\nPick a different port or stop the process using it.`,
      "Port unavailable",
    );
  }

  // Bind
  const bind = await prompter.select<GatewayBind>({
    message: "Gateway bind address",
    options: [
      { value: "loopback", label: "Loopback (127.0.0.1)", hint: "local only — safest" },
      { value: "lan", label: "LAN (0.0.0.0)", hint: "accessible from local network" },
      { value: "custom", label: "Custom", hint: "specify a bind address" },
    ],
    initialValue: "loopback",
  });

  let customBindHost: string | undefined;
  if (bind === "custom") {
    customBindHost = await prompter.text({
      message: "Custom bind host",
      initialValue: "0.0.0.0",
    });
  }

  // Auth mode
  const authMode = await prompter.select<GatewayAuthMode>({
    message: "Gateway authentication",
    options: [
      { value: "token", label: "Token (recommended)", hint: "auto-generated secret" },
      { value: "password", label: "Password", hint: "set a password" },
      { value: "none", label: "None", hint: "no auth — NOT recommended" },
    ],
    initialValue: "token",
  });

  let authToken: string | undefined;
  if (authMode === "token") {
    authToken = generateSecretKey();
    await prompter.note(
      [
        "A secure auth token has been generated.",
        `Token: ${authToken.substring(0, 12)}...${authToken.substring(authToken.length - 8)}`,
        "",
        "Keep this secret! You need it for API and dashboard access.",
      ].join("\n"),
      "Auth Token",
    );
  } else if (authMode === "password") {
    authToken = await prompter.password({
      message: "Set gateway password",
      validate: (v) => (v.length < 8 ? "Password must be at least 8 characters" : undefined),
    });
  } else {
    await prompter.note(
      "Running without authentication is NOT recommended.\nAnyone with network access can control your agent.",
      "Security Warning",
    );
  }

  return { port, bind, authMode, authToken, customBindHost };
}

// ── Permission Mode ──────────────────────────────────────────────────────

export async function promptPermissionMode(
  prompter: WizardPrompter,
): Promise<string> {
  return prompter.select({
    message: "Permission mode (how much freedom the agent has)",
    options: PERMISSION_MODES.map((m) => ({
      value: m.id,
      label: m.label,
    })),
    initialValue: "auto",
  });
}

// ── Working Directory ────────────────────────────────────────────────────

export async function promptWorkingDir(
  prompter: WizardPrompter,
): Promise<string> {
  return prompter.text({
    message: "Working directory for coding operations",
    initialValue: process.cwd(),
  });
}

// ── Log Level ────────────────────────────────────────────────────────────

export async function promptLogLevel(
  prompter: WizardPrompter,
): Promise<string> {
  return prompter.select({
    message: "Log level",
    options: [
      { value: "info", label: "Info", hint: "recommended" },
      { value: "debug", label: "Debug", hint: "verbose output" },
      { value: "warn", label: "Warn", hint: "warnings and errors only" },
      { value: "error", label: "Error", hint: "errors only" },
    ],
    initialValue: "info",
  });
}
