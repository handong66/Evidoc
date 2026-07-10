import { test } from "node:test";
import assert from "node:assert/strict";
import { renderDashboardHtml } from "../src/index.js";
import type { DriftReport } from "@evidoc/core";

test("renders a self-contained dashboard HTML document", () => {
  const report: DriftReport = {
    root: "/repo",
    scannedAt: "2026-07-05T00:00:00.000Z",
    documents: [{ path: "README.md", kind: "markdown", lineCount: 1 }],
    findings: [
      {
        id: "finding-1",
        ruleId: "path.missing-reference",
        severity: "high",
        status: "broken",
        docPath: "README.md",
        line: 1,
        message: "missing path",
        evidence: [],
        suggestedAction: "Fix path."
      }
    ],
    summary: {
      documentsScanned: 1,
      findings: 1,
      broken: 1,
      reviewNeeded: 0,
      reviewSuppressed: 0,
      skippedOversized: 0,
      byRule: { "path.missing-reference": 1 },
      bySeverity: { low: 0, medium: 0, high: 1 }
    }
  };

  const html = renderDashboardHtml(report);

  assert.match(html, /^<!doctype html>/i);
  assert.match(html, /Evidoc Dashboard/);
  assert.match(html, /path\.missing-reference/);
  assert.match(html, /README\.md:1/);
});

test("redacts local absolute paths from static dashboard findings", () => {
  const report: DriftReport = {
    root: "/repo",
    scannedAt: "2026-07-05T00:00:00.000Z",
    documents: [{ path: "README.md", kind: "markdown", lineCount: 1 }],
    findings: [
      {
        id: "finding-1",
        ruleId: "path.missing-reference",
        severity: "high",
        status: "broken",
        docPath: "README.md",
        line: 1,
        message:
          "README.md references /repo/src/secret.ts, /opt/shared-secrets/token.txt, and \\\\build-server\\share\\private\\trace.log.",
        evidence: [],
        suggestedAction: "Compare with D:\\Projects\\private-repo\\src\\secret.ts before editing."
      }
    ],
    summary: {
      documentsScanned: 1,
      findings: 1,
      broken: 1,
      reviewNeeded: 0,
      reviewSuppressed: 0,
      skippedOversized: 0,
      byRule: { "path.missing-reference": 1 },
      bySeverity: { low: 0, medium: 0, high: 1 }
    }
  };

  const html = renderDashboardHtml(report);

  assert.doesNotMatch(html, /\/repo\/src\/secret\.ts/);
  assert.doesNotMatch(html, /\/opt\/shared-secrets/);
  assert.doesNotMatch(html, /\\\\build-server\\share\\private/);
  assert.doesNotMatch(html, /D:\\Projects/);
  assert.match(html, /&lt;target-repository-root&gt;\/src\/secret\.ts/);
  assert.match(html, /&lt;absolute-path&gt;/);
});
