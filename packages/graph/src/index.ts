import type { DriftEvidence, DriftReport } from "@evidoc/core";

export type GraphNodeKind = "document" | "source" | "symbol" | "api" | "claim" | "command";
export type GraphEdgeKind = "references" | "declares" | "covers" | "changes" | "invalidates";

export interface GraphNode {
  id: string;
  kind: GraphNodeKind;
  path?: string;
  label?: string;
}

export interface GraphEdge {
  from: string;
  to: string;
  kind: GraphEdgeKind;
}

export interface DriftGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export function createEmptyGraph(): DriftGraph {
  return { nodes: [], edges: [] };
}

export function buildDriftGraph(report: DriftReport): DriftGraph {
  const graph = createEmptyGraph();
  const nodes = new Map<string, GraphNode>();
  const edges = new Set<string>();

  function addNode(node: GraphNode): void {
    if (!nodes.has(node.id)) nodes.set(node.id, node);
  }

  function addEdge(edge: GraphEdge): void {
    edges.add(`${edge.from}\t${edge.to}\t${edge.kind}`);
  }

  for (const document of report.documents) {
    addNode({
      id: `document:${document.path}`,
      kind: "document",
      path: document.path,
      label: document.path
    });
  }

  for (const finding of report.findings) {
    const docNode = `document:${finding.docPath}`;
    const ruleNode = `rule:${finding.ruleId}`;
    addNode({ id: docNode, kind: "document", path: finding.docPath, label: finding.docPath });
    addNode({ id: ruleNode, kind: "claim", label: finding.ruleId });
    addEdge({ from: ruleNode, to: docNode, kind: "invalidates" });

    for (const evidence of finding.evidence) {
      const evidenceNode = evidenceToNode(evidence);
      addNode(evidenceNode);
      addEdge({ from: docNode, to: evidenceNode.id, kind: "references" });
      addEdge({ from: evidenceNode.id, to: ruleNode, kind: "covers" });
    }
  }

  graph.nodes = [...nodes.values()].sort((a, b) => a.id.localeCompare(b.id));
  graph.edges = [...edges]
    .map((edge) => {
      const [from, to, kind] = edge.split("\t") as [string, string, GraphEdgeKind];
      return { from, to, kind };
    })
    .sort((a, b) => `${a.from}${a.to}${a.kind}`.localeCompare(`${b.from}${b.to}${b.kind}`));

  return graph;
}

function evidenceToNode(evidence: DriftEvidence): GraphNode {
  if (evidence.kind === "symbol") {
    const [path] = evidence.subject.split("#");
    return {
      id: `symbol:${evidence.subject}`,
      kind: "symbol",
      path,
      label: evidence.subject
    };
  }

  if (evidence.kind === "api") {
    return {
      id: `api:${evidence.subject}`,
      kind: "api",
      label: evidence.subject
    };
  }

  if (evidence.kind === "command") {
    return {
      id: `command:${evidence.subject}`,
      kind: "command",
      label: evidence.subject
    };
  }

  return {
    id: `source:${evidence.subject}`,
    kind: "source",
    path: evidence.subject,
    label: evidence.subject
  };
}
