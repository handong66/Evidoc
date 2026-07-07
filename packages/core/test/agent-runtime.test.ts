import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createAgentRuntimeContract,
  fingerprintDriftFinding,
  type DriftFinding,
  type DriftReport
} from "../src/index.js";

function finding(overrides: Partial<DriftFinding> = {}): DriftFinding {
  return {
    id: "README.md:1:path.missing-reference:src/missing.ts",
    ruleId: "path.missing-reference",
    severity: "high",
    status: "broken",
    docPath: "README.md",
    line: 1,
    message: "README.md references missing path src/missing.ts.",
    evidence: [
      {
        kind: "path",
        subject: "src/missing.ts",
        expected: "existing repository path",
        actual: "missing",
        detail: "The referenced path does not exist in the current repository."
      }
    ],
    suggestedAction: "Update README.md or restore src/missing.ts.",
    ...overrides
  };
}

function report(overrides: Partial<DriftReport> = {}): DriftReport {
  const findings = overrides.findings ?? [finding()];
  const broken = findings.filter((item) => item.status === "broken").length;
  const reviewNeeded = findings.filter((item) => item.status === "review_needed").length;
  return {
    root: "/tmp/example",
    scannedAt: "2026-07-06T10:00:00.000Z",
    documents: [{ path: "README.md", kind: "markdown", lineCount: 1 }],
    findings,
    summary: {
      documentsScanned: 1,
      findings: findings.length,
      broken,
      reviewNeeded,
      reviewSuppressed: 0,
      skippedOversized: 0,
      healthScore: 75,
      byRule: { "path.missing-reference": findings.length },
      bySeverity: { low: 0, medium: 0, high: findings.length }
    },
    ...overrides
  };
}

test("agent runtime contract gives every finding a stable dedupe fingerprint", () => {
  const first = fingerprintDriftFinding(finding());
  const second = fingerprintDriftFinding(
    finding({
      id: "changed-id",
      message: "README.md references missing path src/missing.ts."
    })
  );
  const different = fingerprintDriftFinding(finding({ docPath: "docs/guide.md" }));

  assert.match(first, /^dgf_[a-f0-9]{16}$/);
  assert.equal(first, second);
  assert.notEqual(first, different);
});

test("agent runtime finding fingerprint is stable when evidence order changes", () => {
  const first = fingerprintDriftFinding(
    finding({
      evidence: [
        {
          kind: "path",
          subject: "src/missing.ts",
          expected: "existing repository path",
          actual: "missing",
          detail: "The referenced path does not exist in the current repository."
        },
        {
          kind: "path",
          subject: "src/other-missing.ts",
          expected: "existing repository path",
          actual: "missing",
          detail: "The referenced path does not exist in the current repository."
        }
      ]
    })
  );
  const second = fingerprintDriftFinding(
    finding({
      evidence: [
        {
          kind: "path",
          subject: "src/other-missing.ts",
          expected: "existing repository path",
          actual: "missing",
          detail: "The referenced path does not exist in the current repository."
        },
        {
          kind: "path",
          subject: "src/missing.ts",
          expected: "existing repository path",
          actual: "missing",
          detail: "The referenced path does not exist in the current repository."
        }
      ]
    })
  );

  assert.equal(first, second);
});

test("agent runtime finding fingerprint tolerates malformed evidence arrays", () => {
  const clean = fingerprintDriftFinding(finding({ evidence: [] }));
  const malformed = fingerprintDriftFinding(
    finding({
      evidence: [
        null,
        { randomKey: "value" },
        { kind: "not_a_valid_kind", subject: "x", detail: "y" },
        { kind: "path", subject: "x", detail: "y", actual: 123 }
      ] as unknown as DriftFinding["evidence"]
    })
  );

  assert.equal(malformed, clean);
});

test("agent runtime contract maps scan severity to advisory or blocking status", () => {
  const contract = createAgentRuntimeContract(report(), {
    event: "pre-commit",
    mode: "blocking",
    scope: "staged",
    baseline: "HEAD",
    baselineCommit: "0123456789abcdef0123456789abcdef01234567",
    changedFiles: ["README.md"],
    changedFileFingerprints: { "README.md": "sha256:abc123" },
    affectedDocuments: ["README.md"],
    generatedAt: "2026-07-06T10:00:01.000Z"
  });

  assert.equal(contract.schemaVersion, "evidoc.agent-runtime.v1");
  assert.equal(contract.source, "evidoc");
  assert.equal(contract.event, "pre-commit");
  assert.equal(contract.mode, "blocking");
  assert.equal(contract.scope, "staged");
  assert.equal(contract.baseline, "HEAD");
  assert.equal(contract.baselineCommit, "0123456789abcdef0123456789abcdef01234567");
  assert.equal(contract.status, "failed");
  assert.equal(contract.summary.broken, 1);
  assert.equal(contract.findings.length, 1);
  assert.equal(contract.findings[0].fingerprint, fingerprintDriftFinding(finding()));
  assert.equal(contract.dedupe.fingerprintCount, 1);
  assert.deepEqual(contract.changedFiles, ["README.md"]);
  assert.deepEqual(contract.changedFileFingerprints, { "README.md": "sha256:abc123" });
  assert.deepEqual(contract.affectedDocuments, ["README.md"]);
});

test("agent runtime aggregate fingerprint ignores scan timestamps", () => {
  const first = createAgentRuntimeContract(report({ scannedAt: "2026-07-06T10:00:00.000Z" }), {
    event: "manual",
    mode: "advisory",
    scope: "worktree",
    generatedAt: "2026-07-06T10:00:02.000Z"
  });
  const second = createAgentRuntimeContract(report({ scannedAt: "2026-07-06T11:00:00.000Z" }), {
    event: "manual",
    mode: "advisory",
    scope: "worktree",
    generatedAt: "2026-07-06T11:00:02.000Z"
  });

  assert.equal(first.fingerprint, second.fingerprint);
  assert.equal(first.status, "failed");
});

test("agent runtime aggregate fingerprint changes with runtime scope and changed-file context", () => {
  const first = createAgentRuntimeContract(report(), {
    event: "manual",
    mode: "advisory",
    scope: "worktree",
    changedFiles: ["README.md"],
    changedFileFingerprints: { "README.md": "sha256:first" },
    affectedDocuments: ["README.md"],
    generatedAt: "2026-07-06T10:00:02.000Z"
  });
  const second = createAgentRuntimeContract(report(), {
    event: "manual",
    mode: "advisory",
    scope: "worktree",
    changedFiles: ["README.md"],
    changedFileFingerprints: { "README.md": "sha256:second" },
    affectedDocuments: ["README.md"],
    generatedAt: "2026-07-06T11:00:02.000Z"
  });
  const differentScope = createAgentRuntimeContract(report(), {
    event: "pre-commit",
    mode: "blocking",
    scope: "staged",
    changedFiles: ["README.md"],
    changedFileFingerprints: { "README.md": "sha256:first" },
    affectedDocuments: ["README.md"],
    generatedAt: "2026-07-06T12:00:02.000Z"
  });

  assert.notEqual(first.fingerprint, second.fingerprint);
  assert.notEqual(first.fingerprint, differentScope.fingerprint);
  assert.equal(first.findings[0].fingerprint, second.findings[0].fingerprint);
});
