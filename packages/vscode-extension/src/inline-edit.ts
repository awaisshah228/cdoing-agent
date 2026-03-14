/**
 * Inline Edit Mode — Cmd+I / Ctrl+I
 *
 * Allows users to select code, press Cmd+I, type an instruction,
 * and see the AI-generated changes as an inline diff — all without
 * opening the chat panel.
 *
 * How it works:
 *   1. User selects code and presses Cmd+I (or Ctrl+I on Windows/Linux)
 *   2. An input box appears at the top of the editor
 *   3. User types their instruction (e.g., "convert to async/await")
 *   4. We send the selected code + instruction to the AI
 *   5. AI returns modified code
 *   6. We show a VS Code diff view with accept/reject buttons
 *   7. User accepts (applies changes) or rejects (reverts)
 *
 * Learning note: This is modeled after Continue.dev's Cmd+I and
 * Cursor's Composer. The key insight is that many edits don't need
 * a full chat conversation — just "change this to that".
 */

import * as vscode from "vscode";
import { AgentRunner, type ModelConfig, createModel } from "@cdoing/ai";

/** Stores the pending inline edit state */
interface InlineEditState {
  editor: vscode.TextEditor;
  originalSelection: vscode.Selection;
  originalText: string;
  document: vscode.TextDocument;
}

/**
 * Register the inline edit command and keybinding.
 *
 * @param context - VS Code extension context
 * @param getModelConfig - Function to get current model configuration
 */
export function registerInlineEdit(
  context: vscode.ExtensionContext,
  getModelConfig: () => Partial<ModelConfig>,
): void {
  // Register the Cmd+I / Ctrl+I command
  context.subscriptions.push(
    vscode.commands.registerCommand("cdoing.inlineEdit", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage("No active editor");
        return;
      }

      const selection = editor.selection;
      if (selection.isEmpty) {
        vscode.window.showWarningMessage("Select some code first, then press Cmd+I");
        return;
      }

      const selectedText = editor.document.getText(selection);
      const filePath = vscode.workspace.asRelativePath(editor.document.uri);
      const languageId = editor.document.languageId;

      // Show an input box for the user's instruction
      const instruction = await vscode.window.showInputBox({
        prompt: `Inline Edit: ${filePath}:${selection.start.line + 1}-${selection.end.line + 1}`,
        placeHolder: "Describe the change (e.g., 'convert to async/await', 'add error handling')",
        ignoreFocusOut: true,
      });

      if (!instruction) return; // User cancelled

      // Show progress while the AI generates changes
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "Cdoing: Generating inline edit...",
          cancellable: true,
        },
        async (progress, token) => {
          try {
            const modelConfig = getModelConfig();
            const newCode = await generateInlineEdit(
              modelConfig,
              selectedText,
              instruction,
              languageId,
              filePath,
              token,
            );

            if (token.isCancellationRequested) return;

            if (!newCode || newCode === selectedText) {
              vscode.window.showInformationMessage("No changes suggested.");
              return;
            }

            // Show diff and let user accept/reject
            await showInlineEditDiff(editor, selection, selectedText, newCode);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            vscode.window.showErrorMessage(`Inline edit failed: ${msg}`);
          }
        },
      );
    }),
  );
}

/**
 * Generate an inline code edit using the AI model.
 *
 * We use a focused system prompt that tells the model to return
 * ONLY the modified code, without explanations or markdown fences.
 *
 * Learning note: A focused prompt is crucial here — we don't want
 * the model to explain its changes or wrap them in markdown. We
 * want raw code that can be directly applied as a replacement.
 */
async function generateInlineEdit(
  modelConfig: Partial<ModelConfig>,
  selectedCode: string,
  instruction: string,
  language: string,
  filePath: string,
  cancellationToken: vscode.CancellationToken,
): Promise<string> {
  const model = createModel(modelConfig);

  const systemPrompt = [
    "You are a code editor. The user has selected a block of code and wants you to modify it.",
    "IMPORTANT: Return ONLY the modified code. No explanations, no markdown fences, no commentary.",
    "Preserve the original indentation style. Only change what the instruction asks for.",
    `Language: ${language}`,
    `File: ${filePath}`,
  ].join("\n");

  const userPrompt = [
    "Selected code:",
    "```",
    selectedCode,
    "```",
    "",
    `Instruction: ${instruction}`,
    "",
    "Return only the modified code:",
  ].join("\n");

  // Use invoke() for a single-turn response (no tool calling needed)
  const messages = [
    { role: "system" as const, content: systemPrompt },
    { role: "user" as const, content: userPrompt },
  ];

  const response = await model.invoke(messages);

  // Extract text from the response
  let result = typeof response.content === "string"
    ? response.content
    : Array.isArray(response.content)
      ? response.content
        .map((b: any) => (typeof b === "string" ? b : b.text || ""))
        .join("")
      : "";

  // Clean up: remove markdown fences if the model added them anyway
  result = result
    .replace(/^```[\w]*\n/, "")
    .replace(/\n```\s*$/, "")
    .trim();

  return result;
}

/**
 * Show a diff between original and modified code, with accept/reject buttons.
 *
 * Learning note: We use VS Code's built-in diff editor to show changes.
 * The user sees exactly what will change, with green/red highlighting,
 * and can accept or reject with a single click.
 */
async function showInlineEditDiff(
  editor: vscode.TextEditor,
  selection: vscode.Selection,
  originalText: string,
  newText: string,
): Promise<void> {
  // Apply the change immediately (so the diff view shows the new state)
  const edit = new vscode.WorkspaceEdit();
  edit.replace(editor.document.uri, selection, newText);

  // Ask user to accept or reject
  const result = await vscode.window.showInformationMessage(
    "Cdoing: Apply inline edit?",
    { modal: false },
    "Accept",
    "Reject",
  );

  if (result === "Accept") {
    // Apply the edit
    await vscode.workspace.applyEdit(edit);
    vscode.window.showInformationMessage("Inline edit applied.");
  } else {
    // Don't apply — code stays unchanged
    vscode.window.showInformationMessage("Inline edit rejected.");
  }
}
