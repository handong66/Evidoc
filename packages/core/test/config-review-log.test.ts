import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { checkRepository } from "../src/index.js";

async function fixture(): Promise<string> {
  return mkdtemp(join(tmpdir(), "evidoc-config-"));
}

async function write(root: string, file: string, text: string): Promise<void> {
  const target = join(root, file);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, text, "utf8");
}

test("applies config ignore patterns, doc roots, severity overrides, and source test requirements", async () => {
  const root = await fixture();
  await write(
    root,
    ".evidoc/config.json",
    JSON.stringify({
      docRoots: ["docs"],
      ignorePatterns: ["docs/ignored/**"],
      severityOverrides: {
        "path.missing-reference": "medium"
      },
      requireTestsForSources: true
    })
  );
  await write(root, "README.md", "Root docs are outside configured doc roots: `src/root-missing.ts`.\n");
  await write(root, "docs/ignored/README.md", "Ignored missing path: `src/ignored-missing.ts`.\n");
  await write(
    root,
    "docs/README.md",
    [
      "---",
      "sources:",
      "  - path: src/service.ts",
      "---",
      "",
      "Missing path: `src/missing.ts`."
    ].join("\n")
  );
  await write(root, "src/service.ts", "export const service = true;\n");

  const report = await checkRepository(root);

  assert.equal(report.summary.documentsScanned, 1);
  assert.equal(report.findings.length, 2);
  assert.ok(report.findings.some((finding) => finding.ruleId === "path.missing-reference"));
  assert.ok(report.findings.some((finding) => finding.ruleId === "test.missing-source-coverage"));
  assert.equal(
    report.findings.find((finding) => finding.ruleId === "path.missing-reference")?.severity,
    "medium"
  );
});

test("reports missing configured document and API roots as config drift", async () => {
  const root = await fixture();
  await write(
    root,
    ".evidoc/config.json",
    JSON.stringify({
      docRoots: ["docs/missing"],
      apiSpecPaths: ["openapi/missing.json"]
    })
  );
  await write(root, "README.md", "# Existing docs outside the stale docRoots config\n");

  const report = await checkRepository(root);

  assert.equal(report.summary.documentsScanned, 0);
  assert.equal(report.summary.broken, 2);
  assert.deepEqual(
    report.findings.map((finding) => finding.ruleId).sort(),
    ["config.missing-path", "config.missing-path"]
  );
  assert.ok(report.findings.every((finding) => finding.docPath === ".evidoc/config.json"));
  assert.ok(report.findings.some((finding) => finding.evidence[0].subject === "docRoots"));
  assert.ok(report.findings.some((finding) => finding.evidence[0].subject === "apiSpecPaths"));
});

test("rejects invalid config JSON instead of silently scanning with defaults", async () => {
  const root = await fixture();
  await write(root, ".evidoc/config.json", "{ not valid json\n");
  await write(root, "README.md", "# Existing documentation\n");

  await assert.rejects(
    () => checkRepository(root),
    /invalid JSON in \.evidoc\/config\.json/i
  );
});

test("rejects invalid config field types instead of silently weakening coverage", async () => {
  const root = await fixture();
  await write(root, ".evidoc/config.json", JSON.stringify({ docRoots: "docs" }));
  await write(root, "README.md", "# Existing documentation\n");

  await assert.rejects(
    () => checkRepository(root),
    /docRoots must be an array of repository-relative paths/i
  );
});

test("suppresses active review-log overrides and reports expired overrides", async () => {
  const root = await fixture();
  await write(root, "README.md", "Code lives in `src/missing.ts`.\n");
  await write(
    root,
    ".evidoc/review-log.jsonl",
    [
      JSON.stringify({
        findingId: "README.md:1:path.missing-reference:src/missing.ts",
        decision: "false_positive",
        reviewer: "maintainer",
        reviewedAt: "2026-07-05T00:00:00.000Z",
        expiresAt: "2099-01-01T00:00:00.000Z"
      }),
      JSON.stringify({
        findingId: "README.md:1:command.unknown-script:npm missing",
        decision: "accepted",
        reviewer: "maintainer",
        reviewedAt: "2026-07-05T00:00:00.000Z",
        expiresAt: "2000-01-01T00:00:00.000Z"
      })
    ].join("\n")
  );

  const report = await checkRepository(root);

  assert.equal(report.findings.some((finding) => finding.ruleId === "path.missing-reference"), false);
  assert.equal(report.summary.reviewSuppressed, 1);
  assert.ok(report.findings.some((finding) => finding.ruleId === "review_log.override-expired"));
});

test("sanitizes expired review-log finding ids that point outside the repository", async () => {
  const root = await fixture();
  await write(
    root,
    ".evidoc/review-log.jsonl",
    JSON.stringify({
      findingId: "../outside.md:1:path.missing-reference:secret.md",
      decision: "accepted",
      reviewer: "maintainer",
      reviewedAt: "2026-07-05T00:00:00.000Z",
      expiresAt: "2000-01-01T00:00:00.000Z"
    })
  );

  const report = await checkRepository(root);
  const finding = report.findings.find((candidate) => candidate.ruleId === "review_log.override-expired");

  assert.equal(finding?.docPath, ".evidoc/review-log.jsonl");
  assert.equal(finding?.line, 1);
});

test("treats invalid review-log expiry dates as expired instead of suppressing forever", async () => {
  const root = await fixture();
  await write(root, "README.md", "Missing path `src/missing.ts`.\n");
  await write(
    root,
    ".evidoc/review-log.jsonl",
    `${JSON.stringify({
      findingId: "README.md:1:path.missing-reference:src/missing.ts",
      decision: "accepted",
      reviewer: "maintainer",
      reviewedAt: "2026-07-05T00:00:00.000Z",
      expiresAt: "tomorrow"
    })}\n`
  );

  const report = await checkRepository(root, { now: new Date("2026-07-05T00:00:00.000Z") });

  assert.ok(report.findings.some((finding) => finding.ruleId === "path.missing-reference"));
  assert.ok(report.findings.some((finding) => finding.ruleId === "review_log.override-expired"));
});
