import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { readFindingDocuments, type DriftFinding, type DriftReport } from "../src/index.js";

async function fixture(): Promise<string> {
  return mkdtemp(join(tmpdir(), "evidoc-finding-docs-"));
}

async function write(root: string, file: string, text: string): Promise<void> {
  const target = join(root, file);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, text, "utf8");
}

function finding(docPath: string, id = `${docPath}:1:path.missing-reference:src/missing.ts`): DriftFinding {
  return {
    id,
    ruleId: "path.missing-reference",
    severity: "high",
    status: "broken",
    docPath,
    line: 1,
    message: `${docPath} references missing path src/missing.ts.`,
    evidence: [
      {
        kind: "path",
        subject: "src/missing.ts",
        expected: "existing repository path",
        actual: "missing",
        detail: "The referenced path does not exist in the current repository."
      }
    ],
    suggestedAction: `Update ${docPath} or restore src/missing.ts.`
  };
}

function report(findings: DriftFinding[]): DriftReport {
  return {
    root: "/tmp/example",
    scannedAt: "2026-07-06T10:00:00.000Z",
    documents: [{ path: "README.md", kind: "markdown", lineCount: 1 }],
    findings,
    summary: {
      documentsScanned: 1,
      findings: findings.length,
      broken: findings.length,
      reviewNeeded: 0,
      reviewSuppressed: 0,
      skippedOversized: 0,
      healthScore: 50,
      byRule: { "path.missing-reference": findings.length },
      bySeverity: { low: 0, medium: 0, high: findings.length }
    }
  };
}

test("reads unique finding documents through repository path safety", async () => {
  const root = await fixture();
  await write(root, "README.md", "# App\nBroken reference: `src/missing.ts`.\n");

  const documents = await readFindingDocuments(
    root,
    report([
      finding("README.md"),
      finding("README.md", "README.md:2:path.missing-reference:src/other.ts"),
      finding("../outside.md")
    ])
  );

  assert.deepEqual(Object.keys(documents).sort(), ["../outside.md", "README.md"]);
  assert.equal(documents["README.md"], "# App\nBroken reference: `src/missing.ts`.\n");
  assert.equal(documents["../outside.md"], "");
});
