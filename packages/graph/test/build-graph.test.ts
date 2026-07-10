import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDriftGraph } from "../src/index.js";
import type { DriftReport } from "@evidoc/core";

test("builds document, source, symbol, API, and rule nodes from a report", () => {
  const report: DriftReport = {
    root: "/repo",
    scannedAt: "2026-07-05T00:00:00.000Z",
    documents: [{ path: "README.md", kind: "markdown", lineCount: 3 }],
    findings: [
      {
        id: "finding-1",
        ruleId: "symbol.missing-reference",
        severity: "high",
        status: "broken",
        docPath: "README.md",
        line: 3,
        message: "missing symbol",
        evidence: [
          {
            kind: "symbol",
            subject: "src/service.ts#removeUser",
            expected: "exported symbol exists",
            actual: "missing",
            detail: "symbol is absent"
          }
        ],
        suggestedAction: "Update the symbol binding."
      },
      {
        id: "finding-2",
        ruleId: "api.missing-operation",
        severity: "high",
        status: "broken",
        docPath: "README.md",
        line: 4,
        message: "missing API operation",
        evidence: [
          {
            kind: "api",
            subject: "POST /v1/missing",
            expected: "OpenAPI operation exists",
            actual: "missing",
            detail: "operation is absent"
          }
        ],
        suggestedAction: "Update API docs."
      }
    ],
    summary: {
      documentsScanned: 1,
      findings: 2,
      broken: 2,
      reviewNeeded: 0,
      reviewSuppressed: 0,
      skippedOversized: 0,
      byRule: {
        "api.missing-operation": 1,
        "symbol.missing-reference": 1
      },
      bySeverity: {
        low: 0,
        medium: 0,
        high: 2
      }
    }
  };

  const graph = buildDriftGraph(report);

  assert.ok(graph.nodes.some((node) => node.id === "document:README.md"));
  assert.ok(graph.nodes.some((node) => node.id === "symbol:src/service.ts#removeUser"));
  assert.ok(graph.nodes.some((node) => node.id === "api:POST /v1/missing"));
  assert.ok(graph.nodes.some((node) => node.id === "rule:symbol.missing-reference"));
  assert.ok(graph.edges.some((edge) => edge.kind === "references"));
  assert.ok(graph.edges.some((edge) => edge.kind === "invalidates"));
});
