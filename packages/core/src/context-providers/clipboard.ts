import { execSync } from "child_process";
import type { ContextProvider, ContextResult, ContextResolveOptions } from "./types";

/**
 * @clip — pastes clipboard content into the prompt.
 * Works on macOS (pbpaste), Linux with xclip/xsel/wl-paste.
 */
export class ClipboardContextProvider implements ContextProvider {
  id = "clipboard";
  trigger = "@clip";
  description = "Paste clipboard content into the message";
  requiresArg = false;

  async resolve(_arg?: string, _opts?: ContextResolveOptions): Promise<ContextResult> {
    let content = "";

    try {
      const platform = process.platform;
      if (platform === "darwin") {
        content = execSync("pbpaste", { encoding: "utf8" });
      } else if (platform === "linux") {
        // Try wl-paste (Wayland), then xclip, then xsel
        try {
          content = execSync("wl-paste --no-newline 2>/dev/null", { encoding: "utf8" });
        } catch {
          try {
            content = execSync("xclip -selection clipboard -o 2>/dev/null", { encoding: "utf8" });
          } catch {
            content = execSync("xsel --clipboard --output 2>/dev/null", { encoding: "utf8" });
          }
        }
      } else {
        return { label: "Clipboard", content: "", metadata: { source: "unsupported platform" } };
      }
    } catch {
      return { label: "Clipboard", content: "(clipboard is empty or unavailable)" };
    }

    const trimmed = content.trim();
    if (!trimmed) return { label: "Clipboard", content: "(clipboard is empty)" };

    return {
      label: "Clipboard",
      content: `<clipboard>\n${trimmed}\n</clipboard>`,
      metadata: { source: "system clipboard", itemCount: trimmed.split("\n").length },
    };
  }
}
