/**
 * useVsCode.ts — VS Code API Hook
 *
 * Provides access to the VS Code webview API (postMessage, getState, setState).
 * acquireVsCodeApi() can only be called ONCE per webview lifetime,
 * so we cache it in a module-level variable and return the same instance every time.
 */

import { useMemo } from "react";
import type { VsCodeApi } from "../types";

/** Module-level cache — acquireVsCodeApi() can only be called once */
let api: VsCodeApi | undefined;

/** Returns the cached VS Code API instance (acquires it on first call) */
export function getVsCodeApi(): VsCodeApi {
  if (!api) {
    api = acquireVsCodeApi();
  }
  return api;
}

/**
 * Returns the VS Code API instance.
 * Use it to send messages to the extension host:
 *   const vscode = useVsCode();
 *   vscode.postMessage({ type: "sendMessage", text: "hello" });
 */
export function useVsCode(): VsCodeApi {
  return useMemo(() => getVsCodeApi(), []);
}
