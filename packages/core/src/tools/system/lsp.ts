/**
 * LSP Tool — Language Server Protocol operations.
 *
 * Provides code intelligence: go-to-definition, find-references, hover,
 * document symbols, workspace symbols, and diagnostics.
 *
 * Language servers are spawned on demand and cached per language.
 * Server configuration maps file extensions to server commands.
 */

import * as path from "path";
import * as fs from "fs";
import { spawn, type ChildProcess } from "child_process";
import type { BaseTool, ToolDefinition, ToolResult } from "../types";
import { safePath } from "../../utils/path-safety";

const OPERATIONS = [
  "goToDefinition",
  "findReferences",
  "hover",
  "documentSymbol",
  "workspaceSymbol",
  "diagnostics",
] as const;

type LspOperation = typeof OPERATIONS[number];

export interface LspServerConfig {
  command: string;
  args: string[];
}

/** JSON-RPC message */
interface JsonRpcMessage {
  jsonrpc: "2.0";
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string };
}

/** Minimal LSP client over stdio */
class LspClient {
  private process: ChildProcess;
  private nextId = 1;
  private pendingRequests = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private buffer = "";
  private initialized = false;
  private rootUri: string;

  constructor(config: LspServerConfig, workingDir: string) {
    this.rootUri = `file://${workingDir}`;
    this.process = spawn(config.command, config.args, {
      cwd: workingDir,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
    });

    this.process.stdout?.on("data", (data: Buffer) => {
      this.buffer += data.toString();
      this.processBuffer();
    });

    this.process.stderr?.on("data", () => {
      // Silently consume stderr from language servers
    });

    this.process.on("error", () => {
      // Server failed to start — will be handled by request timeouts
    });
  }

  private processBuffer(): void {
    while (true) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) break;

      const header = this.buffer.substring(0, headerEnd);
      const contentLengthMatch = header.match(/Content-Length:\s*(\d+)/i);
      if (!contentLengthMatch) {
        this.buffer = this.buffer.substring(headerEnd + 4);
        continue;
      }

      const contentLength = parseInt(contentLengthMatch[1], 10);
      const bodyStart = headerEnd + 4;
      if (this.buffer.length < bodyStart + contentLength) break;

      const body = this.buffer.substring(bodyStart, bodyStart + contentLength);
      this.buffer = this.buffer.substring(bodyStart + contentLength);

      try {
        const msg: JsonRpcMessage = JSON.parse(body);
        if (msg.id !== undefined && this.pendingRequests.has(msg.id)) {
          const pending = this.pendingRequests.get(msg.id)!;
          this.pendingRequests.delete(msg.id);
          if (msg.error) {
            pending.reject(new Error(msg.error.message));
          } else {
            pending.resolve(msg.result);
          }
        }
      } catch { /* ignore parse errors */ }
    }
  }

  private send(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId++;
    const msg: JsonRpcMessage = { jsonrpc: "2.0", id, method, params };
    const body = JSON.stringify(msg);
    const header = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n`;

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      try {
        this.process.stdin?.write(header + body);
      } catch (err) {
        this.pendingRequests.delete(id);
        reject(new Error("Failed to write to LSP server"));
      }

      // Timeout after 10 seconds
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error("LSP request timed out"));
        }
      }, 10000);
    });
  }

  private notify(method: string, params: unknown): void {
    const msg = { jsonrpc: "2.0", method, params };
    const body = JSON.stringify(msg);
    const header = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n`;
    try {
      this.process.stdin?.write(header + body);
    } catch { /* ignore */ }
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    await this.send("initialize", {
      processId: process.pid,
      rootUri: this.rootUri,
      capabilities: {
        textDocument: {
          definition: { dynamicRegistration: false },
          references: { dynamicRegistration: false },
          hover: { dynamicRegistration: false, contentFormat: ["plaintext", "markdown"] },
          documentSymbol: { dynamicRegistration: false },
        },
        workspace: {
          symbol: { dynamicRegistration: false },
        },
      },
    });

    this.notify("initialized", {});
    this.initialized = true;
  }

  async openFile(uri: string, text: string, languageId: string): Promise<void> {
    this.notify("textDocument/didOpen", {
      textDocument: { uri, languageId, version: 1, text },
    });
  }

  async goToDefinition(uri: string, line: number, character: number): Promise<unknown> {
    return this.send("textDocument/definition", {
      textDocument: { uri },
      position: { line, character },
    });
  }

  async findReferences(uri: string, line: number, character: number): Promise<unknown> {
    return this.send("textDocument/references", {
      textDocument: { uri },
      position: { line, character },
      context: { includeDeclaration: true },
    });
  }

  async hover(uri: string, line: number, character: number): Promise<unknown> {
    return this.send("textDocument/hover", {
      textDocument: { uri },
      position: { line, character },
    });
  }

  async documentSymbol(uri: string): Promise<unknown> {
    return this.send("textDocument/documentSymbol", {
      textDocument: { uri },
    });
  }

  async workspaceSymbol(query: string): Promise<unknown> {
    return this.send("workspace/symbol", { query });
  }

  shutdown(): void {
    try {
      this.process.stdin?.write(
        `Content-Length: ${Buffer.byteLength('{"jsonrpc":"2.0","id":0,"method":"shutdown","params":null}')}\r\n\r\n{"jsonrpc":"2.0","id":0,"method":"shutdown","params":null}`
      );
      this.notify("exit", null);
    } catch { /* ignore */ }
    setTimeout(() => {
      try { this.process.kill(); } catch { /* ignore */ }
    }, 2000);
  }
}

/** Default language server configurations */
const DEFAULT_LSP_CONFIGS: Record<string, LspServerConfig> = {
  typescript: { command: "typescript-language-server", args: ["--stdio"] },
  javascript: { command: "typescript-language-server", args: ["--stdio"] },
  python: { command: "pylsp", args: [] },
  rust: { command: "rust-analyzer", args: [] },
  go: { command: "gopls", args: ["serve"] },
};

/** Map file extensions to language IDs */
function getLanguageId(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const map: Record<string, string> = {
    ".ts": "typescript", ".tsx": "typescript",
    ".js": "javascript", ".jsx": "javascript",
    ".mjs": "javascript", ".cjs": "javascript",
    ".py": "python",
    ".rs": "rust",
    ".go": "go",
    ".java": "java",
    ".c": "c", ".h": "c",
    ".cpp": "cpp", ".hpp": "cpp", ".cc": "cpp",
    ".rb": "ruby",
    ".php": "php",
  };
  return map[ext] || "plaintext";
}

export class LspTool implements BaseTool {
  definition: ToolDefinition = {
    name: "lsp",
    description:
      "Perform Language Server Protocol operations for code intelligence. Supports: goToDefinition, findReferences, hover, documentSymbol, workspaceSymbol, diagnostics. Requires a language server to be installed for the target language.",
    inputSchema: {
      type: "object",
      properties: {
        operation: {
          type: "string",
          enum: [...OPERATIONS],
          description: "The LSP operation to perform",
        },
        file_path: {
          type: "string",
          description: "Path to the file (relative or absolute)",
        },
        line: {
          type: "number",
          description: "Line number (1-based). Required for goToDefinition, findReferences, hover.",
        },
        character: {
          type: "number",
          description: "Character offset (1-based). Required for goToDefinition, findReferences, hover.",
        },
        query: {
          type: "string",
          description: "Search query for workspaceSymbol operation",
        },
      },
      required: ["operation", "file_path"],
    },
    requiresPermission: true,
    permissionMessage: (input) => {
      const op = input.operation as string;
      const file = input.file_path as string;
      const line = input.line as number | undefined;
      const char = input.character as number | undefined;
      if (line && char) return `LSP ${op}: ${file}:${line}:${char}`;
      return `LSP ${op}: ${file}`;
    },
  };

  private workingDir: string;
  private servers = new Map<string, LspClient>();
  private customConfig: Record<string, LspServerConfig>;

  constructor(workingDir: string, lspConfig?: Record<string, LspServerConfig>) {
    this.workingDir = workingDir;
    this.customConfig = lspConfig || {};
  }

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const operation = input.operation as LspOperation;
    const filePath = safePath(this.workingDir, String(input.file_path || ""));
    const line = (input.line as number | undefined) ?? 1;
    const character = (input.character as number | undefined) ?? 1;
    const query = (input.query as string) || "";

    if (!OPERATIONS.includes(operation)) {
      return { success: false, output: "", error: `Unknown operation: ${operation}. Use one of: ${OPERATIONS.join(", ")}` };
    }

    if (!fs.existsSync(filePath)) {
      return { success: false, output: "", error: `File not found: ${filePath}` };
    }

    const languageId = getLanguageId(filePath);
    const config = this.customConfig[languageId] || DEFAULT_LSP_CONFIGS[languageId];

    if (!config) {
      return {
        success: false,
        output: "",
        error: `No LSP server configured for language: ${languageId}. Supported: ${Object.keys(DEFAULT_LSP_CONFIGS).join(", ")}`,
      };
    }

    try {
      const client = await this.getOrCreateClient(languageId, config);
      const uri = `file://${filePath}`;
      const fileContent = fs.readFileSync(filePath, "utf-8");

      // Open the file in the server
      await client.openFile(uri, fileContent, languageId);

      // Convert from 1-based (user) to 0-based (LSP)
      const lspLine = line - 1;
      const lspChar = character - 1;

      let result: unknown;

      switch (operation) {
        case "goToDefinition":
          result = await client.goToDefinition(uri, lspLine, lspChar);
          break;
        case "findReferences":
          result = await client.findReferences(uri, lspLine, lspChar);
          break;
        case "hover":
          result = await client.hover(uri, lspLine, lspChar);
          break;
        case "documentSymbol":
          result = await client.documentSymbol(uri);
          break;
        case "workspaceSymbol":
          result = await client.workspaceSymbol(query);
          break;
        case "diagnostics":
          // Diagnostics come asynchronously — return current file state
          result = { message: "Diagnostics are pushed asynchronously. Check the file for errors after saving." };
          break;
      }

      if (!result) {
        return { success: true, output: "No results found" };
      }

      const formatted = formatLspResult(operation, result, this.workingDir);
      return { success: true, output: formatted };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // If server failed, remove from cache so it can be retried
      this.servers.delete(languageId);
      return { success: false, output: "", error: `LSP ${operation} failed: ${message}` };
    }
  }

  private async getOrCreateClient(languageId: string, config: LspServerConfig): Promise<LspClient> {
    let client = this.servers.get(languageId);
    if (!client) {
      client = new LspClient(config, this.workingDir);
      await client.initialize();
      this.servers.set(languageId, client);
    }
    return client;
  }

  /** Cleanup — shutdown all servers */
  shutdown(): void {
    for (const [, client] of this.servers) {
      client.shutdown();
    }
    this.servers.clear();
  }
}

/** Format LSP results for agent consumption */
function formatLspResult(operation: LspOperation, result: unknown, workingDir: string): string {
  if (!result) return "No results";

  // Location or Location[]
  if (Array.isArray(result)) {
    if (result.length === 0) return "No results found";

    const items = result.slice(0, 50).map((item: Record<string, unknown>) => {
      if (item.uri && item.range) {
        const range = item.range as Record<string, Record<string, number>>;
        const uri = String(item.uri).replace("file://", "");
        const relPath = path.relative(workingDir, uri);
        const line = (range.start?.line ?? 0) + 1;
        const char = (range.start?.character ?? 0) + 1;
        return `${relPath}:${line}:${char}`;
      }
      if (item.name) {
        // SymbolInformation
        const kind = item.kind as number;
        const kindName = SYMBOL_KINDS[kind] || "Unknown";
        const loc = item.location as Record<string, unknown> | undefined;
        if (loc?.uri) {
          const uri = String(loc.uri).replace("file://", "");
          const relPath = path.relative(workingDir, uri);
          return `${kindName} ${item.name} (${relPath})`;
        }
        return `${kindName} ${item.name}`;
      }
      return JSON.stringify(item);
    });

    const suffix = result.length > 50 ? `\n... and ${result.length - 50} more` : "";
    return items.join("\n") + suffix;
  }

  // Single location
  if (typeof result === "object" && result !== null) {
    const obj = result as Record<string, unknown>;

    // Hover result
    if (obj.contents) {
      const contents = obj.contents;
      if (typeof contents === "string") return contents;
      if (typeof contents === "object" && contents !== null) {
        const c = contents as Record<string, unknown>;
        if (c.value) return String(c.value);
        if (c.kind && c.value) return String(c.value);
      }
      return JSON.stringify(contents, null, 2);
    }

    // Location
    if (obj.uri && obj.range) {
      const uri = String(obj.uri).replace("file://", "");
      const relPath = path.relative(workingDir, uri);
      const range = obj.range as Record<string, Record<string, number>>;
      const line = (range.start?.line ?? 0) + 1;
      return `${relPath}:${line}`;
    }
  }

  return JSON.stringify(result, null, 2);
}

const SYMBOL_KINDS: Record<number, string> = {
  1: "File", 2: "Module", 3: "Namespace", 4: "Package", 5: "Class",
  6: "Method", 7: "Property", 8: "Field", 9: "Constructor", 10: "Enum",
  11: "Interface", 12: "Function", 13: "Variable", 14: "Constant",
  15: "String", 16: "Number", 17: "Boolean", 18: "Array", 19: "Object",
  20: "Key", 21: "Null", 22: "EnumMember", 23: "Struct", 24: "Event",
  25: "Operator", 26: "TypeParameter",
};
