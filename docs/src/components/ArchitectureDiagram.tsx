"use client";

import { useState, useCallback } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  applyNodeChanges,
  Background,
  BackgroundVariant,
  type Node,
  type Edge,
  type EdgeTypes,
  type NodeChange,
} from "@xyflow/react";
// @ts-ignore - CSS import
import "@xyflow/react/dist/style.css";

import { useAvoidNodesRouterFromWorker } from "avoid-nodes-edge";
import { AvoidNodesEdge } from "avoid-nodes-edge/edge";
import { DiagramNode, GroupNode } from "@/components/DiagramNode";
import { resolveCollisions } from "@/utils/resolve-collisions";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const edgeTypes: EdgeTypes = { avoidNodes: AvoidNodesEdge as any };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const nodeTypes = { default: DiagramNode, group: GroupNode } as any;

// ── Shared Node Styles ──────────────────────────────────

const baseStyle = {
  borderRadius: 12,
  fontSize: 13,
  fontFamily: "var(--font-mono), monospace",
  padding: "12px 16px",
  textAlign: "center" as const,
  color: "#fafafa",
  whiteSpace: "pre-line" as const,
};

const styles = {
  ui:       { ...baseStyle, background: "#1e1b4b", border: "1px solid #6366f1" },
  ai:       { ...baseStyle, background: "#1c1917", border: "1px solid #f59e0b" },
  core:     { ...baseStyle, background: "#052e16", border: "1px solid #22c55e" },
  tool:     { ...baseStyle, background: "#1a1a2e", border: "1px solid #8b5cf6" },
  action:   { ...baseStyle, background: "#1a1a1a", border: "1px solid #555", fontSize: 11 },
  user:     { ...baseStyle, background: "#0c0c0c", border: "1px solid #6366f1" },
  decision: { ...baseStyle, background: "#27171a", border: "1px solid #ef4444", fontSize: 11 },
};

// ── Reusable Flow Wrapper ───────────────────────────────

function DiagramFlow({ nodes: initNodes, edges: initEdges, height }: {
  nodes: Node[];
  edges: Edge[];
  height: number;
}) {
  const [nodes, setNodes] = useState<Node[]>(initNodes);

  const { updateRoutingOnNodesChange, resetRouting } = useAvoidNodesRouterFromWorker(
    nodes,
    initEdges,
    { edgeRounding: 12, edgeToNodeSpacing: 25, edgeToEdgeSpacing: 20, autoBestSideConnection: true, shouldSplitEdgesNearHandle: true },
  );

  const deferredReset = useCallback(() => {
    requestAnimationFrame(() => resetRouting());
  }, [resetRouting]);

  const onNodesChange = useCallback(
    (changes: NodeChange<Node>[]) => {
      setNodes((nds) => applyNodeChanges(changes, nds));
      updateRoutingOnNodesChange(changes);
    },
    [updateRoutingOnNodesChange],
  );

  const onNodeDragStop = useCallback(
    (_event: React.MouseEvent, _draggedNode: Node, draggedNodes: Node[]) => {
      setNodes((nds) => {
        const posMap = new Map(draggedNodes.map((n) => [n.id, n.position]));
        const updated = nds.map((n) => {
          const pos = posMap.get(n.id);
          return pos ? { ...n, position: pos } : n;
        });
        return resolveCollisions(updated, { margin: 20, maxIterations: 50 });
      });
      deferredReset();
    },
    [deferredReset],
  );

  return (
    <div className="flow-diagram" style={{ height }}>
      <ReactFlow
        nodes={nodes}
        edges={initEdges}
        onNodesChange={onNodesChange}
        onNodeDragStop={onNodeDragStop}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        defaultEdgeOptions={{ type: "avoidNodes" }}
        fitView
        fitViewOptions={{ padding: 0.3 }}
        nodesConnectable={false}
        proOptions={{ hideAttribution: true }}
        selectNodesOnDrag={false}
      >
        <Background variant={BackgroundVariant.Dots} color="#333" gap={20} size={1} />
      </ReactFlow>
    </div>
  );
}

function WrappedDiagram(props: { nodes: Node[]; edges: Edge[]; height: number }) {
  return (
    <ReactFlowProvider>
      <DiagramFlow {...props} />
    </ReactFlowProvider>
  );
}

// ── 1. Package Dependency Graph ─────────────────────────

const depNodes: Node[] = [
  { id: "cli",  position: { x: 0, y: 0 },     data: { label: "@cdoing/cli\nTerminal UI" },               style: { ...styles.ui, width: 200, height: 55 } },
  { id: "vsc",  position: { x: 380, y: 0 },   data: { label: "cdoing-vscode\nVS Code Extension" },      style: { ...styles.ui, width: 220, height: 55 } },
  { id: "ai",   position: { x: 150, y: 170 }, data: { label: "@cdoing/ai\nAgent Runner + Providers" },   style: { ...styles.ai, width: 260, height: 55 } },
  { id: "core", position: { x: 120, y: 340 },  data: { label: "@cdoing/core\nTools, Permissions, OAuth" }, style: { ...styles.core, width: 320, height: 55 } },
];

const depEdges: Edge[] = [
  { id: "e1", source: "cli", target: "ai",   type: "default", style: { stroke: "#6366f1", strokeWidth: 2 } },
  { id: "e2", source: "vsc", target: "ai",   type: "default", style: { stroke: "#6366f1", strokeWidth: 2 } },
  { id: "e3", source: "ai",  target: "core", type: "default", style: { stroke: "#f59e0b", strokeWidth: 2 } },
  { id: "e4", source: "cli", target: "core", type: "default", style: { stroke: "#6366f1", strokeWidth: 2, strokeDasharray: "5 5" } },
  { id: "e5", source: "vsc", target: "core", type: "default", style: { stroke: "#6366f1", strokeWidth: 2, strokeDasharray: "5 5" } },
];

function SimpleDiagram({ nodes: initNodes, edges, height }: { nodes: Node[]; edges: Edge[]; height: number }) {
  const [nodes, setNodes] = useState<Node[]>(initNodes);
  const onNodesChange = useCallback(
    (changes: NodeChange<Node>[]) => setNodes((nds) => applyNodeChanges(changes, nds)),
    [],
  );
  return (
    <div className="flow-diagram" style={{ height }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        fitView
        fitViewOptions={{ padding: 0.3 }}
        nodesConnectable={false}
        proOptions={{ hideAttribution: true }}
        selectNodesOnDrag={false}
      >
        <Background variant={BackgroundVariant.Dots} color="#333" gap={20} size={1} />
      </ReactFlow>
    </div>
  );
}

export function DependencyGraph() {
  return (
    <ReactFlowProvider>
      <SimpleDiagram nodes={depNodes} edges={depEdges} height={460} />
    </ReactFlowProvider>
  );
}

// ── 2. Agentic Loop Diagram ─────────────────────────────

const loopNodes: Node[] = [
  { id: "user",    position: { x: 220, y: 0 },   data: { label: "User Message" },                            style: { ...styles.user, width: 160 } },
  { id: "prompt",  position: { x: 160, y: 90 },  data: { label: "System Prompt Builder\npermissions + tools + context" }, style: { ...styles.action, width: 280 } },
  { id: "llm",     position: { x: 160, y: 200 }, data: { label: "LLM Provider\nAnthropic / OpenAI / Google" }, style: { ...styles.ai, width: 280 } },
  { id: "text",    position: { x: 50, y: 320 },  data: { label: "Text Response" },                           style: { ...styles.core, width: 140 } },
  { id: "tools",   position: { x: 380, y: 320 }, data: { label: "Tool Calls" },                              style: { ...styles.tool, width: 130 } },
  { id: "return",  position: { x: 30, y: 430 },  data: { label: "Return to User" },                          style: { ...styles.user, width: 150 } },
  { id: "hooks",   position: { x: 370, y: 420 }, data: { label: "Pre-Hooks" },                               style: { ...styles.action, width: 120 } },
  { id: "perm",    position: { x: 350, y: 510 }, data: { label: "Permission Check" },                        style: { ...styles.decision, width: 160 } },
  { id: "exec",    position: { x: 280, y: 610 }, data: { label: "Tool Execution" },                          style: { ...styles.tool, width: 140 } },
  { id: "denied",  position: { x: 480, y: 610 }, data: { label: "Denied" },                                  style: { ...styles.decision, width: 90 } },
  { id: "post",    position: { x: 290, y: 710 }, data: { label: "Post-Hooks" },                              style: { ...styles.action, width: 120 } },
  { id: "loop",    position: { x: 200, y: 810 }, data: { label: "Feed result back\nto LLM (loop)" },         style: { ...styles.ai, width: 200 } },
];

const loopEdges: Edge[] = [
  { id: "l1", source: "user",   target: "prompt",  type: "avoidNodes", data: { strokeColor: "#6366f1" } },
  { id: "l2", source: "prompt", target: "llm",     type: "avoidNodes", data: { strokeColor: "#6366f1" } },
  { id: "l3", source: "llm",    target: "text",    type: "avoidNodes", data: { strokeColor: "#22c55e" } },
  { id: "l4", source: "llm",    target: "tools",   type: "avoidNodes", data: { strokeColor: "#8b5cf6" } },
  { id: "l5", source: "text",   target: "return",  type: "avoidNodes", data: { strokeColor: "#22c55e" } },
  { id: "l6", source: "tools",  target: "hooks",   type: "avoidNodes", data: { strokeColor: "#8b5cf6" } },
  { id: "l7", source: "hooks",  target: "perm",    type: "avoidNodes", data: { strokeColor: "#8b5cf6" } },
  { id: "l8", source: "perm",   target: "exec",    type: "avoidNodes", data: { strokeColor: "#22c55e" } },
  { id: "l9", source: "perm",   target: "denied",  type: "avoidNodes", data: { strokeColor: "#ef4444" } },
  { id: "l10", source: "exec",  target: "post",    type: "avoidNodes", data: { strokeColor: "#8b5cf6" } },
  { id: "l11", source: "post",  target: "loop",    type: "avoidNodes", data: { strokeColor: "#f59e0b" } },
  { id: "l12", source: "loop",  target: "llm",     type: "avoidNodes", data: { strokeColor: "#f59e0b", strokeDasharray: "5 5" } },
];

export function AgenticLoopDiagram() {
  return <WrappedDiagram nodes={loopNodes} edges={loopEdges} height={920} />;
}

// ── 3. OAuth Flow Diagram ───────────────────────────────

const oauthNodes: Node[] = [
  { id: "o1", position: { x: 0, y: 0 },   data: { label: "User runs\n/setup or --login" },           style: { ...styles.user, width: 170 } },
  { id: "o2", position: { x: 240, y: 0 },  data: { label: "Generate PKCE\nverifier + challenge" },   style: { ...styles.core, width: 200 } },
  { id: "o3", position: { x: 510, y: 0 },  data: { label: "Open browser\nclaude.ai/oauth" },         style: { ...styles.ai, width: 180 } },
  { id: "o4", position: { x: 510, y: 120 }, data: { label: "User approves\ngets redirect code" },    style: { ...styles.user, width: 180 } },
  { id: "o5", position: { x: 240, y: 120 }, data: { label: "Exchange code\nfor tokens" },             style: { ...styles.tool, width: 200 } },
  { id: "o6", position: { x: 0, y: 120 },  data: { label: "Store in\nOS Keychain" },                 style: { ...styles.core, width: 170 } },
  { id: "o7", position: { x: 100, y: 240 }, data: { label: "CLI + VS Code\nuse same token" },        style: { ...styles.ui, width: 200 } },
];

const oauthEdges: Edge[] = [
  { id: "oe1", source: "o1", target: "o2", type: "avoidNodes", data: { strokeColor: "#6366f1" } },
  { id: "oe2", source: "o2", target: "o3", type: "avoidNodes", data: { strokeColor: "#22c55e" } },
  { id: "oe3", source: "o3", target: "o4", type: "avoidNodes", data: { strokeColor: "#f59e0b" } },
  { id: "oe4", source: "o4", target: "o5", type: "avoidNodes", data: { strokeColor: "#8b5cf6" } },
  { id: "oe5", source: "o5", target: "o6", type: "avoidNodes", data: { strokeColor: "#22c55e" } },
  { id: "oe6", source: "o6", target: "o7", type: "avoidNodes", data: { strokeColor: "#6366f1" } },
];

export function OAuthFlowDiagram() {
  return <WrappedDiagram nodes={oauthNodes} edges={oauthEdges} height={360} />;
}

// ── 4. VS Code Extension Architecture ───────────────────

const vscNodes: Node[] = [
  { id: "v1", position: { x: 200, y: 0 },   data: { label: "extension.ts\nRegisters commands, creates providers" }, style: { ...styles.ui, width: 280 } },
  { id: "v6", position: { x: 0, y: 140 },   data: { label: "inline-edit.ts\ninline-autocomplete.ts" },              style: { ...styles.action, width: 200 } },
  { id: "v2", position: { x: 260, y: 140 },  data: { label: "chat-panel-provider.ts\nRuns agent, bridges webview ↔ agent" },  style: { ...styles.ai, width: 320 } },
  { id: "v3", position: { x: 160, y: 290 },  data: { label: "Webview (React)\nChatPanel, InputArea\nSettingsPanel, ToolCallBubble" },    style: { ...styles.tool, width: 240 } },
  { id: "v4", position: { x: 460, y: 290 },  data: { label: "@cdoing/ai\nAgentRunner" },                            style: { ...styles.ai, width: 180 } },
  { id: "v5", position: { x: 460, y: 420 },  data: { label: "@cdoing/core\nTools, Permissions, OAuth" },             style: { ...styles.core, width: 200 } },
];

const vscEdges: Edge[] = [
  { id: "ve1", source: "v1", target: "v2", type: "avoidNodes", data: { strokeColor: "#6366f1" } },
  { id: "ve5", source: "v1", target: "v6", type: "avoidNodes", data: { strokeColor: "#6366f1", strokeDasharray: "5 5" } },
  { id: "ve2", source: "v2", target: "v3", type: "avoidNodes", data: { strokeColor: "#8b5cf6" } },
  { id: "ve3", source: "v2", target: "v4", type: "avoidNodes", data: { strokeColor: "#f59e0b" } },
  { id: "ve4", source: "v4", target: "v5", type: "avoidNodes", data: { strokeColor: "#22c55e" } },
];

export function VscodeArchDiagram() {
  return <WrappedDiagram nodes={vscNodes} edges={vscEdges} height={500} />;
}

export function FullSystemDiagram() {
  return <WrappedDiagram nodes={fullNodes} edges={fullEdges} height={860} />;
}

// ── 5. Full System Diagram ──────────────────────────────

const g = { // group node style
  background: "rgba(255,255,255,0.03)",
  border: "1px dashed #444",
  borderRadius: 16,
  padding: 12,
  fontSize: 11,
  color: "#888",
};

const sm = { // small inner node
  ...baseStyle,
  fontSize: 10,
  padding: "6px 10px",
  borderRadius: 8,
};

// Helper: child node with explicit width + height for ELK
const W = 120; // default child width
const H = 45;  // default child height (2-line label)
const H1 = 32; // single-line label height

const fullNodes: Node[] = [
  // ── CLI group ──
  { id: "g-cli", position: { x: 0, y: 0 }, data: { label: "@cdoing/cli" }, type: "group", style: { ...g, width: 300, height: 300 } },
  { id: "cli-entry", position: { x: 20, y: 45 }, data: { label: "index.ts\nEntry + Args" }, parentId: "g-cli", extent: "parent" as const, style: { ...sm, ...styles.ui, width: W, height: H } },
  { id: "cli-chat", position: { x: 160, y: 45 }, data: { label: "chat.ts\nInteractive" }, parentId: "g-cli", extent: "parent" as const, style: { ...sm, ...styles.ui, width: W, height: H } },
  { id: "cli-config", position: { x: 20, y: 110 }, data: { label: "config.ts\nSetup Wizard" }, parentId: "g-cli", extent: "parent" as const, style: { ...sm, ...styles.ui, width: W, height: H } },
  { id: "cli-oauth", position: { x: 160, y: 110 }, data: { label: "oauth.ts\nLogin Flow" }, parentId: "g-cli", extent: "parent" as const, style: { ...sm, ...styles.ui, width: W, height: H } },
  { id: "cli-ui", position: { x: 50, y: 175 }, data: { label: "ui/ — Ink Components" }, parentId: "g-cli", extent: "parent" as const, style: { ...sm, ...styles.action, width: 180, height: H1 } },

  // ── VS Code group ──
  { id: "g-vsc", position: { x: 380, y: 0 }, data: { label: "cdoing-vscode" }, type: "group", style: { ...g, width: 300, height: 300 } },
  { id: "vsc-ext", position: { x: 20, y: 45 }, data: { label: "extension.ts" }, parentId: "g-vsc", extent: "parent" as const, style: { ...sm, ...styles.ui, width: W, height: H1 } },
  { id: "vsc-panel", position: { x: 160, y: 45 }, data: { label: "chat-panel\nprovider.ts" }, parentId: "g-vsc", extent: "parent" as const, style: { ...sm, ...styles.ui, width: W, height: H } },
  { id: "vsc-inline", position: { x: 20, y: 110 }, data: { label: "inline-edit\nautocomplete" }, parentId: "g-vsc", extent: "parent" as const, style: { ...sm, ...styles.action, width: W, height: H } },
  { id: "vsc-webview", position: { x: 160, y: 110 }, data: { label: "webview/\nReact Chat UI" }, parentId: "g-vsc", extent: "parent" as const, style: { ...sm, ...styles.tool, width: W, height: H } },
  { id: "vsc-oauth", position: { x: 90, y: 175 }, data: { label: "oauth.ts" }, parentId: "g-vsc", extent: "parent" as const, style: { ...sm, ...styles.action, width: 100, height: H1 } },

  // ── AI Package group ──
  { id: "g-ai", position: { x: 130, y: 370 }, data: { label: "@cdoing/ai" }, type: "group", style: { ...g, width: 460, height: 150 } },
  { id: "ai-runner", position: { x: 20, y: 50 }, data: { label: "agent-runner.ts\nAgentic Loop" }, parentId: "g-ai", extent: "parent" as const, style: { ...sm, ...styles.ai, width: 130, height: H } },
  { id: "ai-provider", position: { x: 170, y: 50 }, data: { label: "provider.ts\nMulti-LLM" }, parentId: "g-ai", extent: "parent" as const, style: { ...sm, ...styles.ai, width: W, height: H } },
  { id: "ai-ctx", position: { x: 310, y: 50 }, data: { label: "context-manager\nTokens + Cost" }, parentId: "g-ai", extent: "parent" as const, style: { ...sm, ...styles.ai, width: 130, height: H } },

  // ── Core Package group ──
  { id: "g-core", position: { x: 0, y: 590 }, data: { label: "@cdoing/core" }, type: "group", style: { ...g, width: 680, height: 320 } },

  // Row 1
  { id: "core-tools", position: { x: 20, y: 50 }, data: { label: "tools/\n21 Built-in" }, parentId: "g-core", extent: "parent" as const, style: { ...sm, ...styles.core, width: W, height: H } },
  { id: "core-perms", position: { x: 160, y: 50 }, data: { label: "permissions/\n5 Modes" }, parentId: "g-core", extent: "parent" as const, style: { ...sm, ...styles.core, width: W, height: H } },
  { id: "core-sandbox", position: { x: 300, y: 50 }, data: { label: "sandbox/\nFS + Network" }, parentId: "g-core", extent: "parent" as const, style: { ...sm, ...styles.core, width: W, height: H } },
  { id: "core-oauth", position: { x: 440, y: 50 }, data: { label: "oauth.ts\nPKCE + Keychain" }, parentId: "g-core", extent: "parent" as const, style: { ...sm, ...styles.core, width: 140, height: H } },

  // Row 2
  { id: "core-ctx", position: { x: 20, y: 120 }, data: { label: "context-providers/\n10 @ Providers" }, parentId: "g-core", extent: "parent" as const, style: { ...sm, ...styles.core, width: 140, height: H } },
  { id: "core-index", position: { x: 180, y: 120 }, data: { label: "indexing/\nFTS5 + Vectors" }, parentId: "g-core", extent: "parent" as const, style: { ...sm, ...styles.core, width: W, height: H } },
  { id: "core-hooks", position: { x: 320, y: 120 }, data: { label: "hooks/\nPre + Post" }, parentId: "g-core", extent: "parent" as const, style: { ...sm, ...styles.core, width: 110, height: H } },
  { id: "core-rules", position: { x: 450, y: 120 }, data: { label: "rules/\nGlob-Scoped" }, parentId: "g-core", extent: "parent" as const, style: { ...sm, ...styles.core, width: 110, height: H } },

  // Row 3
  { id: "core-plan", position: { x: 20, y: 190 }, data: { label: "plan/" }, parentId: "g-core", extent: "parent" as const, style: { ...sm, ...styles.core, width: 80, height: H1 } },
  { id: "core-mcp", position: { x: 120, y: 190 }, data: { label: "mcp/" }, parentId: "g-core", extent: "parent" as const, style: { ...sm, ...styles.core, width: 80, height: H1 } },
  { id: "core-effort", position: { x: 220, y: 190 }, data: { label: "effort/" }, parentId: "g-core", extent: "parent" as const, style: { ...sm, ...styles.core, width: 80, height: H1 } },
  { id: "core-utils", position: { x: 320, y: 190 }, data: { label: "utils/\nSearch + Memory" }, parentId: "g-core", extent: "parent" as const, style: { ...sm, ...styles.core, width: 140, height: H } },
  { id: "core-registry", position: { x: 480, y: 190 }, data: { label: "tools/registry.ts" }, parentId: "g-core", extent: "parent" as const, style: { ...sm, ...styles.core, width: W, height: H1 } },

  // ── LLM Providers (external, right side) ──
  { id: "llm-anthropic", position: { x: 760, y: 380 }, data: { label: "Anthropic\nClaude" }, style: { ...sm, background: "#1a1a1a", border: "1px solid #f59e0b", width: 110, height: H } },
  { id: "llm-openai", position: { x: 760, y: 460 }, data: { label: "OpenAI\nGPT-4o" }, style: { ...sm, background: "#1a1a1a", border: "1px solid #22c55e", width: 110, height: H } },
  { id: "llm-google", position: { x: 760, y: 540 }, data: { label: "Google\nGemini" }, style: { ...sm, background: "#1a1a1a", border: "1px solid #60a5fa", width: 110, height: H } },
];

const fullEdges: Edge[] = [
  // CLI → AI
  { id: "f1", source: "cli-chat", target: "ai-runner", type: "avoidNodes", label: "runs agent", data: { strokeColor: "#6366f1" } },
  { id: "f2", source: "cli-oauth", target: "core-oauth", type: "avoidNodes", label: "shared tokens", data: { strokeColor: "#6366f1", strokeDasharray: "5 5" } },
  // VSC → AI
  { id: "f3", source: "vsc-panel", target: "ai-runner", type: "avoidNodes", label: "runs agent", data: { strokeColor: "#6366f1" } },
  { id: "f4", source: "vsc-oauth", target: "core-oauth", type: "avoidNodes", label: "shared tokens", data: { strokeColor: "#6366f1", strokeDasharray: "5 5" } },
  // VSC internal
  { id: "f5", source: "vsc-ext", target: "vsc-panel", type: "avoidNodes", label: "creates", data: { strokeColor: "#8b5cf6" } },
  { id: "f6", source: "vsc-panel", target: "vsc-webview", type: "avoidNodes", label: "postMessage", data: { strokeColor: "#8b5cf6" } },
  // AI → Core
  { id: "f7", source: "ai-runner", target: "core-tools", type: "avoidNodes", label: "execute", data: { strokeColor: "#f59e0b" } },
  { id: "f8", source: "ai-runner", target: "core-perms", type: "avoidNodes", label: "check", data: { strokeColor: "#f59e0b" } },
  { id: "f9", source: "ai-runner", target: "core-hooks", type: "avoidNodes", label: "fire", data: { strokeColor: "#f59e0b", strokeDasharray: "5 5" } },
  // AI → LLMs
  { id: "f10", source: "ai-provider", target: "llm-anthropic", type: "avoidNodes", label: "stream", data: { strokeColor: "#f59e0b" } },
  { id: "f11", source: "ai-provider", target: "llm-openai", type: "avoidNodes", label: "stream", data: { strokeColor: "#22c55e" } },
  { id: "f12", source: "ai-provider", target: "llm-google", type: "avoidNodes", label: "stream", data: { strokeColor: "#60a5fa" } },
  // Core internal
  { id: "f13", source: "core-tools", target: "core-registry", type: "avoidNodes", label: "registers", data: { strokeColor: "#22c55e", strokeDasharray: "5 5" } },
  { id: "f14", source: "core-perms", target: "core-sandbox", type: "avoidNodes", label: "enforces", data: { strokeColor: "#22c55e", strokeDasharray: "5 5" } },
];
