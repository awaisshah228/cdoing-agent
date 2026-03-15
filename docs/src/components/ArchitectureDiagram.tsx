"use client";

import {
  ReactFlow,
  Node,
  Edge,
  Background,
  BackgroundVariant,
  Position,
  ConnectionLineType,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

// ── Custom Node Styles ──────────────────────────────────

const baseNodeStyle = {
  borderRadius: 12,
  fontSize: 13,
  fontFamily: "var(--font-mono), monospace",
  padding: "0",
  border: "1px solid #333",
  color: "#fafafa",
  textAlign: "center" as const,
};

const nodeStyles = {
  ui: { ...baseNodeStyle, background: "#1e1b4b", borderColor: "#6366f1" },
  ai: { ...baseNodeStyle, background: "#1c1917", borderColor: "#f59e0b" },
  core: { ...baseNodeStyle, background: "#052e16", borderColor: "#22c55e" },
  tool: { ...baseNodeStyle, background: "#1a1a2e", borderColor: "#8b5cf6", fontSize: 11 },
  action: { ...baseNodeStyle, background: "#1a1a1a", borderColor: "#555", fontSize: 11 },
  user: { ...baseNodeStyle, background: "#0c0c0c", borderColor: "#6366f1", fontSize: 12 },
  decision: { ...baseNodeStyle, background: "#27171a", borderColor: "#ef4444", fontSize: 11 },
};

// ── Package Dependency Diagram ──────────────────────────

const depNodes: Node[] = [
  {
    id: "cli",
    data: { label: "@cdoing/cli\nTerminal UI" },
    position: { x: 50, y: 0 },
    style: { ...nodeStyles.ui, width: 180, height: 60 },
    sourcePosition: Position.Bottom,
    targetPosition: Position.Top,
  },
  {
    id: "vscode",
    data: { label: "cdoing-vscode\nVS Code Extension" },
    position: { x: 300, y: 0 },
    style: { ...nodeStyles.ui, width: 200, height: 60 },
    sourcePosition: Position.Bottom,
    targetPosition: Position.Top,
  },
  {
    id: "ai",
    data: { label: "@cdoing/ai\nAgent Runner + LLM Providers" },
    position: { x: 150, y: 120 },
    style: { ...nodeStyles.ai, width: 240, height: 60 },
    sourcePosition: Position.Bottom,
    targetPosition: Position.Top,
  },
  {
    id: "core",
    data: { label: "@cdoing/core\nTools, Permissions, Sandbox, OAuth" },
    position: { x: 130, y: 240 },
    style: { ...nodeStyles.core, width: 280, height: 60 },
    sourcePosition: Position.Bottom,
    targetPosition: Position.Top,
  },
];

const depEdges: Edge[] = [
  { id: "cli-ai", source: "cli", target: "ai", animated: true, style: { stroke: "#6366f1" } },
  { id: "vscode-ai", source: "vscode", target: "ai", animated: true, style: { stroke: "#6366f1" } },
  { id: "ai-core", source: "ai", target: "core", animated: true, style: { stroke: "#f59e0b" } },
  { id: "cli-core", source: "cli", target: "core", style: { stroke: "#6366f144", strokeDasharray: "5 5" } },
  { id: "vscode-core", source: "vscode", target: "core", style: { stroke: "#6366f144", strokeDasharray: "5 5" } },
];

// ── Agentic Loop Diagram ────────────────────────────────

const loopNodes: Node[] = [
  {
    id: "user",
    data: { label: "User Message" },
    position: { x: 220, y: 0 },
    style: { ...nodeStyles.user, width: 160, height: 40 },
    sourcePosition: Position.Bottom,
  },
  {
    id: "prompt",
    data: { label: "System Prompt Builder\npermissions + tools + context" },
    position: { x: 160, y: 80 },
    style: { ...nodeStyles.action, width: 280, height: 55 },
    sourcePosition: Position.Bottom,
    targetPosition: Position.Top,
  },
  {
    id: "llm",
    data: { label: "LLM Provider\nAnthropic / OpenAI / Google / Ollama" },
    position: { x: 160, y: 180 },
    style: { ...nodeStyles.ai, width: 280, height: 55 },
    sourcePosition: Position.Bottom,
    targetPosition: Position.Top,
  },
  {
    id: "text",
    data: { label: "Text Response" },
    position: { x: 60, y: 290 },
    style: { ...nodeStyles.core, width: 130, height: 38 },
    sourcePosition: Position.Bottom,
    targetPosition: Position.Top,
  },
  {
    id: "tools",
    data: { label: "Tool Calls" },
    position: { x: 310, y: 290 },
    style: { ...nodeStyles.tool, width: 130, height: 38 },
    sourcePosition: Position.Bottom,
    targetPosition: Position.Top,
  },
  {
    id: "return",
    data: { label: "Return to User" },
    position: { x: 40, y: 380 },
    style: { ...nodeStyles.user, width: 140, height: 38 },
    targetPosition: Position.Top,
  },
  {
    id: "hooks",
    data: { label: "Pre-Hooks" },
    position: { x: 310, y: 370 },
    style: { ...nodeStyles.action, width: 120, height: 36 },
    sourcePosition: Position.Bottom,
    targetPosition: Position.Top,
  },
  {
    id: "perm",
    data: { label: "Permission Check" },
    position: { x: 290, y: 440 },
    style: { ...nodeStyles.decision, width: 150, height: 40 },
    sourcePosition: Position.Bottom,
    targetPosition: Position.Top,
  },
  {
    id: "exec",
    data: { label: "Tool Execution" },
    position: { x: 230, y: 520 },
    style: { ...nodeStyles.tool, width: 130, height: 38 },
    sourcePosition: Position.Bottom,
    targetPosition: Position.Top,
  },
  {
    id: "denied",
    data: { label: "Denied" },
    position: { x: 410, y: 520 },
    style: { ...nodeStyles.decision, width: 80, height: 34 },
    targetPosition: Position.Top,
  },
  {
    id: "posthooks",
    data: { label: "Post-Hooks" },
    position: { x: 240, y: 600 },
    style: { ...nodeStyles.action, width: 120, height: 36 },
    sourcePosition: Position.Bottom,
    targetPosition: Position.Top,
  },
  {
    id: "feedback",
    data: { label: "Feed result back to LLM (loop)" },
    position: { x: 180, y: 680 },
    style: { ...nodeStyles.ai, width: 240, height: 40 },
    sourcePosition: Position.Right,
    targetPosition: Position.Top,
  },
];

const loopEdges: Edge[] = [
  { id: "e1", source: "user", target: "prompt", style: { stroke: "#6366f1" } },
  { id: "e2", source: "prompt", target: "llm", style: { stroke: "#6366f1" }, animated: true },
  { id: "e3", source: "llm", target: "text", style: { stroke: "#22c55e" } },
  { id: "e4", source: "llm", target: "tools", style: { stroke: "#8b5cf6" } },
  { id: "e5", source: "text", target: "return", style: { stroke: "#22c55e" } },
  { id: "e6", source: "tools", target: "hooks", style: { stroke: "#8b5cf6" }, animated: true },
  { id: "e7", source: "hooks", target: "perm", style: { stroke: "#8b5cf6" } },
  { id: "e8", source: "perm", target: "exec", style: { stroke: "#22c55e" }, label: "Yes", labelStyle: { fill: "#22c55e", fontSize: 10 } },
  { id: "e9", source: "perm", target: "denied", style: { stroke: "#ef4444" }, label: "No", labelStyle: { fill: "#ef4444", fontSize: 10 } },
  { id: "e10", source: "exec", target: "posthooks", style: { stroke: "#8b5cf6" } },
  { id: "e11", source: "posthooks", target: "feedback", style: { stroke: "#f59e0b" }, animated: true },
  {
    id: "e12",
    source: "feedback",
    target: "llm",
    type: "smoothstep",
    style: { stroke: "#f59e0b", strokeDasharray: "5 5" },
    animated: true,
  },
];

// ── OAuth Flow Diagram ──────────────────────────────────

const oauthNodes: Node[] = [
  {
    id: "o-user",
    data: { label: "User runs\n/setup or --login" },
    position: { x: 0, y: 0 },
    style: { ...nodeStyles.user, width: 160, height: 50 },
    sourcePosition: Position.Right,
  },
  {
    id: "o-pkce",
    data: { label: "Generate PKCE\ncode verifier + challenge" },
    position: { x: 220, y: 0 },
    style: { ...nodeStyles.core, width: 200, height: 50 },
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
  },
  {
    id: "o-browser",
    data: { label: "Open browser\nclaude.ai/oauth/authorize" },
    position: { x: 480, y: 0 },
    style: { ...nodeStyles.ai, width: 200, height: 50 },
    sourcePosition: Position.Bottom,
    targetPosition: Position.Left,
  },
  {
    id: "o-approve",
    data: { label: "User approves\ngets redirect with code" },
    position: { x: 480, y: 100 },
    style: { ...nodeStyles.user, width: 200, height: 50 },
    sourcePosition: Position.Left,
    targetPosition: Position.Top,
  },
  {
    id: "o-exchange",
    data: { label: "Exchange code\nfor access + refresh token" },
    position: { x: 220, y: 100 },
    style: { ...nodeStyles.tool, width: 200, height: 50 },
    sourcePosition: Position.Left,
    targetPosition: Position.Right,
  },
  {
    id: "o-store",
    data: { label: "Store in OS Keychain\n(macOS / Linux / Windows)" },
    position: { x: 0, y: 100 },
    style: { ...nodeStyles.core, width: 180, height: 50 },
    sourcePosition: Position.Bottom,
    targetPosition: Position.Right,
  },
  {
    id: "o-use",
    data: { label: "CLI + VS Code Extension\nuse same token" },
    position: { x: 80, y: 200 },
    style: { ...nodeStyles.ui, width: 220, height: 50 },
    targetPosition: Position.Top,
  },
];

const oauthEdges: Edge[] = [
  { id: "oe1", source: "o-user", target: "o-pkce", animated: true, style: { stroke: "#6366f1" } },
  { id: "oe2", source: "o-pkce", target: "o-browser", animated: true, style: { stroke: "#22c55e" } },
  { id: "oe3", source: "o-browser", target: "o-approve", style: { stroke: "#f59e0b" } },
  { id: "oe4", source: "o-approve", target: "o-exchange", animated: true, style: { stroke: "#8b5cf6" } },
  { id: "oe5", source: "o-exchange", target: "o-store", animated: true, style: { stroke: "#22c55e" } },
  { id: "oe6", source: "o-store", target: "o-use", style: { stroke: "#6366f1" } },
];

// ── Shared Flow Props ───────────────────────────────────

const flowDefaults = {
  nodesDraggable: false,
  nodesConnectable: false,
  elementsSelectable: false,
  panOnDrag: false,
  zoomOnScroll: false,
  zoomOnPinch: false,
  zoomOnDoubleClick: false,
  preventScrolling: false,
  connectionLineType: ConnectionLineType.SmoothStep,
  fitView: true,
  fitViewOptions: { padding: 0.3 },
  proOptions: { hideAttribution: true },
};

// ── Exported Components ─────────────────────────────────

export function DependencyGraph() {
  return (
    <div className="flow-diagram" style={{ height: 360 }}>
      <ReactFlow nodes={depNodes} edges={depEdges} {...flowDefaults}>
        <Background variant={BackgroundVariant.Dots} color="#333" gap={20} size={1} />
      </ReactFlow>
    </div>
  );
}

export function AgenticLoopDiagram() {
  return (
    <div className="flow-diagram" style={{ height: 780 }}>
      <ReactFlow nodes={loopNodes} edges={loopEdges} {...flowDefaults}>
        <Background variant={BackgroundVariant.Dots} color="#333" gap={20} size={1} />
      </ReactFlow>
    </div>
  );
}

export function OAuthFlowDiagram() {
  return (
    <div className="flow-diagram" style={{ height: 320 }}>
      <ReactFlow nodes={oauthNodes} edges={oauthEdges} {...flowDefaults}>
        <Background variant={BackgroundVariant.Dots} color="#333" gap={20} size={1} />
      </ReactFlow>
    </div>
  );
}
