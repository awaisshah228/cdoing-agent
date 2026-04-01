/**
 * Notebook Edit Tool — Read and edit Jupyter notebooks (.ipynb files).
 *
 * Supports:
 *   - Reading cells (code, markdown, raw)
 *   - Editing cell content by index
 *   - Inserting new cells
 *   - Deleting cells
 *   - Changing cell type
 *   - Clearing cell outputs
 */

import * as fs from "fs";
import type { BaseTool, ToolDefinition, ToolResult } from "../types";
import { safePath } from "../../utils/path-safety";
import type { SandboxManager } from "../../sandbox";

interface NotebookCell {
  cell_type: "code" | "markdown" | "raw";
  source: string[];
  metadata: Record<string, unknown>;
  outputs?: unknown[];
  execution_count?: number | null;
}

interface Notebook {
  nbformat: number;
  nbformat_minor: number;
  metadata: Record<string, unknown>;
  cells: NotebookCell[];
}

export class NotebookEditTool implements BaseTool {
  // ── Behavioral flags ──
  concurrencyMode = () => "parallel-file" as const;
  getFilePath = (input: Record<string, unknown>) => input.file_path as string | undefined;
  definition: ToolDefinition = {
    name: "notebook_edit",
    description:
      `Read and edit Jupyter notebook (.ipynb) files. Supports viewing cells, editing cell content, inserting/deleting cells, and changing cell types.

Actions:
- read: View all cells with their indices, types, and content
- edit_cell: Replace the content of a cell by index
- insert_cell: Insert a new cell at a position
- delete_cell: Remove a cell by index
- change_type: Change a cell's type (code/markdown/raw)
- clear_outputs: Clear all cell outputs

Use this for working with Jupyter notebooks without corrupting the JSON structure.`,
    inputSchema: {
      type: "object",
      properties: {
        file_path: {
          type: "string",
          description: "Path to the .ipynb notebook file",
        },
        action: {
          type: "string",
          enum: ["read", "edit_cell", "insert_cell", "delete_cell", "change_type", "clear_outputs"],
          description: "Action to perform on the notebook",
        },
        cell_index: {
          type: "number",
          description: "Cell index (0-based) for edit_cell, delete_cell, change_type",
        },
        content: {
          type: "string",
          description: "New cell content (for edit_cell, insert_cell)",
        },
        cell_type: {
          type: "string",
          enum: ["code", "markdown", "raw"],
          description: "Cell type (for insert_cell, change_type). Default: code",
        },
        insert_position: {
          type: "number",
          description: "Position to insert new cell (for insert_cell). Default: end of notebook",
        },
      },
      required: ["file_path", "action"],
    },
    requiresPermission: true,
    permissionMessage: (input) => `Notebook ${input.action}: ${input.file_path}`,
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

    const action = input.action as string;

    // Read action doesn't need write permission
    if (action !== "read") {
      if (this.sandboxManager) {
        const check = this.sandboxManager.checkFileWrite(filePath);
        if (!check.allowed) {
          return { success: false, output: "", error: check.reason || "Sandbox: write access denied" };
        }
      }
    }

    if (!fs.existsSync(filePath)) {
      if (action === "read") {
        return { success: false, output: "", error: `Notebook not found: ${filePath}` };
      }
      // For write actions on non-existent file, create a new empty notebook
    }

    try {
      switch (action) {
        case "read":
          return this.readNotebook(filePath);
        case "edit_cell":
          return this.editCell(filePath, input);
        case "insert_cell":
          return this.insertCell(filePath, input);
        case "delete_cell":
          return this.deleteCell(filePath, input);
        case "change_type":
          return this.changeType(filePath, input);
        case "clear_outputs":
          return this.clearOutputs(filePath);
        default:
          return { success: false, output: "", error: `Unknown action: ${action}` };
      }
    } catch (err) {
      return { success: false, output: "", error: (err as Error).message };
    }
  }

  private loadNotebook(filePath: string): Notebook {
    const raw = fs.readFileSync(filePath, "utf-8");
    const nb = JSON.parse(raw) as Notebook;
    if (!nb.cells || !Array.isArray(nb.cells)) {
      throw new Error("Invalid notebook: missing cells array");
    }
    return nb;
  }

  private saveNotebook(filePath: string, nb: Notebook): void {
    fs.writeFileSync(filePath, JSON.stringify(nb, null, 1) + "\n", "utf-8");
  }

  private createEmptyNotebook(): Notebook {
    return {
      nbformat: 4,
      nbformat_minor: 5,
      metadata: {
        kernelspec: { display_name: "Python 3", language: "python", name: "python3" },
        language_info: { name: "python", version: "3.10.0" },
      },
      cells: [],
    };
  }

  private formatCell(cell: NotebookCell, index: number): string {
    const source = Array.isArray(cell.source) ? cell.source.join("") : String(cell.source);
    const lines = source.split("\n");
    const preview = lines.length > 10
      ? lines.slice(0, 10).join("\n") + `\n... (${lines.length - 10} more lines)`
      : source;

    const outputInfo = cell.cell_type === "code" && cell.outputs && Array.isArray(cell.outputs)
      ? ` [${cell.outputs.length} output(s)]`
      : "";
    const execCount = cell.execution_count != null ? ` In[${cell.execution_count}]` : "";

    return `[${index}] ${cell.cell_type}${execCount}${outputInfo}\n${preview}`;
  }

  private readNotebook(filePath: string): ToolResult {
    const nb = this.loadNotebook(filePath);
    const parts: string[] = [
      `Notebook: ${filePath}`,
      `Format: ${nb.nbformat}.${nb.nbformat_minor}`,
      `Cells: ${nb.cells.length}`,
      `---`,
    ];

    for (let i = 0; i < nb.cells.length; i++) {
      parts.push(this.formatCell(nb.cells[i], i));
      if (i < nb.cells.length - 1) parts.push("");
    }

    return { success: true, output: parts.join("\n") };
  }

  private editCell(filePath: string, input: Record<string, unknown>): ToolResult {
    const nb = this.loadNotebook(filePath);
    const idx = input.cell_index as number;
    const content = input.content as string;

    if (idx === undefined || idx === null) {
      return { success: false, output: "", error: "cell_index is required for edit_cell" };
    }
    if (content === undefined) {
      return { success: false, output: "", error: "content is required for edit_cell" };
    }
    if (idx < 0 || idx >= nb.cells.length) {
      return { success: false, output: "", error: `cell_index ${idx} out of range (0-${nb.cells.length - 1})` };
    }

    const oldSource = Array.isArray(nb.cells[idx].source) ? nb.cells[idx].source.join("") : "";
    nb.cells[idx].source = content.split("\n").map((line, i, arr) =>
      i < arr.length - 1 ? line + "\n" : line
    );

    // Clear outputs for code cells when content changes
    if (nb.cells[idx].cell_type === "code") {
      nb.cells[idx].outputs = [];
      nb.cells[idx].execution_count = null;
    }

    this.saveNotebook(filePath, nb);

    const oldLines = oldSource.split("\n").length;
    const newLines = content.split("\n").length;
    return {
      success: true,
      output: `Edited cell [${idx}] (${nb.cells[idx].cell_type}): ${oldLines} → ${newLines} lines`,
    };
  }

  private insertCell(filePath: string, input: Record<string, unknown>): ToolResult {
    let nb: Notebook;
    if (fs.existsSync(filePath)) {
      nb = this.loadNotebook(filePath);
    } else {
      nb = this.createEmptyNotebook();
    }

    const content = (input.content as string) || "";
    const cellType = (input.cell_type as "code" | "markdown" | "raw") || "code";
    const pos = input.insert_position !== undefined ? (input.insert_position as number) : nb.cells.length;

    if (pos < 0 || pos > nb.cells.length) {
      return { success: false, output: "", error: `insert_position ${pos} out of range (0-${nb.cells.length})` };
    }

    const newCell: NotebookCell = {
      cell_type: cellType,
      source: content.split("\n").map((line, i, arr) =>
        i < arr.length - 1 ? line + "\n" : line
      ),
      metadata: {},
      ...(cellType === "code" ? { outputs: [], execution_count: null } : {}),
    };

    nb.cells.splice(pos, 0, newCell);
    this.saveNotebook(filePath, nb);

    return {
      success: true,
      output: `Inserted ${cellType} cell at position [${pos}] (${nb.cells.length} cells total)`,
    };
  }

  private deleteCell(filePath: string, input: Record<string, unknown>): ToolResult {
    const nb = this.loadNotebook(filePath);
    const idx = input.cell_index as number;

    if (idx === undefined || idx === null) {
      return { success: false, output: "", error: "cell_index is required for delete_cell" };
    }
    if (idx < 0 || idx >= nb.cells.length) {
      return { success: false, output: "", error: `cell_index ${idx} out of range (0-${nb.cells.length - 1})` };
    }

    const removed = nb.cells.splice(idx, 1)[0];
    this.saveNotebook(filePath, nb);

    return {
      success: true,
      output: `Deleted cell [${idx}] (${removed.cell_type}), ${nb.cells.length} cells remaining`,
    };
  }

  private changeType(filePath: string, input: Record<string, unknown>): ToolResult {
    const nb = this.loadNotebook(filePath);
    const idx = input.cell_index as number;
    const newType = input.cell_type as "code" | "markdown" | "raw";

    if (idx === undefined || idx === null) {
      return { success: false, output: "", error: "cell_index is required for change_type" };
    }
    if (!newType) {
      return { success: false, output: "", error: "cell_type is required for change_type" };
    }
    if (idx < 0 || idx >= nb.cells.length) {
      return { success: false, output: "", error: `cell_index ${idx} out of range (0-${nb.cells.length - 1})` };
    }

    const oldType = nb.cells[idx].cell_type;
    nb.cells[idx].cell_type = newType;

    // Add/remove outputs field based on type
    if (newType === "code") {
      if (!nb.cells[idx].outputs) nb.cells[idx].outputs = [];
      if (nb.cells[idx].execution_count === undefined) nb.cells[idx].execution_count = null;
    } else {
      delete nb.cells[idx].outputs;
      delete nb.cells[idx].execution_count;
    }

    this.saveNotebook(filePath, nb);

    return {
      success: true,
      output: `Changed cell [${idx}] type: ${oldType} → ${newType}`,
    };
  }

  private clearOutputs(filePath: string): ToolResult {
    const nb = this.loadNotebook(filePath);
    let cleared = 0;

    for (const cell of nb.cells) {
      if (cell.cell_type === "code" && cell.outputs && cell.outputs.length > 0) {
        cell.outputs = [];
        cell.execution_count = null;
        cleared++;
      }
    }

    this.saveNotebook(filePath, nb);

    return {
      success: true,
      output: `Cleared outputs from ${cleared} code cell(s) in ${filePath}`,
    };
  }
}
