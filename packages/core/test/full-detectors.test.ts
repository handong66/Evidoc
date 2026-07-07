import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { checkRepositories, checkRepository } from "../src/index.js";

async function fixture(prefix = "evidoc-core-"): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

async function write(root: string, file: string, text: string): Promise<void> {
  const target = join(root, file);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, text, "utf8");
}

test("reports API, symbol, frontmatter source, and review-window drift", async () => {
  const root = await fixture();
  await write(
    root,
    "openapi.json",
    JSON.stringify({
      openapi: "3.1.0",
      paths: {
        "/v1/users": {
          get: {}
        }
      }
    })
  );
  await write(
    root,
    "src/service.ts",
    "export function listUsers() { return [] as string[]; }\n"
  );
  await write(
    root,
    "README.md",
    [
      "---",
      "id: readme",
      "sources:",
      "  - path: src/service.ts",
      "    symbols:",
      "      - listUsers",
      "      - removeUser",
      "  - path: src/missing.ts",
      "lastReviewed: 2000-01-01",
      "ttlDays: 30",
      "---",
      "",
      "Supported endpoint: `GET /v1/users`.",
      "Stale endpoint: `POST /v1/missing`.",
      "Symbol anchor: `src/service.ts#removeUser`."
    ].join("\n")
  );

  const report = await checkRepository(root);
  const ruleIds = report.findings.map((finding) => finding.ruleId).sort();

  assert.deepEqual(ruleIds, [
    "api.missing-operation",
    "frontmatter.missing-source",
    "frontmatter.review-expired",
    "symbol.missing-reference",
    "symbol.missing-reference"
  ]);
  assert.equal(report.summary.byRule["api.missing-operation"], 1);
  assert.equal(report.summary.bySeverity.high, 4);
  assert.equal(report.summary.bySeverity.medium, 1);
});

test("aggregates multiple repositories without merging evidence", async () => {
  const clean = await fixture("evidoc-clean-");
  const stale = await fixture("evidoc-stale-");
  await write(clean, "README.md", "No local references here.\n");
  await write(stale, "README.md", "Code lives in `src/missing.ts`.\n");

  const aggregate = await checkRepositories([clean, stale]);

  assert.equal(aggregate.repositories.length, 2);
  assert.equal(aggregate.summary.repositoriesScanned, 2);
  assert.equal(aggregate.summary.findings, 1);
  assert.equal(aggregate.repositories[1].findings[0].docPath, "README.md");
});

test("uses configured default review TTL when frontmatter omits ttlDays", async () => {
  const root = await fixture();
  await write(root, ".evidoc/config.json", JSON.stringify({ reviewTtlDays: 30 }));
  await write(
    root,
    "README.md",
    [
      "---",
      "lastReviewed: 2000-01-01",
      "---",
      "",
      "No local references here."
    ].join("\n")
  );

  const report = await checkRepository(root);

  assert.equal(report.summary.byRule["frontmatter.review-expired"], 1);
  assert.equal(report.findings[0].ruleId, "frontmatter.review-expired");
});
