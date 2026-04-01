/**
 * Terminal Capture Tool — capture current terminal output.
 *
 * Inspired by Claude Code's TerminalCaptureTool. Captures the visible
 * terminal content for analysis (error messages, build output, etc.).
 */

import { execSync } from "child_process";
import type { BaseTool, ToolDefinition, ToolResult } from "../types";

export class TerminalCaptureTool implements BaseTool {
  definition: ToolDefinition = {
    name: "terminal_capture",
    description:
      "Capture the current terminal/screen output. Useful for reading error messages, " +
      "build output, or any visible terminal content that the user is seeing. " +
      "Returns the last N lines of terminal history.",
    inputSchema: {
      type: "object",
      properties: {
        lines: {
          type: "number",
          description: "Number of lines to capture (default: 50, max: 500).",
        },
        source: {
          type: "string",
          enum: ["scrollback", "tmux", "screen"],
          description: "Where to capture from. 'scrollback' reads terminal history. " +
            "'tmux' captures the active tmux pane. 'screen' captures the GNU screen session.",
        },
      },
    },
    requiresPermission: false,
  };

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const lines = Math.min(Number(input.lines) || 50, 500);
    const source = String(input.source || "scrollback");

    try {
      let output = "";

      switch (source) {
        case "tmux": {
          // Capture from tmux pane
          try {
            output = execSync(`tmux capture-pane -p -S -${lines}`, {
              encoding: "utf-8",
              timeout: 5000,
            }).trim();
          } catch {
            return { success: false, output: "No active tmux session found." };
          }
          break;
        }

        case "screen": {
          try {
            // GNU Screen: hardcopy to temp file then read
            const tmpFile = `/tmp/cdoing-screen-capture-${Date.now()}.txt`;
            execSync(`screen -X hardcopy ${tmpFile}`, { timeout: 5000 });
            output = execSync(`tail -${lines} ${tmpFile}`, { encoding: "utf-8", timeout: 5000 }).trim();
            execSync(`rm -f ${tmpFile}`, { timeout: 5000 });
          } catch {
            return { success: false, output: "No active GNU Screen session found." };
          }
          break;
        }

        case "scrollback":
        default: {
          // Try to read from terminal scrollback via script/TERM capabilities
          // This is best-effort — works well in tmux, less well in raw terminals
          if (process.env.TMUX) {
            try {
              output = execSync(`tmux capture-pane -p -S -${lines}`, {
                encoding: "utf-8",
                timeout: 5000,
              }).trim();
              break;
            } catch { /* fall through */ }
          }

          // Fallback: report that direct scrollback capture isn't available
          return {
            success: false,
            output: "Direct terminal scrollback capture requires tmux or screen. " +
              "Alternatives:\n" +
              "- Use shell_exec to re-run the command and capture output\n" +
              "- Use 'tmux' source if running inside tmux\n" +
              "- User can paste the terminal output as a message",
          };
        }
      }

      if (!output) {
        return { success: true, output: "(terminal is empty or no visible output)" };
      }

      return { success: true, output: `Terminal capture (${source}, last ${lines} lines):\n\n${output}` };
    } catch (err: any) {
      return { success: false, output: `Capture failed: ${err.message || err}` };
    }
  }
}
