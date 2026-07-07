import { test } from "node:test";
import assert from "node:assert/strict";
import { renderDashboardHtml, renderMultiRepositoryDashboardHtml } from "../src/index.js";
import type { DriftReport, MultiRepositoryReport } from "@handong66/evidoc-core";

const report: DriftReport = {
  root: "/repo",
  scannedAt: "2026-07-05T00:00:00.000Z",
  documents: [{ path: "README.md", kind: "markdown", lineCount: 1 }],
  findings: [],
  summary: {
    documentsScanned: 1,
    findings: 0,
    broken: 0,
    reviewNeeded: 0,
    reviewSuppressed: 0,
    skippedOversized: 0,
    byRule: {},
    bySeverity: { low: 0, medium: 0, high: 0 }
  }
};

test("renders interactive filters, graph data, trend slots, and review controls", () => {
  const html = renderDashboardHtml({
    ...report,
    findings: [
      {
        id: "README.md:1:path.missing-reference:src/missing.ts",
        ruleId: "path.missing-reference",
        severity: "high",
        status: "broken",
        docPath: "README.md",
        line: 1,
        message: "README.md references missing src/missing.ts.",
        evidence: [],
        suggestedAction: "Update the documented path."
      }
    ],
    summary: {
      ...report.summary,
      findings: 1,
      broken: 1,
      byRule: { "path.missing-reference": 1 },
      bySeverity: { low: 0, medium: 0, high: 1 }
    }
  });

  assert.match(html, /id="finding-filter"/);
  assert.match(html, /id="graph-data"/);
  assert.match(html, /id="trend-data"/);
  assert.match(html, /data-review-action/);
  assert.match(html, /id="review-feedback"/);
  assert.match(html, /navigator\.clipboard\?\.writeText\(findingId\)/);
  assert.match(html, /evidoc\.record_review/);
});

test("renders a multi-repository dashboard", () => {
  const aggregate: MultiRepositoryReport = {
    scannedAt: "2026-07-05T00:00:00.000Z",
    repositories: [report],
    summary: {
      repositoriesScanned: 1,
      documentsScanned: 1,
      findings: 0,
      broken: 0,
      reviewNeeded: 0,
      reviewSuppressed: 0,
      skippedOversized: 0,
      byRule: {},
      bySeverity: { low: 0, medium: 0, high: 0 }
    }
  };

  const html = renderMultiRepositoryDashboardHtml(aggregate);

  assert.match(html, /Multi-repository/);
  assert.match(html, /\/repo/);
});
