#!/usr/bin/env node
import { execFile } from "node:child_process";
import { realpathSync } from "node:fs";
import { access, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import {
  checkRepositories,
  checkRepository,
  createAgentRuntimeContract,
  detectRepositoryEvidocWorkflowText,
  evidocWorkflowWarnings,
  fingerprintFileContent,
  readFindingDocuments,
  readRepository,
  resolveExistingPathInsideRoot
} from "@handong66/evidoc-core";
import type { AgentRuntimeContract, DriftFinding, EvidocConfig } from "@handong66/evidoc-core";
import { renderDashboardHtml } from "@handong66/evidoc-dashboard";
import { buildDriftGraph } from "@handong66/evidoc-graph";
import { runGithubAction } from "@handong66/evidoc-github-action";
import {
  createDefaultEvidocConfig,
  defaultGithubWorkflow,
  detectRepositoryDefaultBranch,
  detectRepositoryPushBranches,
  enableLocalGitGate,
  ensureLocalHistoryGitignore,
  inspectLocalGitGate,
  scanLocalAppRepositories,
  scaffoldRepository,
  type ScaffoldFeature,
  startLocalAppServer
} from "@handong66/evidoc-local-app";
import { listMcpTools } from "@handong66/evidoc-mcp-server";
import { applyPatchProposal, createPatchProposals, validatePatchProposal } from "@handong66/evidoc-patcher";
import type { PatchProposal } from "@handong66/evidoc-patcher";
import { formatTextReport } from "@handong66/evidoc-reports";

type FailOn = "none" | "broken" | "review_needed";
type Command =
  | "agent-eval"
  | "action"
  | "app"
  | "check"
  | "dashboard"
  | "demo"
  | "diagnose"
  | "diff"
  | "draft"
  | "explain"
  | "fix"
  | "guard"
  | "graph"
  | "help"
  | "doctor"
  | "init"
  | "index"
  | "mcp-tools"
  | "multi"
  | "recipes"
  | "serve"
  | "validate"
  | "verify";

const execFileAsync = promisify(execFile);

export interface CliIO {
  cwd: string;
  stdout: (chunk: string) => void;
  stderr: (chunk: string) => void;
  forceApp?: boolean;
}

export async function runCli(args: string[], io: Partial<CliIO> = {}): Promise<number> {
  const resolved: CliIO = {
    cwd: io.cwd ?? process.cwd(),
    stdout: io.stdout ?? ((chunk) => process.stdout.write(chunk)),
    stderr: io.stderr ?? ((chunk) => process.stderr.write(chunk))
  };

  const defaultMode = resolveDefaultMode(args, io);
  const parsed = parseArgs(args, defaultMode.command);
  if (parsed.unknownOptions && parsed.unknownOptions.length > 0) {
    resolved.stderr(`Unknown option: ${parsed.unknownOptions.join(", ")}\n\n${helpText()}`);
    return 2;
  }
  const targetRoot =
    parsed.roots.length > 0 && parsed.command !== "app" && parsed.command !== "serve" && parsed.command !== "multi"
      ? resolve(resolved.cwd, parsed.roots[0])
      : resolved.cwd;
  if ((parsed.command === "app" || parsed.command === "serve") && defaultMode.once) {
    parsed.once = true;
    parsed.noOpen = true;
  }

  if (parsed.command === "help") {
    resolved.stdout(helpText());
    return 0;
  }

  try {
    if (parsed.command === "app" || parsed.command === "serve") {
      const roots = parsed.roots.length > 0 ? parsed.roots : [resolved.cwd];
      if (parsed.once) {
        const state = await scanLocalAppRepositories(roots, { autoInit: true, writeHistory: true });
        resolved.stdout(parsed.json ? `${JSON.stringify(state, null, 2)}\n` : formatLocalAppText(state));
        return shouldFail(
          {
            broken: state.summary.broken,
            reviewNeeded: state.summary.reviewNeeded
          },
          parsed.failOn
        )
          ? 1
          : 0;
      }

      const app = await startLocalAppServer({
        roots,
        port: parsed.port,
        openBrowser: !parsed.noOpen,
        watch: parsed.watch,
        autoInit: true,
        writeHistory: true
      });
      resolved.stdout(`Evidoc Local App: ${app.url}\n`);
      return 0;
    }

    if (parsed.command === "demo") {
      const demoRoot = await createDemoRepository();
      if (parsed.once || parsed.json) {
        const state = await scanLocalAppRepositories([demoRoot], { autoInit: true, writeHistory: true });
        resolved.stdout(parsed.json ? `${JSON.stringify(state, null, 2)}\n` : formatLocalAppText(state));
        return 0;
      }

      const app = await startLocalAppServer({
        roots: [demoRoot],
        port: parsed.port,
        openBrowser: !parsed.noOpen,
        watch: false,
        autoInit: true,
        writeHistory: true
      });
      resolved.stdout(`Evidoc demo app: ${app.url}\n`);
      return 0;
    }

    if (parsed.command === "multi") {
      const roots = parsed.roots.length > 0 ? parsed.roots : [resolved.cwd];
      const aggregate = await checkRepositories(roots);
      resolved.stdout(parsed.json ? `${JSON.stringify(aggregate, null, 2)}\n` : formatMultiText(aggregate));
      return shouldFail(aggregate.summary, parsed.failOn) ? 1 : 0;
    }

    if (parsed.command === "init") {
      const result = await initializeRepository(targetRoot, {
        force: parsed.force,
        githubAction: !parsed.noAction && !parsed.localGit,
        localGit: parsed.localGit,
        installHooks: parsed.installHooks,
        withFeatures: parsed.withFeatures
      });
      resolved.stdout(formatInitResult(result, targetRoot));
      return 0;
    }

    if (parsed.command === "doctor") {
      const result = await inspectOnboarding(targetRoot);
      resolved.stdout(formatDoctorResult(result, targetRoot));
      return result.ready ? 0 : 1;
    }

    if (parsed.command === "guard") {
      const event = parseGuardEvent(parsed.event);
      const failOn = resolveGuardFailOn(parsed.failOn, event, parsed.failOnExplicit);
      const result = await runLocalGitGuard(targetRoot, {
        event,
        scope: parseGuardScope(parsed.scope, event),
        since: parsed.since,
        failOn
      });
      resolved.stdout(parsed.json ? `${JSON.stringify(result, null, 2)}\n` : formatLocalGitGuardText(result));
      return shouldFail(result.report.summary, failOn) ? 1 : 0;
    }

    if (parsed.command === "verify") {
      if (!parsed.instructions) {
        resolved.stderr("verify currently requires --instructions.\n");
        return 1;
      }

      const report = await checkRepository(targetRoot);
      const verification = createInstructionVerificationReport(report);
      resolved.stdout(
        parsed.json ? `${JSON.stringify(verification, null, 2)}\n` : formatInstructionVerificationText(verification)
      );
      return shouldFail(verification.summary, parsed.failOn) ? 1 : 0;
    }

    if (parsed.command === "agent-eval") {
      const report = await checkRepository(targetRoot);
      const documents = await readFindingDocuments(targetRoot, report);
      const proposals = createPatchProposals(report, documents);
      const evaluation = createAgentEvaluationReport(report, proposals);
      resolved.stdout(parsed.json ? `${JSON.stringify(evaluation, null, 2)}\n` : formatAgentEvaluationText(evaluation));
      return 0;
    }

    if (parsed.command === "graph") {
      const report = await checkRepository(targetRoot);
      const graph = buildDriftGraph(report);
      resolved.stdout(`${JSON.stringify(graph, null, 2)}\n`);
      return 0;
    }

    if (parsed.command === "index") {
      const snapshot = await readRepository(targetRoot);
      resolved.stdout(
        `${JSON.stringify(
          {
            root: snapshot.root,
            files: [...snapshot.files],
            documents: snapshot.documents.map(({ path, kind, lineCount }) => ({
              path,
              kind,
              lineCount
            })),
            expectedPackageManager: snapshot.expectedPackageManager,
            apiOperations: snapshot.apiOperations
          },
          null,
          2
        )}\n`
      );
      return 0;
    }

    if (parsed.command === "dashboard") {
      const report = await checkRepository(targetRoot);
      const html = renderDashboardHtml(report);
      if (parsed.out) {
        await mkdir(dirname(parsed.out), { recursive: true });
        await writeFile(parsed.out, html, "utf8");
        resolved.stdout(`Wrote ${parsed.out}\n`);
      } else {
        resolved.stdout(html);
      }
      return shouldFail(report.summary, parsed.failOn) ? 1 : 0;
    }

    if (parsed.command === "diagnose") {
      const report = await checkRepository(targetRoot);
      const documents = await readFindingDocuments(targetRoot, report);
      const proposals = createPatchProposals(report, documents);
      const diagnosis = createDiagnosis(report, proposals);
      resolved.stdout(parsed.json ? `${JSON.stringify(diagnosis, null, 2)}\n` : formatDiagnosisText(diagnosis));
      return 0;
    }

    if (parsed.command === "diff") {
      const diff = await createDiffImpactReport(targetRoot, parsed.since);
      resolved.stdout(parsed.json ? `${JSON.stringify(diff, null, 2)}\n` : formatDiffText(diff));
      return shouldFail(diff.report.summary, parsed.failOn) ? 1 : 0;
    }

    if (parsed.command === "draft") {
      const report = await checkRepository(targetRoot);
      const documents = await readFindingDocuments(targetRoot, report);
      const proposals = createPatchProposals(report, documents);
      resolved.stdout(`${JSON.stringify(proposals, null, 2)}\n`);
      return 0;
    }

    if (parsed.command === "fix") {
      if (parsed.write && !parsed.safeOnly) {
        resolved.stderr("fix --write requires --safe because only deterministic safe fixes may be applied automatically.\n");
        return 1;
      }

      const report = await checkRepository(targetRoot);
      const documents = await readFindingDocuments(targetRoot, report);
      const allProposals = createPatchProposals(report, documents);
      const proposals = allProposals.filter((proposal) =>
        parsed.safeOnly ? proposal.classification === "safe" : proposal.classification !== "blocked"
      );
      if (!parsed.write) {
        const preview = { mode: "preview", proposals };
        resolved.stdout(parsed.json ? `${JSON.stringify(preview, null, 2)}\n` : formatFixText(preview));
        return 0;
      }

      const applied = [];
      const appliedFindingIds = new Set<string>();
      const maxAttempts = Math.max(100, report.findings.length * 2 + 10);
      let truncated = false;
      for (let attempts = 0; attempts < maxAttempts; attempts += 1) {
        const currentReport = await checkRepository(targetRoot);
        const currentDocuments = await readFindingDocuments(targetRoot, currentReport);
        const currentProposals = createPatchProposals(currentReport, currentDocuments).filter((proposal) =>
          parsed.safeOnly ? proposal.classification === "safe" : proposal.classification !== "blocked"
        );
        const nextSafeProposal = currentProposals.find((proposal) => {
          return proposal.classification === "safe" && !appliedFindingIds.has(proposal.findingId);
        });
        if (!nextSafeProposal) break;
        applied.push(await applyPatchProposal(targetRoot, nextSafeProposal, { allowWrites: true }));
        appliedFindingIds.add(nextSafeProposal.findingId);
        truncated = attempts + 1 >= maxAttempts;
      }
      if (truncated) {
        resolved.stderr(`Evidoc stopped after ${maxAttempts} safe fix attempts; re-run fix to continue.\n`);
      }
      const finalReport = await checkRepository(targetRoot);
      const finalDocuments = await readFindingDocuments(targetRoot, finalReport);
      const skipped = createPatchProposals(finalReport, finalDocuments).filter(
        (proposal) => proposal.classification !== "safe"
      ).length;
      const result = { mode: "write", applied, skipped, truncated, postFixSummary: finalReport.summary };
      resolved.stdout(parsed.json ? `${JSON.stringify(result, null, 2)}\n` : formatFixText(result));
      return 0;
    }

    if (parsed.command === "explain") {
      const report = await checkRepository(targetRoot);
      const selector = parsed.operands[0] ?? "0";
      const finding =
        /^\d+$/.test(selector)
          ? report.findings[Number.parseInt(selector, 10)]
          : report.findings.find((candidate) => candidate.id === selector);
      if (!finding) {
        resolved.stderr(`No Evidoc finding matched ${selector}.\n`);
        return 1;
      }
      resolved.stdout(parsed.json ? `${JSON.stringify(finding, null, 2)}\n` : `${finding.message}\n`);
      return 0;
    }

    if (parsed.command === "validate") {
      if (!parsed.proposal) {
        resolved.stderr("validate requires --proposal path.\n");
        return 1;
      }

      const report = await checkRepository(targetRoot);
      const proposalInput = JSON.parse(await readFile(parsed.proposal, "utf8"));
      const validation = Array.isArray(proposalInput)
        ? validatePatchProposals(proposalInput, report)
        : validatePatchProposal(proposalInput, report);
      resolved.stdout(
        parsed.json
          ? `${JSON.stringify(validation, null, 2)}\n`
          : validation.ok
            ? "patch proposal is valid\n"
            : `${validation.errors.join("\n")}\n`
      );
      return validation.ok ? 0 : 1;
    }

    if (parsed.command === "mcp-tools") {
      resolved.stdout(`${JSON.stringify(listMcpTools(), null, 2)}\n`);
      return 0;
    }

    if (parsed.command === "recipes") {
      const recipes = createCiRecipes(parsed.target ?? "all");
      resolved.stdout(parsed.json ? `${JSON.stringify(recipes, null, 2)}\n` : formatCiRecipes(recipes));
      return 0;
    }

    if (parsed.command === "action") {
      const changedFiles = parsed.changedOnly ? await readChangedScanFiles(targetRoot, parsed.since) : undefined;
      const result = await runGithubAction({ cwd: targetRoot, failOn: parsed.failOn, changedFiles });
      await writeOptional(parsed.summary, result.prComment);
      await writeOptional(parsed.sarif, result.sarif);
      await writeOptional(parsed.annotations, result.annotations);
      await writeOptional(parsed.result, JSON.stringify(result.report, null, 2));
      if (!parsed.annotations && result.annotations) {
        resolved.stdout(`${result.annotations}\n`);
      }
      resolved.stdout(result.markdownSummary);
      return result.exitCode;
    }

    const changedImpact = parsed.changedOnly ? await createChangedImpact(targetRoot, parsed.since) : undefined;
    const report = await checkRepository(targetRoot, {
      changedFiles: changedImpact?.affectedDocuments,
      changedSourceFiles: changedImpact?.changedFiles,
      undocumentedChangedFiles: changedImpact?.undocumentedChangedFiles
    });
    resolved.stdout(parsed.json ? `${JSON.stringify(report, null, 2)}\n` : formatTextReport(report));
    return shouldFail(report.summary, parsed.failOn) ? 1 : 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    resolved.stderr(`Evidoc failed: ${message}\n`);
    return 1;
  }
}

function resolveDefaultMode(args: string[], io: Partial<CliIO>): { command: Command; once: boolean } {
  if (io.forceApp) return { command: "app", once: false };
  if (args.some((arg) => isCommand(arg))) return { command: "check", once: false };
  if (args.some(isLocalAppFlag)) return { command: "app", once: false };
  if (args.length > 0) return { command: "check", once: false };
  if (io.stdout === undefined && process.stdout.isTTY) return { command: "app", once: false };
  return { command: "app", once: true };
}

function isLocalAppFlag(arg: string): boolean {
  return (
    arg === "--once" ||
    arg === "--no-open" ||
    arg === "--watch" ||
    arg === "--port" ||
    arg.startsWith("--port=")
  );
}

function parseArgs(args: string[], defaultCommand: Command = "check"): {
  command: Command;
  json: boolean;
  failOn: FailOn;
  failOnExplicit: boolean;
  format?: string;
  out?: string;
  port?: number;
  proposal?: string;
  result?: string;
  sarif?: string;
  since?: string;
  event?: string;
  scope?: string;
  target?: string;
  summary?: string;
  annotations?: string;
  changedOnly: boolean;
  force: boolean;
  instructions: boolean;
  installHooks: boolean;
  localGit: boolean;
  noAction: boolean;
  noOpen: boolean;
  once: boolean;
  safeOnly: boolean;
  yes: boolean;
  watch: boolean;
  write: boolean;
  operands: string[];
  roots: string[];
  unknownOptions?: string[];
  withFeatures: ScaffoldFeature[];
} {
  if (args.includes("--help") || args.includes("-h")) {
    return {
      command: "help",
      json: false,
      failOn: "none",
      failOnExplicit: false,
      changedOnly: false,
      force: false,
      instructions: false,
      installHooks: false,
      localGit: false,
      noAction: false,
      noOpen: false,
      once: false,
      safeOnly: false,
      yes: false,
      watch: false,
      write: false,
      operands: [],
      roots: [],
      withFeatures: []
    };
  }

  const first = args.find((arg) => !arg.startsWith("-"));
  const command = isCommand(first) ? first : defaultCommand;
  const normalized = normalizeOptionAliases(args).filter((arg) => arg !== command && arg !== "--worktree");

  return {
    command,
    json: normalized.includes("--json"),
    failOn: parseFailOn(normalized),
    failOnExplicit: hasFailOnOption(normalized),
    format: readOption(normalized, "--format"),
    out: readOption(normalized, "--out"),
    port: parsePort(readOption(normalized, "--port")),
    proposal: readOption(normalized, "--proposal"),
    result: readOption(normalized, "--result"),
    sarif: readOption(normalized, "--sarif"),
    since: readOption(normalized, "--since"),
    event: readOption(normalized, "--event"),
    scope: readOption(normalized, "--scope"),
    target: readOption(normalized, "--target"),
    summary: readOption(normalized, "--summary"),
    annotations: readOption(normalized, "--annotations"),
    changedOnly: normalized.includes("--changed-only"),
    force: normalized.includes("--force"),
    instructions: normalized.includes("--instructions"),
    installHooks: normalized.includes("--install-hooks"),
    localGit: normalized.includes("--local-git"),
    noAction: normalized.includes("--no-action"),
    noOpen: normalized.includes("--no-open"),
    once: normalized.includes("--once"),
    safeOnly: normalized.includes("--safe"),
    yes: normalized.includes("--yes"),
    watch: normalized.includes("--watch"),
    write: normalized.includes("--write"),
    operands: readOperands(normalized),
    roots: readRepeatedOption(normalized, "--root"),
    unknownOptions: findUnknownOptions(normalized),
    withFeatures: parseScaffoldFeatures(readRepeatedOption(normalized, "--with"))
  };
}

function normalizeOptionAliases(args: string[]): string[] {
  return args.map((arg) => {
    if (arg === "--pr-comment-file") return "--summary";
    if (arg.startsWith("--pr-comment-file=")) return `--summary=${arg.slice("--pr-comment-file=".length)}`;
    if (arg === "--annotations-file") return "--annotations";
    if (arg.startsWith("--annotations-file=")) return `--annotations=${arg.slice("--annotations-file=".length)}`;
    return arg;
  });
}

function findUnknownOptions(args: string[]): string[] {
  const knownBooleanFlags = new Set([
    "--changed-only",
    "--force",
    "--instructions",
    "--install-hooks",
    "--json",
    "--local-git",
    "--no-action",
    "--no-open",
    "--once",
    "--safe",
    "--watch",
    "--worktree",
    "--write",
    "--yes"
  ]);
  const knownValueFlags = new Set([
    "--annotations",
    "--fail-on",
    "--event",
    "--format",
    "--out",
    "--port",
    "--proposal",
    "--result",
    "--root",
    "--sarif",
    "--since",
    "--scope",
    "--summary",
    "--target",
    "--with"
  ]);
  const unknown: string[] = [];
  for (const arg of args) {
    if (!arg.startsWith("--")) continue;
    const flag = arg.includes("=") ? arg.slice(0, arg.indexOf("=")) : arg;
    if (!knownBooleanFlags.has(flag) && !knownValueFlags.has(flag)) {
      unknown.push(flag);
    }
  }
  return [...new Set(unknown)];
}

function parseFailOn(args: string[]): FailOn {
  const inline = args.find((arg) => arg.startsWith("--fail-on="));
  const value = inline?.slice("--fail-on=".length);
  if (value === "broken" || value === "review_needed" || value === "none") {
    return value;
  }

  const flagIndex = args.indexOf("--fail-on");
  const next = flagIndex >= 0 ? args[flagIndex + 1] : undefined;
  if (next === "broken" || next === "review_needed" || next === "none") {
    return next;
  }

  return "none";
}

function hasFailOnOption(args: string[]): boolean {
  return args.some((arg) => arg === "--fail-on" || arg.startsWith("--fail-on="));
}

function resolveGuardFailOn(failOn: FailOn, event: LocalGitGuardEvent, explicit: boolean): FailOn {
  if (explicit || event === "manual") return failOn;
  return "review_needed";
}

function parsePort(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const port = Number.parseInt(value, 10);
  if (!Number.isInteger(port) || port < 0 || port > 65535) return undefined;
  return port;
}

function shouldFail(
  summary: { broken: number; reviewNeeded: number },
  failOn: FailOn
): boolean {
  if (failOn === "none") return false;
  if (failOn === "broken") return summary.broken > 0;
  return summary.broken > 0 || summary.reviewNeeded > 0;
}

function helpText(): string {
  return `Evidoc

Usage:
  evidoc agent-eval [--root path] [--json]
  evidoc init --yes [--root path] [--force] [--no-action] [--local-git] [--install-hooks] [--with features]
  evidoc
  evidoc app [--root path...] [--port 4321] [--watch] [--no-open] [--fail-on=none|broken|review_needed]
  evidoc serve [--root path...] [--port 4321] [--watch] [--no-open] [--fail-on=none|broken|review_needed]
  evidoc doctor [--root path]
  evidoc demo [--json] [--once] [--no-open]
  evidoc check [--root path] [--json] [--worktree] [--fail-on=none|broken|review_needed]
  evidoc diagnose [--root path] [--json]
  evidoc diff [--root path] [--since ref] [--json] [--fail-on=none|broken|review_needed]
  evidoc fix [--root path] [--safe] [--write] [--json]
  evidoc guard [--root path] [--event pre-commit|pre-push|manual] [--scope staged|worktree] [--since ref] [--json] [--fail-on=none|broken|review_needed]
  evidoc verify --instructions [--root path] [--json] [--fail-on=none|broken|review_needed]
  evidoc index [--root path] --json
  evidoc explain <finding-id-or-index> [--root path] [--json]
  evidoc graph [--root path] --json
  evidoc dashboard [--root path] [--out path]
  evidoc draft [--root path] --json
  evidoc validate --proposal path [--json]
  evidoc multi --root path --root path [--json]
  evidoc recipes [--target all|gitlab|jenkins|gitea|buildkite] [--json]
  evidoc mcp-tools
  evidoc action [--format=github] [--fail-on=none|broken|review_needed] [--changed-only] [--since ref] [--sarif path] [--summary path] [--annotations path] [--result path]

Commands:
  agent-eval  print the agent A/B benchmark and coverage pack for Codex, Claude Code, and OpenCode
  evidoc  one-click local app; non-interactive runs a one-shot app scan
  app         auto-init, scan, start the local Web GUI, and open the browser
  serve       explicit local GUI server entry; supports multiple --root values
  init        write a minimal .evidoc config and GitHub Action workflow
  demo        open a built-in sample in the local GUI without touching the current repository
  doctor      check whether this repository is ready to run Evidoc
  check       scan the current repository for documentation drift evidence
  diagnose    convert findings into AI-actionable repair prompts
  diff        report changed files, affected docs, and drift findings since a git ref
  index       print a machine-readable repository index
  explain     print one finding with its evidence
  fix         apply or preview safe deterministic documentation fixes
  guard       run the local Git documentation-drift gate and write local reports
              hook events default to --fail-on=review_needed unless --fail-on is explicit
  verify     run targeted verification surfaces such as agent instruction checks
  graph       print the document/source/rule graph as JSON
  dashboard   render a self-contained HTML dashboard
  draft       print evidence-bound patch proposals
  validate    validate a patch proposal against current evidence
  multi       scan multiple repositories and aggregate results
  recipes     print local/inner-source CI recipes that call the Evidoc CLI
  mcp-tools   list Evidoc MCP tools
  action      run the same scanner contract used by the GitHub Action

Options:
  --json      print structured JSON where supported
  --worktree  accepted alias for current working tree scan
  --fail-on   choose exit-code policy for CI usage
  --format    accepted compatibility flag for copied action commands; current action output is GitHub-oriented
  --once      auto-init, scan, record app state, and exit without keeping the GUI server alive
  --no-open   start the local app without opening a browser
  --port      choose local app port; use 0 for a random free port
  --root      target repository path; single-repository commands use the first value, app/serve/multi support multiple values
  --watch     keep refreshing local app scan state while the server is running
  --yes       run init non-interactively; accepted for copy-paste setup
  --force     replace generated init files
  --local-git initialize local Git hooks instead of a GitHub Actions workflow
  --install-hooks set repo-local git config core.hooksPath=.githooks
  --with      comma-separated scaffolders for init: agents,hooks,ci,badge,llms
  --event     local Git guard event: pre-commit, pre-push, or manual
  --scope     local Git guard changed-file scope: staged or worktree
  --target    recipes target: all, gitlab, jenkins, gitea, or buildkite
  --instructions run verify against AGENTS/CLAUDE/Cursor/Copilot instruction files
  --changed-only scan changed Markdown documents plus docs affected by changed source, API, or package-manager evidence
  --since     git ref used by diff and --changed-only
  --safe      restrict fix to deterministic safe proposals
  --write     allow fix to write files
  --no-action skip GitHub Action workflow generation during init
`;
}

interface InitResult {
  config: FileWriteResult;
  historyIgnore: FileWriteResult;
  workflow?: FileWriteResult;
  localGit?: {
    files: FileWriteResult[];
    installed: boolean;
    hooksPath?: string;
  };
  scaffolds: Array<{ feature: ScaffoldFeature; files: FileWriteResult[] }>;
}

interface FileWriteResult {
  path: string;
  status: "created" | "updated" | "kept";
}

interface OnboardingInspection {
  ready: boolean;
  configExists: boolean;
  configValid: boolean;
  workflowExists: boolean;
  workflowPath?: string;
  localGit: Awaited<ReturnType<typeof inspectLocalGitGate>>;
  agentSurfaces: string[];
  issues: string[];
  warnings: string[];
}

async function initializeRepository(
  root: string,
  options: { force: boolean; githubAction: boolean; localGit: boolean; installHooks: boolean; withFeatures: ScaffoldFeature[] }
): Promise<InitResult> {
  const configPath = ".evidoc/config.json";
  const workflowPath = ".github/workflows/evidoc.yml";
  const config = await createDefaultEvidocConfig(root);

  const result: InitResult = {
    config: await writeGeneratedFile(root, configPath, `${JSON.stringify(config, null, 2)}\n`, options.force),
    historyIgnore: await ensureLocalHistoryGitignore(root),
    scaffolds: []
  };

  if (options.githubAction) {
    result.workflow = await writeGeneratedFile(
      root,
      workflowPath,
      defaultGithubWorkflow({ pushBranches: await detectRepositoryPushBranches(root) }),
      options.force
    );
  }

  if (options.localGit) {
    result.localGit = await enableLocalGitGate(root, {
      force: options.force,
      installHooks: options.installHooks
    });
  }

  if (options.withFeatures.length > 0) {
    result.scaffolds = await scaffoldRepository(root, {
      features: options.withFeatures,
      force: options.force
    });
  }

  return result;
}

async function writeGeneratedFile(
  root: string,
  path: string,
  content: string,
  force: boolean
): Promise<FileWriteResult> {
  const target = join(root, path);
  const alreadyExists = await exists(root, path);
  if (alreadyExists && !force) {
    return { path, status: "kept" };
  }

  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content, "utf8");
  return { path, status: alreadyExists ? "updated" : "created" };
}

async function inspectOnboarding(root: string): Promise<OnboardingInspection> {
  const config = await inspectConfig(root);
  const workflow = await findEvidocWorkflow(root);
  const localGit = await inspectLocalGitGate(root);
  const issues = [...config.issues];
  const hasGate = workflow !== undefined || localGit.ready;

  return {
    ready: config.exists && config.valid && hasGate && issues.length === 0,
    configExists: config.exists,
    configValid: config.valid,
    workflowExists: workflow !== undefined,
    workflowPath: workflow?.path,
    localGit,
    agentSurfaces: await detectAgentSurfaces(root),
    issues,
    warnings: workflow?.warnings ?? []
  };
}

function formatInitResult(result: InitResult, root: string): string {
  const lines = [
    "Evidoc initialized",
    "",
    formatFileWrite("config", result.config)
  ];
  lines.push(formatFileWrite("local history ignore", result.historyIgnore));

  if (result.workflow) {
    lines.push(formatFileWrite("GitHub Action", result.workflow));
  } else {
    lines.push("GitHub Action: skipped");
  }

  if (result.localGit) {
    const statuses = result.localGit.files.map((file) => `${file.status} ${file.path}`).join(", ");
    lines.push(`Local Git Gate: ${statuses}`);
    lines.push(
      result.localGit.installed
        ? "Local Git hooksPath: installed .githooks"
        : "Local Git hooksPath: run `git config core.hooksPath .githooks` to activate hooks"
    );
  }

  for (const scaffold of result.scaffolds) {
    for (const file of scaffold.files) {
      lines.push(formatFileWrite(`scaffold ${scaffold.feature}`, file));
    }
  }

  const addTargets = [
    result.config.path,
    result.historyIgnore.path,
    result.workflow?.path,
    ...(result.localGit?.files.map((file) => file.path) ?? []),
    ...result.scaffolds.flatMap((scaffold) => scaffold.files.map((file) => file.path))
  ].filter((path): path is string => path !== undefined);
  lines.push(
    "",
    "Next:",
    result.localGit
      ? "  git config core.hooksPath .githooks"
      : `  npx evidoc check --root ${quoteShellArg(root)} --fail-on=review_needed`,
    result.localGit
      ? "  npx evidoc guard --event pre-commit --root " + quoteShellArg(root)
      : "",
    "Source checkout fallback:",
    result.localGit
      ? "  npm run evidoc -- guard --event pre-commit --root " + quoteShellArg(root)
      : `  npm run evidoc -- check --root ${quoteShellArg(root)} --fail-on=review_needed`,
    `  git add ${[...new Set(addTargets)].join(" ")}`
  );
  return `${lines.join("\n")}\n`;
}

function formatFileWrite(label: string, result: FileWriteResult): string {
  if (result.status === "kept") return `${label}: kept existing ${result.path}`;
  return `${label}: ${result.status} ${result.path}`;
}

function formatDoctorResult(result: OnboardingInspection, root: string): string {
  const status = result.ready
    ? "ready"
    : !result.configExists && !result.workflowExists && !result.localGit.ready
      ? "not initialized"
      : "not ready";
  const lines = [
    "Evidoc doctor",
    "",
    `status: ${status}`,
    `config: ${formatConfigStatus(result)}`,
    `GitHub Action: ${
      result.workflowExists ? `found ${sanitizeCliWarningText(result.workflowPath ?? "")}` : "missing .github/workflows/evidoc.yml"
    }`,
    `Local Git Gate: ${formatLocalGitGateStatus(result.localGit)}`,
    `Agent surfaces: ${result.agentSurfaces.length > 0 ? result.agentSurfaces.join(", ") : "none detected"}`,
    "MCP default: evidoc.agent_scan",
    "MCP status: evidoc.get_drift_status"
  ];

  if (result.issues.length > 0) {
    lines.push("", "Issues:", ...result.issues.map((issue) => `  - ${issue}`));
  }

  if (result.warnings.length > 0) {
    lines.push("", "Warnings:", ...result.warnings.map((warning) => `  - ${sanitizeCliWarningText(warning)}`));
  }

  const localGitIssues = result.localGit.issues ?? [];
  if (shouldShowLocalGitGateIssues(result)) {
    lines.push("", "Local Git Gate issues:", ...localGitIssues.map((issue) => `  - ${issue}`));
  }

  if (!result.ready) {
    lines.push(
      "",
      "Fix:",
      `  npx evidoc init --yes --root ${quoteShellArg(root)}`,
      `  npx evidoc init --yes --local-git --install-hooks --root ${quoteShellArg(root)}`,
      "Source checkout fallback:",
      `  npm run evidoc -- init --yes --root ${quoteShellArg(root)}`
    );
  } else {
    lines.push(
      "",
      "Next:",
      `  npx evidoc check --root ${quoteShellArg(root)} --fail-on=review_needed`,
      "Source checkout fallback:",
      `  npm run evidoc -- check --root ${quoteShellArg(root)} --fail-on=review_needed`
    );
  }

  return `${lines.join("\n")}\n`;
}

function formatLocalGitGateStatus(localGit: Awaited<ReturnType<typeof inspectLocalGitGate>>): string {
  if (!localGit.isRepository) return "not a git repository";
  if (localGit.ready) return "ready";
  return "not ready";
}

function shouldShowLocalGitGateIssues(result: OnboardingInspection): boolean {
  if (!result.localGit.issues || result.localGit.issues.length === 0) return false;
  if (!result.workflowExists) return true;
  return Boolean(result.localGit.hooksPath || result.localGit.preCommitHook || result.localGit.prePushHook);
}

function sanitizeCliWarningText(value: string): string {
  return value
    .replaceAll("```", "` ` `")
    .replace(/[\r\n]+/g, " ")
    .replace(/([\\[\]()<>])/g, "\\$1");
}

function quoteShellArg(value: string): string {
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function formatConfigStatus(result: OnboardingInspection): string {
  if (!result.configExists) return "missing .evidoc/config.json";
  if (!result.configValid) return "invalid .evidoc/config.json";
  return "found .evidoc/config.json";
}

async function inspectConfig(root: string): Promise<{ exists: boolean; valid: boolean; issues: string[] }> {
  const path = ".evidoc/config.json";
  if (!(await exists(root, path))) {
    return { exists: false, valid: false, issues: [] };
  }

  let config: EvidocConfig;
  try {
    config = JSON.parse(await readFile(join(root, path), "utf8")) as EvidocConfig;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      exists: true,
      valid: false,
      issues: [`invalid JSON in ${path}: ${detail}`]
    };
  }

  const issues: string[] = [];
  issues.push(...(await missingConfiguredPaths(root, "docRoots", config.docRoots)));
  issues.push(...(await missingConfiguredPaths(root, "apiSpecPaths", config.apiSpecPaths)));

  return {
    exists: true,
    valid: issues.length === 0,
    issues
  };
}

async function detectAgentSurfaces(root: string): Promise<string[]> {
  const candidates = [
    "AGENTS.md",
    "CLAUDE.md",
    ".cursor/rules/evidoc.md",
    ".github/copilot-instructions.md",
    "llms.txt"
  ];
  const detected: string[] = [];
  for (const candidate of candidates) {
    if (await exists(root, candidate)) detected.push(candidate);
  }
  return detected;
}

async function createDemoRepository(): Promise<string> {
  const container = await mkdtemp(join(tmpdir(), "evidoc-demo-"));
  const root = join(container, "evidoc-demo");
  await mkdir(root, { recursive: true });
  await writeGeneratedFile(
    root,
    "package.json",
    `${JSON.stringify({ name: "evidoc-demo", packageManager: "pnpm@10.0.0", scripts: { test: "node --test" } }, null, 2)}\n`,
    true
  );
  await writeGeneratedFile(
    root,
    "README.md",
    [
      "# Evidoc Demo",
      "",
      "Run `npm missing` before opening a PR.",
      "",
      "Legacy code path: `src/removed.ts`.",
      "",
      "Endpoint: `GET /v1/ghost`.",
      ""
    ].join("\n"),
    true
  );
  await writeGeneratedFile(root, "AGENTS.md", "Always use `npm test`.\nProject policy: `docs/missing.md`.\n", true);
  await writeGeneratedFile(root, "CLAUDE.md", "Never use `npm test`.\n", true);
  await writeGeneratedFile(
    root,
    "openapi.json",
    `${JSON.stringify({ openapi: "3.1.0", paths: { "/v1/users": { get: { responses: { "200": { description: "ok" } } } } } }, null, 2)}\n`,
    true
  );
  return root;
}

interface DiagnosisReport {
  root: string;
  scannedAt: string;
  summary: Awaited<ReturnType<typeof checkRepository>>["summary"];
  findings: Array<{
    findingId: string;
    ruleId: string;
    status: string;
    severity: string;
    location: string;
    diagnosis: string;
    risk: string;
    suggestedAction: string;
    patch: {
      classification: string;
      kind: string;
      rationale: string;
    };
    prompt: string;
  }>;
}

interface InstructionVerificationReport {
  root: string;
  scannedAt: string;
  summary: {
    findings: number;
    broken: number;
    reviewNeeded: number;
    healthScore: number;
  };
  findings: DriftFinding[];
}

interface AgentEvaluationReport {
  root: string;
  scannedAt: string;
  benchmark: {
    id: string;
    version: number;
    purpose: string;
  };
  coverage: {
    documentsScanned: number;
    findings: number;
    safeAutoFixCandidates: number;
    reviewCandidates: number;
    blockedCandidates: number;
    instructionFindings: number;
    mcpDefaultTool: string;
  };
  abProtocol: {
    agents: string[];
    control: string;
    treatment: string;
    successCriteria: string[];
  };
  tasks: Array<{
    id: string;
    goal: string;
    controlInput: string;
    treatmentInput: string;
    passCriteria: string[];
  }>;
  privacy: {
    repositoryContentUpload: string;
    telemetry: string;
    notes: string[];
  };
}

function createInstructionVerificationReport(
  report: Awaited<ReturnType<typeof checkRepository>>
): InstructionVerificationReport {
  const findings = report.findings.filter((finding) => finding.ruleId.startsWith("agent_instruction."));
  const broken = findings.filter((finding) => finding.status === "broken").length;
  const reviewNeeded = findings.filter((finding) => finding.status === "review_needed").length;

  return {
    root: report.root,
    scannedAt: report.scannedAt,
    summary: {
      findings: findings.length,
      broken,
      reviewNeeded,
      healthScore: Math.max(0, Math.min(100, 100 - broken * 25 - reviewNeeded * 10))
    },
    findings
  };
}

function createAgentEvaluationReport(
  report: Awaited<ReturnType<typeof checkRepository>>,
  proposals: PatchProposal[]
): AgentEvaluationReport {
  const instructionFindings = report.findings.filter((finding) => finding.ruleId.startsWith("agent_instruction.")).length;
  const mcpDefaultTool = listMcpTools()[0]?.name ?? "evidoc.agent_scan";

  return {
    root: "<redacted-local-repository-root>",
    scannedAt: report.scannedAt,
    benchmark: {
      id: "evidoc-agent-ab-v0",
      version: 0,
      purpose:
        "Compare whether Codex, Claude Code, and OpenCode repair documentation drift more accurately when Evidoc evidence is the first context."
    },
    coverage: {
      documentsScanned: report.summary.documentsScanned,
      findings: report.summary.findings,
      safeAutoFixCandidates: proposals.filter((proposal) => proposal.classification === "safe").length,
      reviewCandidates: proposals.filter((proposal) => proposal.classification === "review").length,
      blockedCandidates: proposals.filter((proposal) => proposal.classification === "blocked").length,
      instructionFindings,
      mcpDefaultTool
    },
    abProtocol: {
      agents: ["codex", "claude-code", "opencode"],
      control:
        "Ask the agent to repair documentation drift from the repository alone, then record files read, files changed, verification commands, and remaining findings.",
      treatment:
        `Ask the agent to start with ${mcpDefaultTool} or \`evidoc diagnose\`, then record the same outcomes.`,
      successCriteria: [
        "agent inspects or uses Evidoc evidence before editing",
        "agent changes only affected documentation or directly required source references",
        "agent does not keep dependency directories, generated agent logs, or speculative artifacts",
        "agent reruns Evidoc and reports remaining broken/review-needed findings"
      ]
    },
    tasks: [
      {
        id: "mcp_default_entrypoint",
        goal: "Validate that agents discover and use one default MCP tool instead of guessing among a tool menu.",
        controlInput: "List repository drift and propose repairs without Evidoc MCP.",
        treatmentInput: `Call ${mcpDefaultTool} first and use its freshness/read-parity bundle.`,
        passCriteria: [
          "the agent uses the default MCP entrypoint first",
          "the agent cites scannedAt/freshness before acting",
          "the agent does not ask for broad repository reads when the evidence bundle is sufficient"
        ]
      },
      {
        id: "read_parity_repair",
        goal: "Measure whether the Evidoc bundle lets the agent stop reading unrelated files.",
        controlInput: "Repair a reported finding from a normal scanner report.",
        treatmentInput: "Repair the same finding from the agent_scan read-parity fields.",
        passCriteria: [
          "the agent reads affected documents and evidence categories only",
          "the final patch is bound to structured evidence",
          "the agent explains missing evidence instead of inventing a fix"
        ]
      },
      {
        id: "safe_fix_accuracy",
        goal: "Measure deterministic safe-fix adoption without automatic merge.",
        controlInput: "Ask the agent to fix command/package-manager drift manually.",
        treatmentInput: "Ask the agent to preview `evidoc fix --safe --json`, apply only safe proposals, and rerun check.",
        passCriteria: [
          "safe proposals are applied only when classification is safe",
          "review or blocked proposals remain human-reviewed",
          "Evidoc post-fix summary is recorded"
        ]
      },
      {
        id: "instruction_surface_consistency",
        goal: "Catch contradictory agent instructions before they reach PR review.",
        controlInput: "Ask the agent to read AGENTS/CLAUDE/Cursor/Copilot guidance manually.",
        treatmentInput: "Ask the agent to run `evidoc verify --instructions --json` first.",
        passCriteria: [
          "agent identifies inconsistent agent guidance",
          "agent updates all relevant instruction surfaces together",
          "agent reruns instruction verification"
        ]
      }
    ],
    privacy: {
      repositoryContentUpload: "never_by_default",
      telemetry: "disabled_by_default",
      notes: [
        "This command emits a local evaluation pack; it does not call external agent providers.",
        "The local repository root is redacted by default so the pack can be shared as an aggregate benchmark artifact.",
        "Teams may publish aggregate benchmark results only after removing repository content and paths."
      ]
    }
  };
}

function formatAgentEvaluationText(report: AgentEvaluationReport): string {
  return [
    "Evidoc agent evaluation",
    "",
    `benchmark ${report.benchmark.id}`,
    `documents_scanned ${report.coverage.documentsScanned}`,
    `findings ${report.coverage.findings}`,
    `safe_auto_fix_candidates ${report.coverage.safeAutoFixCandidates}`,
    `mcp_default ${report.coverage.mcpDefaultTool}`,
    `telemetry ${report.privacy.telemetry}`,
    "",
    "Tasks:",
    ...report.tasks.map((task) => `  - ${task.id}: ${task.goal}`),
    ""
  ].join("\n");
}

function formatInstructionVerificationText(report: InstructionVerificationReport): string {
  const lines = [
    "Evidoc instruction verification",
    "",
    `health_score ${report.summary.healthScore}`,
    `findings     ${report.summary.findings}`,
    `broken       ${report.summary.broken}`,
    `review_needed ${report.summary.reviewNeeded}`,
    ""
  ];

  for (const finding of report.findings) {
    lines.push(
      `${finding.status.padEnd(13)} ${finding.docPath}:${finding.line} ${finding.ruleId}`,
      `  ${finding.message}`,
      `  action: ${finding.suggestedAction}`,
      ""
    );
  }

  return `${lines.join("\n")}\n`;
}

function validatePatchProposals(
  proposals: unknown[],
  report: Awaited<ReturnType<typeof checkRepository>>
): ReturnType<typeof validatePatchProposal> & { proposals: number; results: ReturnType<typeof validatePatchProposal>[] } {
  const results = proposals.map((proposal) => validatePatchProposal(proposal as PatchProposal, report));
  const errors = results.flatMap((result, index) => result.errors.map((error) => `proposal[${index}]: ${error}`));

  return {
    ok: errors.length === 0,
    errors,
    proposals: proposals.length,
    results
  };
}

function createDiagnosis(
  report: Awaited<ReturnType<typeof checkRepository>>,
  proposals: ReturnType<typeof createPatchProposals>
): DiagnosisReport {
  const byFinding = new Map(proposals.map((proposal) => [proposal.findingId, proposal]));
  return {
    root: report.root,
    scannedAt: report.scannedAt,
    summary: report.summary,
    findings: report.findings.map((finding) => {
      const proposal = byFinding.get(finding.id);
      const classification = proposal?.classification ?? "blocked";
      return {
        findingId: finding.id,
        ruleId: finding.ruleId,
        status: finding.status,
        severity: finding.severity,
        location: `${finding.docPath}:${finding.line}`,
        diagnosis: diagnosisForFinding(finding),
        risk: riskForPatchClassification(classification),
        suggestedAction: finding.suggestedAction,
        patch: {
          classification,
          kind: proposal?.kind ?? "human_only",
          rationale: proposal?.rationale ?? "Blocked because no patch proposal was generated."
        },
        prompt: promptForFinding(finding, classification)
      };
    })
  };
}

function diagnosisForFinding(finding: DriftFinding): string {
  return `${finding.message} Evidence: ${finding.evidence
    .map((item) => `${item.kind}:${item.subject} expected=${item.expected ?? "n/a"} actual=${item.actual ?? "n/a"}`)
    .join("; ")}`;
}

function riskForPatchClassification(classification: string): string {
  if (classification === "safe") return "Low mechanical risk, but still review the diff before merging.";
  if (classification === "review") return "Requires human review because wording or intent may change.";
  return "Blocked until a human confirms the missing evidence or expired review decision.";
}

function promptForFinding(finding: DriftFinding, classification: string): string {
  return [
    "You are fixing Evidoc documentation drift.",
    `Finding: ${finding.id}`,
    `Rule: ${finding.ruleId}`,
    `Allowed path: ${finding.docPath}`,
    `Patch classification: ${classification}`,
    "Use only the evidence below. Do not touch unrelated files.",
    "",
    JSON.stringify(
      {
        message: finding.message,
        evidence: finding.evidence,
        suggestedAction: finding.suggestedAction
      },
      null,
      2
    )
  ].join("\n");
}

function formatDiagnosisText(report: DiagnosisReport): string {
  const lines = [
    "Evidoc diagnosis",
    "",
    `health_score ${report.summary.healthScore}`,
    `findings     ${report.summary.findings}`,
    ""
  ];
  for (const finding of report.findings) {
    lines.push(
      `${finding.patch.classification.padEnd(8)} ${finding.location} ${finding.ruleId}`,
      `  ${finding.diagnosis}`,
      `  action: ${finding.suggestedAction}`,
      `  prompt: ${finding.prompt.split("\n")[0]}`,
      ""
    );
  }
  return `${lines.join("\n")}\n`;
}

interface DiffImpactReport {
  root: string;
  since?: string;
  changedFiles: string[];
  affectedDocuments: string[];
  undocumentedChangedFiles: string[];
  report: Awaited<ReturnType<typeof checkRepository>>;
}

type LocalGitGuardEvent = "pre-commit" | "pre-push" | "manual";
type LocalGitGuardScope = "staged" | "worktree";

interface LocalGitGuardResult extends DiffImpactReport {
  event: LocalGitGuardEvent;
  scope: LocalGitGuardScope;
  runtime: AgentRuntimeContract;
  reports: {
    json: string;
    markdown: string;
  };
}

async function createDiffImpactReport(root: string, since: string | undefined): Promise<DiffImpactReport> {
  const impact = await createChangedImpact(root, since);
  return {
    root,
    since,
    changedFiles: impact.changedFiles,
    affectedDocuments: impact.affectedDocuments,
    undocumentedChangedFiles: impact.undocumentedChangedFiles,
    report: await checkRepository(root, {
      changedFiles: impact.affectedDocuments,
      changedSourceFiles: impact.changedFiles,
      undocumentedChangedFiles: impact.undocumentedChangedFiles
    })
  };
}

async function readChangedScanFiles(root: string, since: string | undefined): Promise<string[]> {
  return (await createChangedImpact(root, since)).affectedDocuments;
}

async function createChangedImpact(
  root: string,
  since: string | undefined
): Promise<Pick<DiffImpactReport, "changedFiles" | "affectedDocuments" | "undocumentedChangedFiles">> {
  const changedFiles = await readGitChangedFiles(root, since);
  return createChangedImpactFromFiles(root, changedFiles);
}

async function createChangedImpactFromFiles(
  root: string,
  changedFiles: string[]
): Promise<Pick<DiffImpactReport, "changedFiles" | "affectedDocuments" | "undocumentedChangedFiles">> {
  const snapshot = await readRepository(root);
  const changed = new Set(changedFiles);
  const affected = new Set<string>();
  const undocumentedChangedFiles = new Set(changedFiles.filter((file) => !isMarkdown(file)));
  const changedGlobalEvidence = changedFiles.filter(
    (file) => isPackageManagerEvidenceFile(file) || isApiSpecEvidenceFile(file, snapshot.config)
  );

  if (changedGlobalEvidence.length > 0) {
    for (const document of snapshot.documents) {
      affected.add(document.path);
    }
    for (const file of changedGlobalEvidence) {
      undocumentedChangedFiles.delete(file);
    }
  }

  for (const document of snapshot.documents) {
    if (changed.has(document.path)) {
      affected.add(document.path);
    }
    for (const file of changedFiles) {
      if (!isMarkdown(file) && documentReferencesChangedFile(document.text, file)) {
        affected.add(document.path);
        undocumentedChangedFiles.delete(file);
      }
    }
  }

  const affectedDocuments = [...affected].sort();
  return {
    changedFiles,
    affectedDocuments,
    undocumentedChangedFiles: [...undocumentedChangedFiles].sort()
  };
}

async function runLocalGitGuard(
  root: string,
  options: { event: LocalGitGuardEvent; scope: LocalGitGuardScope; since?: string; failOn: FailOn }
): Promise<LocalGitGuardResult> {
  const changedFiles = await readGitChangedFilesForScope(root, options.scope, options.since);
  const scanRoot = options.scope === "staged" ? await createStagedIndexSnapshot(root) : root;
  try {
    const impact = await createChangedImpactFromFiles(scanRoot, changedFiles);
    const changedFileFingerprints = await readChangedFileFingerprints(root, scanRoot, options.scope, impact.changedFiles);
    const report = await checkRepository(scanRoot, {
      changedFiles: impact.affectedDocuments,
      changedSourceFiles: impact.changedFiles,
      undocumentedChangedFiles: impact.undocumentedChangedFiles
    });
    const exposedReport = { ...report, root };
    const result: LocalGitGuardResult = {
      root,
      since: options.since,
      event: options.event,
      scope: options.scope,
      changedFiles: impact.changedFiles,
      affectedDocuments: impact.affectedDocuments,
      undocumentedChangedFiles: impact.undocumentedChangedFiles,
      report: exposedReport,
      runtime: createAgentRuntimeContract(exposedReport, {
        event: options.event,
        mode: options.event === "manual" ? "advisory" : "blocking",
        scope: options.scope,
        baseline: options.since ?? "HEAD",
        baselineCommit: await resolveRuntimeBaselineCommit(root, options.since ?? "HEAD"),
        changedFiles: impact.changedFiles,
        changedFileFingerprints,
        affectedDocuments: impact.affectedDocuments
      }),
      reports: {
        json: ".evidoc/reports/local-gate.json",
        markdown: ".evidoc/reports/local-gate.md"
      }
    };
    await ensureLocalHistoryGitignore(root);
    await mkdir(join(root, ".evidoc", "reports"), { recursive: true });
    await writeFile(join(root, result.reports.json), `${JSON.stringify(result, null, 2)}\n`, "utf8");
    await writeFile(join(root, result.reports.markdown), formatLocalGitGuardMarkdown(result), "utf8");
    return result;
  } finally {
    if (scanRoot !== root) {
      await rm(scanRoot, { recursive: true, force: true });
    }
  }
}

function parseGuardEvent(value: string | undefined): LocalGitGuardEvent {
  if (value === "pre-commit" || value === "pre-push" || value === "manual") return value;
  return "manual";
}

function parseGuardScope(value: string | undefined, event: LocalGitGuardEvent): LocalGitGuardScope {
  if (value === "staged" || value === "worktree") return value;
  return event === "pre-commit" ? "staged" : "worktree";
}

function formatDiffText(diff: DiffImpactReport): string {
  return [
    "Evidoc diff impact",
    "",
    `changed_files ${diff.changedFiles.length}`,
    `affected_docs ${diff.affectedDocuments.length}`,
    `findings      ${diff.report.summary.findings}`,
    "",
    ...diff.affectedDocuments.map((doc) => `doc ${doc}`),
    ""
  ].join("\n");
}

function formatLocalGitGuardText(result: LocalGitGuardResult): string {
  return [
    "Evidoc local Git gate",
    "",
    `event ${result.event}`,
    `scope ${result.scope}`,
    `changed_files ${result.changedFiles.length}`,
    `affected_docs ${result.affectedDocuments.length}`,
    `findings ${result.report.summary.findings}`,
    `broken ${result.report.summary.broken}`,
    `review_needed ${result.report.summary.reviewNeeded}`,
    `runtime_status ${result.runtime.status}`,
    `runtime_mode ${result.runtime.mode}`,
    `runtime_fingerprint ${result.runtime.fingerprint}`,
    `json_report ${result.reports.json}`,
    `markdown_report ${result.reports.markdown}`,
    "",
    ...result.affectedDocuments.map((doc) => `doc ${doc}`),
    ""
  ].join("\n");
}

function formatLocalGitGuardMarkdown(result: LocalGitGuardResult): string {
  const findingLines =
    result.report.findings.length > 0
      ? result.report.findings.map((finding) => `- ${finding.status} ${finding.ruleId}: ${finding.message}`)
      : ["- No drift findings in this local Git gate scope."];
  return [
    "# Evidoc local Git gate",
    "",
    `- Event: ${result.event}`,
    `- Scope: ${result.scope}`,
    `- Since: ${result.since ?? "HEAD"}`,
    `- Changed files: ${result.changedFiles.length}`,
    `- Affected documents: ${result.affectedDocuments.length}`,
    `- Findings: ${result.report.summary.findings}`,
    `- Broken: ${result.report.summary.broken}`,
    `- Review needed: ${result.report.summary.reviewNeeded}`,
    "",
    "## Agent Runtime Contract",
    "",
    `- Schema: ${result.runtime.schemaVersion}`,
    `- Mode: ${result.runtime.mode}`,
    `- Status: ${result.runtime.status}`,
    `- Fingerprint: ${result.runtime.fingerprint}`,
    `- Dedupe: ${result.runtime.dedupe.strategy}`,
    "",
    "## Runtime findings",
    "",
    ...(result.runtime.findings.length > 0
      ? result.runtime.findings.map((finding) => `- ${finding.fingerprint} ${finding.status} ${finding.ruleId}`)
      : ["- None"]),
    "",
    "## Changed files",
    "",
    ...(result.changedFiles.length > 0 ? result.changedFiles.map((file) => `- ${file}`) : ["- None"]),
    "",
    "## Findings",
    "",
    ...findingLines,
    ""
  ].join("\n");
}

function formatFixText(result: {
  mode: string;
  proposals?: unknown[];
  applied?: unknown[];
  skipped?: number;
  truncated?: boolean;
  postFixSummary?: { findings: number; broken: number; reviewNeeded: number; healthScore?: number };
}): string {
  return [
    "Evidoc fix",
    "",
    `mode    ${result.mode}`,
    `preview ${result.proposals?.length ?? 0}`,
    `applied ${result.applied?.length ?? 0}`,
    `skipped ${result.skipped ?? 0}`,
    `remaining_findings ${result.postFixSummary?.findings ?? "n/a"}`,
    `remaining_broken ${result.postFixSummary?.broken ?? "n/a"}`,
    `remaining_review_needed ${result.postFixSummary?.reviewNeeded ?? "n/a"}`,
    `truncated ${result.truncated ?? false}`,
    ""
  ].join("\n");
}

interface CiRecipe {
  platform: "gitlab" | "jenkins" | "gitea" | "buildkite";
  title: string;
  file: string;
  content: string;
}

function createCiRecipes(target: string): { recipes: CiRecipe[] } {
  const all: CiRecipe[] = [
    {
      platform: "gitlab",
      title: "GitLab CI",
      file: ".gitlab-ci.yml",
      content: [
        "evidoc:",
        "  image: node:22",
        "  script:",
        "    - npm ci",
        "    - export EVIDOC_BASE_BRANCH=\"${CI_MERGE_REQUEST_TARGET_BRANCH_NAME:-main}\"",
        "    - npx evidoc guard --event pre-push --since merge-base:$EVIDOC_BASE_BRANCH --fail-on=review_needed",
        ""
      ].join("\n")
    },
    {
      platform: "jenkins",
      title: "Jenkins",
      file: "Jenkinsfile",
      content: [
        "stage('Evidoc') {",
        "  sh 'npm ci'",
        "  sh 'EVIDOC_BASE_BRANCH=${CHANGE_TARGET:-main} npx evidoc guard --event pre-push --since merge-base:$EVIDOC_BASE_BRANCH --fail-on=review_needed'",
        "}",
        ""
      ].join("\n")
    },
    {
      platform: "gitea",
      title: "Gitea Actions",
      file: ".gitea/workflows/evidoc.yml",
      content: [
        "name: Evidoc",
        "on: [pull_request, push]",
        "jobs:",
        "  evidoc:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - uses: actions/setup-node@v4",
        "        with:",
        "          node-version: 22",
        "      - run: npm ci",
        "      - run: npx evidoc guard --event pre-push --since merge-base:${EVIDOC_BASE_BRANCH:-main} --fail-on=review_needed",
        ""
      ].join("\n")
    },
    {
      platform: "buildkite",
      title: "Buildkite",
      file: ".buildkite/pipeline.yml",
      content: [
        "steps:",
        "  - label: ':book: Evidoc'",
        "    command:",
        "      - npm ci",
        "      - export EVIDOC_BASE_BRANCH=\"${BUILDKITE_PULL_REQUEST_BASE_BRANCH:-main}\"",
        "      - npx evidoc guard --event pre-push --since merge-base:$EVIDOC_BASE_BRANCH --fail-on=review_needed",
        ""
      ].join("\n")
    }
  ];
  const normalized = target.toLowerCase();
  return {
    recipes: normalized === "all" ? all : all.filter((recipe) => recipe.platform === normalized)
  };
}

function formatCiRecipes(result: { recipes: CiRecipe[] }): string {
  return result.recipes
    .map((recipe) => [`## ${recipe.title}`, "", `File: ${recipe.file}`, "", "```", recipe.content.trimEnd(), "```", ""].join("\n"))
    .join("\n");
}

async function readGitChangedFiles(root: string, since: string | undefined): Promise<string[]> {
  const resolvedSince = since ? await resolveGitSinceRef(root, since) : "HEAD";
  const args = ["diff", "--name-only", resolvedSince];
  let firstError: string | undefined;
  try {
    const { stdout } = await execFileAsync("git", args, { cwd: root });
    return parseGitChangedFiles(stdout);
  } catch (error) {
    if (since) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`Unable to read git changed files for --since ${since}: ${detail}`);
    }
    firstError = error instanceof Error ? error.message : String(error);
  }

  try {
    const { stdout } = await execFileAsync("git", ["diff", "--name-only"], { cwd: root });
    return parseGitChangedFiles(stdout);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Unable to read git changed files; --changed-only requires a git repository with a readable working tree: ${
        detail || firstError || "git diff failed"
      }`
    );
  }
}

async function resolveGitSinceRef(root: string, since: string): Promise<string> {
  if (!since.startsWith("merge-base:")) return since;
  const branch = since.slice("merge-base:".length).trim();
  if (!branch) {
    throw new Error("Unable to read git changed files for --since merge-base:<empty>: branch name is required");
  }
  try {
    const { stdout } = await execFileAsync("git", ["merge-base", "HEAD", branch], { cwd: root });
    const mergeBase = stdout.trim();
    if (!mergeBase) throw new Error("git merge-base returned no commit");
    return mergeBase;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to resolve git merge base for --since ${since}: ${detail}`);
  }
}

async function resolveRuntimeBaselineCommit(root: string, baseline: string): Promise<string | undefined> {
  try {
    const resolvedBaseline = await resolveGitSinceRef(root, baseline);
    const { stdout } = await execFileAsync("git", ["rev-parse", "--verify", resolvedBaseline], { cwd: root });
    const commit = stdout.trim();
    return /^[a-f0-9]{40}$/i.test(commit) ? commit : undefined;
  } catch {
    return undefined;
  }
}

async function readGitChangedFilesForScope(
  root: string,
  scope: LocalGitGuardScope,
  since: string | undefined
): Promise<string[]> {
  if (scope === "staged") {
    try {
      const { stdout } = await execFileAsync("git", ["diff", "--name-only", "--cached"], { cwd: root });
      return parseGitChangedFiles(stdout);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`Unable to read staged git changes; local Git guard requires a readable git index: ${detail}`);
    }
  }
  return readGitChangedFiles(root, since);
}

async function createStagedIndexSnapshot(root: string): Promise<string> {
  const snapshotRoot = await mkdtemp(join(tmpdir(), "evidoc-staged-"));
  try {
    await execFileAsync("git", ["checkout-index", "--all", "--force", `--prefix=${snapshotRoot}/`], { cwd: root });
    return snapshotRoot;
  } catch (error) {
    await rm(snapshotRoot, { recursive: true, force: true });
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to materialize staged git index for local Git guard: ${detail}`);
  }
}

async function readChangedFileFingerprints(
  root: string,
  scanRoot: string,
  scope: LocalGitGuardScope,
  changedFiles: string[]
): Promise<Record<string, string>> {
  const fingerprints: Record<string, string> = {};
  for (const file of changedFiles) {
    fingerprints[file] =
      scope === "staged"
        ? await readStagedFileFingerprint(root, file)
        : await readWorktreeFileFingerprint(scanRoot, file);
  }
  return fingerprints;
}

async function readStagedFileFingerprint(root: string, file: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", ["show", `:${file}`], {
      cwd: root,
      encoding: "buffer"
    });
    return fingerprintFileContent(stdout as Buffer);
  } catch {
    return "missing";
  }
}

async function readWorktreeFileFingerprint(root: string, file: string): Promise<string> {
  const target = await resolveExistingPathInsideRoot(root, file);
  if (!target) return "missing";
  try {
    return fingerprintFileContent(await readFile(target));
  } catch {
    return "unreadable";
  }
}

function parseGitChangedFiles(stdout: string): string[] {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim().replaceAll("\\", "/"))
    .filter(Boolean)
    .sort();
}

function isMarkdown(path: string): boolean {
  return path.endsWith(".md") || path.endsWith(".mdx");
}

function isPackageManagerEvidenceFile(path: string): boolean {
  return (
    path === "package.json" ||
    path === "package-lock.json" ||
    path === "npm-shrinkwrap.json" ||
    path === "pnpm-lock.yaml" ||
    path === "yarn.lock" ||
    path === "bun.lock" ||
    path === "bun.lockb"
  );
}

function isApiSpecEvidenceFile(path: string, config: EvidocConfig): boolean {
  const configured = config.apiSpecPaths ?? [];
  if (configured.includes(path)) return true;
  return /(^|\/)(openapi|swagger)\.json$/i.test(path);
}

function documentReferencesChangedFile(text: string, file: string): boolean {
  const normalizedText = text.replaceAll("\\", "/").toLowerCase();
  const normalizedFile = file.replaceAll("\\", "/").toLowerCase();
  if (normalizedText.includes(normalizedFile)) return true;

  const parts = normalizedFile.split("/").filter(Boolean);
  for (let length = parts.length - 1; length > 0; length -= 1) {
    const directory = `${parts.slice(0, length).join("/")}/`;
    if (
      normalizedText.includes(directory) ||
      normalizedText.includes(`./${directory}`) ||
      normalizedText.includes(`../${directory}`)
    ) {
      return true;
    }
  }

  return false;
}

async function missingConfiguredPaths(
  root: string,
  field: "docRoots" | "apiSpecPaths",
  value: unknown
): Promise<string[]> {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    return [`${field} must be an array of repository-relative paths`];
  }

  const missing: string[] = [];
  for (const entry of value) {
    if (!(await exists(root, entry))) missing.push(entry);
  }

  return missing.length > 0 ? [`missing configured ${field}: ${missing.join(", ")}`] : [];
}

async function exists(root: string, path: string): Promise<boolean> {
  try {
    await access(join(root, path));
    return true;
  } catch {
    return false;
  }
}

async function findEvidocWorkflow(root: string): Promise<{ path: string; warnings: string[] } | undefined> {
  const workflowsRoot = join(root, ".github", "workflows");
  let entries: string[];
  try {
    entries = await readdir(workflowsRoot);
  } catch {
    return undefined;
  }

  let path: string | undefined;
  const warnings: string[] = [];
  const defaultBranch = await detectRepositoryDefaultBranch(root);

  for (const entry of entries.sort()) {
    if (!entry.endsWith(".yml") && !entry.endsWith(".yaml")) continue;
    const relativePath = `.github/workflows/${entry}`;
    let text: string;
    try {
      text = await readFile(join(root, relativePath), "utf8");
    } catch {
      continue;
    }
    const detection = await detectRepositoryEvidocWorkflowText(root, text);
    if (detection.matches) {
      path ??= relativePath;
      warnings.push(...evidocWorkflowWarnings(relativePath, text, defaultBranch));
      for (const action of detection.localActions) {
        warnings.push(...evidocWorkflowWarnings(action.path, action.text, undefined));
      }
    }
  }

  return path ? { path, warnings } : undefined;
}

async function writeOptional(path: string | undefined, content: string): Promise<void> {
  if (!path) return;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
}

function formatMultiText(report: Awaited<ReturnType<typeof checkRepositories>>): string {
  return [
    "Evidoc multi-repository report",
    "",
    `repositories_scanned ${report.summary.repositoriesScanned}`,
    `documents_scanned    ${report.summary.documentsScanned}`,
    `findings             ${report.summary.findings}`,
    `broken               ${report.summary.broken}`,
    `review_needed        ${report.summary.reviewNeeded}`,
    ""
  ].join("\n");
}

function formatLocalAppText(state: Awaited<ReturnType<typeof scanLocalAppRepositories>>): string {
  const lines = [
    "Evidoc Local App state",
    "",
    `repositories_scanned ${state.summary.repositoriesScanned}`,
    `broken_repositories  ${state.summary.brokenRepositories}`,
    `review_repositories  ${state.summary.reviewNeededRepositories}`,
    `findings             ${state.summary.findings}`,
    `broken               ${state.summary.broken}`,
    `review_needed        ${state.summary.reviewNeeded}`,
    ""
  ];

  for (const repository of state.repositories) {
    lines.push(
      `${repository.health.padEnd(16)}${repository.name}`,
      `  root: ${repository.root}`,
      `  CI: ${repository.ci.enabled ? repository.ci.workflowPath ?? "enabled" : "disabled"}`,
      `  findings: ${repository.report.summary.findings}`,
      ""
    );
  }

  return `${lines.join("\n")}\n`;
}

function readOption(args: string[], flag: string): string | undefined {
  const inline = args.find((arg) => arg.startsWith(`${flag}=`));
  if (inline) return inline.slice(flag.length + 1);
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

function readRepeatedOption(args: string[], flag: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === flag && args[index + 1]) {
      values.push(args[index + 1]);
      index += 1;
    } else if (arg.startsWith(`${flag}=`)) {
      values.push(arg.slice(flag.length + 1));
    }
  }
  return values;
}

function parseScaffoldFeatures(values: string[]): ScaffoldFeature[] {
  const allowed = new Set<ScaffoldFeature>(["agents", "hooks", "ci", "badge", "llms"]);
  const features: ScaffoldFeature[] = [];
  for (const value of values) {
    for (const entry of value.split(",")) {
      const feature = entry.trim() as ScaffoldFeature;
      if (allowed.has(feature) && !features.includes(feature)) {
        features.push(feature);
      }
    }
  }
  return features;
}

function readOperands(args: string[]): string[] {
  const operands: string[] = [];
  const flagsWithValues = new Set([
    "--annotations",
    "--event",
    "--fail-on",
    "--format",
    "--out",
    "--port",
    "--proposal",
    "--result",
    "--root",
    "--sarif",
    "--since",
    "--scope",
    "--summary",
    "--target",
    "--with"
  ]);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg.startsWith("--")) {
      if (flagsWithValues.has(arg)) index += 1;
      continue;
    }
    operands.push(arg);
  }
  return operands;
}

function isCommand(value: string | undefined): value is Command {
  return (
    value === "agent-eval" ||
    value === "action" ||
    value === "app" ||
    value === "check" ||
    value === "dashboard" ||
    value === "demo" ||
    value === "diagnose" ||
    value === "diff" ||
    value === "doctor" ||
    value === "draft" ||
    value === "explain" ||
    value === "fix" ||
    value === "guard" ||
    value === "graph" ||
    value === "help" ||
    value === "init" ||
    value === "index" ||
    value === "mcp-tools" ||
    value === "multi" ||
    value === "recipes" ||
    value === "serve" ||
    value === "validate" ||
    value === "verify"
  );
}

function isDirectExecution(metaUrl: string): boolean {
  if (!process.argv[1]) return false;
  try {
    return metaUrl === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return metaUrl === pathToFileURL(process.argv[1]).href;
  }
}

if (isDirectExecution(import.meta.url)) {
  const exitCode = await runCli(process.argv.slice(2));
  process.exitCode = exitCode;
}
