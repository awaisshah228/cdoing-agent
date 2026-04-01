/**
 * AST Edit Tool — Tree-sitter powered structural code editing.
 *
 * Uses tree-sitter to parse source code into an AST, then performs
 * targeted edits on specific AST nodes (functions, classes, methods,
 * imports, etc.) by name rather than by string matching.
 *
 * This is more reliable than string-based editing for:
 *   - Renaming functions/methods/classes across a file
 *   - Replacing entire function bodies
 *   - Adding/removing imports
 *   - Inserting methods into classes
 *   - Extracting or inlining code blocks
 */

import * as fs from "fs";
import type { BaseTool, ToolDefinition, ToolResult } from "../types";
import { safePath } from "../../utils/path-safety";
import type { SandboxManager } from "../../sandbox";

// Tree-sitter types (loaded dynamically to keep it optional)
let Parser: any = null;
const languageCache = new Map<string, any>();

/** Supported languages and their tree-sitter package names */
const LANGUAGE_MAP: Record<string, string> = {
  ".ts": "tree-sitter-typescript/typescript",
  ".tsx": "tree-sitter-typescript/tsx",
  ".js": "tree-sitter-javascript",
  ".jsx": "tree-sitter-javascript",
  ".py": "tree-sitter-python",
  ".rs": "tree-sitter-rust",
  ".go": "tree-sitter-go",
  ".java": "tree-sitter-java",
  ".c": "tree-sitter-c",
  ".cpp": "tree-sitter-cpp",
  ".rb": "tree-sitter-ruby",
  ".css": "tree-sitter-css",
  ".json": "tree-sitter-json",
};

/** AST node types we can target for editing */
type ASTNodeType =
  | "function"
  | "class"
  | "method"
  | "import"
  | "variable"
  | "type"
  | "interface"
  | "enum"
  | "block"
  | "expression";

interface ASTEditOperation {
  /** Type of AST node to target */
  node_type: ASTNodeType;
  /** Name of the node (function name, class name, etc.) */
  name: string;
  /** Action to perform */
  action: "replace" | "rename" | "delete" | "insert_before" | "insert_after" | "replace_body";
  /** New content (for replace, insert_before, insert_after, replace_body) */
  content?: string;
  /** New name (for rename) */
  new_name?: string;
}

export class ASTEditTool implements BaseTool {
  // ── Behavioral flags ──
  concurrencyMode = () => "parallel-file" as const;
  getFilePath = (input: Record<string, unknown>) => input.file_path as string | undefined;
  definition: ToolDefinition = {
    name: "ast_edit",
    description:
      `Perform structural edits on source code using Tree-sitter AST parsing. More reliable than string matching for targeting specific code structures.

Supported operations:
- replace: Replace an entire AST node (function, class, etc.) with new content
- rename: Rename a function, class, method, variable, or type
- delete: Remove an AST node entirely
- insert_before/insert_after: Insert content before or after a named node
- replace_body: Replace only the body of a function/method/class (keeps signature)

Supported languages: TypeScript, JavaScript, Python, Rust, Go, Java, C, C++, Ruby, CSS, JSON.

Use this when string-matching edits are fragile or when you need to target code by structure rather than text.`,
    inputSchema: {
      type: "object",
      properties: {
        file_path: {
          type: "string",
          description: "Path to the file to edit",
        },
        operations: {
          type: "array",
          description: "Array of AST edit operations to apply sequentially",
          items: {
            type: "object",
            properties: {
              node_type: {
                type: "string",
                enum: ["function", "class", "method", "import", "variable", "type", "interface", "enum", "block", "expression"],
                description: "Type of AST node to target",
              },
              name: {
                type: "string",
                description: "Name of the node (function name, class name, variable name, import module name, etc.)",
              },
              action: {
                type: "string",
                enum: ["replace", "rename", "delete", "insert_before", "insert_after", "replace_body"],
                description: "Action to perform on the node",
              },
              content: {
                type: "string",
                description: "New content (for replace, insert_before, insert_after, replace_body actions)",
              },
              new_name: {
                type: "string",
                description: "New name (for rename action)",
              },
            },
            required: ["node_type", "name", "action"],
          },
        },
      },
      required: ["file_path", "operations"],
    },
    requiresPermission: true,
    permissionMessage: (input) => {
      const ops = input.operations as unknown[];
      return `AST edit: ${input.file_path} (${Array.isArray(ops) ? ops.length : "?"} operation(s))`;
    },
  };

  private workingDir: string;
  private sandboxManager?: SandboxManager;

  constructor(workingDir: string, sandboxManager?: SandboxManager) {
    this.workingDir = workingDir;
    this.sandboxManager = sandboxManager;
  }

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    let filePath: string;
    try {
      filePath = safePath(input.file_path as string, this.workingDir);
    } catch (err) {
      return { success: false, output: "", error: (err as Error).message };
    }

    if (this.sandboxManager) {
      const check = this.sandboxManager.checkFileWrite(filePath);
      if (!check.allowed) {
        return { success: false, output: "", error: check.reason || "Sandbox: write access denied" };
      }
    }

    if (!fs.existsSync(filePath)) {
      return { success: false, output: "", error: `File not found: ${filePath}` };
    }

    const operations = input.operations as ASTEditOperation[];
    if (!Array.isArray(operations) || operations.length === 0) {
      return { success: false, output: "", error: "operations must be a non-empty array" };
    }

    // Initialize tree-sitter
    const initResult = await this.initParser(filePath);
    if (!initResult.success) {
      return initResult;
    }

    let content = fs.readFileSync(filePath, "utf-8");
    const originalContent = content;
    const results: string[] = [];

    for (let i = 0; i < operations.length; i++) {
      const op = operations[i];

      // Validate operation
      if (op.action === "rename" && !op.new_name) {
        return { success: false, output: "", error: `Operation ${i + 1}: rename requires new_name` };
      }
      if ((op.action === "replace" || op.action === "insert_before" || op.action === "insert_after" || op.action === "replace_body") && op.content === undefined) {
        return { success: false, output: "", error: `Operation ${i + 1}: ${op.action} requires content` };
      }

      try {
        const result = this.applyOperation(content, filePath, op);
        content = result.content;
        results.push(`${i + 1}. ${op.action} ${op.node_type} "${op.name}" — ${result.message}`);
      } catch (err) {
        return { success: false, output: results.join("\n"), error: `Operation ${i + 1} failed: ${(err as Error).message}` };
      }
    }

    // Write result
    fs.writeFileSync(filePath, content, "utf-8");

    // Generate diff summary
    const oldLines = originalContent.split("\n");
    const newLines = content.split("\n");
    const diffHeader = `--- a/${input.file_path}\n+++ b/${input.file_path}\n@@ -1,${oldLines.length} +1,${newLines.length} @@`;

    return {
      success: true,
      output: `AST-edited ${filePath}: ${operations.length} operation(s)\n\n${results.join("\n")}\n\n${diffHeader}`,
    };
  }

  /**
   * Initialize tree-sitter parser for the given file's language.
   */
  private async initParser(filePath: string): Promise<ToolResult> {
    const ext = filePath.substring(filePath.lastIndexOf(".")).toLowerCase();
    const langPackage = LANGUAGE_MAP[ext];

    if (!langPackage) {
      return {
        success: false,
        output: "",
        error: `Unsupported file type: ${ext}. Supported: ${Object.keys(LANGUAGE_MAP).join(", ")}`,
      };
    }

    try {
      if (!Parser) {
        Parser = require("tree-sitter");
      }

      if (!languageCache.has(langPackage)) {
        const lang = require(langPackage);
        languageCache.set(langPackage, lang);
      }

      return { success: true, output: "" };
    } catch {
      return {
        success: false,
        output: "",
        error: `Tree-sitter not available. Install with: npm install tree-sitter ${langPackage}`,
      };
    }
  }

  /**
   * Parse source code and apply a single AST operation.
   */
  private applyOperation(
    content: string,
    filePath: string,
    op: ASTEditOperation,
  ): { content: string; message: string } {
    const ext = filePath.substring(filePath.lastIndexOf(".")).toLowerCase();
    const langPackage = LANGUAGE_MAP[ext]!;
    const language = languageCache.get(langPackage);

    const parser = new Parser();
    parser.setLanguage(language);
    const tree = parser.parse(content);

    // Find the target node
    const node = this.findNode(tree.rootNode, op.node_type, op.name);
    if (!node) {
      throw new Error(`Could not find ${op.node_type} named "${op.name}" in AST`);
    }

    const startIdx = node.startIndex;
    const endIdx = node.endIndex;

    switch (op.action) {
      case "replace":
        return {
          content: content.substring(0, startIdx) + op.content! + content.substring(endIdx),
          message: `replaced (${node.startPosition.row + 1}:${node.startPosition.column}-${node.endPosition.row + 1}:${node.endPosition.column})`,
        };

      case "delete":
        // Delete the node and any trailing newline
        let deleteEnd = endIdx;
        if (content[deleteEnd] === "\n") deleteEnd++;
        return {
          content: content.substring(0, startIdx) + content.substring(deleteEnd),
          message: `deleted (${node.startPosition.row + 1}:${node.startPosition.column}-${node.endPosition.row + 1}:${node.endPosition.column})`,
        };

      case "rename":
        return this.renameNode(content, node, op.name, op.new_name!);

      case "insert_before":
        return {
          content: content.substring(0, startIdx) + op.content! + "\n" + content.substring(startIdx),
          message: `inserted before (line ${node.startPosition.row + 1})`,
        };

      case "insert_after":
        return {
          content: content.substring(0, endIdx) + "\n" + op.content! + content.substring(endIdx),
          message: `inserted after (line ${node.endPosition.row + 1})`,
        };

      case "replace_body": {
        const body = this.findBody(node);
        if (!body) {
          throw new Error(`No body found for ${op.node_type} "${op.name}"`);
        }
        return {
          content: content.substring(0, body.startIndex) + op.content! + content.substring(body.endIndex),
          message: `body replaced (${body.startPosition.row + 1}:${body.startPosition.column}-${body.endPosition.row + 1}:${body.endPosition.column})`,
        };
      }

      default:
        throw new Error(`Unknown action: ${op.action}`);
    }
  }

  /**
   * Find an AST node by type and name.
   */
  private findNode(rootNode: any, nodeType: ASTNodeType, name: string): any {
    const matches: any[] = [];
    this.walkTree(rootNode, (node: any) => {
      if (this.matchesNodeType(node, nodeType) && this.getNodeName(node) === name) {
        matches.push(node);
      }
    });
    return matches[0] || null;
  }

  /**
   * Walk the AST tree depth-first, calling visitor on each node.
   */
  private walkTree(node: any, visitor: (node: any) => void): void {
    visitor(node);
    for (let i = 0; i < node.childCount; i++) {
      this.walkTree(node.child(i), visitor);
    }
  }

  /**
   * Check if an AST node matches the requested type category.
   */
  private matchesNodeType(node: any, nodeType: ASTNodeType): boolean {
    const type = node.type as string;

    switch (nodeType) {
      case "function":
        return [
          "function_declaration", "function_definition", "function_item",
          "arrow_function", "method_definition", "function_expression",
          "export_statement", // may wrap a function
        ].includes(type);

      case "class":
        return [
          "class_declaration", "class_definition", "class_statement",
          "struct_item", "impl_item",
        ].includes(type);

      case "method":
        return [
          "method_definition", "method_declaration", "function_item",
          "public_method_definition",
        ].includes(type);

      case "import":
        return [
          "import_statement", "import_declaration", "use_declaration",
          "import_from_statement", "include_statement",
        ].includes(type);

      case "variable":
        return [
          "variable_declaration", "lexical_declaration", "const_declaration",
          "let_declaration", "variable_declarator", "assignment_expression",
          "static_item", "const_item",
        ].includes(type);

      case "type":
        return [
          "type_alias_declaration", "type_definition", "typedef_declaration",
        ].includes(type);

      case "interface":
        return [
          "interface_declaration", "interface_definition",
        ].includes(type);

      case "enum":
        return [
          "enum_declaration", "enum_definition", "enum_item",
        ].includes(type);

      case "block":
        return [
          "statement_block", "block", "compound_statement",
          "block_expression",
        ].includes(type);

      case "expression":
        return [
          "expression_statement", "call_expression", "assignment_expression",
        ].includes(type);

      default:
        return false;
    }
  }

  /**
   * Extract the name identifier from an AST node.
   */
  private getNodeName(node: any): string | null {
    // Direct name child
    const nameNode = node.childForFieldName?.("name");
    if (nameNode) return nameNode.text;

    // Check for declarator (variable declarations)
    const declarator = node.childForFieldName?.("declarator");
    if (declarator) {
      const declName = declarator.childForFieldName?.("name");
      if (declName) return declName.text;
      return declarator.text;
    }

    // For export statements, check the declaration inside
    if (node.type === "export_statement") {
      const decl = node.childForFieldName?.("declaration");
      if (decl) return this.getNodeName(decl);
    }

    // For imports, try to get the module/source name
    if (node.type?.includes("import")) {
      const source = node.childForFieldName?.("source") || node.childForFieldName?.("module_name");
      if (source) return source.text?.replace(/['"]/g, "");
    }

    // For lexical_declaration, check first declarator child
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child.type === "variable_declarator") {
        const childName = child.childForFieldName?.("name");
        if (childName) return childName.text;
      }
    }

    return null;
  }

  /**
   * Find the body/block node within a function, method, or class.
   */
  private findBody(node: any): any {
    // Common body field names
    const bodyNode = node.childForFieldName?.("body") || node.childForFieldName?.("block");
    if (bodyNode) return bodyNode;

    // Fallback: find first block-type child
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (["statement_block", "block", "compound_statement", "class_body"].includes(child.type)) {
        return child;
      }
    }

    return null;
  }

  /**
   * Rename a node by replacing all occurrences of the old name with the new name
   * within the node's text range.
   */
  private renameNode(
    content: string,
    node: any,
    oldName: string,
    newName: string,
  ): { content: string; message: string } {
    const nodeText = content.substring(node.startIndex, node.endIndex);
    // Replace identifier occurrences (word-boundary aware)
    const pattern = new RegExp(`\\b${escapeRegex(oldName)}\\b`, "g");
    const updatedText = nodeText.replace(pattern, newName);
    const count = (nodeText.match(pattern) || []).length;

    return {
      content: content.substring(0, node.startIndex) + updatedText + content.substring(node.endIndex),
      message: `renamed ${count} occurrence(s) of "${oldName}" → "${newName}"`,
    };
  }
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
