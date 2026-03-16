/**
 * Question Tool — ask the user interactive questions with options.
 *
 * The CLI and VSCode extension inject their own promptFn implementations.
 * This tool doesn't require permission since user interaction IS the gate.
 */

import type { BaseTool, ToolDefinition, ToolResult } from "../types";

export interface QuestionOption {
  label: string;
  description: string;
}

export type QuestionPromptFn = (
  question: string,
  options: QuestionOption[],
  allowMultiple: boolean,
) => Promise<string[]>;

export class QuestionTool implements BaseTool {
  definition: ToolDefinition = {
    name: "question",
    description:
      "Ask the user a question with selectable options. Use this when you need the user to make a choice before proceeding (e.g., choosing between approaches, confirming a design decision). The user can select one or multiple options and optionally provide a custom answer.",
    inputSchema: {
      type: "object",
      properties: {
        question: {
          type: "string",
          description: "The complete question to ask the user",
        },
        options: {
          type: "array",
          description: "Available choices for the user",
          items: {
            type: "object",
            properties: {
              label: {
                type: "string",
                description: "Short display text (1-5 words)",
              },
              description: {
                type: "string",
                description: "Explanation of this choice",
              },
            },
            required: ["label", "description"],
          },
        },
        allow_multiple: {
          type: "boolean",
          description: "Whether the user can select multiple options. Default: false.",
        },
      },
      required: ["question", "options"],
    },
    requiresPermission: false,
  };

  private promptFn: QuestionPromptFn;

  constructor(promptFn: QuestionPromptFn) {
    this.promptFn = promptFn;
  }

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const question = String(input.question || "");
    const options = (input.options || []) as QuestionOption[];
    const allowMultiple = Boolean(input.allow_multiple);

    if (!question) {
      return { success: false, output: "", error: "No question provided" };
    }

    if (!options.length) {
      return { success: false, output: "", error: "No options provided" };
    }

    try {
      const answers = await this.promptFn(question, options, allowMultiple);

      if (answers.length === 0) {
        return { success: true, output: "User did not select any option (skipped)." };
      }

      const answerText = answers.join(", ");
      return {
        success: true,
        output: `User answered: ${answerText}`,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, output: "", error: `Question failed: ${message}` };
    }
  }
}
