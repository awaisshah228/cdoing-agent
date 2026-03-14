/**
 * index.tsx — Webview Entry Point
 *
 * This is the first file that runs inside the VS Code webview (browser sandbox).
 * It mounts the React app into the #root div created by webview-content.ts.
 *
 * esbuild bundles this file + all imports into dist/webview.js.
 * The CSS import is extracted to dist/webview.css.
 */

import React from "react";
import { createRoot } from "react-dom/client";
import { ChatPanel } from "./components/ChatPanel";
import "./styles/chat.css";

// Mount the React app into the #root div (defined in the HTML from webview-content.ts)
const container = document.getElementById("root")!;
const root = createRoot(container);
root.render(<ChatPanel />);
