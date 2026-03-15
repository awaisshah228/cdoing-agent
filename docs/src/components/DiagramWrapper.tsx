"use client";

import dynamic from "next/dynamic";

function DiagramPlaceholder({ height }: { height: number }) {
  return <div className="flow-diagram" style={{ minHeight: Math.min(height, 300) }} />;
}

const DependencyGraphInner = dynamic(
  () => import("@/components/ArchitectureDiagram").then((m) => m.DependencyGraph),
  { ssr: false, loading: () => <DiagramPlaceholder height={460} /> },
);

const AgenticLoopDiagramInner = dynamic(
  () => import("@/components/ArchitectureDiagram").then((m) => m.AgenticLoopDiagram),
  { ssr: false, loading: () => <DiagramPlaceholder height={920} /> },
);

const OAuthFlowDiagramInner = dynamic(
  () => import("@/components/ArchitectureDiagram").then((m) => m.OAuthFlowDiagram),
  { ssr: false, loading: () => <DiagramPlaceholder height={360} /> },
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
  { ssr: false, loading: () => <DiagramPlaceholder height={500} /> },
);

export function VscodeArchDiagram() {
  return <VscodeArchDiagramInner />;
}

const FullSystemDiagramInner = dynamic(
  () => import("@/components/ArchitectureDiagram").then((m) => m.FullSystemDiagram),
  { ssr: false, loading: () => <DiagramPlaceholder height={860} /> },
);

export function FullSystemDiagram() {
  return <FullSystemDiagramInner />;
}
