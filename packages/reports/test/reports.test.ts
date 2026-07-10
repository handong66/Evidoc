import { test } from "node:test";
import assert from "node:assert/strict";
import { formatMarkdownReport, formatTextReport } from "../src/index.js";
import type { DriftReport } from "@evidoc/core";

const report: DriftReport = {
  root: "/repo",
  scannedAt: "2026-07-05T00:00:00.000Z",
  documents: [{ path: "README.md", kind: "markdown", lineCount: 3 }],
  findings: [
    {
      id: "README.md:2:path.missing-reference:src/missing.ts",
      ruleId: "path.missing-reference",
      severity: "high",
      status: "broken",
      docPath: "README.md",
      line: 2,
      message: "README.md:2 references missing path src/missing.ts.",
      evidence: [
        {
          kind: "path",
          subject: "src/missing.ts",
          expected: "path exists in repository",
          actual: "missing",
          detail: "Path is absent."
        }
      ],
      suggestedAction: "Update the path."
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

test("formats text reports with finding location and rule", () => {
  const output = formatTextReport(report);

  assert.match(output, /Evidoc report/);
  assert.match(output, /broken\s+README\.md:2/);
  assert.match(output, /path\.missing-reference/);
});

test("formats markdown reports with summary and finding sections", () => {
  const output = formatMarkdownReport(report);

  assert.match(output, /# Evidoc Report/);
  assert.match(output, /Broken: 1/);
  assert.match(output, /## broken: README\.md:2/);
});
