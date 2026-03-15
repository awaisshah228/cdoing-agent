/**
 * ELK layout with compound group support.
 * ELK handles both node positioning AND group sizing via INCLUDE_CHILDREN.
 * No manual expandGroups needed.
 */

import type { Node, Edge } from "@xyflow/react";
import Elk, { type ElkNode } from "elkjs/lib/elk.bundled.js";

const GROUP_PADDING = 40;
const elk = new Elk();

function getWidth(n: Node): number {
  return (n.width as number) ?? (n.style?.width as number) ?? 150;
}

function getHeight(n: Node): number {
  return (n.height as number) ?? (n.style?.height as number) ?? 50;
}

function getElkDirection(d: string) {
  switch (d) {
    case "TB": return "DOWN";
    case "LR": return "RIGHT";
    case "BT": return "UP";
    case "RL": return "LEFT";
    default: return "DOWN";
  }
}

export async function layoutDiagram(
  nodes: Node[],
  edges: Edge[],
  direction = "TB",
  spacing = 60,
): Promise<Node[]> {
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const groupIds = new Set(nodes.filter((n) => n.type === "group").map((n) => n.id));

  const childrenByParent = new Map<string, Node[]>();
  for (const node of nodes) {
    const key = node.parentId ?? "__root__";
    if (!childrenByParent.has(key)) childrenByParent.set(key, []);
    childrenByParent.get(key)!.push(node);
  }

  function isLabelNode(n: Node): boolean {
    const s = n.style as Record<string, unknown> | undefined;
    return !!(s?.border === "none" && s?.background === "transparent");
  }

  function buildElkNode(nodeId: string): ElkNode {
    const node = nodeById.get(nodeId)!;
    const children = (childrenByParent.get(nodeId) ?? []).filter((c) => !isLabelNode(c));

    if (children.length === 0 || !groupIds.has(nodeId)) {
      return { id: node.id, width: getWidth(node), height: getHeight(node) };
    }

    const childIds = new Set(children.map((c) => c.id));
    return {
      id: node.id,
      layoutOptions: {
        "elk.padding": `[top=${GROUP_PADDING + 15},left=${GROUP_PADDING},bottom=${GROUP_PADDING},right=${GROUP_PADDING}]`,
      },
      children: children.map((child) => buildElkNode(child.id)),
      edges: edges
        .filter((e) => childIds.has(e.source) && childIds.has(e.target))
        .map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] })),
    };
  }

  const rootChildren = childrenByParent.get("__root__") ?? [];

  const graph = {
    id: "elk-root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": getElkDirection(direction),
      "elk.spacing.nodeNode": `${spacing}`,
      "elk.layered.spacing.nodeNodeBetweenLayers": `${spacing}`,
      "elk.hierarchyHandling": "INCLUDE_CHILDREN",
    },
    children: rootChildren.map((node) => buildElkNode(node.id)),
    edges: edges.map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] })),
  };

  const root = await elk.layout(graph);

  const positions = new Map<string, { x: number; y: number }>();
  const groupSizes = new Map<string, { width: number; height: number }>();

  function collect(elkNodes: ElkNode[]) {
    for (const en of elkNodes) {
      positions.set(en.id, { x: en.x!, y: en.y! });
      if (groupIds.has(en.id)) {
        groupSizes.set(en.id, { width: en.width!, height: en.height! });
      }
      if (en.children) collect(en.children);
    }
  }
  collect(root.children ?? []);

  return nodes.map((node) => {
    // Label nodes stay at fixed position
    if (isLabelNode(node)) {
      return { ...node, position: { x: 10, y: 8 } };
    }

    const pos = positions.get(node.id);
    if (!pos) return node;

    if (node.type === "group") {
      const size = groupSizes.get(node.id);
      return {
        ...node,
        position: pos,
        width: size?.width,
        height: size?.height,
        style: {
          ...((node.style ?? {}) as Record<string, unknown>),
          ...(size ? { width: size.width, height: size.height } : {}),
        },
      };
    }
    return { ...node, position: pos };
  });
}
