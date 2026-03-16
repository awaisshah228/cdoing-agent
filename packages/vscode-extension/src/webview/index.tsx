/**
 * index.tsx — Webview Entry Point
 *
 * Mounts the React app and injects global scripts (copy code handler).
 */

import { createRoot } from "react-dom/client";
import { ChatPanel } from "./components/ChatPanel";
import { copyCode } from "./utils/markdown";
import "./styles/chat.css";
import "highlight.js/styles/vs2015.min.css";

// Register copy code handler globally (avoids CSP inline script violation)
(window as any).copyCode = copyCode;

// Mount React app
const container = document.getElementById("root")!;
const root = createRoot(container);
root.render(<ChatPanel />);
