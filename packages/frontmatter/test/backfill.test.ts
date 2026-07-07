import { test } from "node:test";
import assert from "node:assert/strict";
import {
  backfillDocumentFrontmatter,
  parseDocumentFrontmatter,
  serializeDocumentFrontmatter,
  validateDocumentFrontmatter
} from "../src/index.js";

test("parses and serializes source bindings", () => {
  const parsed = parseDocumentFrontmatter([
    "---",
    "id: readme",
    "owner: docs",
    "sources:",
    "  - path: src/index.ts",
    "    symbols:",
    "      - checkRepository",
    "lastReviewed: 2026-07-05",
    "ttlDays: 30",
    "---",
    "# README"
  ].join("\n"));

  assert.equal(parsed.frontmatter.id, "readme");
  assert.equal(parsed.frontmatter.sources?.[0].path, "src/index.ts");
  assert.deepEqual(parsed.frontmatter.sources?.[0].symbols, ["checkRepository"]);
  assert.equal(parsed.body.trim(), "# README");
  assert.equal(validateDocumentFrontmatter(parsed.frontmatter).length, 0);

  const serialized = serializeDocumentFrontmatter(parsed.frontmatter);
  assert.match(serialized, /sources:/);
  assert.match(serialized, /- path: src\/index\.ts/);
});

test("backfills missing frontmatter without replacing document body", () => {
  const next = backfillDocumentFrontmatter("# README\n", {
    id: "readme",
    owner: "docs",
    sources: [{ path: "src/index.ts", symbols: ["checkRepository"] }],
    lastReviewed: "2026-07-05",
    ttlDays: 90
  });

  assert.match(next, /^---\n/);
  assert.match(next, /id: readme/);
  assert.match(next, /checkRepository/);
  assert.match(next, /# README/);
});
