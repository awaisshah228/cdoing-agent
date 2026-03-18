/**
 * esbuild.config.js — Build Configuration
 *
 * Produces TWO separate bundles:
 *
 *   1. Extension Host (dist/extension.js)
 *      - Runs in VS Code's Node.js process
 *      - Has access to the VS Code API, filesystem, npm packages
 *      - "vscode" is marked as external (provided by VS Code at runtime)
 *
 *   2. React Webview (dist/webview.js + dist/webview.css)
 *      - Runs in a browser sandbox inside a VS Code webview
 *      - No access to Node.js or filesystem
 *      - Bundled as IIFE (immediately invoked function expression) for browsers
 *      - CSS is extracted to a separate file
 *
 * Usage:
 *   node esbuild.config.js          → Production build (minified)
 *   node esbuild.config.js --watch  → Dev mode (watches for changes, rebuilds automatically)
 */

const esbuild = require("esbuild");
const path = require("path");

const isWatch = process.argv.includes("--watch");

// Bundle 1: Extension host — runs in VS Code's Node.js process
const extensionBuild = {
  entryPoints: [path.resolve(__dirname, "src/extension.ts")],
  bundle: true,
  outfile: path.resolve(__dirname, "dist/extension.js"),
  external: ["vscode"],   // VS Code provides this module at runtime
  format: "cjs",           // CommonJS — required by VS Code extensions
  platform: "node",        // Node.js APIs available
  target: "node18",
  sourcemap: true,
  minify: !isWatch,        // Minify for production, skip for dev (faster rebuilds)
};

// Bundle 2: React webview — runs in a browser sandbox inside VS Code
// IMPORTANT: alias react/react-dom to the LOCAL copies to prevent duplicate React instances.
// Without this, transitive deps (zustand) may resolve React from the workspace root,
// creating two React copies — which causes "Cannot read properties of null ('useCallback')" crashes.
const webviewBuild = {
  entryPoints: [path.resolve(__dirname, "src/webview/index.tsx")],
  bundle: true,
  outfile: path.resolve(__dirname, "dist/webview.js"),
  format: "iife",          // Browser-compatible wrapper (no module system needed)
  platform: "browser",     // Browser APIs only (no Node.js)
  target: "es2020",
  sourcemap: true,
  minify: !isWatch,
  loader: { ".css": "css" }, // Extract CSS to dist/webview.css
  alias: {
    "react": path.resolve(__dirname, "node_modules/react"),
    "react-dom": path.resolve(__dirname, "node_modules/react-dom"),
  },
};

async function build() {
  if (isWatch) {
    // Dev mode: create watch contexts for both bundles
    const [extCtx, webCtx] = await Promise.all([
      esbuild.context(extensionBuild),
      esbuild.context(webviewBuild),
    ]);
    await Promise.all([extCtx.watch(), webCtx.watch()]);
    console.log("Watching for changes...");
  } else {
    // Production: build both bundles in parallel
    await Promise.all([
      esbuild.build(extensionBuild),
      esbuild.build(webviewBuild),
    ]);
    console.log("Build complete.");
  }
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
