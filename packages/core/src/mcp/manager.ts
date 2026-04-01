/**
 * MCP Manager — Manages connections to MCP (Model Context Protocol) servers.
 *
 * Security features:
 *   - Sensitive environment variables stripped from server processes
 *   - Config validation (command must be a string, no path traversal in names)
 *   - Initialization timeout (prevents hanging on malicious servers)
 *   - Project-scoped servers flagged for user awareness
 *
 * Handles:
 *   - Loading server configurations
 *   - Spawning and connecting to server processes
 *   - Tool discovery (listing available tools from each server)
 *   - Routing tool calls to the correct server
 *   - Graceful shutdown of server processes
 *
 * Learning note: This uses JSON-RPC 2.0 over stdio for communication.
 * Each message is a JSON object separated by newlines. The protocol
 * is stateless — each request gets exactly one response.
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { spawn, type ChildProcess } from "child_process";

// ── Sensitive env vars to strip from MCP server processes ────────────────────

const SENSITIVE_ENV_VARS = [
  "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN", "AWS_ACCESS_KEY_ID",
  "GH_TOKEN", "GITHUB_TOKEN", "GITHUB_APP_PRIVATE_KEY",
  "NPM_TOKEN", "NPM_AUTH_TOKEN",
  "DOCKER_PASSWORD", "DOCKER_AUTH_CONFIG",
  "GOOGLE_APPLICATION_CREDENTIALS",
  "AZURE_CLIENT_SECRET", "AZURE_TENANT_ID",
  "DATABASE_URL", "DB_PASSWORD", "REDIS_PASSWORD", "MONGO_PASSWORD",
  "SECRET_KEY", "PRIVATE_KEY", "API_SECRET", "ENCRYPTION_KEY",
  "VERCEL_TOKEN", "SLACK_TOKEN", "STRIPE_SECRET_KEY",
  "TWILIO_AUTH_TOKEN", "SENDGRID_API_KEY",
  "CI_JOB_TOKEN", "CIRCLE_TOKEN", "TRAVIS_TOKEN",
];

/** Build a sanitized environment for MCP server processes */
function buildMcpEnv(serverEnv?: Record<string, string>): NodeJS.ProcessEnv {
  const env = { ...process.env };

  // Strip sensitive vars
  for (const v of SENSITIVE_ENV_VARS) {
    delete env[v];
  }

  // Strip vars whose names suggest secrets
  for (const key of Object.keys(env)) {
    const upper = key.toUpperCase();
    if (
      (upper.includes("SECRET") ||
       upper.includes("PRIVATE_KEY") ||
       (upper.includes("_TOKEN") && !upper.includes("COLOR")) ||
       upper.includes("_PASSWORD") ||
       upper.includes("_CREDENTIALS")) &&
      !["COLORTERM", "FORCE_COLOR"].some(safe => upper.includes(safe))
    ) {
      delete env[key];
    }
  }

  // Apply server-specific env vars (these are intentional overrides)
  if (serverEnv) {
    Object.assign(env, serverEnv);
  }

  return env;
}

/** Timeouts for MCP operations */
const MCP_INIT_TIMEOUT = 15000;  // 15s for initialization handshake
const MCP_REQUEST_TIMEOUT = 30000; // 30s for tool calls

/**
 * Configuration for a single MCP server.
 */
export interface McpServerConfig {
  /** Human-readable name for this server */
  name: string;

  /** Command to run the server (e.g., "npx", "python") */
  command: string;

  /** Arguments to pass to the command */
  args?: string[];

  /** Environment variables for the server process */
  env?: Record<string, string>;

  /** Working directory for the server */
  cwd?: string;

  /** Whether this server is enabled (default: true) */
  enabled?: boolean;

  /** Source of this config: "global" or "project" */
  source?: "global" | "project";
}

/**
 * A tool discovered from an MCP server.
 */
export interface McpTool {
  /** Tool name (namespaced: "server_name.tool_name") */
  name: string;

  /** Human-readable description */
  description: string;

  /** JSON Schema for the tool's input parameters */
  inputSchema: Record<string, unknown>;

  /** Which MCP server provides this tool */
  serverName: string;
}

/**
 * Internal state for a connected MCP server.
 */
interface McpConnection {
  config: McpServerConfig;
  process: ChildProcess;
  tools: McpTool[];
  requestId: number;
  pendingRequests: Map<number, {
    resolve: (value: unknown) => void;
    reject: (reason: Error) => void;
  }>;
  buffer: string;
}

/**
 * Validate an MCP server config for safety.
 * Returns an error message if invalid, null if valid.
 */
function validateServerConfig(config: McpServerConfig): string | null {
  // Name must be alphanumeric/dash/underscore (no path traversal)
  if (!config.name || !/^[a-zA-Z0-9_-]+$/.test(config.name)) {
    return `Invalid server name: "${config.name}" (must be alphanumeric with dashes/underscores)`;
  }

  // Command must be a non-empty string
  if (!config.command || typeof config.command !== "string") {
    return `Invalid command for server "${config.name}"`;
  }

  // Args must be an array of strings if present
  if (config.args !== undefined) {
    if (!Array.isArray(config.args) || config.args.some(a => typeof a !== "string")) {
      return `Invalid args for server "${config.name}" (must be array of strings)`;
    }
  }

  // Env must be a record of strings if present
  if (config.env !== undefined) {
    if (typeof config.env !== "object" || config.env === null) {
      return `Invalid env for server "${config.name}"`;
    }
    for (const [key, val] of Object.entries(config.env)) {
      if (typeof key !== "string" || typeof val !== "string") {
        return `Invalid env entry in server "${config.name}"`;
      }
    }
  }

  return null;
}

export class McpManager {
  /** Active server connections */
  private connections = new Map<string, McpConnection>();

  /** Working directory for resolving config paths */
  private workingDir: string;

  /** Whether to allow project-scoped MCP servers */
  private allowProjectServers: boolean;

  constructor(workingDir: string, options?: { allowProjectServers?: boolean }) {
    this.workingDir = workingDir;
    this.allowProjectServers = options?.allowProjectServers ?? true;
  }

  /**
   * Load MCP server configurations from config files.
   *
   * Checks these locations (in order):
   *   1. .cdoing/mcp.json (project-specific) — flagged as "project" source
   *   2. ~/.cdoing/mcp.json (global) — trusted
   *
   * Learning note: Project configs take precedence over global ones.
   * This lets you have project-specific MCP servers (e.g., a Jira
   * server for one project, a Notion server for another).
   */
  loadConfig(): McpServerConfig[] {
    const configs: McpServerConfig[] = [];
    const paths: Array<{ path: string; source: "project" | "global" }> = [
      { path: path.join(this.workingDir, ".cdoing", "mcp.json"), source: "project" },
      { path: path.join(os.homedir(), ".cdoing", "mcp.json"), source: "global" },
    ];

    for (const { path: configPath, source } of paths) {
      // Skip project servers if not allowed (managed settings)
      if (source === "project" && !this.allowProjectServers) continue;

      try {
        if (fs.existsSync(configPath)) {
          const raw = fs.readFileSync(configPath, "utf-8");

          let parsed: unknown;
          try {
            parsed = JSON.parse(raw);
          } catch {
            console.error(`[MCP] Invalid JSON in ${configPath}, skipping`);
            continue;
          }

          if (!parsed || typeof parsed !== "object") continue;
          const obj = parsed as Record<string, unknown>;

          if (obj.servers && Array.isArray(obj.servers)) {
            for (const server of obj.servers) {
              if (!server || typeof server !== "object") continue;
              const serverConfig = server as McpServerConfig;
              serverConfig.source = source;

              // Validate server config
              const validationError = validateServerConfig(serverConfig);
              if (validationError) {
                console.error(`[MCP] ${validationError} in ${configPath}, skipping`);
                continue;
              }

              // Don't add duplicates (project config overrides global)
              if (!configs.some((c) => c.name === serverConfig.name)) {
                configs.push(serverConfig);
              }
            }
          }
        }
      } catch {
        // Skip invalid config files
      }
    }

    return configs;
  }

  /**
   * Connect to all configured MCP servers.
   * Spawns each server process and discovers its tools.
   */
  async connectAll(): Promise<void> {
    const configs = this.loadConfig();

    for (const config of configs) {
      if (config.enabled === false) continue;

      try {
        await this.connect(config);
      } catch (err) {
        console.error(`[MCP] Failed to connect to ${config.name}:`, err);
      }
    }
  }

  /**
   * Connect to a single MCP server.
   *
   * Learning note: We spawn the server as a child process and
   * communicate via JSON-RPC over stdio. The "initialize" handshake
   * tells the server our capabilities, and "tools/list" discovers
   * what tools it offers.
   */
  async connect(config: McpServerConfig): Promise<void> {
    // Validate before spawning
    const validationError = validateServerConfig(config);
    if (validationError) {
      throw new Error(validationError);
    }

    // Spawn the server process with sanitized environment
    const child = spawn(config.command, config.args || [], {
      cwd: config.cwd || this.workingDir,
      env: buildMcpEnv(config.env),
      stdio: ["pipe", "pipe", "pipe"],
    });

    const connection: McpConnection = {
      config,
      process: child,
      tools: [],
      requestId: 0,
      pendingRequests: new Map(),
      buffer: "",
    };

    // Handle incoming messages from the server
    child.stdout?.on("data", (data: Buffer) => {
      connection.buffer += data.toString();

      // Process complete JSON-RPC messages (delimited by newlines)
      let newlineIndex: number;
      while ((newlineIndex = connection.buffer.indexOf("\n")) >= 0) {
        const line = connection.buffer.substring(0, newlineIndex).trim();
        connection.buffer = connection.buffer.substring(newlineIndex + 1);

        if (!line) continue;

        try {
          const message = JSON.parse(line);
          this.handleServerMessage(config.name, message, connection);
        } catch {
          // Skip non-JSON lines (e.g., server startup logs)
        }
      }
    });

    // Handle server errors
    child.stderr?.on("data", (data: Buffer) => {
      // Log but don't crash — server stderr is often debug output
      const text = data.toString().trim();
      if (text) {
        console.error(`[MCP:${config.name}] ${text}`);
      }
    });

    child.on("exit", (_code) => {
      this.connections.delete(config.name);
    });

    this.connections.set(config.name, connection);

    // Perform MCP handshake with timeout
    try {
      await this.sendRequest(config.name, "initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "cdoing-agent", version: "0.1.0" },
      }, MCP_INIT_TIMEOUT);

      // Discover tools (also with timeout)
      const toolsResult = await this.sendRequest(config.name, "tools/list", {}, MCP_INIT_TIMEOUT) as any;
      if (toolsResult?.tools) {
        connection.tools = toolsResult.tools
          .filter((t: any) => {
            // Validate tool name — no path traversal or special chars
            return t && typeof t.name === "string" && /^[a-zA-Z0-9_-]+$/.test(t.name);
          })
          .map((t: any) => ({
            name: `${config.name}_${t.name}`,
            description: `[${config.name}] ${t.description || t.name}`,
            inputSchema: t.inputSchema || { type: "object", properties: {} },
            serverName: config.name,
          }));
      }
    } catch (err) {
      // If handshake fails, clean up
      child.kill();
      this.connections.delete(config.name);
      throw err;
    }
  }

  /**
   * Send a JSON-RPC request to an MCP server.
   *
   * Learning note: JSON-RPC uses numeric IDs to match requests
   * with responses. We store pending requests in a Map and resolve
   * the Promise when we get the matching response.
   */
  private sendRequest(
    serverName: string,
    method: string,
    params: unknown,
    timeout?: number,
  ): Promise<unknown> {
    const connection = this.connections.get(serverName);
    if (!connection) {
      return Promise.reject(new Error(`MCP server not connected: ${serverName}`));
    }

    const requestTimeout = timeout || MCP_REQUEST_TIMEOUT;

    return new Promise((resolve, reject) => {
      const id = ++connection.requestId;
      connection.pendingRequests.set(id, { resolve, reject });

      const message = JSON.stringify({
        jsonrpc: "2.0",
        id,
        method,
        params,
      });

      connection.process.stdin?.write(message + "\n");

      // Timeout
      setTimeout(() => {
        const pending = connection.pendingRequests.get(id);
        if (pending) {
          connection.pendingRequests.delete(id);
          pending.reject(new Error(`MCP request timeout after ${requestTimeout}ms: ${method}`));
        }
      }, requestTimeout);
    });
  }

  /**
   * Handle an incoming message from an MCP server.
   */
  private handleServerMessage(
    _serverName: string,
    message: any,
    connection: McpConnection,
  ): void {
    // JSON-RPC response (has an "id" field)
    if (message.id !== undefined) {
      const pending = connection.pendingRequests.get(message.id);
      if (pending) {
        connection.pendingRequests.delete(message.id);
        if (message.error) {
          pending.reject(new Error(message.error.message || "MCP error"));
        } else {
          pending.resolve(message.result);
        }
      }
    }
    // JSON-RPC notification (no "id" field) — log but ignore
  }

  /**
   * Get all tools from all connected MCP servers.
   */
  getAllTools(): McpTool[] {
    const tools: McpTool[] = [];
    for (const connection of this.connections.values()) {
      tools.push(...connection.tools);
    }
    return tools;
  }

  /**
   * Call a tool on an MCP server.
   *
   * @param toolName - Namespaced tool name (e.g., "jira_create_issue")
   * @param input - Tool input parameters
   * @returns Tool execution result
   */
  async callTool(toolName: string, input: Record<string, unknown>): Promise<{
    success: boolean;
    output: string;
    error?: string;
  }> {
    // Find which server provides this tool
    for (const connection of this.connections.values()) {
      const tool = connection.tools.find((t) => t.name === toolName);
      if (tool) {
        // Strip the server name prefix to get the original tool name
        const originalName = toolName.replace(`${tool.serverName}_`, "");

        try {
          const result = await this.sendRequest(tool.serverName, "tools/call", {
            name: originalName,
            arguments: input,
          }) as any;

          // MCP tool results have a "content" array — validate structure
          let output: string;
          if (result?.content && Array.isArray(result.content)) {
            output = result.content
              .filter((c: any) => c && typeof c === "object")
              .map((c: any) => {
                if (typeof c.text === "string") return c.text;
                return JSON.stringify(c);
              })
              .join("\n");
          } else {
            output = JSON.stringify(result);
          }

          return { success: true, output: output || "(empty result)" };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return { success: false, output: "", error: message };
        }
      }
    }

    return { success: false, output: "", error: `Unknown MCP tool: ${toolName}` };
  }

  /**
   * Check if a tool name belongs to an MCP server.
   */
  isMcpTool(toolName: string): boolean {
    for (const connection of this.connections.values()) {
      if (connection.tools.some((t) => t.name === toolName)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Get connected server names.
   */
  getConnectedServers(): string[] {
    return Array.from(this.connections.keys());
  }

  /**
   * Disconnect from all MCP servers.
   * Sends a graceful shutdown signal to each server process.
   */
  async disconnectAll(): Promise<void> {
    for (const [_name, connection] of this.connections) {
      try {
        connection.process.kill("SIGTERM");
      } catch {
        // Process may already be dead
      }
    }
    this.connections.clear();
  }

  /**
   * Update the working directory.
   */
  setWorkingDir(dir: string): void {
    this.workingDir = dir;
  }
}
