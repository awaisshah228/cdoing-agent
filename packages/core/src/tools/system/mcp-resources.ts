/**
 * MCP Resource Tools — list and read resources from MCP servers.
 *
 * Inspired by Claude Code's ListMcpResourcesTool and ReadMcpResourceTool.
 * Allows the agent to browse and read MCP server resources.
 */

import type { BaseTool, ToolDefinition, ToolResult } from "../types";

/** Interface for MCP manager resource operations */
export interface McpResourceProvider {
  listResources(serverName?: string): Promise<Array<{ uri: string; name: string; description?: string; serverName: string }>>;
  readResource(serverName: string, uri: string): Promise<string>;
  getConnectedServers(): string[];
}

export class ListMcpResourcesTool implements BaseTool {
  // ── Behavioral flags ──
  isReadOnly = () => true;
  concurrencyMode = () => "parallel" as const;
  definition: ToolDefinition = {
    name: "list_mcp_resources",
    description:
      "List available resources from connected MCP servers. " +
      "Resources include files, database entries, API endpoints, and other data. " +
      "Optionally filter by server name.",
    inputSchema: {
      type: "object",
      properties: {
        server: {
          type: "string",
          description: "Optional MCP server name to filter resources from.",
        },
      },
    },
    requiresPermission: false,
  };

  private provider: McpResourceProvider;

  constructor(provider: McpResourceProvider) {
    this.provider = provider;
  }

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const server = input.server ? String(input.server) : undefined;

    try {
      const servers = this.provider.getConnectedServers();
      if (servers.length === 0) {
        return { success: true, output: "No MCP servers connected." };
      }

      const resources = await this.provider.listResources(server);
      if (resources.length === 0) {
        return {
          success: true,
          output: server
            ? `No resources found on server "${server}".`
            : "No resources found on any connected MCP server.",
        };
      }

      const lines = resources.map((r) =>
        `- [${r.serverName}] ${r.name}: ${r.uri}${r.description ? ` — ${r.description}` : ""}`
      );

      return {
        success: true,
        output: `Found ${resources.length} resource(s):\n${lines.join("\n")}`,
      };
    } catch (err: any) {
      return { success: false, output: `Failed to list MCP resources: ${err.message || err}` };
    }
  }
}

export class ReadMcpResourceTool implements BaseTool {
  // ── Behavioral flags ──
  isReadOnly = () => true;
  concurrencyMode = () => "parallel" as const;
  definition: ToolDefinition = {
    name: "read_mcp_resource",
    description:
      "Read the contents of a specific MCP resource by its URI. " +
      "Use list_mcp_resources first to discover available resources.",
    inputSchema: {
      type: "object",
      properties: {
        server: {
          type: "string",
          description: "The MCP server name that hosts the resource.",
        },
        uri: {
          type: "string",
          description: "The resource URI to read.",
        },
      },
      required: ["server", "uri"],
    },
    requiresPermission: true,
    permissionMessage: (input) => `Read MCP resource: ${input.uri} from ${input.server}`,
  };

  private provider: McpResourceProvider;

  constructor(provider: McpResourceProvider) {
    this.provider = provider;
  }

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const server = String(input.server || "");
    const uri = String(input.uri || "");

    if (!server || !uri) {
      return { success: false, output: "Both 'server' and 'uri' are required." };
    }

    try {
      const content = await this.provider.readResource(server, uri);
      return { success: true, output: content };
    } catch (err: any) {
      return { success: false, output: `Failed to read resource: ${err.message || err}` };
    }
  }
}
