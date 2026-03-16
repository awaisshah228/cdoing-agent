/**
 * SDK Context — wraps AgentRunner, ToolRegistry, PermissionManager,
 * and exposes callbacks for runtime model/provider changes and agent rebuild.
 */

import { createContext, useContext } from "react";
import type { ReactNode } from "react";
import type { AgentRunner } from "@cdoing/ai";
import type { ToolRegistry, PermissionManager } from "@cdoing/core";

export interface SDKState {
  agent: AgentRunner;
  registry: ToolRegistry;
  permissionManager: PermissionManager;
  workingDir: string;
  provider: string;
  model: string;
  /** Request a permission decision from the UI */
  requestPermission?: (toolName: string, message: string) => Promise<"allow" | "always" | "deny">;
  /** Rebuild the agent after model/provider change */
  rebuildAgent?: (provider: string, model: string, apiKey?: string) => void;
  /** Change working directory */
  setWorkingDir?: (dir: string) => void;
}

const SDKContext = createContext<SDKState | undefined>(undefined);

export function SDKProvider(props: { value: SDKState; children: ReactNode }) {
  return (
    <SDKContext.Provider value={props.value}>
      {props.children}
    </SDKContext.Provider>
  );
}

export function useSDK() {
  const ctx = useContext(SDKContext);
  if (!ctx) throw new Error("useSDK must be used within SDKProvider");
  return ctx;
}
