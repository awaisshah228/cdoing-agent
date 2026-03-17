/**
 * HTTP proxy to intercept Claude Code CLI API requests.
 *
 * Captures and logs the exact headers, body, and response for every
 * request that Claude Code CLI makes to the Anthropic API. Useful for
 * debugging OAuth issues, understanding request format, and reverse
 * engineering the official implementation.
 *
 * Usage:
 *   1. Start proxy:  node helpers/intercept-claude.mjs
 *   2. In another terminal:
 *      ANTHROPIC_BASE_URL=http://localhost:9999 claude --model claude-sonnet-4-5 -p "say hi"
 *   3. Watch intercepted requests in the proxy terminal
 *   4. Full request bodies saved to /tmp/claude-request-*.json
 *
 * Options:
 *   PORT=8888 node helpers/intercept-claude.mjs   — use custom port
 */

import http from "node:http";
import https from "node:https";
import fs from "node:fs";
import { URL } from "node:url";

const PROXY_PORT = parseInt(process.env.PORT || "9999", 10);
const TARGET = "https://api.anthropic.com";

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PROXY_PORT}`);
  const targetUrl = `${TARGET}${url.pathname}${url.search}`;

  // Collect request body
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const bodyBuf = Buffer.concat(chunks);
  const bodyStr = bodyBuf.toString("utf-8");

  // Log request
  console.log("\n" + "=".repeat(80));
  console.log(`>>> ${req.method} ${url.pathname}`);
  console.log(">>> HEADERS:");
  const interestingHeaders = [
    "authorization",
    "content-type",
    "user-agent",
    "anthropic-beta",
    "anthropic-version",
    "anthropic-dangerous-direct-browser-access",
    "x-app",
  ];
  for (const k of interestingHeaders) {
    const v = req.headers[k];
    if (!v) continue;
    const val =
      k === "authorization" ? v.toString().substring(0, 30) + "..." : v;
    console.log(`    ${k}: ${val}`);
  }

  if (bodyStr) {
    try {
      const body = JSON.parse(bodyStr);
      console.log(">>> BODY (key fields):");
      console.log(`    model:        ${body.model}`);
      console.log(`    max_tokens:   ${body.max_tokens}`);
      console.log(`    stream:       ${body.stream}`);
      console.log(`    temperature:  ${body.temperature}`);
      console.log(`    thinking:     ${JSON.stringify(body.thinking)}`);
      if (body.system) {
        if (Array.isArray(body.system)) {
          console.log(`    system:       [${body.system.length} blocks]`);
          for (const s of body.system) {
            const text =
              typeof s === "string" ? s : s.text || JSON.stringify(s);
            console.log(`      - ${text.substring(0, 120)}${text.length > 120 ? "..." : ""}`);
          }
        } else {
          const sys = String(body.system);
          console.log(`    system:       ${sys.substring(0, 200)}...`);
        }
      }
      if (body.tools)
        console.log(`    tools:        [${body.tools.length} tools]`);
      if (body.tool_choice)
        console.log(`    tool_choice:  ${JSON.stringify(body.tool_choice)}`);
      if (body.metadata)
        console.log(`    metadata:     ${JSON.stringify(body.metadata)}`);
      if (body.context_management)
        console.log(
          `    ctx_mgmt:     ${JSON.stringify(body.context_management)}`,
        );

      // Save full body for detailed inspection
      const filename = `/tmp/claude-request-${Date.now()}.json`;
      fs.writeFileSync(filename, JSON.stringify(body, null, 2));
      console.log(`    [saved to ${filename}]`);
    } catch {
      console.log(`>>> BODY (raw): ${bodyStr.substring(0, 500)}`);
    }
  }

  // Forward to real API
  const targetUrlObj = new URL(targetUrl);
  const fwdHeaders = { ...req.headers, host: targetUrlObj.host };

  const proxyReq = https.request(
    targetUrl,
    { method: req.method, headers: fwdHeaders },
    (proxyRes) => {
      const isStreaming =
        proxyRes.headers["content-type"]?.includes("text/event-stream");

      if (!isStreaming) {
        // Non-streaming: collect, log, and forward
        const resChunks = [];
        proxyRes.on("data", (c) => resChunks.push(c));
        proxyRes.on("end", () => {
          const resBody = Buffer.concat(resChunks).toString("utf-8");
          console.log(
            `\n<<< ${proxyRes.statusCode} ${proxyRes.statusMessage}`,
          );
          try {
            const parsed = JSON.parse(resBody);
            if (parsed.error) {
              console.log(`<<< ERROR: ${JSON.stringify(parsed.error)}`);
            } else {
              console.log(
                `<<< OK: model=${parsed.model}, usage=${JSON.stringify(parsed.usage)}`,
              );
            }
          } catch {
            console.log(`<<< BODY: ${resBody.substring(0, 300)}`);
          }
          res.writeHead(proxyRes.statusCode, proxyRes.headers);
          res.end(Buffer.concat(resChunks));
        });
      } else {
        // Streaming: log status and pipe through
        console.log(
          `\n<<< ${proxyRes.statusCode} ${proxyRes.statusMessage} (streaming)`,
        );
        res.writeHead(proxyRes.statusCode, proxyRes.headers);
        proxyRes.pipe(res);
      }
    },
  );

  proxyReq.on("error", (err) => {
    console.log(`<<< PROXY ERROR: ${err.message}`);
    res.writeHead(502).end(`Proxy error: ${err.message}`);
  });

  if (bodyBuf.length > 0) proxyReq.write(bodyBuf);
  proxyReq.end();
});

server.listen(PROXY_PORT, () => {
  console.log(`Intercepting proxy on http://localhost:${PROXY_PORT}`);
  console.log(`\nUsage (in another terminal):`);
  console.log(
    `  ANTHROPIC_BASE_URL=http://localhost:${PROXY_PORT} claude --model claude-sonnet-4-5 -p "say hi"`,
  );
  console.log(
    `  ANTHROPIC_BASE_URL=http://localhost:${PROXY_PORT} claude --model claude-opus-4-6 -p "say hi"`,
  );
  console.log(
    `  ANTHROPIC_BASE_URL=http://localhost:${PROXY_PORT} claude --model claude-haiku-4-5 -p "say hi"`,
  );
  console.log(`\nWaiting for requests...\n`);
});
