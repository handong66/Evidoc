import { createHash } from "node:crypto";
import { detectDrift } from "./detectors.js";
import { readRepository } from "./repository.js";
import type {
  CheckRepositoryOptions,
  DriftFinding,
  DriftReport,
  DriftSeverity,
  RepositorySnapshot,
  MultiRepositoryReport,
  ReviewLogEntry
} from "./types.js";

export type {
  DocumentRecord,
  CheckRepositoryOptions,
  DriftEvidence,
  DriftFinding,
  DriftSeverity,
  DriftReport,
  AgentRuntimeContract,
  AgentRuntimeEvent,
  AgentRuntimeFinding,
  AgentRuntimeMode,
  AgentRuntimeScope,
  AgentRuntimeStatus,
  DriftStatus,
  DriftSummary,
  EvidocConfig,
  MultiRepositoryReport,
  PackageManifest,
  RepositorySnapshot,
  ReviewLogEntry
} from "./types.js";

export { detectDrift } from "./detectors.js";
export { createAgentRuntimeContract, fingerprintDriftFinding, fingerprintFileContent } from "./agent-runtime.js";
export type { AgentRuntimeContractOptions } from "./agent-runtime.js";
export { readFindingDocuments } from "./finding-documents.js";
export { readRepository } from "./repository.js";
export {
  detectEvidocWorkflowText,
  detectRepositoryEvidocWorkflowText,
  evidocWorkflowWarnings,
  isEvidocWorkflowText,
  workflowLocalActionPaths
} from "./workflow-warnings.js";
export type {
  EvidocWorkflowTextDetection,
  WorkflowLocalActionDefinition,
  WorkflowLocalActionReader
} from "./workflow-warnings.js";
export {
  isPathInsideRoot,
  normalizeRepositoryRelativePath,
  resolveExistingPathInsideRoot,
  resolveExistingRootInsideBoundary,
  resolveWritablePathInsideRoot
} from "./path-safety.js";

export async function checkRepository(
  root = process.cwd(),
  options: CheckRepositoryOptions = {}
): Promise<DriftReport> {
  const snapshot = await readRepository(root, { changedFiles: options.changedFiles });
  const detectedFindings = [
    ...detectConfigPathDrift(snapshot),
    ...detectChangedSourceCoverageDrift(snapshot, options.undocumentedChangedFiles ?? options.changedSourceFiles),
    ...(await detectDrift(snapshot))
  ];
  const findingsWithOverrides = applySeverityOverrides(detectedFindings, snapshot.config.severityOverrides ?? {});
  const { findings, reviewSuppressed } = applyReviewLog(
    findingsWithOverrides,
    snapshot.reviewLog,
    options.now ?? new Date()
  );

  return {
    root: snapshot.root,
    scannedAt: new Date().toISOString(),
    documents: snapshot.documents.map(({ path, kind, lineCount }) => ({
      path,
      kind,
      lineCount
    })),
    findings,
    summary: summarizeFindings(snapshot.documents.length, findings, {
      reviewSuppressed,
      skippedOversized: snapshot.skippedOversized
    })
  };
}

function detectChangedSourceCoverageDrift(
  snapshot: RepositorySnapshot,
  changedFiles: string[] | undefined
): DriftFinding[] {
  if (!snapshot.config.requireDocsForChangedSources || !changedFiles?.length) return [];
  return changedFiles.filter(isLikelySourcePath).map((path) => ({
    id: `${path}:1:coverage.changed-source-without-doc`,
    ruleId: "coverage.changed-source-without-doc",
    severity: "medium",
    status: "review_needed",
    docPath: path,
    line: 1,
    message: `Changed source file ${path} has no affected documentation or source binding in this scan scope.`,
    evidence: [
      {
        kind: "coverage",
        subject: path,
        expected: "a changed or affected Markdown/MDX document",
        actual: "no affected documentation",
        detail:
          "requireDocsForChangedSources is enabled, and this changed source file did not map to README, docs, agent instructions, or source-bound documentation."
      }
    ],
    suggestedAction:
      "Update documentation or add a source binding for this changed source file, or disable requireDocsForChangedSources for this repository."
  }));
}

function isLikelySourcePath(path: string): boolean {
  if (isMarkdownPath(path)) return false;
  const lower = path.toLowerCase();
  const basename = lower.split("/").pop() ?? lower;
  if (lower.startsWith(".evidoc/") || lower.startsWith(".github/workflows/") || lower.startsWith(".githooks/")) {
    return false;
  }
  if (lower.includes("__tests__/") || lower.startsWith("test/") || lower.startsWith("tests/")) return false;
  if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(basename)) return false;
  if (/^(vite|vitest|jest|webpack|rollup|eslint|prettier|tailwind|postcss|babel)\.config\.[cm]?[jt]s$/.test(basename)) {
    return false;
  }
  if (/^package(-lock)?\.json$/.test(path)) return false;
  if (/^(pnpm-lock\.yaml|yarn\.lock|bun\.lockb)$/.test(path)) return false;
  return /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|rb|php|cs|sh|sql|proto|graphql|gql)$/i.test(path);
}

function detectConfigPathDrift(snapshot: RepositorySnapshot): DriftFinding[] {
  const findings: DriftFinding[] = [];
  findings.push(...missingConfiguredPathFindings(snapshot, "docRoots", snapshot.config.docRoots));
  findings.push(...missingConfiguredPathFindings(snapshot, "apiSpecPaths", snapshot.config.apiSpecPaths));
  findings.push(...noDocumentCoverageFindings(snapshot));
  return findings;
}

function noDocumentCoverageFindings(snapshot: RepositorySnapshot): DriftFinding[] {
  const hasMarkdownFiles = [...snapshot.files].some(isMarkdownPath);
  const hasConfiguredDocRoots = Boolean(snapshot.config.docRoots?.length);
  const hasMissingConfiguredDocRoots = Boolean(
    snapshot.config.docRoots?.some((path) => !configuredPathExists(snapshot, "docRoots", path))
  );
  const hasConfiguredMarkdownCandidates = Boolean(
    snapshot.config.docRoots?.some((root) =>
      [...snapshot.files].some((file) => isMarkdownPath(file) && isInsideConfiguredDocRoot(file, root))
    )
  );
  if (snapshot.documents.length > 0) {
    if (!hasConfiguredDocRoots) return [];
    const hasScannedConfiguredDocument = snapshot.documents.some((document) =>
      snapshot.config.docRoots?.some((root) => isInsideConfiguredDocRoot(document.path, root))
    );
    if (hasScannedConfiguredDocument || hasMissingConfiguredDocRoots || hasConfiguredMarkdownCandidates) return [];
  }
  if (hasMarkdownFiles && !hasConfiguredDocRoots) return [];
  if (hasMissingConfiguredDocRoots) return [];
  if (hasConfiguredMarkdownCandidates) return [];

  return [
    {
      id: ".evidoc/config.json:1:coverage.no-documents-scanned",
      ruleId: "coverage.no-documents-scanned",
      severity: "medium",
      status: "review_needed",
      docPath: ".evidoc/config.json",
      line: 1,
      message: "No documentation files were scanned, so Evidoc cannot prove this repository is covered.",
      evidence: [
        {
          kind: "config",
          subject: "docRoots",
          expected: "at least one Markdown or MDX document included in the scan",
          actual: "0 documents scanned",
          detail:
            hasConfiguredDocRoots
              ? "The configured docRoots produced no scanned Markdown or MDX documents."
              : "The repository does not contain scanned Markdown or MDX documentation yet."
        }
      ],
      suggestedAction:
        "Add README.md or docs/, run `evidoc init`, or update .evidoc/config.json docRoots to include current documentation."
    }
  ];
}

function isMarkdownPath(path: string): boolean {
  const lower = path.toLowerCase();
  return lower.endsWith(".md") || lower.endsWith(".mdx");
}

function isInsideConfiguredDocRoot(file: string, root: string): boolean {
  return file === root || file.startsWith(`${root}/`);
}

function missingConfiguredPathFindings(
  snapshot: RepositorySnapshot,
  field: "docRoots" | "apiSpecPaths",
  configured: string[] | undefined
): DriftFinding[] {
  if (!configured?.length) return [];

  return configured
    .filter((path) => !configuredPathExists(snapshot, field, path))
    .map((path) => ({
      id: `.evidoc/config.json:1:config.missing-path:${field}:${path}`,
      ruleId: "config.missing-path",
      severity: "high",
      status: "broken",
      docPath: ".evidoc/config.json",
      line: 1,
      message: `Configured ${field} path does not exist: ${path}.`,
      evidence: [
        {
          kind: "config",
          subject: field,
          expected: "existing repository-relative path",
          actual: path,
          detail: `The configured ${field} entry resolves to no current repository path, so Evidoc may scan no relevant documents or API specs.`
        }
      ],
      suggestedAction: `Update .evidoc/config.json to point ${field} at an existing path, or remove the stale entry.`
    }));
}

function configuredPathExists(
  snapshot: RepositorySnapshot,
  field: "docRoots" | "apiSpecPaths",
  path: string
): boolean {
  if (snapshot.files.has(path)) return true;
  if (field === "docRoots") {
    return [...snapshot.files].some((file) => file.startsWith(`${path}/`));
  }
  return false;
}

export async function checkRepositories(roots: string[]): Promise<MultiRepositoryReport> {
  const repositories = await Promise.all(roots.map((root) => checkRepository(root)));
  const findings = repositories.flatMap((repository) => repository.findings);
  const documentsScanned = repositories.reduce(
    (total, repository) => total + repository.summary.documentsScanned,
    0
  );

  return {
    scannedAt: new Date().toISOString(),
    repositories,
    summary: {
      repositoriesScanned: repositories.length,
      ...summarizeFindings(documentsScanned, findings, {
        reviewSuppressed: repositories.reduce(
          (total, repository) => total + repository.summary.reviewSuppressed,
          0
        ),
        skippedOversized: repositories.reduce(
          (total, repository) => total + repository.summary.skippedOversized,
          0
        )
      })
    }
  };
}

export function createScanCacheKey(input: {
  files: string[];
  configHash: string;
  changedFiles?: string[];
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        files: [...input.files].sort(),
        configHash: input.configHash,
        changedFiles: [...(input.changedFiles ?? [])].sort()
      })
    )
    .digest("hex");
}

function summarizeFindings(
  documentsScanned: number,
  findings: DriftFinding[],
  counters: { reviewSuppressed: number; skippedOversized: number }
): DriftReport["summary"] {
  const byRule: Record<string, number> = {};
  const bySeverity: Record<DriftSeverity, number> = {
    low: 0,
    medium: 0,
    high: 0
  };

  for (const finding of findings) {
    byRule[finding.ruleId] = (byRule[finding.ruleId] ?? 0) + 1;
    bySeverity[finding.severity] += 1;
  }

  return {
    documentsScanned,
    findings: findings.length,
    broken: findings.filter((finding) => finding.status === "broken").length,
    reviewNeeded: findings.filter((finding) => finding.status === "review_needed").length,
    reviewSuppressed: counters.reviewSuppressed,
    skippedOversized: counters.skippedOversized,
    healthScore: calculateHealthScore(findings),
    byRule,
    bySeverity
  };
}

function calculateHealthScore(findings: DriftFinding[]): number {
  const broken = findings.filter((finding) => finding.status === "broken").length;
  const reviewNeeded = findings.filter((finding) => finding.status === "review_needed").length;
  return Math.max(0, Math.min(100, 100 - broken * 25 - reviewNeeded * 10));
}

function applySeverityOverrides(
  findings: DriftFinding[],
  overrides: Record<string, DriftSeverity>
): DriftFinding[] {
  return findings.map((finding) => ({
    ...finding,
    severity: overrides[finding.ruleId] ?? finding.severity
  }));
}

function applyReviewLog(
  findings: DriftFinding[],
  entries: ReviewLogEntry[],
  now: Date
): { findings: DriftFinding[]; reviewSuppressed: number } {
  const active = new Map<string, ReviewLogEntry>();
  const expired: ReviewLogEntry[] = [];

  for (const entry of entries) {
    if (!isSuppressingDecision(entry.decision)) continue;
    const expiresAt = entry.expiresAt ? Date.parse(entry.expiresAt) : undefined;
    if (entry.expiresAt && (expiresAt === undefined || Number.isNaN(expiresAt) || expiresAt < now.getTime())) {
      expired.push(entry);
      continue;
    }
    active.set(entry.findingId, entry);
  }

  const remaining: DriftFinding[] = [];
  let reviewSuppressed = 0;

  for (const finding of findings) {
    const entry = active.get(finding.id);
    if (entry) {
      reviewSuppressed += 1;
      continue;
    }
    remaining.push(finding);
  }

  for (const entry of expired) {
    remaining.push(createExpiredReviewFinding(entry));
  }

  return { findings: remaining, reviewSuppressed };
}

function isSuppressingDecision(decision: ReviewLogEntry["decision"]): boolean {
  return decision === "accepted" || decision === "false_positive" || decision === "fixed";
}

function createExpiredReviewFinding(entry: ReviewLogEntry): DriftFinding {
  const [rawDocPath = ".evidoc/review-log.jsonl", line = "1"] = entry.findingId.split(":");
  const docPath = safeReviewLogDocPath(rawDocPath);
  return {
    id: `${entry.findingId}:review_log.override-expired`,
    ruleId: "review_log.override-expired",
    severity: "medium",
    status: "review_needed",
    docPath,
    line: Number.parseInt(line, 10) || 1,
    message: `Review override for ${entry.findingId} expired at ${entry.expiresAt}.`,
    evidence: [
      {
        kind: "review_log",
        subject: entry.findingId,
        expected: "active non-expired review decision",
        actual: entry.expiresAt ?? "expired",
        detail: "The review log entry can no longer suppress or annotate this finding."
      }
    ],
    suggestedAction: "Re-review the finding and append a fresh review-log decision if the override still applies.",
    review: {
      decision: entry.decision,
      reviewer: entry.reviewer,
      reviewedAt: entry.reviewedAt,
      expiresAt: entry.expiresAt
    }
  };
}

function safeReviewLogDocPath(value: string): string {
  const normalized = value.replaceAll("\\", "/");
  const parts = normalized.split("/");
  if (
    normalized.length === 0 ||
    normalized.startsWith("/") ||
    normalized.includes(":") ||
    parts.some((part) => part === "" || part === "..")
  ) {
    return ".evidoc/review-log.jsonl";
  }
  return normalized;
}
