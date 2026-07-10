import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFailOn, shouldFailAction } from "../src/index.js";
import type { DriftReport } from "@handong66/evidoc-core";

function report(broken: number, reviewNeeded: number): DriftReport {
  return {
    root: "/repo",
    scannedAt: "2026-07-05T00:00:00.000Z",
    documents: [],
    findings: [],
    summary: {
      documentsScanned: 0,
      findings: broken + reviewNeeded,
      broken,
      reviewNeeded,
      reviewSuppressed: 0,
      skippedOversized: 0,
      healthScore: Math.max(0, 100 - broken * 25 - reviewNeeded * 10),
      byRule: {},
      bySeverity: { low: 0, medium: reviewNeeded, high: broken }
    }
  };
}

test("does not fail when policy is none", () => {
  assert.equal(shouldFailAction(report(1, 1), { failOn: "none" }), false);
});

test("fails on broken findings when policy is broken", () => {
  assert.equal(shouldFailAction(report(1, 0), { failOn: "broken" }), true);
  assert.equal(shouldFailAction(report(0, 1), { failOn: "broken" }), false);
});

test("fails on any finding when policy is review_needed", () => {
  assert.equal(shouldFailAction(report(0, 1), { failOn: "review_needed" }), true);
});

test("defaults missing action fail-on input and rejects invalid policies", () => {
  assert.equal(parseFailOn(undefined), "review_needed");
  assert.equal(parseFailOn(""), "review_needed");
  assert.throws(() => parseFailOn("invalid"), /Invalid fail-on policy/);
  assert.equal(parseFailOn("broken"), "broken");
  assert.equal(parseFailOn("review_needed"), "review_needed");
  assert.equal(parseFailOn("none"), "none");
});

test("action reports expose health score outputs", () => {
  const current = report(1, 2);
  assert.equal(current.summary.healthScore, 55);
});
