import { test } from "node:test";
import assert from "node:assert/strict";
import { createDashboardSnapshot } from "../src/index.js";
import type { DriftReport } from "@handong66/evidoc-core";

test("creates a dashboard snapshot from a drift report", () => {
  const report: DriftReport = {
    root: "/repo",
    scannedAt: "2026-07-05T00:00:00.000Z",
    documents: [],
    findings: [],
    summary: {
      documentsScanned: 0,
      findings: 0,
      broken: 0,
      reviewNeeded: 0,
      reviewSuppressed: 0,
      skippedOversized: 0,
      byRule: {},
      bySeverity: { low: 0, medium: 0, high: 0 }
    }
  };

  const snapshot = createDashboardSnapshot(report);

  assert.deepEqual(snapshot.summary, report.summary);
  assert.deepEqual(snapshot.findings, []);
  assert.match(snapshot.generatedAt, /^\d{4}-\d{2}-\d{2}T/);
});
