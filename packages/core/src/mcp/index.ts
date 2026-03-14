/**
 * MCP (Model Context Protocol) Server Support
 *
 * MCP is an open protocol that lets AI models connect to external
 * data sources and tools. Think of it as "USB for AI" — a standard
 * way to plug in capabilities.
 *
 * How it works:
 *   1. User configures MCP servers in .cdoing/mcp.json or settings
 *   2. On startup, we connect to each configured server
 *   3. Discover available tools from each server
 *   4. Register those tools so the agent can call them
 *   5. Route tool calls through the MCP protocol
 *
 * Configuration format (.cdoing/mcp.json):
 *   {
 *     "servers": [
 *       {
 *         "name": "jira",
 *         "command": "npx",
 *         "args": ["-y", "@modelcontextprotocol/server-jira"],
 *         "env": { "JIRA_URL": "https://..." }
 *       }
 *     ]
 *   }
 *
 * Learning note: MCP uses JSON-RPC over stdio or SSE (Server-Sent Events).
 * Each server is a separate process that we spawn and communicate with
 * through its stdin/stdout. This isolation means a buggy MCP server
 * can't crash the main agent.
 */

export { McpManager, type McpServerConfig, type McpTool } from "./manager";
