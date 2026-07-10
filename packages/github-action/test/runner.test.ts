import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { runGithubAction } from "../src/index.js";

async function fixture(): Promise<string> {
  return mkdtemp(join(tmpdir(), "evidoc-action-"));
}

async function write(root: string, file: string, text: string): Promise<void> {
  const target = join(root, file);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, text, "utf8");
}

test("runs a real action scan and applies fail policy", async () => {
  const root = await fixture();
  await write(root, "README.md", "Code lives in `src/missing.ts`.\n");

  const result = await runGithubAction({
    cwd: root,
    failOn: "broken"
  });

  assert.equal(result.exitCode, 1);
  assert.equal(result.report.summary.broken, 1);
  assert.equal(result.runtime.schemaVersion, "evidoc.agent-runtime.v1");
  assert.equal(result.runtime.event, "github_action");
  assert.equal(result.runtime.mode, "blocking");
  assert.equal(result.runtime.summary.broken, result.report.summary.broken);
  assert.match(result.markdownSummary, /Evidoc Report/);
});

test("surfaces workflow setup warnings in action outputs", async () => {
  const root = await fixture();
  await write(root, "README.md", "# Example\n");
  await write(
    root,
    ".github/workflows/evidoc.yml",
    [
      "name: Evidoc",
      "on:",
      "  pull_request:",
      "  push:",
      "jobs:",
      "  evidoc:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - uses: actions/checkout@v4",
      "      - uses: handong66/Evidoc/packages/github-action@main",
      "        with:",
      '          pr-comment: "true"',
      ""
    ].join("\n")
  );

  const result = await runGithubAction({
    cwd: root,
    failOn: "broken"
  });

  assert.equal(result.exitCode, 0);
  assert.match(result.markdownSummary, /CI setup warnings/);
  assert.match(result.markdownSummary, /duplicate push and pull-request checks/);
  assert.match(result.prComment, /CI setup warnings/);
  assert.match(result.prComment, /duplicate push and pull-request checks/);
});

test("surfaces disabled PR comment workflow warnings in action outputs", async () => {
  const root = await fixture();
  await write(root, "README.md", "# Example\n");
  await write(
    root,
    ".github/workflows/evidoc.yml",
    [
      "name: Evidoc",
      "on:",
      "  pull_request:",
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

  const result = await runGithubAction({
    cwd: root,
    failOn: "broken"
  });

  assert.match(result.markdownSummary, /PR comments are disabled/);
  assert.match(result.prComment, /PR comments are disabled/);
});

test("surfaces source-checkout Evidoc workflow setup warnings", async () => {
  const root = await fixture();
  await write(root, "README.md", "# Example\n");
  await write(
    root,
    ".github/workflows/ci.yml",
    [
      "name: CI",
      "on:",
      "  pull_request:",
      "  push:",
      "jobs:",
      "  test:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - uses: actions/checkout@v4",
      "      - run: npm run evidoc -- --fail-on=review_needed",
      ""
    ].join("\n")
  );

  const result = await runGithubAction({
    cwd: root,
    failOn: "broken"
  });

  assert.match(result.markdownSummary, /ci\.yml uses pull\\_request plus unfiltered push/);
  assert.doesNotMatch(result.markdownSummary, /PR comments are disabled/);
});

test("surfaces setup warnings for workflows delegated to local composite actions", async () => {
  const root = await fixture();
  await write(root, "README.md", "# Example\n");
  await write(
    root,
    ".github/workflows/ci.yml",
    [
      "name: CI",
      "on:",
      "  pull_request:",
      "  push:",
      "jobs:",
      "  test:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - uses: actions/checkout@v4",
      "      - uses: ./.github/actions/evidoc-check",
      ""
    ].join("\n")
  );
  await write(
    root,
    ".github/actions/evidoc-check/action.yml",
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

  const result = await runGithubAction({
    cwd: root,
    failOn: "broken"
  });

  assert.match(result.markdownSummary, /ci\.yml uses pull\\_request plus unfiltered push/);
  assert.doesNotMatch(result.markdownSummary, /PR comments are disabled/);
});

test("surfaces advisory source-checkout Evidoc fail policy warnings", async () => {
  const root = await fixture();
  await write(root, "README.md", "# Example\n");
  await write(
    root,
    ".github/workflows/ci.yml",
    [
      "name: CI",
      "on:",
      "  pull_request:",
      "jobs:",
      "  test:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - uses: actions/checkout@v4",
      "      - run: npm run evidoc -- --fail-on=broken",
      ""
    ].join("\n")
  );

  const result = await runGithubAction({
    cwd: root,
    failOn: "broken"
  });

  assert.match(result.markdownSummary, /fail-on: broken is advisory/);
  assert.doesNotMatch(result.markdownSummary, /PR comments are disabled/);
});

test("sanitizes workflow warning values before rendering action markdown", async () => {
  const root = await fixture();
  const eventPath = join(root, "event.json");
  await write(root, "README.md", "# Example\n");
  await write(root, "event.json", JSON.stringify({ repository: { default_branch: "main\n```hijack" } }));
  await write(
    root,
    ".github/workflows/evidoc.yml",
    [
      "name: Evidoc",
      "on:",
      "  pull_request:",
      "  push:",
      "    branches:",
      "      - trunk",
      "jobs:",
      "  evidoc:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - uses: actions/checkout@v4",
      "      - uses: handong66/Evidoc/packages/github-action@main",
      "        with:",
      '          pr-comment: "true"',
      ""
    ].join("\n")
  );

  const previousEventPath = process.env.GITHUB_EVENT_PATH;
  process.env.GITHUB_EVENT_PATH = eventPath;
  try {
    const result = await runGithubAction({
      cwd: root,
      failOn: "broken"
    });

    assert.doesNotMatch(result.markdownSummary, /hijack/);
    assert.doesNotMatch(result.markdownSummary, /```/);
  } finally {
    if (previousEventPath === undefined) {
      delete process.env.GITHUB_EVENT_PATH;
    } else {
      process.env.GITHUB_EVENT_PATH = previousEventPath;
    }
  }
});

test("sanitizes workflow filenames before rendering action markdown", async () => {
  const root = await fixture();
  await write(root, "README.md", "# Example\n");
  await write(
    root,
    ".github/workflows/[click](evil.example).yml",
    [
      "name: Evidoc",
      "on:",
      "  pull_request:",
      "  push:",
      "jobs:",
      "  evidoc:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - uses: actions/checkout@v4",
      "      - uses: handong66/Evidoc/packages/github-action@main",
      "        with:",
      '          pr-comment: "true"',
      ""
    ].join("\n")
  );

  const result = await runGithubAction({
    cwd: root,
    failOn: "broken"
  });

  assert.doesNotMatch(result.markdownSummary, /\[click\]\(evil\.example\)/);
  assert.doesNotMatch(result.prComment, /\[click\]\(evil\.example\)/);
  assert.match(result.markdownSummary, /\\\[click\\\]\\\(evil\.example\\\)/);
  assert.match(result.prComment, /\\\[click\\\]\\\(evil\.example\\\)/);
});

test("escapes emphasis characters in workflow filenames before rendering action markdown", async () => {
  const root = await fixture();
  await write(root, "README.md", "# Example\n");
  await write(
    root,
    ".github/workflows/*important*_~name~.yml",
    [
      "name: Evidoc",
      "on:",
      "  pull_request:",
      "  push:",
      "jobs:",
      "  evidoc:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - uses: actions/checkout@v4",
      "      - uses: handong66/Evidoc/packages/github-action@main",
      "        with:",
      '          pr-comment: "true"',
      ""
    ].join("\n")
  );

  const result = await runGithubAction({
    cwd: root,
    failOn: "broken"
  });

  assert.match(result.markdownSummary, /\\\*important\\\*\\_\\~name\\~\.yml/);
  assert.match(result.prComment, /\\\*important\\\*\\_\\~name\\~\.yml/);
});

test("keeps safe non-alphanumeric default branch names in setup warnings", async () => {
  const root = await fixture();
  const eventPath = join(root, "event.json");
  await write(root, "README.md", "# Example\n");
  await write(root, "event.json", JSON.stringify({ repository: { default_branch: "release/v2@prod" } }));
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
      '          pr-comment: "true"',
      ""
    ].join("\n")
  );

  const previousEventPath = process.env.GITHUB_EVENT_PATH;
  process.env.GITHUB_EVENT_PATH = eventPath;
  try {
    const result = await runGithubAction({
      cwd: root,
      failOn: "broken"
    });

    assert.match(result.markdownSummary, /default branch release\/v2@prod/);
  } finally {
    if (previousEventPath === undefined) {
      delete process.env.GITHUB_EVENT_PATH;
    } else {
      process.env.GITHUB_EVENT_PATH = previousEventPath;
    }
  }
});

test("skips unreadable workflow files when surfacing action setup warnings", async () => {
  const root = await fixture();
  await write(root, "README.md", "# Example\n");
  await mkdir(join(root, ".github/workflows"), { recursive: true });
  await symlink(join(root, "missing-workflow.yml"), join(root, ".github/workflows/a-broken.yml"));
  await write(
    root,
    ".github/workflows/b-evidoc.yml",
    [
      "name: Evidoc",
      "on:",
      "  pull_request:",
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

  const result = await runGithubAction({
    cwd: root,
    failOn: "broken"
  });

  assert.equal(result.exitCode, 0);
  assert.match(result.markdownSummary, /b-evidoc\.yml PR comments are disabled/);
});

test("surfaces setup warnings from every Evidoc workflow", async () => {
  const root = await fixture();
  await write(root, "README.md", "# Example\n");
  await write(
    root,
    ".github/workflows/a-evidoc.yml",
    [
      "name: Evidoc A",
      "on:",
      "  pull_request:",
      "  push:",
      "jobs:",
      "  evidoc:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - uses: actions/checkout@v4",
      "      - uses: handong66/Evidoc/packages/github-action@main",
      "        with:",
      '          pr-comment: "true"',
      ""
    ].join("\n")
  );
  await write(
    root,
    ".github/workflows/b-evidoc.yml",
    [
      "name: Evidoc B",
      "on:",
      "  pull_request:",
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

  const result = await runGithubAction({
    cwd: root,
    failOn: "broken"
  });

  assert.match(result.markdownSummary, /a-evidoc\.yml uses pull\\_request plus unfiltered push/);
  assert.match(result.markdownSummary, /b-evidoc\.yml PR comments are disabled/);
});
