import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { chmod, mkdtemp, mkdir, readFile, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fingerprintFileContent } from "@handong66/evidoc-core";
import { enableGithubAction, scanLocalAppRepositories, startLocalAppServer } from "../src/index.js";

async function fixture(prefix = "evidoc-local-app-"): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

async function write(root: string, file: string, text: string): Promise<void> {
  const target = join(root, file);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, text, "utf8");
}

async function real(root: string): Promise<string> {
  return realpath(root);
}

function gitInitBranch(root: string, branch: string): void {
  const init = spawnSync("git", ["init", "--initial-branch", branch], { cwd: root, encoding: "utf8" });
  if (init.status === 0) return;

  assert.equal(spawnSync("git", ["init"], { cwd: root, encoding: "utf8" }).status, 0);
  assert.equal(spawnSync("git", ["checkout", "-b", branch], { cwd: root, encoding: "utf8" }).status, 0);
}

test("scanLocalAppRepositories auto-initializes config, scans repos, and records history", async () => {
  const root = await fixture();
  await write(root, "README.md", "# Example\n");
  await write(root, "AGENTS.md", "packageManager: npm\n");

  const state = await scanLocalAppRepositories([root], { autoInit: true, writeHistory: true });

  assert.equal(state.repositories.length, 1);
  assert.equal(state.repositories[0].health, "ok");
  assert.equal(state.repositories[0].ci.enabled, false);
  assert.equal(existsSync(join(root, ".evidoc", "config.json")), true);
  assert.equal(existsSync(join(root, ".evidoc", ".gitignore")), true);
  assert.equal(existsSync(join(root, ".evidoc", "history.jsonl")), true);

  assert.match(await readFile(join(root, ".evidoc", ".gitignore"), "utf8"), /^history\.jsonl$/m);
  const history = await readFile(join(root, ".evidoc", "history.jsonl"), "utf8");
  assert.match(history, /"findings":0/);
});

test("scanLocalAppRepositories reports local Git gate status", async () => {
  const root = await fixture();
  gitInitBranch(root, "main");
  await write(root, "README.md", "# Example\n");
  assert.equal(spawnSync("git", ["config", "user.email", "test@example.com"], { cwd: root }).status, 0);
  assert.equal(spawnSync("git", ["config", "user.name", "Test User"], { cwd: root }).status, 0);
  assert.equal(spawnSync("git", ["add", "."], { cwd: root }).status, 0);
  assert.equal(spawnSync("git", ["commit", "-m", "initial"], { cwd: root }).status, 0);
  await write(root, ".githooks/pre-commit", "#!/usr/bin/env sh\nnpx evidoc guard --event pre-commit\n");
  await write(root, ".githooks/pre-push", "#!/usr/bin/env sh\nnpx evidoc guard --event pre-push\n");
  assert.equal(spawnSync("git", ["config", "core.hooksPath", ".githooks"], { cwd: root }).status, 0);

  const state = await scanLocalAppRepositories([root], { autoInit: true, writeHistory: false });

  const localGit = state.repositories[0].localGit;
  assert.ok(localGit);
  assert.equal(localGit.isRepository, true);
  assert.equal(localGit.branch, "main");
  assert.equal(localGit.hooksPath, ".githooks");
  assert.equal(localGit.preCommitHook, true);
  assert.equal(localGit.prePushHook, true);
  assert.equal(localGit.ready, true);
});

test("scanLocalAppRepositories reports local Git changed files, affected docs, and the last gate result", async () => {
  const root = await fixture();
  gitInitBranch(root, "main");
  await write(root, "README.md", "# Example\n");
  assert.equal(spawnSync("git", ["config", "user.email", "test@example.com"], { cwd: root }).status, 0);
  assert.equal(spawnSync("git", ["config", "user.name", "Test User"], { cwd: root }).status, 0);
  assert.equal(spawnSync("git", ["add", "."], { cwd: root }).status, 0);
  assert.equal(spawnSync("git", ["commit", "-m", "initial"], { cwd: root }).status, 0);
  await write(root, ".githooks/pre-commit", "#!/usr/bin/env sh\nnpx evidoc guard --event pre-commit\n");
  await write(root, ".githooks/pre-push", "#!/usr/bin/env sh\nnpx evidoc guard --event pre-push\n");
  assert.equal(spawnSync("git", ["config", "core.hooksPath", ".githooks"], { cwd: root }).status, 0);

  await write(root, "src/service.ts", "export function runLocalGate() { return true; }\n");
  assert.equal(spawnSync("git", ["add", "src/service.ts"], { cwd: root }).status, 0);
  await write(root, "README.md", "# Example\n\nLocal gate source: `src/service.ts`.\n");
  await write(
    root,
    ".evidoc/reports/local-gate.json",
    JSON.stringify(
      {
        runtime: {
          schemaVersion: "evidoc.agent-runtime.v1",
          source: "evidoc",
          event: "pre-commit",
          mode: "blocking",
          scope: "staged",
          baseline: "HEAD",
          baselineCommit: "0123456789abcdef0123456789abcdef01234567",
          status: "review_needed",
          fingerprint: "dgr_0123456789abcdef",
          generatedAt: "2099-07-05T00:00:01.000Z",
          scannedAt: "2099-07-05T00:00:00.000Z",
          summary: { findings: 1, broken: 0, reviewNeeded: 1 },
          findings: [{ fingerprint: "dgf_0123456789abcdef", ruleId: "coverage.changed-source-without-doc" }],
          dedupe: { fingerprintCount: 1 }
        },
        event: "pre-commit",
        scope: "staged",
        since: "HEAD",
        changedFiles: ["src/service.ts"],
        affectedDocuments: ["README.md"],
        report: {
          scannedAt: "2026-07-05T00:00:00.000Z",
          summary: { findings: 1, broken: 0, reviewNeeded: 1 }
        }
      },
      null,
      2
    )
  );

  const state = await scanLocalAppRepositories([root], { autoInit: false, writeHistory: false });

  const localGit = state.repositories[0].localGit;
  assert.ok(localGit);
  assert.deepEqual(localGit.stagedChangedFiles, ["src/service.ts"]);
  assert.deepEqual(localGit.unstagedChangedFiles, ["README.md"]);
  assert.deepEqual(localGit.affectedDocuments, ["README.md"]);
  assert.deepEqual(localGit.lastGate, {
    event: "pre-commit",
    scope: "staged",
    since: "HEAD",
    baselineCommit: "0123456789abcdef0123456789abcdef01234567",
    status: "review_needed",
    fingerprint: "dgr_0123456789abcdef",
    generatedAt: "2099-07-05T00:00:01.000Z",
    scannedAt: "2099-07-05T00:00:00.000Z",
    stale: false,
    staleReason: undefined,
    findings: 1,
    broken: 0,
    reviewNeeded: 1
  });
});

test("scanLocalAppRepositories marks stale local gate reports when current changes moved on", async () => {
  const root = await fixture();
  gitInitBranch(root, "main");
  await write(root, "README.md", "# Example\n");
  assert.equal(spawnSync("git", ["config", "user.email", "test@example.com"], { cwd: root }).status, 0);
  assert.equal(spawnSync("git", ["config", "user.name", "Test User"], { cwd: root }).status, 0);
  assert.equal(spawnSync("git", ["add", "."], { cwd: root }).status, 0);
  assert.equal(spawnSync("git", ["commit", "-m", "initial"], { cwd: root }).status, 0);
  await write(root, "README.md", "# Example\n\nLocal gate source: `src/service.ts`.\n");
  await write(
    root,
    ".evidoc/reports/local-gate.json",
    JSON.stringify(
      {
        runtime: {
          schemaVersion: "evidoc.agent-runtime.v1",
          source: "evidoc",
          event: "manual",
          mode: "advisory",
          scope: "worktree",
          status: "passed",
          fingerprint: "dgr_0123456789abcdef",
          generatedAt: "2000-01-01T00:00:00.000Z",
          scannedAt: "2000-01-01T00:00:00.000Z",
          summary: { findings: 0, broken: 0, reviewNeeded: 0 },
          findings: [],
          dedupe: { fingerprintCount: 0 }
        },
        event: "manual",
        scope: "worktree",
        changedFiles: ["README.md"],
        report: {
          scannedAt: "2000-01-01T00:00:00.000Z",
          summary: { findings: 0, broken: 0, reviewNeeded: 0 }
        }
      },
      null,
      2
    )
  );

  const state = await scanLocalAppRepositories([root], { autoInit: false, writeHistory: false });

  assert.equal(state.repositories[0].localGit?.lastGate?.stale, true);
  assert.match(state.repositories[0].localGit?.lastGate?.staleReason ?? "", /README\.md changed after gate report/);
});

test("scanLocalAppRepositories trusts staged gate reports by staged content fingerprint", async () => {
  const root = await fixture();
  gitInitBranch(root, "main");
  await write(root, "README.md", "# Example\n");
  assert.equal(spawnSync("git", ["config", "user.email", "test@example.com"], { cwd: root }).status, 0);
  assert.equal(spawnSync("git", ["config", "user.name", "Test User"], { cwd: root }).status, 0);
  assert.equal(spawnSync("git", ["add", "."], { cwd: root }).status, 0);
  assert.equal(spawnSync("git", ["commit", "-m", "initial"], { cwd: root }).status, 0);

  const stagedText = "# Example\n\nStaged documentation.\n";
  await write(root, "README.md", stagedText);
  assert.equal(spawnSync("git", ["add", "README.md"], { cwd: root }).status, 0);
  await write(root, "README.md", "# Example\n\nUnstaged follow-up.\n");
  await write(
    root,
    ".evidoc/reports/local-gate.json",
    JSON.stringify(
      {
        runtime: {
          schemaVersion: "evidoc.agent-runtime.v1",
          source: "evidoc",
          event: "pre-commit",
          mode: "blocking",
          scope: "staged",
          status: "passed",
          fingerprint: "dgr_0123456789abcdef",
          generatedAt: "2000-01-01T00:00:00.000Z",
          scannedAt: "2000-01-01T00:00:00.000Z",
          summary: { findings: 0, broken: 0, reviewNeeded: 0 },
          findings: [],
          dedupe: { fingerprintCount: 0 },
          changedFileFingerprints: {
            "README.md": fingerprintFileContent(stagedText)
          }
        },
        event: "pre-commit",
        scope: "staged",
        changedFiles: ["README.md"],
        report: {
          scannedAt: "2000-01-01T00:00:00.000Z",
          summary: { findings: 0, broken: 0, reviewNeeded: 0 }
        }
      },
      null,
      2
    )
  );

  const state = await scanLocalAppRepositories([root], { autoInit: false, writeHistory: false });

  assert.equal(state.repositories[0].localGit?.lastGate?.stale, false);
});

test("scanLocalAppRepositories marks stale local gate reports when content fingerprints changed", async () => {
  const root = await fixture();
  gitInitBranch(root, "main");
  await write(root, "README.md", "# Example\n");
  assert.equal(spawnSync("git", ["config", "user.email", "test@example.com"], { cwd: root }).status, 0);
  assert.equal(spawnSync("git", ["config", "user.name", "Test User"], { cwd: root }).status, 0);
  assert.equal(spawnSync("git", ["add", "."], { cwd: root }).status, 0);
  assert.equal(spawnSync("git", ["commit", "-m", "initial"], { cwd: root }).status, 0);
  await write(root, "README.md", "# Example\n\nCurrent content.\n");
  await write(
    root,
    ".evidoc/reports/local-gate.json",
    JSON.stringify(
      {
        runtime: {
          schemaVersion: "evidoc.agent-runtime.v1",
          source: "evidoc",
          event: "manual",
          mode: "advisory",
          scope: "worktree",
          status: "passed",
          fingerprint: "dgr_0123456789abcdef",
          generatedAt: "2099-01-01T00:00:00.000Z",
          scannedAt: "2099-01-01T00:00:00.000Z",
          summary: { findings: 0, broken: 0, reviewNeeded: 0 },
          findings: [],
          dedupe: { fingerprintCount: 0 },
          changedFileFingerprints: {
            "README.md": fingerprintFileContent("# Example\n\nPrevious content.\n")
          }
        },
        event: "manual",
        scope: "worktree",
        changedFiles: ["README.md"],
        report: {
          scannedAt: "2099-01-01T00:00:00.000Z",
          summary: { findings: 0, broken: 0, reviewNeeded: 0 }
        }
      },
      null,
      2
    )
  );

  const state = await scanLocalAppRepositories([root], { autoInit: false, writeHistory: false });

  assert.equal(state.repositories[0].localGit?.lastGate?.stale, true);
  assert.match(state.repositories[0].localGit?.lastGate?.staleReason ?? "", /README\.md content changed/);
});

test("scanLocalAppRepositories rejects tampered non-string local gate fingerprints", async () => {
  const root = await fixture();
  gitInitBranch(root, "main");
  await write(root, "README.md", "# Example\n");
  assert.equal(spawnSync("git", ["config", "user.email", "test@example.com"], { cwd: root }).status, 0);
  assert.equal(spawnSync("git", ["config", "user.name", "Test User"], { cwd: root }).status, 0);
  assert.equal(spawnSync("git", ["add", "."], { cwd: root }).status, 0);
  assert.equal(spawnSync("git", ["commit", "-m", "initial"], { cwd: root }).status, 0);
  await write(root, "README.md", "# Example\n\nCurrent content.\n");
  await write(
    root,
    ".evidoc/reports/local-gate.json",
    JSON.stringify(
      {
        runtime: {
          schemaVersion: "evidoc.agent-runtime.v1",
          source: "evidoc",
          event: "manual",
          mode: "advisory",
          scope: "worktree",
          status: "passed",
          fingerprint: "dgr_0123456789abcdef",
          generatedAt: "2099-01-01T00:00:00.000Z",
          scannedAt: "2099-01-01T00:00:00.000Z",
          summary: { findings: 0, broken: 0, reviewNeeded: 0 },
          findings: [],
          dedupe: { fingerprintCount: 0 },
          changedFileFingerprints: {
            "README.md": null
          }
        },
        event: "manual",
        scope: "worktree",
        changedFiles: ["README.md"],
        report: {
          scannedAt: "2099-01-01T00:00:00.000Z",
          summary: { findings: 0, broken: 0, reviewNeeded: 0 }
        }
      },
      null,
      2
    )
  );

  const state = await scanLocalAppRepositories([root], { autoInit: false, writeHistory: false });

  assert.equal(state.repositories[0].localGit?.lastGate?.stale, true);
  assert.match(state.repositories[0].localGit?.lastGate?.staleReason ?? "", /README\.md content changed/);
});

test("scanLocalAppRepositories ignores malformed local gate reports", async () => {
  const root = await fixture();
  gitInitBranch(root, "main");
  await write(root, "README.md", "# Example\n");
  assert.equal(spawnSync("git", ["config", "user.email", "test@example.com"], { cwd: root }).status, 0);
  assert.equal(spawnSync("git", ["config", "user.name", "Test User"], { cwd: root }).status, 0);
  assert.equal(spawnSync("git", ["add", "."], { cwd: root }).status, 0);
  assert.equal(spawnSync("git", ["commit", "-m", "initial"], { cwd: root }).status, 0);
  await write(root, ".githooks/pre-commit", "#!/usr/bin/env sh\nnpx evidoc guard --event pre-commit\n");
  await write(root, ".githooks/pre-push", "#!/usr/bin/env sh\nnpx evidoc guard --event pre-push\n");
  await write(root, ".evidoc/reports/local-gate.json", "{");
  assert.equal(spawnSync("git", ["config", "core.hooksPath", ".githooks"], { cwd: root }).status, 0);

  const state = await scanLocalAppRepositories([root], { autoInit: false, writeHistory: false });

  assert.equal(state.repositories[0].localGit?.ready, true);
  assert.equal(state.repositories[0].localGit?.lastGate, undefined);
});

test("scanLocalAppRepositories does not mark repositories with no scanned documents as healthy", async () => {
  const root = await fixture();

  const state = await scanLocalAppRepositories([root], { autoInit: true, writeHistory: false });

  assert.equal(state.repositories.length, 1);
  assert.equal(state.repositories[0].report.summary.documentsScanned, 0);
  assert.equal(state.repositories[0].health, "review_needed");
  assert.equal(state.summary.reviewNeededRepositories, 1);
});

test("scanLocalAppRepositories rejects missing startup roots instead of showing an empty dashboard", async () => {
  const parent = await fixture("evidoc-local-missing-parent-");
  const missing = join(parent, "missing-repository");

  await assert.rejects(
    () => scanLocalAppRepositories([missing], { autoInit: true, writeHistory: false }),
    /repository root does not exist/
  );
});

test("startLocalAppServer serves app state and can enable CI for a repository", async () => {
  const root = await fixture();
  await write(root, "README.md", "Code lives in `src/missing.ts`.\n");

  const app = await startLocalAppServer({ roots: [root], port: 0, openBrowser: false });
  try {
    const baseUrl = `http://127.0.0.1:${app.port}`;

    const stateResponse = await fetch(`${baseUrl}/api/state`);
    const state = await stateResponse.json() as { repositories: Array<{ health: string; report: { summary: { broken: number } } }> };
    assert.equal(state.repositories[0].health, "broken");
    assert.equal(state.repositories[0].report.summary.broken, 1);

    const initialHtmlResponse = await fetch(baseUrl);
    const initialHtml = await initialHtmlResponse.text();
    assert.match(initialHtml, /Evidoc Local App/);
    assert.match(initialHtml, /Enable CI/);

    const faviconResponse = await fetch(`${baseUrl}/favicon.ico`);
    assert.equal(faviconResponse.status, 200);
    assert.equal(faviconResponse.headers.get("content-type"), "image/svg+xml");

    const missingRootResponse = await fetch(`${baseUrl}/api/enable-ci`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({})
    });
    assert.equal(missingRootResponse.status, 400);

    const ciResponse = await fetch(`${baseUrl}/api/enable-ci`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ root })
    });
    assert.equal(ciResponse.status, 200);
    assert.equal(existsSync(join(root, ".github", "workflows", "evidoc.yml")), true);
    const workflow = await readFile(join(root, ".github", "workflows", "evidoc.yml"), "utf8");
    assert.match(workflow, /handong66\/Evidoc\/packages\/github-action@main/);
    assert.match(workflow, /permissions:\n  contents: read\n  actions: read\n  pull-requests: write/);
    assert.doesNotMatch(workflow, /security-events: write/);
    assert.match(workflow, /fail-on: review_needed/);
    assert.match(workflow, /sarif: "false"/);
    assert.match(workflow, /pr-comment: "true"/);
    assert.match(
      workflow,
      /pull_request:\n  push:\n    # If your default branch is not main or master, replace this list\.\n    branches:\n      - main\n      - master/
    );
    assert.match(workflow, /If your default branch is not main or master, replace this list/);
    assert.doesNotMatch(workflow, /pull_request:\n  push:\n\npermissions:/);
    assert.match(workflow, /changed-only: \$\{\{ github\.event_name == 'pull_request' && 'true' \|\| 'false' \}\}/);
    assert.doesNotMatch(workflow, /changed-only: "true"/);
    assert.match(workflow, /since: origin\/\$\{\{ github\.event\.repository\.default_branch \}\}/);

    const htmlResponse = await fetch(baseUrl);
    const html = await htmlResponse.text();
    assert.match(html, /Evidoc Local App/);
    assert.match(html, /CI enabled/);
  } finally {
    await app.close();
  }
});

test("local app server can add repositories and blocks file path traversal", async () => {
  const first = await fixture("evidoc-local-first-");
  const second = await fixture("evidoc-local-second-");
  await write(first, "README.md", "# First\n");
  await write(second, "README.md", "# Second\n");

  const app = await startLocalAppServer({ roots: [first], port: 0, openBrowser: false });
  try {
    const baseUrl = `http://127.0.0.1:${app.port}`;
    await write(first, "README.md", "Code lives in `src/newly-missing.ts`.\n");

    const addResponse = await fetch(`${baseUrl}/api/repositories`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ root: second })
    });
    const addState = await addResponse.json() as {
      summary: { repositoriesScanned: number };
      repositories: Array<{ root: string; health: string }>;
    };
    assert.equal(addResponse.status, 200);
    assert.equal(addState.summary.repositoriesScanned, 2);
    assert.deepEqual(
      addState.repositories.map((repository) => [repository.root, repository.health]),
      [
        [await real(first), "ok"],
        [await real(second), "ok"]
      ]
    );

    const traversalResponse = await fetch(
      `${baseUrl}/open-file?root=${encodeURIComponent(first)}&path=${encodeURIComponent("../outside.md")}`
    );
    assert.equal(traversalResponse.status, 400);

    const unknownRootResponse = await fetch(
      `${baseUrl}/open-file?root=${encodeURIComponent(await fixture("evidoc-local-unknown-"))}&path=${encodeURIComponent("../outside.md")}`
    );
    const unknownRoot = await unknownRootResponse.json() as { error: string };
    assert.equal(unknownRootResponse.status, 400);
    assert.equal(unknownRoot.error, "unknown repository root");
  } finally {
    await app.close();
  }
});

test("local app canonicalizes repository roots and rejects invalid additions", async () => {
  const first = await fixture("evidoc-local-real-");
  const links = await fixture("evidoc-local-links-");
  const firstLink = join(links, "first-link");
  const missing = join(links, "missing");
  const fileRoot = join(links, "not-a-directory");
  await symlink(first, firstLink, "dir");
  await write(first, "README.md", "# First\n");
  await writeFile(fileRoot, "not a directory\n", "utf8");

  const app = await startLocalAppServer({ roots: [firstLink], port: 0, openBrowser: false });
  try {
    const baseUrl = `http://127.0.0.1:${app.port}`;
    assert.deepEqual(app.state().repositories.map((repository) => repository.root), [await real(first)]);

    const scanViaSymlinkResponse = await fetch(`${baseUrl}/api/scan`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ root: firstLink })
    });
    assert.equal(scanViaSymlinkResponse.status, 200);

    const missingResponse = await fetch(`${baseUrl}/api/repositories`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ root: missing })
    });
    assert.equal(missingResponse.status, 400);

    const fileResponse = await fetch(`${baseUrl}/api/repositories`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ root: fileRoot })
    });
    assert.equal(fileResponse.status, 400);
  } finally {
    await app.close();
  }
});

test("local app CI generation includes the detected repository branch", async () => {
  const root = await fixture("evidoc-local-branch-");
  await write(root, "README.md", "# Branch\n");
  gitInitBranch(root, "trunk");

  const result = await enableGithubAction(root);

  assert.equal(result.status, "created");
  const workflow = await readFile(join(root, ".github", "workflows", "evidoc.yml"), "utf8");
  assert.match(workflow, /branches:\n      - trunk\n/);
});

test("local app CI generation prefers non-origin remote HEAD over the current branch", async () => {
  const root = await fixture("evidoc-local-upstream-");
  await write(root, "README.md", "# Branch\n");
  gitInitBranch(root, "feature");
  assert.equal(spawnSync("git", ["remote", "add", "upstream", "https://example.com/repo.git"], { cwd: root }).status, 0);
  await write(root, ".git/refs/remotes/upstream/HEAD", "ref: refs/remotes/upstream/trunk\n");

  const result = await enableGithubAction(root);

  assert.equal(result.status, "created");
  const workflow = await readFile(join(root, ".github", "workflows", "evidoc.yml"), "utf8");
  assert.match(workflow, /branches:\n      - trunk\n/);
  assert.doesNotMatch(workflow, /branches:\n      - feature\n/);
});

test("local app reports CI warnings for workflows without PR comments", async () => {
  const root = await fixture("evidoc-local-ci-warning-");
  await write(root, "README.md", "# CI warning\n");
  await write(
    root,
    ".github/workflows/evidoc.yml",
    [
      "name: Evidoc",
      "on:",
      "  pull_request:",
      "  push:",
      "    branches:",
      "      - main",
      "jobs:",
      "  evidoc:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - uses: actions/checkout@v4",
      "      - uses: handong66/Evidoc/packages/github-action@main",
      "        with:",
      '          pr-comment: "false"',
      ""
    ].join("\n")
  );

  const state = await scanLocalAppRepositories([root], { autoInit: true, writeHistory: false });

  assert.equal(state.repositories[0].ci.enabled, true);
  assert.match((state.repositories[0].ci as { warnings?: string[] }).warnings?.join("\n") ?? "", /PR comments are disabled/);
});

test("local app recognizes workflows delegated to local composite actions", async () => {
  const root = await fixture("evidoc-local-ci-composite-");
  await write(root, "README.md", "# CI composite\n");
  await write(
    root,
    ".github/workflows/ci.yml",
    [
      "name: CI",
      "on:",
      "  pull_request:",
      "  push:",
      "jobs:",
      "  evidoc:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - uses: actions/checkout@v4",
      "      - uses: ./.github/actions/evidoc-check",
      ""
    ].join("\n")
  );
  await write(
    root,
    ".github/actions/evidoc-check/action.yaml",
    [
      "name: Evidoc check",
      "runs:",
      "  using: composite",
      "  steps:",
      "    - shell: bash",
      "      run: npm run evidoc -- --fail-on=review_needed",
      ""
    ].join("\n")
  );

  const state = await scanLocalAppRepositories([root], { autoInit: true, writeHistory: false });

  assert.equal(state.repositories[0].ci.enabled, true);
  assert.equal(state.repositories[0].ci.workflowPath, ".github/workflows/ci.yml");
  assert.match((state.repositories[0].ci as { warnings?: string[] }).warnings?.join("\n") ?? "", /duplicate push/);
  assert.doesNotMatch(
    (state.repositories[0].ci as { warnings?: string[] }).warnings?.join("\n") ?? "",
    /PR comments are disabled/
  );
});

test("local app write paths reject symlink escapes", async () => {
  const configRoot = await fixture("evidoc-local-config-root-");
  const configOutside = await fixture("evidoc-local-config-outside-");
  await symlink(configOutside, join(configRoot, ".evidoc"), "dir");
  await write(configRoot, "README.md", "# Config\n");

  await assert.rejects(
    () => scanLocalAppRepositories([configRoot], { autoInit: true, writeHistory: true }),
    /inside repository root/
  );

  const workflowRoot = await fixture("evidoc-local-workflow-root-");
  const workflowOutside = await fixture("evidoc-local-workflow-outside-");
  await mkdir(join(workflowRoot, ".github"), { recursive: true });
  await symlink(workflowOutside, join(workflowRoot, ".github", "workflows"), "dir");

  await assert.rejects(() => enableGithubAction(workflowRoot, { force: true }), /inside repository root/);
});

test("local app server rejects oversized JSON bodies and cross-origin writes", async () => {
  const root = await fixture("evidoc-local-security-");
  await write(root, "README.md", "# Security\n");

  const app = await startLocalAppServer({ roots: [root], port: 0, openBrowser: false });
  try {
    const baseUrl = `http://127.0.0.1:${app.port}`;
    const oversizedResponse = await fetch(`${baseUrl}/api/repositories`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ root, padding: "x".repeat(1_100_000) })
    });
    assert.equal(oversizedResponse.status, 413);

    const crossOriginResponse = await fetch(`${baseUrl}/api/enable-ci`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://attacker.example" },
      body: JSON.stringify({ root })
    });
    assert.equal(crossOriginResponse.status, 403);

    const htmlResponse = await fetch(baseUrl);
    assert.equal(htmlResponse.headers.get("x-content-type-options"), "nosniff");
    assert.equal(htmlResponse.headers.get("x-frame-options"), "DENY");
  } finally {
    await app.close();
  }
});

test("local app server can scaffold repository support files", async () => {
  const root = await fixture("evidoc-local-scaffold-");
  await write(root, "README.md", "# Scaffold\n");

  const app = await startLocalAppServer({ roots: [root], port: 0, openBrowser: false });
  try {
    const baseUrl = `http://127.0.0.1:${app.port}`;
    const response = await fetch(`${baseUrl}/api/scaffold`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ root, features: ["agents", "hooks", "ci", "badge", "llms"] })
    });
    const payload = await response.json() as {
      result: Array<{ feature: string; files: Array<{ path: string; status: string }> }>;
    };

    assert.equal(response.status, 200);
    assert.deepEqual(payload.result.map((entry) => entry.feature), ["agents", "hooks", "ci", "badge", "llms"]);
    assert.deepEqual(scaffoldStatusMap(payload.result), {
      "agents:AGENTS.md": "created",
      "agents:CLAUDE.md": "created",
      "agents:.cursor/rules/evidoc.md": "created",
      "agents:.github/copilot-instructions.md": "created",
      "agents:.evidoc/skills/evidoc/SKILL.md": "created",
      "hooks:.githooks/pre-commit": "created",
      "hooks:.githooks/pre-push": "created",
      "ci:.github/workflows/evidoc.yml": "created",
      "badge:.evidoc/badge.md": "created",
      "llms:llms.txt": "created",
      "llms:.evidoc/context-pack.md": "created"
    });
    assert.equal(existsSync(join(root, "AGENTS.md")), true);
    assert.equal(existsSync(join(root, ".githooks", "pre-commit")), true);
    assert.equal(existsSync(join(root, ".githooks", "pre-push")), true);
    assert.equal(existsSync(join(root, ".github", "workflows", "evidoc.yml")), true);
    assert.equal(existsSync(join(root, ".evidoc", "badge.md")), true);
    assert.equal(existsSync(join(root, ".evidoc", "skills", "evidoc", "SKILL.md")), true);
    assert.equal(existsSync(join(root, "llms.txt")), true);

    const hook = await readFile(join(root, ".githooks", "pre-commit"), "utf8");
    assert.match(hook, /node_modules\/\.bin\/evidoc/);
    assert.match(hook, /Evidoc pre-commit skipped/);
    const prePush = await readFile(join(root, ".githooks", "pre-push"), "utf8");
    assert.match(prePush, /guard --event pre-push/);
    const unavailableRuntime = spawnSync("/bin/sh", [join(root, ".githooks", "pre-commit")], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, PATH: "/usr/bin:/bin" }
    });
    assert.equal(unavailableRuntime.status, 0);
    assert.match(unavailableRuntime.stderr, /Evidoc pre-commit skipped/);

    const nodeOnlyBin = await fixture("evidoc-node-only-");
    await symlink(process.execPath, join(nodeOnlyBin, "node"));
    const unavailableEvidoc = spawnSync("/bin/sh", [join(root, ".githooks", "pre-commit")], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, PATH: `${nodeOnlyBin}:/usr/bin:/bin` }
    });
    assert.equal(unavailableEvidoc.status, 0);
    assert.match(unavailableEvidoc.stderr, /install Evidoc locally\/globally/);

    await mkdir(join(root, "node_modules", ".bin"), { recursive: true });
    await write(root, "node_modules/.bin/evidoc", "#!/usr/bin/env node\n");
    await chmod(join(root, "node_modules", ".bin", "evidoc"), 0o755);
    const unavailableNode = spawnSync("/bin/sh", [join(root, ".githooks", "pre-commit")], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, PATH: "/usr/bin:/bin" }
    });
    assert.equal(unavailableNode.status, 0);
    assert.match(unavailableNode.stderr, /Evidoc pre-commit skipped/);

    const keptResponse = await fetch(`${baseUrl}/api/scaffold`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ root, features: ["agents", "hooks", "ci", "badge", "llms"] })
    });
    const keptPayload = await keptResponse.json() as {
      result: Array<{ feature: string; files: Array<{ path: string; status: string }> }>;
    };

    assert.equal(keptResponse.status, 200);
    assert.deepEqual(scaffoldStatusMap(keptPayload.result), {
      "agents:AGENTS.md": "kept",
      "agents:CLAUDE.md": "kept",
      "agents:.cursor/rules/evidoc.md": "kept",
      "agents:.github/copilot-instructions.md": "kept",
      "agents:.evidoc/skills/evidoc/SKILL.md": "kept",
      "hooks:.githooks/pre-commit": "kept",
      "hooks:.githooks/pre-push": "kept",
      "ci:.github/workflows/evidoc.yml": "kept",
      "badge:.evidoc/badge.md": "kept",
      "llms:llms.txt": "kept",
      "llms:.evidoc/context-pack.md": "kept"
    });
  } finally {
    await app.close();
  }
});

test("local app server can return a system-selected repository folder", async () => {
  const first = await fixture("evidoc-local-picker-first-");
  const selected = await fixture("evidoc-local-picker-selected-");
  await write(first, "README.md", "# First\n");
  await write(selected, "README.md", "# Selected\n");

  const app = await startLocalAppServer({
    roots: [first],
    port: 0,
    openBrowser: false,
    selectDirectory: async () => selected
  });
  try {
    const baseUrl = `http://127.0.0.1:${app.port}`;
    const pickerResponse = await fetch(`${baseUrl}/api/select-directory`, { method: "POST" });
    const picker = await pickerResponse.json() as { root: string };
    assert.equal(pickerResponse.status, 200);
    assert.equal(picker.root, await real(selected));

    const addResponse = await fetch(`${baseUrl}/api/repositories`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ root: picker.root })
    });
    const addState = await addResponse.json() as { summary: { repositoriesScanned: number } };
    assert.equal(addResponse.status, 200);
    assert.equal(addState.summary.repositoriesScanned, 2);
  } finally {
    await app.close();
  }
});

test("local app server can re-scan one repository without refreshing every repository", async () => {
  const first = await fixture("evidoc-local-rescan-first-");
  const second = await fixture("evidoc-local-rescan-second-");
  await write(first, "README.md", "# First\n");
  await write(second, "README.md", "# Second\n");

  const app = await startLocalAppServer({ roots: [first, second], port: 0, openBrowser: false, writeHistory: false });
  try {
    const baseUrl = `http://127.0.0.1:${app.port}`;
    await write(first, "README.md", "Code lives in `src/missing-first.ts`.\n");
    await write(second, "README.md", "Code lives in `src/missing-second.ts`.\n");

    const rescanResponse = await fetch(`${baseUrl}/api/scan`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ root: first })
    });
    const state = await rescanResponse.json() as { repositories: Array<{ root: string; health: string }> };

    assert.equal(rescanResponse.status, 200);
    assert.deepEqual(
      state.repositories.map((repository) => [repository.root, repository.health]),
      [
        [await real(first), "broken"],
        [await real(second), "ok"]
      ]
    );
  } finally {
    await app.close();
  }
});

test("local app state aggregates multiple repositories", async () => {
  const clean = await fixture("evidoc-local-clean-");
  const broken = await fixture("evidoc-local-broken-");
  await write(clean, "README.md", "# Clean\n");
  await write(broken, "README.md", "Code lives in `src/missing.ts`.\n");

  const state = await scanLocalAppRepositories([clean, broken], { autoInit: true, writeHistory: false });

  assert.equal(state.summary.repositoriesScanned, 2);
  assert.equal(state.summary.brokenRepositories, 1);
  assert.deepEqual(state.repositories.map((repo) => repo.health).sort(), ["broken", "ok"]);
});

test("startLocalAppServer falls back when the default port is occupied", async () => {
  const root = await fixture();
  await write(root, "README.md", "# Example\n");
  const blocker = await occupyDefaultPort();
  const app = await startLocalAppServer({ roots: [root], openBrowser: false });

  try {
    assert.notEqual(app.port, 4321);
  } finally {
    await app.close();
    if (blocker) await closeServer(blocker);
  }
});

async function occupyDefaultPort(): Promise<Server | undefined> {
  const server = createServer((_request, response) => {
    response.end("busy");
  });

  try {
    await new Promise<void>((resolveListen, reject) => {
      server.once("error", reject);
      server.listen(4321, "127.0.0.1", () => {
        server.off("error", reject);
        resolveListen();
      });
    });
    return server;
  } catch {
    return undefined;
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

function scaffoldStatusMap(result: Array<{ feature: string; files: Array<{ path: string; status: string }> }>): Record<string, string> {
  return Object.fromEntries(
    result.flatMap((entry) => entry.files.map((file) => [`${entry.feature}:${file.path}`, file.status]))
  );
}
