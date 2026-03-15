"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";

/**
 * Custom node with centered, non-overflowing label.
 * Handles on all 4 sides so avoid-nodes-edge can route from any direction.
 */
function DiagramNodeComponent({ data, selected }: NodeProps<Node>) {
  const label = (data?.label as string) || "";

  return (
    <div className={`diagram-node ${selected ? "selected" : ""}`}>
      <Handle type="target" position={Position.Top} className="diagram-handle" />
      <Handle type="target" position={Position.Left} className="diagram-handle" />
      <div className="diagram-node-label">{label}</div>
      <Handle type="source" position={Position.Bottom} className="diagram-handle" />
      <Handle type="source" position={Position.Right} className="diagram-handle" />
    </div>
  );
}

export const DiagramNode = memo(DiagramNodeComponent);

/**
 * Group node with label at top-left corner.
 */
function GroupNodeComponent({ data }: NodeProps<Node>) {
  const label = (data?.label as string) || "";

  return (
    <div className="group-node">
      {label && <div className="group-node-label">{label}</div>}
    </div>
  );
}

export const GroupNode = memo(GroupNodeComponent);
