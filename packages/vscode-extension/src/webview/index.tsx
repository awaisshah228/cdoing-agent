/**
 * index.tsx — Webview Entry Point
 *
 * Mounts the React app and injects global scripts (copy code handler).
 */

import { createRoot } from "react-dom/client";
import { ChatPanel } from "./components/ChatPanel";
import { COPY_CODE_SCRIPT } from "./utils/markdown";
import "./styles/chat.css";
import "highlight.js/styles/vs2015.min.css";

// Inject global copy code function
const script = document.createElement("script");
script.textContent = COPY_CODE_SCRIPT;
document.head.appendChild(script);

// Mount React app
const container = document.getElementById("root")!;
const root = createRoot(container);
root.render(<ChatPanel />);
