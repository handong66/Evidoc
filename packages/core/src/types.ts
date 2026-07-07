export type DriftStatus = "ok" | "review_needed" | "broken";
export type DriftSeverity = "low" | "medium" | "high";

export interface DocumentRecord {
  path: string;
  kind: "agent_instruction" | "markdown";
  lineCount: number;
  text: string;
}

export interface PackageManifest {
  name?: string;
  version?: string;
  packageManager?: string;
  scripts: Record<string, string>;
}

export interface ApiOperation {
  specPath: string;
  method: string;
  path: string;
  operationId?: string;
  requestSchemas: string[];
  responseSchemas: Record<string, string[]>;
}

export interface ReviewLogEntry {
  findingId: string;
  decision: "accepted" | "false_positive" | "deferred" | "fixed";
  reviewer: string;
  reviewedAt: string;
  expiresAt?: string;
  note?: string;
}

export interface EvidocConfig {
  docRoots?: string[];
  ignorePatterns?: string[];
  severityOverrides?: Record<string, DriftSeverity>;
  apiSpecPaths?: string[];
  ownerMapping?: Record<string, string>;
  reviewTtlDays?: number;
  requireTestsForSources?: boolean;
  requireDocsForChangedSources?: boolean;
  maxFileBytes?: number;
  concurrency?: number;
}

export interface RepositorySnapshot {
  root: string;
  files: Set<string>;
  documents: DocumentRecord[];
  packageManifest?: PackageManifest;
  expectedPackageManager?: "npm" | "pnpm" | "yarn" | "bun";
  apiOperations: ApiOperation[];
  config: EvidocConfig;
  reviewLog: ReviewLogEntry[];
  skippedOversized: number;
}

export interface CheckRepositoryOptions {
  changedFiles?: string[];
  changedSourceFiles?: string[];
  undocumentedChangedFiles?: string[];
  now?: Date;
}

export interface DriftEvidence {
  kind:
    | "agent_instruction"
    | "api"
    | "command"
    | "config"
    | "coverage"
    | "frontmatter"
    | "path"
    | "review_log"
    | "symbol";
  subject: string;
  expected?: string;
  actual?: string;
  detail: string;
}

export interface DriftFinding {
  id: string;
  ruleId: string;
  severity: DriftSeverity;
  status: Exclude<DriftStatus, "ok">;
  docPath: string;
  line: number;
  message: string;
  evidence: DriftEvidence[];
  suggestedAction: string;
  review?: {
    decision: ReviewLogEntry["decision"];
    reviewer: string;
    reviewedAt: string;
    expiresAt?: string;
  };
}

export interface DriftSummary {
  documentsScanned: number;
  findings: number;
  broken: number;
  reviewNeeded: number;
  reviewSuppressed: number;
  skippedOversized: number;
  healthScore?: number;
  byRule: Record<string, number>;
  bySeverity: Record<DriftSeverity, number>;
}

export interface DriftReport {
  root: string;
  scannedAt: string;
  documents: Array<Pick<DocumentRecord, "path" | "kind" | "lineCount">>;
  findings: DriftFinding[];
  summary: DriftSummary;
}

export type AgentRuntimeEvent = "pre-commit" | "pre-push" | "manual" | "mcp" | "ide";
export type AgentRuntimeMode = "advisory" | "blocking";
export type AgentRuntimeScope = "staged" | "worktree" | "full_repository";
export type AgentRuntimeStatus = "passed" | "review_needed" | "failed";

export interface AgentRuntimeFinding {
  fingerprint: string;
  findingId: string;
  ruleId: string;
  status: Exclude<DriftStatus, "ok">;
  severity: DriftSeverity;
  location: string;
  message: string;
  suggestedAction: string;
}

export interface AgentRuntimeContract {
  schemaVersion: "evidoc.agent-runtime.v1";
  source: "evidoc";
  event: AgentRuntimeEvent;
  mode: AgentRuntimeMode;
  scope: AgentRuntimeScope;
  baseline?: string;
  baselineCommit?: string;
  status: AgentRuntimeStatus;
  fingerprint: string;
  generatedAt: string;
  scannedAt: string;
  summary: {
    findings: number;
    broken: number;
    reviewNeeded: number;
  };
  findings: AgentRuntimeFinding[];
  dedupe: {
    strategy: "runtime.findings[].fingerprint";
    fingerprintCount: number;
  };
  changedFiles?: string[];
  changedFileFingerprints?: Record<string, string>;
  affectedDocuments?: string[];
}

export interface MultiRepositoryReport {
  scannedAt: string;
  repositories: DriftReport[];
  summary: {
    repositoriesScanned: number;
    documentsScanned: number;
    findings: number;
    broken: number;
    reviewNeeded: number;
    reviewSuppressed: number;
    skippedOversized: number;
    healthScore?: number;
    byRule: Record<string, number>;
    bySeverity: Record<DriftSeverity, number>;
  };
}
