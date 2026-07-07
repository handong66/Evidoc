import { test } from "node:test";
import assert from "node:assert/strict";
import { validateDocumentFrontmatter } from "../src/index.js";

test("accepts repository-relative source bindings", () => {
  const errors = validateDocumentFrontmatter({
    sources: [{ path: "src/index.ts", symbols: ["checkRepository"] }],
    ttlDays: 30
  });

  assert.deepEqual(errors, []);
});

test("rejects absolute source bindings and invalid ttl values", () => {
  const errors = validateDocumentFrontmatter({
    sources: [{ path: "/tmp/index.ts" }],
    ttlDays: 0
  });

  assert.deepEqual(errors, [
    "sources.path must be a non-empty repository-relative path",
    "ttlDays must be a positive integer when provided"
  ]);
});
