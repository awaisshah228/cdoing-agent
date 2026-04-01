/**
 * Brief Tool (SendUserMessage) — send a structured message to the user.
 *
 * Inspired by Claude Code's BriefTool. Allows the agent to send
 * messages with optional file attachments (screenshots, diffs, logs).
 */

import * as fs from "fs";
import * as path from "path";
import type { BaseTool, ToolDefinition, ToolResult } from "../types";

export class BriefTool implements BaseTool {
  // ── Behavioral flags ──
  isReadOnly = () => true; // just sends a message, no side effects
  concurrencyMode = () => "parallel" as const;
  definition: ToolDefinition = {
    name: "send_user_message",
    description:
      "Send a message to the user with optional file attachments. " +
      "Use this to present results, share screenshots, or deliver reports. " +
      "Supports markdown formatting in the message body.",
    inputSchema: {
      type: "object",
      properties: {
        message: {
          type: "string",
          description: "Markdown-formatted message to send to the user.",
        },
        attachments: {
          type: "array",
          items: { type: "string" },
          description: "Optional list of file paths to attach (absolute or relative to working dir).",
        },
        status: {
          type: "string",
          enum: ["normal", "proactive"],
          description: "'normal' for user-requested output, 'proactive' for unsolicited updates.",
        },
      },
      required: ["message"],
    },
    requiresPermission: false,
  };

  private workingDir: string;
  private onBrief?: (message: string, attachments?: Array<{ path: string; size: number; isImage: boolean }>) => void;

  constructor(
    workingDir: string,
    onBrief?: (message: string, attachments?: Array<{ path: string; size: number; isImage: boolean }>) => void,
  ) {
    this.workingDir = workingDir;
    this.onBrief = onBrief;
  }

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const message = String(input.message || "");
    const attachmentPaths = (input.attachments as string[]) || [];

    if (!message.trim()) {
      return { success: false, output: "Empty message." };
    }

    // Resolve and validate attachments
    const resolved: Array<{ path: string; size: number; isImage: boolean }> = [];
    for (const p of attachmentPaths) {
      const absPath = path.isAbsolute(p) ? p : path.resolve(this.workingDir, p);
      try {
        const stat = fs.statSync(absPath);
        const ext = path.extname(absPath).toLowerCase();
        const isImage = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp"].includes(ext);
        resolved.push({ path: absPath, size: stat.size, isImage });
      } catch {
        // Skip missing files
      }
    }

    if (this.onBrief) {
      this.onBrief(message, resolved.length > 0 ? resolved : undefined);
    }

    const attachInfo = resolved.length > 0
      ? `\nAttachments: ${resolved.map((a) => `${path.basename(a.path)} (${(a.size / 1024).toFixed(1)}KB${a.isImage ? ", image" : ""})`).join(", ")}`
      : "";

    return {
      success: true,
      output: `Message sent to user.${attachInfo}`,
    };
  }
}
