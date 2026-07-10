import { spawn } from "node:child_process";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { access, appendFile, chmod, mkdir, readFile, readdir, realpath, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import {
  checkRepository,
  createAgentRuntimeContract,
  createChangedImpactFromFiles,
  detectRepositoryEvidocWorkflowText,
  EVIDOC_VERSION,
  evidocWorkflowWarnings,
  fingerprintFileContent,
  resolveExistingPathInsideRoot,
  resolveWritablePathInsideRoot,
  type EvidocConfig,
  type DriftReport
} from "@evidoc/core";
import { applySafePatchProposals } from "@evidoc/patcher";
import {
  renderLocalAppHtml,
  type LocalAppDashboardState,
  type LocalAppHistoryPoint,
  type LocalAppRepositoryState,
  type RepositoryHealth
} from "@evidoc/dashboard";

export interface ScanLocalAppOptions {
  autoInit?: boolean;
  writeHistory?: boolean;
  historyLimit?: number;
}

export type DirectorySelector = () => Promise<string | undefined>;

export interface LocalAppServerOptions extends ScanLocalAppOptions {
  roots: string[];
  host?: string;
  port?: number;
  openBrowser?: boolean;
  watch?: boolean;
  watchIntervalMs?: number;
  selectDirectory?: DirectorySelector;
}

export interface LocalAppServer {
  url: string;
  port: number;
  state: () => LocalAppDashboardState;
  close: () => Promise<void>;
}

export interface LocalAppFileWriteResult {
  path: string;
  status: "created" | "updated" | "kept";
}

export type ScaffoldFeature = "agents" | "hooks" | "ci" | "badge" | "llms";

export interface ScaffoldResult {
  feature: ScaffoldFeature;
  files: Array<{ path: string; status: "created" | "updated" | "kept" }>;
}

const DEFAULT_PUSH_BRANCHES = ["main", "master"];

interface ServerState {
  roots: string[];
  current: LocalAppDashboardState;
  clients: Set<ServerResponse>;
  authority?: string;
}

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 4321;
const DEFAULT_HISTORY_LIMIT = 30;
const MAX_JSON_BODY_BYTES = 1_000_000;
const DIRECTORY_PICKER_TIMEOUT_MS = 120_000;
const LOCAL_HISTORY_GITIGNORE_PATH = ".evidoc/.gitignore";
const LOCAL_HISTORY_GITIGNORE_ENTRIES = ["history.jsonl", "reports/"];
const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="10" fill="#11100e"/><path d="M15 14h34v9H25v6h20v8H25v7h24v9H15z" fill="#f6c76f"/><path d="m35 35 6 6 11-13 6 5-17 20-12-12z" fill="#8cb9ff"/></svg>`;

class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

export async function scanLocalAppRepositories(
  roots: string[],
  options: ScanLocalAppOptions = {}
): Promise<LocalAppDashboardState> {
  const normalizedRoots = await normalizeRoots(roots);
  const repositories: LocalAppRepositoryState[] = [];

  for (const root of normalizedRoots) {
    if (options.autoInit) {
      await ensureLocalAppConfig(root);
    }

    const report = await checkRepository(root);
    if (options.writeHistory) {
      await appendHistory(root, report);
    }

    const runtime = createAgentRuntimeContract(report, {
      event: "local_app",
      mode: "advisory",
      scope: "full_repository"
    });
    repositories.push({
      root,
      name: basename(root) || root,
      health: healthFromReport(report),
      runtime,
      ci: await inspectGithubAction(root),
      localGit: await inspectLocalGitGate(root, report),
      history: await readHistory(root, options.historyLimit ?? DEFAULT_HISTORY_LIMIT),
      report
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    summary: summarizeRepositories(repositories),
    repositories
  };
}

export async function startLocalAppServer(options: LocalAppServerOptions): Promise<LocalAppServer> {
  const host = requireLoopbackHost(options.host ?? DEFAULT_HOST);
  const requestedPort = options.port ?? DEFAULT_PORT;
  const selectDirectory = options.selectDirectory ?? selectSystemDirectory;
  const roots = await normalizeRoots(options.roots.length > 0 ? options.roots : [process.cwd()]);
  const state: ServerState = {
    roots,
    current: await scanLocalAppRepositories(roots, {
      autoInit: options.autoInit ?? true,
      writeHistory: options.writeHistory ?? true,
      historyLimit: options.historyLimit
    }),
    clients: new Set()
  };

  async function rescan(root?: string): Promise<LocalAppDashboardState> {
    const scanOptions = {
      autoInit: options.autoInit ?? true,
      writeHistory: options.writeHistory ?? true,
      historyLimit: options.historyLimit
    };
    if (!root) {
      state.current = await scanLocalAppRepositories(state.roots, scanOptions);
      publishEvent(state, "scan", state.current);
      return state.current;
    }

    const targetState = await scanLocalAppRepositories([root], scanOptions);
    const [targetRepository] = targetState.repositories;
    let replaced = false;
    const repositories = state.current.repositories.map((repository) => {
      if (repository.root !== root) return repository;
      replaced = true;
      return targetRepository;
    });
    if (!replaced) {
      repositories.push(targetRepository);
    }
    state.current = {
      generatedAt: targetState.generatedAt,
      summary: summarizeRepositories(repositories),
      repositories
    };
    publishEvent(state, "scan", state.current);
    return state.current;
  }

  const server = createServer((request, response) => {
    void handleRequest(request, response, state, rescan, selectDirectory);
  });

  await listenWithFallback(server, requestedPort, host, options.port === undefined);
  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : requestedPort;
  const urlHost = host.includes(":") ? `[${host}]` : host;
  const url = `http://${urlHost}:${actualPort}`;
  state.authority = new URL(url).host;

  let watcher: NodeJS.Timeout | undefined;
  if (options.watch) {
    watcher = setInterval(() => {
      void rescan().catch(() => undefined);
    }, options.watchIntervalMs ?? 5000);
    watcher.unref?.();
  }

  if (options.openBrowser !== false) {
    openBrowser(url);
  }

  return {
    url,
    port: actualPort,
    state: () => state.current,
    close: async () => {
      if (watcher) clearInterval(watcher);
      for (const client of state.clients) {
        client.end();
      }
      state.clients.clear();
      await closeServer(server);
    }
  };
}

export async function ensureLocalAppConfig(root: string): Promise<"created" | "kept"> {
  const configPath = await resolveWritablePathInsideRoot(root, ".evidoc/config.json");
  if (!configPath) {
    throw new Error("config path must stay inside repository root");
  }
  if (await exists(configPath)) {
    await ensureLocalHistoryGitignore(root);
    return "kept";
  }

  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, `${JSON.stringify(await createDefaultEvidocConfig(root), null, 2)}\n`, "utf8");
  await ensureLocalHistoryGitignore(root);
  return "created";
}

export async function ensureLocalHistoryGitignore(root: string): Promise<LocalAppFileWriteResult> {
  const target = await resolveWritablePathInsideRoot(root, LOCAL_HISTORY_GITIGNORE_PATH);
  if (!target) {
    throw new Error("local history ignore path must stay inside repository root");
  }

  if (!(await exists(target))) {
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, `${LOCAL_HISTORY_GITIGNORE_ENTRIES.join("\n")}\n`, "utf8");
    return { path: LOCAL_HISTORY_GITIGNORE_PATH, status: "created" };
  }

  const current = await readFile(target, "utf8");
  const lines = new Set(current.split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
  const missingEntries = LOCAL_HISTORY_GITIGNORE_ENTRIES.filter((entry) => !lines.has(entry));
  if (missingEntries.length === 0) {
    return { path: LOCAL_HISTORY_GITIGNORE_PATH, status: "kept" };
  }

  const separator = current.endsWith("\n") || current.length === 0 ? "" : "\n";
  await writeFile(target, `${current}${separator}${missingEntries.join("\n")}\n`, "utf8");
  return { path: LOCAL_HISTORY_GITIGNORE_PATH, status: "updated" };
}

export async function inspectLocalGitGate(
  root: string,
  report?: DriftReport
): Promise<NonNullable<LocalAppRepositoryState["localGit"]>> {
  const isRepository = (await runGit(root, ["rev-parse", "--is-inside-work-tree"]))?.trim() === "true";
  if (!isRepository) {
    return {
      isRepository: false,
      ready: false,
      preCommitHook: false,
      prePushHook: false,
      hasCommits: false,
      stagedChangedFiles: [],
      unstagedChangedFiles: [],
      affectedDocuments: [],
      issues: ["not a git repository"]
    };
  }

  const branch = sanitizeBranchName((await runGit(root, ["branch", "--show-current"]))?.trim());
  const hooksPath = (await runGit(root, ["config", "--get", "core.hooksPath"]))?.trim();
  const hasCommits = (await runGit(root, ["rev-parse", "--verify", "HEAD"])) !== undefined;
  const preCommitHook = await exists(join(root, ".githooks", "pre-commit"));
  const prePushHook = await exists(join(root, ".githooks", "pre-push"));
  const stagedChangedFiles = parseGitPathList(await runGit(root, ["diff", "--name-only", "--cached"]));
  const unstagedChangedFiles = parseGitPathList(await runGit(root, ["diff", "--name-only"]));
  const localChangedFiles = [...new Set([...stagedChangedFiles, ...unstagedChangedFiles])];
  const affectedDocuments = report
    ? (await createChangedImpactFromFiles(root, localChangedFiles)).affectedDocuments
    : [];
  const lastGate = await readLastLocalGitGate(root, { stagedChangedFiles, unstagedChangedFiles });
  const issues: string[] = [];
  if (!hasCommits) issues.push("no commits yet; create an initial baseline commit");
  if (hooksPath !== ".githooks") issues.push("core.hooksPath is not .githooks");
  if (!preCommitHook) issues.push("missing .githooks/pre-commit");
  if (!prePushHook) issues.push("missing .githooks/pre-push");

  return {
    isRepository,
    ready: issues.length === 0,
    branch,
    hooksPath,
    preCommitHook,
    prePushHook,
    hasCommits,
    baseline: hasCommits ? "HEAD" : undefined,
    stagedChangedFiles,
    unstagedChangedFiles,
    affectedDocuments,
    lastGate,
    issues
  };
}

export async function enableLocalGitGate(
  root: string,
  options: { force?: boolean; installHooks?: boolean } = {}
): Promise<{ files: LocalAppFileWriteResult[]; installed: boolean; hooksPath?: string }> {
  const files = await writeLocalGitHookFiles(root, Boolean(options.force));
  let installed = false;
  if (options.installHooks) {
    installed = await runGitOk(root, ["config", "core.hooksPath", ".githooks"]);
    if (!installed) {
      throw new Error("Unable to set repo-local git config core.hooksPath=.githooks");
    }
  }
  return {
    files,
    installed,
    hooksPath: installed ? ".githooks" : (await runGit(root, ["config", "--get", "core.hooksPath"]))?.trim()
  };
}

export async function enableGithubAction(root: string, options: { force?: boolean } = {}): Promise<{
  path: string;
  status: "created" | "updated" | "kept";
}> {
  const workflowPath = ".github/workflows/evidoc.yml";
  const target = await resolveWritablePathInsideRoot(root, workflowPath);
  if (!target) {
    throw new Error("workflow path must stay inside repository root");
  }
  const alreadyExists = await exists(target);
  if (alreadyExists && !options.force) {
    return { path: workflowPath, status: "kept" };
  }

  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, defaultGithubWorkflow({ pushBranches: await detectRepositoryPushBranches(root) }), "utf8");
  return { path: workflowPath, status: alreadyExists ? "updated" : "created" };
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  state: ServerState,
  rescan: (root?: string) => Promise<LocalAppDashboardState>,
  selectDirectory: DirectorySelector
): Promise<void> {
  const url = new URL(request.url ?? "/", "http://localhost");

  try {
    if (!isAllowedRequestHost(request, state.authority)) {
      sendJson(response, { error: "untrusted local app host rejected" }, 403);
      return;
    }
    if (request.method === "POST" && !isAllowedRequestOrigin(request)) {
      sendJson(response, { error: "cross-origin local app request rejected" }, 403);
      return;
    }

    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      sendHtml(response, renderLocalAppHtml(state.current));
      return;
    }

    if (request.method === "GET" && url.pathname === "/favicon.ico") {
      sendSvg(response, FAVICON_SVG);
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/state") {
      sendJson(response, state.current);
      return;
    }

    if (request.method === "GET" && url.pathname === "/events") {
      response.writeHead(200, {
        ...securityHeaders(),
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive"
      });
      response.write(`event: state\ndata: ${JSON.stringify(state.current)}\n\n`);
      state.clients.add(response);
      request.on("close", () => state.clients.delete(response));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/scan") {
      const body = await readJsonBody<{ root?: string }>(request);
      if (body.root) {
        const root = await resolveKnownRoot(state, body.root);
        if (!root) {
          sendJson(response, { error: "unknown repository root" }, 400);
          return;
        }
        sendJson(response, await rescan(root));
        return;
      }
      sendJson(response, await rescan());
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/repositories") {
      const body = await readJsonBody<{ root?: string }>(request);
      if (!body.root) {
        sendJson(response, { error: "root is required" }, 400);
        return;
      }
      const root = await resolveExistingDirectory(body.root);
      if (!root) {
        sendJson(response, { error: "repository root must be an existing directory" }, 400);
        return;
      }
      if (!state.roots.includes(root)) {
        state.roots.push(root);
      }
      sendJson(response, await rescan(root));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/select-directory") {
      const selected = await withTimeout(selectDirectory(), DIRECTORY_PICKER_TIMEOUT_MS, "system folder picker timed out");
      if (!selected) {
        sendJson(response, { cancelled: true });
        return;
      }
      const root = await resolveExistingDirectory(selected);
      if (!root) {
        sendJson(response, { error: "selected folder must be an existing directory" }, 400);
        return;
      }
      sendJson(response, { root });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/enable-ci") {
      const body = await readJsonBody<{ root?: string; force?: boolean }>(request);
      if (!body.root) {
        sendJson(response, { error: "root is required" }, 400);
        return;
      }
      const root = await resolveKnownRoot(state, body.root);
      if (!root) {
        sendJson(response, { error: "unknown repository root" }, 400);
        return;
      }
      const result = await enableGithubAction(root, { force: body.force });
      await rescan();
      sendJson(response, { result, state: state.current });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/enable-local-git") {
      const body = await readJsonBody<{ root?: string; force?: boolean }>(request);
      if (!body.root) {
        sendJson(response, { error: "root is required" }, 400);
        return;
      }
      const root = await resolveKnownRoot(state, body.root);
      if (!root) {
        sendJson(response, { error: "unknown repository root" }, 400);
        return;
      }
      const result = await enableLocalGitGate(root, { force: body.force, installHooks: true });
      await rescan();
      sendJson(response, { result, state: state.current });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/fix-safe") {
      const body = await readJsonBody<{ root?: string }>(request);
      if (!body.root) {
        sendJson(response, { error: "root is required" }, 400);
        return;
      }
      const root = await resolveKnownRoot(state, body.root);
      if (!root) {
        sendJson(response, { error: "unknown repository root" }, 400);
        return;
      }
      const result = await applySafePatchProposals(root, { allowWrites: true });
      const nextState = await rescan(root);
      sendJson(response, { result, state: nextState });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/scaffold") {
      const body = await readJsonBody<{ root?: string; features?: ScaffoldFeature[]; force?: boolean }>(request);
      if (!body.root) {
        sendJson(response, { error: "root is required" }, 400);
        return;
      }
      const root = await resolveKnownRoot(state, body.root);
      if (!root) {
        sendJson(response, { error: "unknown repository root" }, 400);
        return;
      }
      const result = await scaffoldRepository(root, {
        features: body.features?.length ? body.features : ["agents", "hooks", "badge", "llms"],
        force: body.force
      });
      await rescan();
      sendJson(response, { result, state: state.current });
      return;
    }

    if (request.method === "GET" && url.pathname === "/open-file") {
      const root = await resolveKnownRoot(state, url.searchParams.get("root") ?? state.roots[0] ?? process.cwd());
      if (!root) {
        sendJson(response, { error: "unknown repository root" }, 400);
        return;
      }
      const relativePath = url.searchParams.get("path") ?? "";
      const target = await resolveExistingPathInsideRoot(root, relativePath);
      if (!target) {
        sendJson(response, { error: "path must stay inside repository root" }, 400);
        return;
      }
      openFile(target);
      sendJson(response, { ok: true, path: target });
      return;
    }

    sendJson(response, { error: "not found" }, 404);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendJson(response, { error: message }, error instanceof HttpError ? error.status : 500);
  }
}

async function normalizeRoots(roots: string[]): Promise<string[]> {
  const normalized: string[] = [];
  for (const root of roots) {
    const realRoot = await resolveExistingDirectory(root);
    if (!realRoot) {
      throw new Error(`repository root does not exist or is not a directory: ${root}`);
    }
    if (!normalized.includes(realRoot)) {
      normalized.push(realRoot);
    }
  }
  return normalized;
}

async function resolveExistingDirectory(root: string): Promise<string | undefined> {
  const target = resolve(root);
  const targetReal = await realpath(target).catch(() => undefined);
  if (!targetReal) return undefined;
  const stats = await stat(targetReal).catch(() => undefined);
  if (!stats?.isDirectory()) return undefined;
  return targetReal;
}

async function resolveKnownRoot(state: ServerState, requestedRoot: string): Promise<string | undefined> {
  const root = await resolveExistingDirectory(requestedRoot);
  if (!root || !state.roots.includes(root)) return undefined;
  return root;
}

function summarizeRepositories(
  repositories: LocalAppRepositoryState[]
): LocalAppDashboardState["summary"] {
  return {
    repositoriesScanned: repositories.length,
    brokenRepositories: repositories.filter((repository) => repository.health === "broken").length,
    reviewNeededRepositories: repositories.filter((repository) => repository.health === "review_needed").length,
    findings: repositories.reduce((total, repository) => total + repository.report.summary.findings, 0),
    broken: repositories.reduce((total, repository) => total + repository.report.summary.broken, 0),
    reviewNeeded: repositories.reduce((total, repository) => total + repository.report.summary.reviewNeeded, 0)
  };
}

function healthFromReport(report: DriftReport): RepositoryHealth {
  if (report.summary.broken > 0) return "broken";
  if (report.summary.reviewNeeded > 0) return "review_needed";
  if (report.summary.documentsScanned === 0) return "review_needed";
  return "ok";
}

async function appendHistory(root: string, report: DriftReport): Promise<void> {
  const path = await resolveWritablePathInsideRoot(root, ".evidoc/history.jsonl");
  if (!path) {
    throw new Error("history path must stay inside repository root");
  }
  await mkdir(dirname(path), { recursive: true });
  await appendFile(
    path,
    `${JSON.stringify({
      scannedAt: report.scannedAt,
      findings: report.summary.findings,
      broken: report.summary.broken,
      reviewNeeded: report.summary.reviewNeeded
    })}\n`,
    "utf8"
  );
}

async function readHistory(root: string, limit: number): Promise<LocalAppHistoryPoint[]> {
  try {
    const raw = await readFile(join(root, ".evidoc", "history.jsonl"), "utf8");
    const points: LocalAppHistoryPoint[] = [];
    for (const line of raw.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line) as Partial<LocalAppHistoryPoint>;
        if (typeof parsed.scannedAt === "string") {
          points.push({
            scannedAt: parsed.scannedAt,
            findings: numberOrZero(parsed.findings),
            broken: numberOrZero(parsed.broken),
            reviewNeeded: numberOrZero(parsed.reviewNeeded)
          });
        }
      } catch {
        continue;
      }
    }
    return points.slice(-limit);
  } catch {
    return [];
  }
}

async function readLastLocalGitGate(
  root: string,
  changes: { stagedChangedFiles: string[]; unstagedChangedFiles: string[] }
): Promise<NonNullable<NonNullable<LocalAppRepositoryState["localGit"]>["lastGate"]> | undefined> {
  let raw: string;
  try {
    raw = await readFile(join(root, ".evidoc", "reports", "local-gate.json"), "utf8");
  } catch {
    return undefined;
  }

  try {
    const parsed = JSON.parse(raw) as {
      runtime?: {
        status?: unknown;
        fingerprint?: unknown;
        generatedAt?: unknown;
        scannedAt?: unknown;
        baselineCommit?: unknown;
        changedFileFingerprints?: unknown;
      };
      event?: unknown;
      scope?: unknown;
      since?: unknown;
      changedFiles?: unknown;
      report?: {
        scannedAt?: unknown;
        summary?: {
          findings?: unknown;
          broken?: unknown;
          reviewNeeded?: unknown;
        };
      };
    };
    const summary = parsed.report?.summary;
    if (!summary) return undefined;
    const generatedAt = typeof parsed.runtime?.generatedAt === "string" ? parsed.runtime.generatedAt : undefined;
    const runtimeScannedAt = typeof parsed.runtime?.scannedAt === "string" ? parsed.runtime.scannedAt : undefined;
    const scannedAt = runtimeScannedAt ?? (typeof parsed.report?.scannedAt === "string" ? parsed.report.scannedAt : undefined);
    const scope = typeof parsed.scope === "string" ? parsed.scope : undefined;
    const changedFiles = parseStringArray(parsed.changedFiles);
    const freshness = await localGateFreshness(root, {
      scope,
      generatedAt,
      scannedAt,
      changedFiles,
      changedFileFingerprints: parseStringRecord(parsed.runtime?.changedFileFingerprints),
      stagedChangedFiles: changes.stagedChangedFiles,
      unstagedChangedFiles: changes.unstagedChangedFiles
    });
    return {
      event: typeof parsed.event === "string" ? parsed.event : undefined,
      scope,
      since: typeof parsed.since === "string" ? parsed.since : undefined,
      status: typeof parsed.runtime?.status === "string" ? parsed.runtime.status : undefined,
      fingerprint: typeof parsed.runtime?.fingerprint === "string" ? parsed.runtime.fingerprint : undefined,
      baselineCommit: typeof parsed.runtime?.baselineCommit === "string" ? parsed.runtime.baselineCommit : undefined,
      generatedAt,
      scannedAt,
      stale: freshness.stale,
      staleReason: freshness.reason,
      findings: numberOrZero(summary.findings),
      broken: numberOrZero(summary.broken),
      reviewNeeded: numberOrZero(summary.reviewNeeded)
    };
  } catch {
    return undefined;
  }
}

async function localGateFreshness(
  root: string,
  input: {
    scope: string | undefined;
    generatedAt: string | undefined;
    scannedAt: string | undefined;
    changedFiles: string[];
    changedFileFingerprints: Record<string, string>;
    stagedChangedFiles: string[];
    unstagedChangedFiles: string[];
  }
): Promise<{ stale: boolean; reason?: string }> {
  const currentChangedFiles = uniqueSorted(
    input.scope === "staged"
      ? input.stagedChangedFiles
      : [...input.stagedChangedFiles, ...input.unstagedChangedFiles]
  );
  if (!sameStringList(currentChangedFiles, uniqueSorted(input.changedFiles))) {
    return { stale: true, reason: "changed file set differs" };
  }
  if (currentChangedFiles.length === 0) return { stale: false };

  const expectedFingerprintFiles = Object.keys(input.changedFileFingerprints).sort();
  if (expectedFingerprintFiles.length > 0) {
    if (!sameStringList(currentChangedFiles, expectedFingerprintFiles)) {
      return { stale: true, reason: "changed file fingerprint set differs" };
    }
    const actualFingerprints = await readCurrentChangedFileFingerprints(root, currentChangedFiles, input.scope);
    for (const file of currentChangedFiles) {
      if (actualFingerprints[file] !== input.changedFileFingerprints[file]) {
        return { stale: true, reason: `${file} content changed after gate report` };
      }
    }
    return { stale: false };
  }

  const timestamp = Date.parse(input.generatedAt ?? input.scannedAt ?? "");
  if (!Number.isFinite(timestamp)) {
    return { stale: true, reason: "missing runtime timestamp" };
  }

  for (const file of currentChangedFiles) {
    const target = await resolveExistingPathInsideRoot(root, file);
    if (!target) continue;
    const stats = await stat(target).catch(() => undefined);
    if (stats && stats.mtimeMs > timestamp) {
      return { stale: true, reason: `${file} changed after gate report` };
    }
  }
  return { stale: false };
}

async function readCurrentChangedFileFingerprints(
  root: string,
  changedFiles: string[],
  scope: string | undefined
): Promise<Record<string, string>> {
  const fingerprints: Record<string, string> = {};
  for (const file of changedFiles) {
    fingerprints[file] =
      scope === "staged"
        ? await readStagedFileFingerprint(root, file)
        : await readWorktreeFileFingerprint(root, file);
  }
  return fingerprints;
}

async function readStagedFileFingerprint(root: string, file: string): Promise<string> {
  const content = await runGitBuffer(root, ["show", `:${file}`]);
  return content ? fingerprintFileContent(content) : "missing";
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

function parseStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string").sort();
}

function parseStringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => [key, typeof item === "string" ? item : "invalid"] as [string, string])
      .sort(([left], [right]) => left.localeCompare(right))
  );
}

function uniqueSorted(value: string[]): string[] {
  return [...new Set(value)].sort();
}

function sameStringList(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((item, index) => item === right[index]);
}

export async function createDefaultEvidocConfig(root: string): Promise<EvidocConfig> {
  const docRoots: string[] = [];
  if (await exists(join(root, "README.md"))) docRoots.push("README.md");
  if (await exists(join(root, "AGENTS.md"))) docRoots.push("AGENTS.md");
  if (await exists(join(root, "CLAUDE.md"))) docRoots.push("CLAUDE.md");
  if (await exists(join(root, "docs"))) docRoots.push("docs");

  const apiSpecPaths: string[] = [];
  for (const candidate of ["openapi.json", "swagger.json", "docs/openapi.json", "docs/swagger.json"]) {
    if (await exists(join(root, candidate))) apiSpecPaths.push(candidate);
  }

  return {
    docRoots,
    ignorePatterns: ["docs/archive/**"],
    severityOverrides: {},
    apiSpecPaths,
    reviewTtlDays: 90,
    requireTestsForSources: false,
    maxFileBytes: 500000
  };
}

async function inspectGithubAction(root: string): Promise<LocalAppRepositoryState["ci"]> {
  const workflowsRoot = join(root, ".github", "workflows");
  let entries: string[];
  try {
    entries = await readdir(workflowsRoot);
  } catch {
    return { enabled: false };
  }

  let workflowPath: string | undefined;
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
      workflowPath ??= relativePath;
      warnings.push(...evidocWorkflowWarnings(relativePath, text, defaultBranch));
      for (const action of detection.localActions) {
        warnings.push(...evidocWorkflowWarnings(action.path, action.text, undefined));
      }
    }
  }

  return workflowPath ? { enabled: true, workflowPath, warnings } : { enabled: false };
}

export function defaultGithubWorkflow(options: { pushBranches?: string[] } = {}): string {
  const pushBranches = normalizePushBranches(options.pushBranches);
  const branchComment =
    pushBranches.join(",") === DEFAULT_PUSH_BRANCHES.join(",")
      ? "    # If your default branch is not main or master, replace this list."
      : "    # Detected from this repository. Update if your default branch differs.";
  return [
    "name: Evidoc",
    "",
    "on:",
    "  pull_request:",
    "  push:",
    branchComment,
    "    branches:",
    ...pushBranches.map((branch) => `      - ${branch}`),
    "",
    "permissions:",
    "  contents: read",
    "  actions: read",
    "  pull-requests: write",
    "",
    "jobs:",
    "  evidoc:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0 # v7",
    `      - uses: handong66/Evidoc/packages/github-action@v${EVIDOC_VERSION}`,
    "        with:",
    "          fail-on: review_needed",
    '          sarif: "false"',
    '          pr-comment: "true"',
    "          changed-only: ${{ github.event_name == 'pull_request' && 'true' || 'false' }}",
    '          since: origin/${{ github.event.repository.default_branch }}',
    ""
  ].join("\n");
}

export async function detectRepositoryDefaultBranch(root: string): Promise<string | undefined> {
  for (const remote of await detectRepositoryRemoteNames(root)) {
    const remoteHead = await runGit(root, ["symbolic-ref", "--short", `refs/remotes/${remote}/HEAD`]);
    const remoteBranch = sanitizeBranchName(remoteHead?.replace(new RegExp(`^${escapeRegExp(remote)}/`), "").trim());
    if (remoteBranch) return remoteBranch;
  }

  for (const candidate of DEFAULT_PUSH_BRANCHES) {
    if (await runGit(root, ["rev-parse", "--verify", `refs/heads/${candidate}`])) return candidate;
  }

  const currentBranch = await runGit(root, ["branch", "--show-current"]);
  return sanitizeBranchName(currentBranch?.trim());
}

export async function detectRepositoryPushBranches(root: string): Promise<string[]> {
  const branch = await detectRepositoryDefaultBranch(root);
  return branch ? [branch] : DEFAULT_PUSH_BRANCHES;
}

function normalizePushBranches(value: string[] | undefined): string[] {
  const sanitized = (value ?? DEFAULT_PUSH_BRANCHES)
    .map((branch) => sanitizeBranchName(branch))
    .filter((branch): branch is string => branch !== undefined);
  const unique = [...new Set(sanitized)];
  return unique.length > 0 ? unique : DEFAULT_PUSH_BRANCHES;
}

function sanitizeBranchName(value: string | undefined): string | undefined {
  const branch = value?.trim();
  if (!branch || !/^[A-Za-z0-9._/-]+$/.test(branch)) return undefined;
  return branch;
}

async function detectRepositoryRemoteNames(root: string): Promise<string[]> {
  const rawRemotes = await runGit(root, ["remote"]);
  const remotes = (rawRemotes ?? "")
    .split(/\r?\n/)
    .map((remote) => remote.trim())
    .filter((remote) => /^[A-Za-z0-9._-]+$/.test(remote));
  return [...new Set(["origin", ...remotes])];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function runGit(root: string, args: string[]): Promise<string | undefined> {
  return new Promise((resolveRun) => {
    const child = spawn("git", args, {
      cwd: root,
      stdio: ["ignore", "pipe", "ignore"]
    });
    const stdout: Buffer[] = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.once("error", () => resolveRun(undefined));
    child.once("close", (exitCode) => {
      if (exitCode !== 0) {
        resolveRun(undefined);
        return;
      }
      resolveRun(Buffer.concat(stdout).toString("utf8"));
    });
  });
}

async function runGitBuffer(root: string, args: string[]): Promise<Buffer | undefined> {
  return new Promise((resolveRun) => {
    const child = spawn("git", args, {
      cwd: root,
      stdio: ["ignore", "pipe", "ignore"]
    });
    const stdout: Buffer[] = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.once("error", () => resolveRun(undefined));
    child.once("close", (exitCode) => {
      if (exitCode !== 0) {
        resolveRun(undefined);
        return;
      }
      resolveRun(Buffer.concat(stdout));
    });
  });
}

async function runGitOk(root: string, args: string[]): Promise<boolean> {
  return new Promise((resolveRun) => {
    const child = spawn("git", args, {
      cwd: root,
      stdio: ["ignore", "ignore", "ignore"]
    });
    child.once("error", () => resolveRun(false));
    child.once("close", (exitCode) => resolveRun(exitCode === 0));
  });
}

function parseGitPathList(stdout: string | undefined): string[] {
  return (stdout ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim().replaceAll("\\", "/"))
    .filter(Boolean)
    .sort();
}

export async function scaffoldRepository(
  root: string,
  options: { features: ScaffoldFeature[]; force?: boolean }
): Promise<ScaffoldResult[]> {
  const results: ScaffoldResult[] = [];
  for (const feature of [...new Set(options.features)]) {
    if (feature === "ci") {
      const workflow = await enableGithubAction(root, { force: options.force });
      results.push({ feature, files: [workflow] });
      continue;
    }

    const files = await scaffoldFeature(root, feature, Boolean(options.force));
    results.push({ feature, files });
  }
  return results;
}

async function scaffoldFeature(
  root: string,
  feature: ScaffoldFeature,
  force: boolean
): Promise<ScaffoldResult["files"]> {
  if (feature === "agents") {
    return Promise.all([
      writeScaffoldFile(root, "AGENTS.md", agentInstructions("AGENTS.md"), force),
      writeScaffoldFile(root, "CLAUDE.md", agentInstructions("CLAUDE.md"), force),
      writeScaffoldFile(root, ".cursor/rules/evidoc.md", agentInstructions("Cursor"), force),
      writeScaffoldFile(
        root,
        ".github/copilot-instructions.md",
        agentInstructions("GitHub Copilot"),
        force
      ),
      writeScaffoldFile(root, ".evidoc/skills/evidoc/SKILL.md", evidocSkillInstructions(), force)
    ]);
  }

  if (feature === "hooks") {
    return writeLocalGitHookFiles(root, force);
  }

  if (feature === "badge") {
    return [
      await writeScaffoldFile(
        root,
        ".evidoc/badge.md",
        "[![Evidoc](https://img.shields.io/badge/Evidoc-enabled-146ef5)](https://github.com/handong66/Evidoc)\n",
        force
      )
    ];
  }

  if (feature === "llms") {
    return Promise.all([
      writeScaffoldFile(
        root,
        "llms.txt",
        [
          "# Evidoc agent context",
          "",
          "- Run `npx repo-evidoc guard --event manual --scope staged --json` before final code, doc, review, or commit summaries.",
          "- If using MCP, call `evidoc.get_drift_status` only when it appears in tools/list; otherwise use the CLI.",
          "- Trust `.evidoc/reports/local-gate.json` only when `changedFiles` and `runtime.changedFileFingerprints` still match current same-scope Git changes; old reports without fingerprints also need fresh timestamps.",
          "- Dedupe repeated replies by `runtime.findings[].fingerprint`.",
          "- Treat Evidoc findings as evidence requests, not automatic permission to rewrite prose.",
          "- Safe patches may be applied only after review; review/blocked patches require human judgment.",
          ""
        ].join("\n"),
        force
      ),
      writeScaffoldFile(
        root,
        ".evidoc/context-pack.md",
        [
          "# Evidoc Context Pack",
          "",
          "This repository is configured for local-first documentation drift checks.",
          "",
          "Recommended loop:",
          "",
          "1. `npx repo-evidoc guard --event manual --scope staged --json`",
          "2. Check `runtime.status`, `runtime.fingerprint`, and `runtime.findings[].fingerprint`.",
          "3. `npx repo-evidoc diagnose` before proposing repairs.",
          "4. Apply only evidence-bound changes.",
          "5. Re-run Evidoc before opening a PR or final summary.",
          ""
        ].join("\n"),
        force
      )
    ]);
  }

  return [];
}

async function writeLocalGitHookFiles(root: string, force: boolean): Promise<LocalAppFileWriteResult[]> {
  const baseBranch = (await detectRepositoryDefaultBranch(root)) ?? "main";
  const files = await Promise.all([
    writeScaffoldFile(root, ".githooks/pre-commit", localGitHookScript("pre-commit", baseBranch), force),
    writeScaffoldFile(root, ".githooks/pre-push", localGitHookScript("pre-push", baseBranch), force)
  ]);
  await Promise.all([
    chmod(join(root, ".githooks", "pre-commit"), 0o755).catch(() => undefined),
    chmod(join(root, ".githooks", "pre-push"), 0o755).catch(() => undefined)
  ]);
  return files;
}

function localGitHookScript(event: "pre-commit" | "pre-push", baseBranch: string): string {
  const fallbackCommand =
    event === "pre-commit"
      ? "check --changed-only --fail-on=review_needed"
      : 'check --changed-only --since "$EVIDOC_BASELINE" --fail-on=review_needed';
  const guardCommand =
    event === "pre-commit"
      ? "guard --event pre-commit --fail-on=review_needed"
      : 'guard --event pre-push --since "$EVIDOC_BASELINE" --fail-on=review_needed';
  const prePushSetup =
    event === "pre-push"
      ? [
          `EVIDOC_BASE_BRANCH="\${EVIDOC_BASE_BRANCH:-${baseBranch}}"`,
          'EVIDOC_BASELINE="merge-base:$EVIDOC_BASE_BRANCH"',
          "if [ ! -t 0 ]; then",
          "  while IFS=' ' read -r _local_ref _local_oid _remote_ref remote_oid; do",
          '    case "$remote_oid" in',
          "      ''|*[!0]*) EVIDOC_BASELINE=\"$remote_oid\"; break ;;",
          "      *) ;;",
          "    esac",
          "  done",
          "fi",
          ""
        ]
      : [];
  return [
    "#!/usr/bin/env sh",
    "set -u",
    "",
    ...prePushSetup,
    "if ! command -v node >/dev/null 2>&1; then",
    `  echo "Evidoc ${event} skipped: install Node.js plus Evidoc, or run npx repo-evidoc ${fallbackCommand}." >&2`,
    "  exit 0",
    "elif [ -x ./node_modules/.bin/evidoc ]; then",
    `  ./node_modules/.bin/evidoc ${guardCommand}`,
    "elif command -v npx >/dev/null 2>&1; then",
    `  npx --yes repo-evidoc ${guardCommand}`,
    "elif command -v evidoc >/dev/null 2>&1; then",
    `  evidoc ${guardCommand}`,
    "else",
    `  echo "Evidoc ${event} skipped: install Evidoc locally, install npm/npx, or install a global evidoc binary; local Git gate could not run." >&2`,
    "  exit 0",
    "fi",
    ""
  ].join("\n");
}

async function writeScaffoldFile(
  root: string,
  path: string,
  content: string,
  force: boolean
): Promise<{ path: string; status: "created" | "updated" | "kept" }> {
  const target = await resolveWritablePathInsideRoot(root, path);
  if (!target) {
    throw new Error("scaffold path must stay inside repository root");
  }
  const alreadyExists = await exists(target);
  if (alreadyExists && !force) {
    return { path, status: "kept" };
  }

  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content, "utf8");
  return { path, status: alreadyExists ? "updated" : "created" };
}

function agentInstructions(surface: string): string {
  return [
    `# ${surface} Evidoc Instructions`,
    "",
    "## Evidoc Agent Runtime Contract",
    "",
    "- Evidoc is the single source of truth for documentation drift. Do not invent drift findings from prose alone.",
    "- Before finalizing code changes, documentation changes, review summaries, or commit summaries, run `npx repo-evidoc guard --event manual --scope staged --json` from the repository root.",
    "- If MCP tools are available, call `evidoc.get_drift_status` before speaking about status; if the tool is not listed, fall back to the local report or CLI.",
    "- Read `.evidoc/reports/local-gate.json` only when its `changedFiles` and `runtime.changedFileFingerprints` match the current same-scope Git changes. For old reports without fingerprints, require `runtime.generatedAt` or `runtime.scannedAt` to be newer than those files; otherwise run another scan.",
    "- Summarize only `runtime.status`, `runtime.mode`, `runtime.fingerprint`, and unique `runtime.findings[]`; dedupe by `runtime.findings[].fingerprint` so the same drift is not repeated.",
    "- Treat hook-triggered `runtime.mode=blocking` as a gate failure. Treat manual, MCP, or IDE results as advisory unless a hook failed.",
    "- When findings exist, report affected documents, evidence-backed cause, and next commands: `npx repo-evidoc diagnose`, `npx repo-evidoc fix --safe --write`, and `git diff`.",
    "- Keep AGENTS.md, CLAUDE.md, Cursor rules, GitHub Copilot instructions, and `.evidoc/skills/evidoc/SKILL.md` consistent.",
    "- Do not silence Evidoc findings without a review-log entry and expiry. Generated patches still require review before merge.",
    "- Prefer deterministic evidence over LLM guesses; every documentation change should cite the source file or API spec it follows.",
    ""
  ].join("\n");
}

function evidocSkillInstructions(): string {
  return [
    "---",
    "name: evidoc",
    "description: Use when changing code or documentation, preparing a commit summary, reviewing a repository, or answering whether docs drifted.",
    "---",
    "",
    "# Evidoc Agent Runtime",
    "",
    "Use Evidoc as the repository-local documentation drift fact source.",
    "",
    "## When To Run",
    "",
    "- Before finalizing code changes, documentation edits, review summaries, or commit summaries.",
    "- When the user asks whether docs drifted or asks for a documentation repair.",
    "- When a local Git hook reports Evidoc failed.",
    "",
    "## Command Path",
    "",
    "1. If MCP tools are available and `evidoc.get_drift_status` is listed, call it before speaking about status.",
    "2. Prefer `.evidoc/reports/local-gate.json` only when its `changedFiles` and `runtime.changedFileFingerprints` match the current same-scope Git changes. For old reports without fingerprints, require `runtime.generatedAt` or `runtime.scannedAt` to be newer than those files.",
    "3. Otherwise run `npx repo-evidoc guard --event manual --scope staged --json`.",
    "4. If `evidoc.diagnose_drift` is listed, call it before proposing repairs; otherwise use `npx repo-evidoc diagnose`.",
    "",
    "## Response Contract",
    "",
    "- Report `runtime.status`, `runtime.mode`, and `runtime.fingerprint`.",
    "- dedupe by runtime.findings[].fingerprint.",
    "- For each unique finding, summarize affected document, evidence-backed cause, severity, and suggested action.",
    "- Use `evidoc.suggest_doc_fix` or `npx repo-evidoc fix --safe --write` only for evidence-bound safe fixes.",
    "- Never upload repository content to third-party models by default, and never merge generated patches automatically.",
    ""
  ].join("\n");
}

function publishEvent(state: ServerState, event: string, payload: unknown): void {
  for (const client of state.clients) {
    client.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
  }
}

function sendHtml(response: ServerResponse, html: string): void {
  response.writeHead(200, {
    ...securityHeaders(),
    "content-type": "text/html; charset=utf-8"
  });
  response.end(html);
}

function sendSvg(response: ServerResponse, svg: string): void {
  response.writeHead(200, {
    ...securityHeaders(),
    "content-type": "image/svg+xml",
    "cache-control": "public, max-age=86400"
  });
  response.end(svg);
}

function sendJson(response: ServerResponse, payload: unknown, status = 200): void {
  response.writeHead(status, {
    ...securityHeaders(),
    "content-type": "application/json; charset=utf-8"
  });
  response.end(JSON.stringify(payload));
}

async function readJsonBody<T>(request: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  let total = 0;
  let tooLarge = false;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.byteLength;
    if (total > MAX_JSON_BODY_BYTES) {
      tooLarge = true;
      continue;
    }
    if (!tooLarge) chunks.push(buffer);
  }
  if (tooLarge) {
    throw new HttpError("JSON request body is too large.", 413);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  try {
    return raw.trim() ? (JSON.parse(raw) as T) : ({} as T);
  } catch {
    throw new HttpError("Invalid JSON request body.", 400);
  }
}

function securityHeaders(): Record<string, string> {
  return {
    "content-security-policy":
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY"
  };
}

function listen(server: Server, port: number, host: string): Promise<void> {
  return new Promise((resolveListen, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolveListen();
    };
    server.once("error", onError);
    server.listen(port, host, () => {
      onListening();
    });
  });
}

async function listenWithFallback(
  server: Server,
  port: number,
  host: string,
  allowFallback: boolean
): Promise<void> {
  try {
    await listen(server, port, host);
  } catch (error) {
    if (allowFallback && isAddressInUse(error)) {
      await listen(server, 0, host);
      return;
    }
    throw error;
  }
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolveClose, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolveClose();
    });
  });
}

function openBrowser(url: string): void {
  const [command, args] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", "", url]]
        : ["xdg-open", [url]];
  const child = spawn(command, args, { detached: true, stdio: "ignore" });
  child.unref();
}

function openFile(path: string): void {
  const [command, args] =
    process.platform === "darwin"
      ? ["open", [path]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", "", path]]
        : ["xdg-open", [path]];
  const child = spawn(command, args, { detached: true, stdio: "ignore" });
  child.unref();
}

async function selectSystemDirectory(): Promise<string | undefined> {
  if (process.platform === "darwin") {
    return runDirectoryPicker("osascript", [
      "-e",
      'POSIX path of (choose folder with prompt "Choose a repository folder for Evidoc")'
    ]);
  }

  if (process.platform === "win32") {
    const command = [
      "Add-Type -AssemblyName System.Windows.Forms;",
      "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog;",
      "$dialog.Description = 'Choose a repository folder for Evidoc';",
      "if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {",
      "  [Console]::Out.WriteLine($dialog.SelectedPath)",
      "}"
    ].join(" ");
    return runDirectoryPicker("powershell.exe", ["-NoProfile", "-STA", "-Command", command]);
  }

  try {
    return await runDirectoryPicker("zenity", [
      "--file-selection",
      "--directory",
      "--title=Choose a repository folder for Evidoc"
    ]);
  } catch (error) {
    if (!isCommandMissing(error)) throw error;
  }

  try {
    return await runDirectoryPicker("kdialog", ["--getexistingdirectory", process.cwd(), "Choose a repository folder for Evidoc"]);
  } catch (error) {
    if (!isCommandMissing(error)) throw error;
  }

  throw new Error("No supported system folder picker was found. Install zenity or kdialog, or paste a path manually.");
}

async function runDirectoryPicker(command: string, args: string[]): Promise<string | undefined> {
  const result = await runCommand(command, args);
  const selected = result.stdout.trim();
  if (result.exitCode === 0) return selected ? resolve(selected) : undefined;
  if (result.exitCode === 1) return undefined;
  throw new Error(result.stderr.trim() || `${command} exited with code ${result.exitCode}`);
}

function runCommand(command: string, args: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.once("error", reject);
    child.once("close", (exitCode) => {
      resolveRun({
        exitCode: exitCode ?? 0,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8")
      });
    });
  });
}

function isAllowedRequestOrigin(request: IncomingMessage): boolean {
  const originHeader = request.headers.origin;
  const origin = Array.isArray(originHeader) ? originHeader[0] : originHeader;
  if (!origin) return true;

  try {
    const parsed = new URL(origin);
    return parsed.host === request.headers.host && parsed.protocol === "http:";
  } catch {
    return false;
  }
}

function isAllowedRequestHost(request: IncomingMessage, authority: string | undefined): boolean {
  if (!authority || !request.headers.host) return false;
  return request.headers.host.toLowerCase() === authority.toLowerCase();
}

function requireLoopbackHost(host: string): string {
  const normalized = host.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (normalized === "127.0.0.1" || normalized === "localhost" || normalized === "::1") {
    return normalized;
  }
  throw new Error("Evidoc Local App host must be loopback-only: 127.0.0.1, localhost, or ::1.");
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise((resolveTimeout, reject) => {
    const timer = setTimeout(() => reject(new HttpError(message, 504)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolveTimeout(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function numberOrZero(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function isAddressInUse(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "EADDRINUSE";
}

function isCommandMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
