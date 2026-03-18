/**
 * Cross-platform clipboard utilities
 *
 * Supports macOS (pbpaste/osascript), Linux (xclip/xsel/wl-paste),
 * and Windows/PowerShell (powershell Get-Clipboard).
 */

import { execSync, execFile } from "child_process";

/**
 * Write text to the system clipboard via OSC 52 escape sequence.
 * Works over SSH by having the terminal emulator handle clipboard locally.
 */
function writeOsc52(text: string): void {
  if (!process.stdout.isTTY) return;
  const base64 = Buffer.from(text).toString("base64");
  const osc52 = `\x1b]52;c;${base64}\x07`;
  const passthrough = process.env["TMUX"] || process.env["STY"];
  const sequence = passthrough ? `\x1bPtmux;\x1b${osc52}\x1b\\` : osc52;
  process.stdout.write(sequence);
}

/** Write text to the system clipboard (cross-platform) */
export function writeClipboard(text: string): Promise<void> {
  // Always try OSC 52 first (works over SSH/tmux)
  writeOsc52(text);

  return new Promise<void>((resolve, reject) => {
    if (process.platform === "darwin") {
      const proc = execFile("pbcopy", (err) => (err ? reject(err) : resolve()));
      proc.stdin?.write(text);
      proc.stdin?.end();
      return;
    }
    if (process.platform === "win32") {
      const proc = execFile(
        "powershell.exe",
        [
          "-NonInteractive",
          "-NoProfile",
          "-Command",
          "[Console]::InputEncoding = [System.Text.Encoding]::UTF8; Set-Clipboard -Value ([Console]::In.ReadToEnd())",
        ],
        (err) => (err ? reject(err) : resolve()),
      );
      proc.stdin?.write(text);
      proc.stdin?.end();
      return;
    }
    // Linux — try Wayland first, then X11
    if (process.env["WAYLAND_DISPLAY"]) {
      const proc = execFile("wl-copy", (err) => (err ? reject(err) : resolve()));
      proc.stdin?.write(text);
      proc.stdin?.end();
      return;
    }
    // Try xclip, fall back to xsel
    const proc = execFile("xclip", ["-selection", "clipboard"], (err) => {
      if (err) {
        const proc2 = execFile("xsel", ["--clipboard", "--input"], (err2) =>
          err2 ? reject(err2) : resolve(),
        );
        proc2.stdin?.write(text);
        proc2.stdin?.end();
      } else {
        resolve();
      }
    });
    proc.stdin?.write(text);
    proc.stdin?.end();
  });
}

/** Read text from the system clipboard */
export function readClipboard(): string {
  try {
    if (process.platform === "darwin") {
      return execSync("pbpaste", { encoding: "utf-8" });
    }
    if (process.platform === "win32") {
      return execSync(
        'powershell.exe -NonInteractive -NoProfile -Command "Get-Clipboard"',
        { encoding: "utf-8" },
      ).replace(/\r\n/g, "\n");
    }
    // Linux — try Wayland first, then X11
    try {
      return execSync("wl-paste --no-newline 2>/dev/null", { encoding: "utf-8" });
    } catch {}
    try {
      return execSync("xclip -selection clipboard -o", { encoding: "utf-8" });
    } catch {
      return execSync("xsel --clipboard --output", { encoding: "utf-8" });
    }
  } catch {
    return "";
  }
}

export interface ImageAttachment {
  data: string;
  mimeType: string;
}

/** Read an image from the clipboard (macOS + Windows) */
export function readClipboardImage(): ImageAttachment | null {
  if (process.platform === "darwin") {
    try {
      const hasImage = execSync(
        `osascript -e 'clipboard info' 2>/dev/null | grep -q "TIFF\\|PNG\\|JPEG" && echo "yes" || echo "no"`,
        { encoding: "utf-8", timeout: 1000 },
      ).trim();
      if (hasImage !== "yes") return null;
      const base64 = execSync(
        `osascript -e 'set theImage to the clipboard as «class PNGf»' -e 'return theImage' 2>/dev/null | base64`,
        { encoding: "utf-8", timeout: 3000, maxBuffer: 20 * 1024 * 1024 },
      ).trim();
      if (base64 && base64.length > 100) return { data: base64, mimeType: "image/png" };
    } catch {}
    return null;
  }

  if (process.platform === "win32") {
    try {
      // Check if clipboard has an image, save to temp, read as base64
      const script = `
        Add-Type -AssemblyName System.Windows.Forms
        $img = [System.Windows.Forms.Clipboard]::GetImage()
        if ($img) {
          $ms = New-Object System.IO.MemoryStream
          $img.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
          [Convert]::ToBase64String($ms.ToArray())
        }
      `.trim();
      const base64 = execSync(
        `powershell.exe -NonInteractive -NoProfile -Command "${script.replace(/"/g, '\\"')}"`,
        { encoding: "utf-8", timeout: 5000, maxBuffer: 20 * 1024 * 1024 },
      ).trim();
      if (base64 && base64.length > 100) return { data: base64, mimeType: "image/png" };
    } catch {}
    return null;
  }

  return null;
}
