import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import {
  checkRepository,
  createAgentRuntimeContract,
  detectRepositoryEvidocWorkflowText,
  evidocWorkflowWarnings,
  parseFailOnPolicy,
  type AgentRuntimeContract,
  type FailOn,
  type DriftReport
} from "@evidoc/core";
import {
  formatGithubAnnotations,
  formatMarkdownReport,
  formatPrComment,
  formatSarifReport
} from "@evidoc/reports";

export interface ActionPolicy {
  failOn: FailOn;
}

export interface GithubActionOptions extends ActionPolicy {
  cwd: string;
  changedFiles?: string[];
  changedSourceFiles?: string[];
  undocumentedChangedFiles?: string[];
  baseline?: string;
}

export interface GithubActionResult {
  exitCode: number;
  report: DriftReport;
  runtime: AgentRuntimeContract;
  setupWarnings: string[];
  markdownSummary: string;
  annotations: string;
  prComment: string;
  sarif: string;
}

export function shouldFailAction(report: DriftReport, policy: ActionPolicy): boolean {
  if (policy.failOn === "none") return false;
  if (policy.failOn === "broken") return report.summary.broken > 0;
  return report.summary.broken > 0 || report.summary.reviewNeeded > 0;
}

export async function runGithubAction(options: GithubActionOptions): Promise<GithubActionResult> {
  const report = await checkRepository(options.cwd, {
    changedFiles: options.changedFiles,
    changedSourceFiles: options.changedSourceFiles,
    undocumentedChangedFiles: options.undocumentedChangedFiles
  });
  const runtime = createAgentRuntimeContract(report, {
    event: "github_action",
    mode: options.failOn === "none" ? "advisory" : "blocking",
    scope: options.changedFiles === undefined ? "full_repository" : "worktree",
    baseline: options.baseline,
    changedFiles: options.changedSourceFiles,
    affectedDocuments: options.changedFiles
  });
  const setupWarnings = await findEvidocWorkflowWarnings(options.cwd);
  const reportFormatOptions = {
    setupWarnings,
    scanScope: options.changedFiles === undefined ? undefined : ("changed-only" as const)
  };
  const markdownSummary = formatMarkdownReport(report, reportFormatOptions);

  return {
    exitCode: shouldFailAction(report, options) ? 1 : 0,
    report,
    runtime,
    setupWarnings,
    markdownSummary,
    annotations: formatGithubAnnotations(report),
    prComment: formatPrComment(report, reportFormatOptions),
    sarif: formatSarifReport(report)
  };
}

async function findEvidocWorkflowWarnings(root: string): Promise<string[]> {
  const workflowsRoot = join(root, ".github", "workflows");
  let entries: string[];
  try {
    entries = await readdir(workflowsRoot);
  } catch {
    return [];
  }

  const warnings: string[] = [];
  const defaultBranch = await readGithubEventDefaultBranch();

  for (const entry of entries.sort()) {
    if (!entry.endsWith(".yml") && !entry.endsWith(".yaml")) continue;
    const workflowPath = `.github/workflows/${entry}`;
    let text: string;
    try {
      text = await readFile(join(root, workflowPath), "utf8");
    } catch {
      continue;
    }
    const detection = await detectRepositoryEvidocWorkflowText(root, text);
    if (detection.matches) {
      warnings.push(...evidocWorkflowWarnings(workflowPath, text, defaultBranch));
      for (const action of detection.localActions) {
        warnings.push(...evidocWorkflowWarnings(action.path, action.text, undefined));
      }
    }
  }

  return warnings;
}

async function readGithubEventDefaultBranch(): Promise<string | undefined> {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) return undefined;
  try {
    const event = JSON.parse(await readFile(eventPath, "utf8")) as { repository?: { default_branch?: unknown } };
    return sanitizeBranchName(
      typeof event.repository?.default_branch === "string" ? event.repository.default_branch : undefined
    );
  } catch {
    return undefined;
  }
}

function sanitizeBranchName(value: string | undefined): string | undefined {
  const branch = value?.trim();
  if (!branch || !isSafeBranchName(branch)) return undefined;
  return branch;
}

function isSafeBranchName(branch: string): boolean {
  if (branch === "@" || branch.startsWith("/") || branch.endsWith("/") || branch.endsWith(".")) return false;
  if (branch.includes("..") || branch.includes("//") || branch.includes("@{")) return false;
  if (branch.split("/").some((part) => part.startsWith(".") || part.endsWith(".lock"))) return false;
  return !/[\x00-\x20\x7f~^:?*[\]\\`]/.test(branch);
}

export function parseFailOn(value: string | undefined): FailOn {
  return parseFailOnPolicy(value, "review_needed");
}
