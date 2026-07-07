import { createHash } from "node:crypto";
import type {
  AgentRuntimeContract,
  AgentRuntimeEvent,
  AgentRuntimeMode,
  AgentRuntimeScope,
  AgentRuntimeStatus,
  DriftFinding,
  DriftEvidence,
  DriftReport
} from "./types.js";

const DRIFT_EVIDENCE_KINDS = new Set<string>([
  "agent_instruction",
  "api",
  "command",
  "config",
  "coverage",
  "frontmatter",
  "path",
  "review_log",
  "symbol"
]);

export interface AgentRuntimeContractOptions {
  event: AgentRuntimeEvent;
  mode: AgentRuntimeMode;
  scope: AgentRuntimeScope;
  baseline?: string;
  baselineCommit?: string;
  changedFiles?: string[];
  changedFileFingerprints?: Record<string, string>;
  affectedDocuments?: string[];
  generatedAt?: string;
}

export function createAgentRuntimeContract(
  report: DriftReport,
  options: AgentRuntimeContractOptions
): AgentRuntimeContract {
  const findings = report.findings.map((finding) => ({
    fingerprint: fingerprintDriftFinding(finding),
    findingId: finding.id,
    ruleId: finding.ruleId,
    status: finding.status,
    severity: finding.severity,
    location: `${finding.docPath}:${finding.line}`,
    message: finding.message,
    suggestedAction: finding.suggestedAction
  }));
  const status = runtimeStatus(report);
  const changedFiles = normalizeList(options.changedFiles);
  const changedFileFingerprints = normalizeRecord(options.changedFileFingerprints);
  const affectedDocuments = normalizeList(options.affectedDocuments);

  return {
    schemaVersion: "evidoc.agent-runtime.v1",
    source: "evidoc",
    event: options.event,
    mode: options.mode,
    scope: options.scope,
    baseline: options.baseline,
    baselineCommit: options.baselineCommit,
    status,
    fingerprint: aggregateRuntimeFingerprint({
      status,
      findingFingerprints: findings.map((finding) => finding.fingerprint),
      event: options.event,
      mode: options.mode,
      scope: options.scope,
      baseline: options.baseline,
      baselineCommit: options.baselineCommit,
      changedFiles,
      changedFileFingerprints,
      affectedDocuments
    }),
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    scannedAt: report.scannedAt,
    summary: {
      findings: report.summary.findings,
      broken: report.summary.broken,
      reviewNeeded: report.summary.reviewNeeded
    },
    findings,
    dedupe: {
      strategy: "runtime.findings[].fingerprint",
      fingerprintCount: new Set(findings.map((finding) => finding.fingerprint)).size
    },
    changedFiles,
    changedFileFingerprints,
    affectedDocuments
  };
}

export function fingerprintDriftFinding(finding: DriftFinding): string {
  return `dgf_${stableHash({
    ruleId: finding.ruleId,
    status: finding.status,
    severity: finding.severity,
    docPath: finding.docPath,
    line: finding.line,
    evidence: readFindingEvidence(finding)
      .map((item) => ({
        kind: item.kind,
        subject: item.subject,
        expected: item.expected,
        actual: item.actual,
        detail: item.detail
      }))
      .sort((left, right) => stableStringify(left).localeCompare(stableStringify(right)))
  })}`;
}

function readFindingEvidence(finding: DriftFinding): DriftEvidence[] {
  if (!Array.isArray(finding.evidence)) return [];
  return finding.evidence.filter(isDriftEvidence);
}

function isDriftEvidence(item: unknown): item is DriftEvidence {
  if (!item || typeof item !== "object") return false;
  const candidate = item as Partial<DriftEvidence>;
  return (
    typeof candidate.kind === "string" &&
    DRIFT_EVIDENCE_KINDS.has(candidate.kind) &&
    typeof candidate.subject === "string" &&
    typeof candidate.detail === "string" &&
    (candidate.expected === undefined || typeof candidate.expected === "string") &&
    (candidate.actual === undefined || typeof candidate.actual === "string")
  );
}

export function fingerprintFileContent(content: string | Uint8Array): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

function runtimeStatus(report: DriftReport): AgentRuntimeStatus {
  if (report.summary.broken > 0) return "failed";
  if (report.summary.reviewNeeded > 0) return "review_needed";
  return "passed";
}

function aggregateRuntimeFingerprint(input: {
  status: AgentRuntimeStatus;
  findingFingerprints: string[];
  event: AgentRuntimeEvent;
  mode: AgentRuntimeMode;
  scope: AgentRuntimeScope;
  baseline?: string;
  baselineCommit?: string;
  changedFiles?: string[];
  changedFileFingerprints?: Record<string, string>;
  affectedDocuments?: string[];
}): string {
  return `dgr_${stableHash({
    status: input.status,
    event: input.event,
    mode: input.mode,
    scope: input.scope,
    baseline: input.baseline,
    baselineCommit: input.baselineCommit,
    changedFiles: input.changedFiles,
    changedFileFingerprints: input.changedFileFingerprints,
    affectedDocuments: input.affectedDocuments,
    findings: [...input.findingFingerprints].sort()
  })}`;
}

function normalizeList(value: string[] | undefined): string[] | undefined {
  if (!value) return undefined;
  return [...new Set(value)].sort();
}

function normalizeRecord(value: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!value) return undefined;
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)));
}

function stableHash(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex").slice(0, 16);
}

function stableStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalize(item)])
  );
}
