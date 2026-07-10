import { test } from "node:test";
import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import { renderDashboardHtml, renderMultiRepositoryDashboardHtml } from "../src/index.js";
import type { DriftReport, MultiRepositoryReport } from "@evidoc/core";

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
  assert.match(html, /id="status-filter"/);
  assert.match(html, /data-status="broken"/);
  assert.match(html, /id="graph-data"/);
  assert.match(html, /id="trend-data"/);
  assert.match(html, /data-review-action/);
  assert.match(html, /id="review-feedback"/);
  assert.match(html, /navigator\.clipboard\?\.writeText\(findingId\)/);
  assert.match(html, /evidoc\.record_review/);
  assert.match(html, />Copy review id</);
  assert.doesNotMatch(html, /Repository: <code>\/repo<\/code>/);

  const script = html.match(/<script>\s*([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);
  const listeners = new Map<string, () => void>();
  const search = {
    value: "",
    addEventListener: (event: string, listener: () => void) => listeners.set(`search:${event}`, listener)
  };
  const status = {
    value: "",
    addEventListener: (event: string, listener: () => void) => listeners.set(`status:${event}`, listener)
  };
  const rows = [
    { dataset: { status: "broken" }, textContent: "missing path", hidden: false },
    { dataset: { status: "review_needed" }, textContent: "stale command", hidden: false }
  ];
  runInNewContext(script, {
    document: {
      getElementById: (id: string) => id === "finding-filter" ? search : id === "status-filter" ? status : undefined,
      querySelectorAll: (selector: string) => selector === "tbody tr" ? rows : []
    },
    navigator: {}
  });

  status.value = "review_needed";
  listeners.get("status:change")?.();
  assert.equal(rows[0].hidden, true);
  assert.equal(rows[1].hidden, false);

  search.value = "missing";
  listeners.get("search:input")?.();
  assert.equal(rows[0].hidden, true);
  assert.equal(rows[1].hidden, true);
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
  assert.match(html, />repo<\/code>/);
  assert.doesNotMatch(html, />\/repo<\/code>/);
});
