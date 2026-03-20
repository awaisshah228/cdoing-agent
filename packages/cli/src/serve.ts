/**
 * cdoing serve — HTTP API server
 *
 * Exposes the AI agent as a REST API:
 *   GET  /health
 *   GET  /sessions
 *   POST /sessions                  — create new session
 *   GET  /sessions/:id
 *   POST /sessions/:id/messages     — continue a conversation
 *   POST /chat                      — one-shot prompt
 *   POST /chat/stream               — streaming via SSE
 */

import * as http from "http";
import * as url from "url";
import chalk from "chalk";
import { AgentRunner } from "@cdoing/ai";
import { HookManager, MemoryStore, loadProjectConfig } from "@cdoing/core";
import {
  buildModelConfig,
  createPermissionManager,
  resolveApiKey,
  type CLIOptions,
} from "./config";
import { createToolRegistry } from "./tools";
import {
  createConversation,
  addMessage,
  loadConversation,
  listConversations,
  saveConversation,
} from "./history";

export interface ServeOptions {
  port: number;
  host: string;
  model?: string;
  provider?: string;
  apiKey?: string;
  dir: string;
  mode: string;
}

function jsonResponse(res: http.ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data, null, 2);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  });
  res.end(body);
}

function readBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      try { resolve(JSON.parse(body || "{}")); }
      catch { reject(new Error("Invalid JSON body")); }
    });
    req.on("error", reject);
  });
}

export async function startServer(opts: ServeOptions): Promise<void> {
  const cliOpts = {
    model: opts.model,
    provider: opts.provider || "anthropic",
    apiKey: opts.apiKey,
    dir: opts.dir,
    mode: opts.mode || "auto",
  } as CLIOptions;

  await resolveApiKey(cliOpts);

  const modelConfig = buildModelConfig(cliOpts);
  const permissionManager = createPermissionManager(cliOpts);
  const hookManager = new HookManager(opts.dir);
  const memoryStore = new MemoryStore(opts.dir);
  const projectConfig = loadProjectConfig(opts.dir);

  const isGitRepo = require("fs").existsSync(require("path").join(opts.dir, ".git"));

  const agentOptions = {
    workingDir: opts.dir,
    projectConfig: projectConfig || undefined,
    memory: memoryStore.formatForPrompt() || undefined,
    isGitRepo,
  };

  const server = http.createServer(async (req, res) => {
    // CORS preflight
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      });
      res.end();
      return;
    }

    const parsed = url.parse(req.url || "/", true);
    const pathname = parsed.pathname || "/";

    try {
      // GET /health
      if (req.method === "GET" && pathname === "/health") {
        jsonResponse(res, 200, {
          status: "ok",
          provider: modelConfig.provider,
          model: modelConfig.model || "(default)",
          dir: opts.dir,
          mode: opts.mode,
          timestamp: new Date().toISOString(),
        });
        return;
      }

      // GET /sessions
      if (req.method === "GET" && pathname === "/sessions") {
        const sessions = listConversations().slice(0, 100).map((c) => ({
          id: c.id,
          title: c.title,
          createdAt: c.createdAt,
          updatedAt: c.updatedAt,
          provider: c.provider,
          model: c.model,
          messageCount: c.messages.length,
        }));
        jsonResponse(res, 200, { sessions, total: sessions.length });
        return;
      }

      // POST /sessions — create new session
      if (req.method === "POST" && pathname === "/sessions") {
        const conv = createConversation(
          String(modelConfig.provider || "anthropic"),
          String(modelConfig.model || "default"),
        );
        saveConversation(conv);
        jsonResponse(res, 201, { id: conv.id, title: conv.title, createdAt: conv.createdAt });
        return;
      }

      // GET /sessions/:id
      const sessionGetMatch = pathname.match(/^\/sessions\/([a-z0-9-]+)$/);
      if (req.method === "GET" && sessionGetMatch) {
        const conv = loadConversation(sessionGetMatch[1]);
        if (!conv) { jsonResponse(res, 404, { error: "Session not found" }); return; }
        jsonResponse(res, 200, conv);
        return;
      }

      // POST /sessions/:id/messages — continue conversation
      const sessionMsgMatch = pathname.match(/^\/sessions\/([a-z0-9-]+)\/messages$/);
      if (req.method === "POST" && sessionMsgMatch) {
        const conv = loadConversation(sessionMsgMatch[1]);
        if (!conv) { jsonResponse(res, 404, { error: "Session not found" }); return; }

        const body = await readBody(req);
        const prompt = String(body.prompt || "");
        if (!prompt) { jsonResponse(res, 400, { error: "prompt is required" }); return; }

        const toolRegistry = await createToolRegistry(opts.dir);
        const agent = new AgentRunner(modelConfig, toolRegistry, permissionManager, hookManager, agentOptions);

        // Restore history
        for (const m of conv.messages) {
          if (m.role === "user") agent.addToHistory("user", m.content);
          else if (m.role === "assistant") agent.addToHistory("assistant", m.content);
        }

        let response = "";
        const tools: Array<{ name: string; input: Record<string, unknown> }> = [];

        await agent.run(prompt, {
          onToken: (t) => { response += t; },
          onToolCall: (name, input) => { tools.push({ name, input }); },
          onToolResult: () => {},
          onComplete: () => {},
          onError: (e) => { response = `Error: ${e.message}`; },
        });

        addMessage(conv, "user", prompt);
        addMessage(conv, "assistant", response);

        jsonResponse(res, 200, { response, tools, sessionId: conv.id });
        return;
      }

      // POST /chat — one-shot prompt
      if (req.method === "POST" && pathname === "/chat") {
        const body = await readBody(req);
        const prompt = String(body.prompt || "");
        if (!prompt) { jsonResponse(res, 400, { error: "prompt is required" }); return; }

        const mc = {
          ...modelConfig,
          ...(body.model ? { model: String(body.model) } : {}),
          ...(body.provider ? { provider: String(body.provider) } : {}),
        };

        const toolRegistry = await createToolRegistry(opts.dir);
        const agent = new AgentRunner(mc, toolRegistry, permissionManager, hookManager, agentOptions);

        let response = "";
        const tools: Array<{ name: string; input: Record<string, unknown> }> = [];
        let usage: unknown = null;

        await agent.run(prompt, {
          onToken: (t) => { response += t; },
          onToolCall: (name, input) => { tools.push({ name, input }); },
          onToolResult: () => {},
          onComplete: () => {},
          onError: (e) => { response = `Error: ${e.message}`; },
          onUsage: (u) => { usage = u; },
        });

        jsonResponse(res, 200, { response, tools, usage });
        return;
      }

      // POST /chat/stream — streaming via SSE
      if (req.method === "POST" && pathname === "/chat/stream") {
        const body = await readBody(req);
        const prompt = String(body.prompt || "");
        if (!prompt) { jsonResponse(res, 400, { error: "prompt is required" }); return; }

        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
          "Access-Control-Allow-Origin": "*",
        });

        const sse = (event: string, data: unknown) => {
          res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        };

        const toolRegistry = await createToolRegistry(opts.dir);
        const agent = new AgentRunner(modelConfig, toolRegistry, permissionManager, hookManager, agentOptions);

        await agent.run(prompt, {
          onToken: (t) => sse("token", { token: t }),
          onToolCall: (name, input) => sse("tool_call", { name, input }),
          onToolResult: (name, result, isError) => sse("tool_result", { name, result, isError }),
          onComplete: () => { sse("complete", {}); res.end(); },
          onError: (e) => { sse("error", { message: e.message }); res.end(); },
          onUsage: (usage) => sse("usage", usage),
        });
        return;
      }

      jsonResponse(res, 404, { error: `Not found: ${pathname}` });
    } catch (err) {
      jsonResponse(res, 500, { error: String(err) });
    }
  });

  server.listen(opts.port, opts.host, () => {
    console.log();
    console.log(chalk.bold.cyan("  🚀 Cdoing API Server"));
    console.log(chalk.gray("  ─────────────────────────────────────────"));
    console.log(chalk.white(`  URL:      `) + chalk.cyan(`http://${opts.host}:${opts.port}`));
    console.log(chalk.white(`  Provider: `) + chalk.yellow(String(modelConfig.provider || "anthropic")));
    console.log(chalk.white(`  Model:    `) + chalk.yellow(String(modelConfig.model || "(default)")));
    console.log(chalk.white(`  Dir:      `) + chalk.gray(opts.dir));
    console.log(chalk.white(`  Mode:     `) + chalk.green(opts.mode || "auto"));
    console.log();
    console.log(chalk.gray("  Endpoints:"));
    console.log(chalk.dim("    GET  /health"));
    console.log(chalk.dim("    GET  /sessions         — list conversations"));
    console.log(chalk.dim("    POST /sessions         — create session"));
    console.log(chalk.dim("    GET  /sessions/:id     — get session"));
    console.log(chalk.dim("    POST /sessions/:id/messages"));
    console.log(chalk.dim("    POST /chat             — one-shot prompt"));
    console.log(chalk.dim("    POST /chat/stream      — streaming SSE"));
    console.log();
    console.log(chalk.gray("  Press Ctrl+C to stop."));
    console.log();
  });

  // Keep server alive until killed
  await new Promise<void>((_resolve, reject) => {
    server.on("error", reject);
    process.on("SIGINT", () => {
      console.log(chalk.yellow("\n\n  Shutting down server..."));
      server.close(() => process.exit(0));
    });
  });
}
