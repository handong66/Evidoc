import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { checkRepository } from "../src/index.js";

async function fixture(): Promise<string> {
  return mkdtemp(join(tmpdir(), "evidoc-perf-"));
}

async function write(root: string, file: string, text: string): Promise<void> {
  const target = join(root, file);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, text, "utf8");
}

test("supports changed-file scans and skips oversized documents", async () => {
  const root = await fixture();
  await write(root, ".evidoc/config.json", JSON.stringify({ maxFileBytes: 64 }));
  await write(root, "docs/changed.md", "Missing path: `src/missing.ts`.\n");
  await write(root, "docs/unchanged.md", "Missing path: `src/other-missing.ts`.\n");
  await write(root, "docs/huge.md", `${"x".repeat(128)} src/huge-missing.ts\n`);

  const report = await checkRepository(root, { changedFiles: ["docs/changed.md"] });

  assert.equal(report.summary.documentsScanned, 1);
  assert.equal(report.findings.length, 1);
  assert.equal(report.findings[0].evidence[0].subject, "src/missing.ts");
  assert.equal(report.summary.skippedOversized, 1);
});

test("empty changed-file scans do not fall back to full repository scans", async () => {
  const root = await fixture();
  await write(root, "README.md", "Missing path: `src/missing.ts`.\n");

  const report = await checkRepository(root, { changedFiles: [] });

  assert.equal(report.summary.documentsScanned, 0);
  assert.equal(report.summary.findings, 0);
});
