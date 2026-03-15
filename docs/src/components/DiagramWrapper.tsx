"use client";

import dynamic from "next/dynamic";

const DependencyGraphInner = dynamic(
  () => import("@/components/ArchitectureDiagram").then((m) => m.DependencyGraph),
  { ssr: false, loading: () => <div className="flow-diagram" style={{ height: 400 }} /> },
);

const AgenticLoopDiagramInner = dynamic(
  () => import("@/components/ArchitectureDiagram").then((m) => m.AgenticLoopDiagram),
  { ssr: false, loading: () => <div className="flow-diagram" style={{ height: 920 }} /> },
);

const OAuthFlowDiagramInner = dynamic(
  () => import("@/components/ArchitectureDiagram").then((m) => m.OAuthFlowDiagram),
  { ssr: false, loading: () => <div className="flow-diagram" style={{ height: 360 }} /> },
);

export function DependencyGraph() {
  return <DependencyGraphInner />;
}

export function AgenticLoopDiagram() {
  return <AgenticLoopDiagramInner />;
}

export function OAuthFlowDiagram() {
  return <OAuthFlowDiagramInner />;
}

const VscodeArchDiagramInner = dynamic(
  () => import("@/components/ArchitectureDiagram").then((m) => m.VscodeArchDiagram),
  { ssr: false, loading: () => <div className="flow-diagram" style={{ height: 500 }} /> },
);

export function VscodeArchDiagram() {
  return <VscodeArchDiagramInner />;
}

const FullSystemDiagramInner = dynamic(
  () => import("@/components/ArchitectureDiagram").then((m) => m.FullSystemDiagram),
  { ssr: false, loading: () => <div className="flow-diagram" style={{ height: 860 }} /> },
);

export function FullSystemDiagram() {
  return <FullSystemDiagramInner />;
}
