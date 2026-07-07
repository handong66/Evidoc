import { test } from "node:test";
import assert from "node:assert/strict";
import {
  appendReviewLogEntry,
  isFindingReviewed,
  parseReviewLog,
  serializeReviewLogEntry
} from "../src/index.js";
import type { DriftFinding } from "@handong66/evidoc-core";

const finding: DriftFinding = {
  id: "README.md:1:path.missing-reference",
  ruleId: "path.missing-reference",
  severity: "high",
  status: "broken",
  docPath: "README.md",
  line: 1,
  message: "missing path",
  evidence: [],
  suggestedAction: "Fix path."
};

test("serializes and parses append-only review log entries", () => {
  const entry = {
    findingId: finding.id,
    decision: "accepted" as const,
    reviewer: "maintainer",
    reviewedAt: "2026-07-05T00:00:00.000Z",
    expiresAt: "2026-08-05T00:00:00.000Z",
    note: "Confirmed stale path."
  };

  const text = appendReviewLogEntry("", entry);
  const parsed = parseReviewLog(text);

  assert.match(serializeReviewLogEntry(entry), /"findingId"/);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].decision, "accepted");
  assert.equal(isFindingReviewed(finding, parsed, new Date("2026-07-06T00:00:00.000Z")), true);
  assert.equal(isFindingReviewed(finding, parsed, new Date("2026-09-01T00:00:00.000Z")), false);
});
