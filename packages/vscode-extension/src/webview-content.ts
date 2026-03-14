/**
 * webview-content.ts — HTML Generator for the Webview
 *
 * Generates the minimal HTML page that loads the React bundle.
 * This runs in the extension host (Node.js), NOT in the webview.
 *
 * The generated HTML:
 *   1. Sets a Content-Security-Policy with a nonce (prevents script injection)
 *   2. Links the CSS file (dist/webview.css) if it exists
 *   3. Loads the React bundle (dist/webview.js) which mounts <ChatPanel />
 *
 * VS Code requires special URIs for loading assets in webviews.
 * We use webview.asWebviewUri() to convert file paths to VS Code-safe URIs.
 */

import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";

/**
 * Builds the HTML string that VS Code injects into the webview iframe.
 *
 * @param webview - The webview instance (needed to create safe URIs and CSP source)
 * @param extensionUri - Root path of the extension (used to find dist/ assets)
 */
export function getWebviewContent(
  webview: vscode.Webview,
  extensionUri: vscode.Uri
): string {
  // Generate a random nonce — only scripts with this nonce can execute (security)
  const nonce = getNonce();

  // Convert file paths to webview-safe URIs
  // Normal file:// paths don't work in webviews — VS Code requires its own URI scheme
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "dist", "webview.js")
  );
  const styleUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "dist", "webview.css")
  );

  // esbuild extracts CSS to a separate file — check if it exists
  const cssPath = path.join(extensionUri.fsPath, "dist", "webview.css");
  const hasCss = fs.existsSync(cssPath);

  // The HTML shell — React's <ChatPanel /> mounts into the #root div
  return /*html*/ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <!-- Content-Security-Policy: only allow scripts with our nonce, styles from VS Code or inline -->
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none';
             style-src ${webview.cspSource} 'unsafe-inline';
             script-src 'nonce-${nonce}';">
  <title>Cdoing Agent</title>
  ${hasCss ? `<link rel="stylesheet" href="${styleUri}">` : ""}
</head>
<body>
  <!-- React mounts here — see src/webview/index.tsx -->
  <div id="root"></div>
  <!-- The bundled React app (built by esbuild from src/webview/index.tsx) -->
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

/** Generates a random 32-character string used as a CSP nonce for script security */
function getNonce(): string {
  let text = "";
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}
