import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { runCli } from "../src/index.js";

const execFileAsync = promisify(execFile);

async function fixture(): Promise<string> {
  return mkdtemp(join(tmpdir(), "evidoc-onboarding-"));
}

async function write(root: string, file: string, text: string): Promise<void> {
  const target = join(root, file);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, text, "utf8");
}

function shellArg(value: string): string {
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", "'\\''")}'`;
}

async function gitInitBranch(root: string, branch: string): Promise<void> {
  try {
    await execFileAsync("git", ["init", "--initial-branch", branch], { cwd: root });
  } catch {
    await execFileAsync("git", ["init"], { cwd: root });
    await execFileAsync("git", ["checkout", "-b", branch], { cwd: root });
  }
}

test("init creates config and GitHub workflow for zero-friction onboarding", async () => {
  const root = await fixture();
  await write(root, "README.md", "# Example\n");
  await write(root, "package.json", JSON.stringify({ packageManager: "pnpm@10.0.0" }));

  let stdout = "";
  const exitCode = await runCli(["init", "--yes"], {
    cwd: root,
    stdout: (chunk: string) => {
      stdout += chunk;
    },
    stderr: () => {}
  });

  assert.equal(exitCode, 0);
  assert.equal(existsSync(join(root, ".evidoc", "config.json")), true);
  assert.equal(existsSync(join(root, ".evidoc", ".gitignore")), true);
  assert.equal(existsSync(join(root, ".github", "workflows", "evidoc.yml")), true);
  assert.match(stdout, /Evidoc initialized/);
  assert.match(stdout, /npx evidoc check/);
  assert.match(stdout, /Source checkout fallback/);
  assert.ok(stdout.includes(`npx evidoc check --root ${shellArg(root)} --fail-on=review_needed`));
  assert.ok(stdout.includes(`npm run evidoc -- check --root ${root} --fail-on=review_needed`));
  assert.match(stdout, /git add \.evidoc\/config\.json \.evidoc\/\.gitignore \.github\/workflows\/evidoc\.yml/);
  assert.doesNotMatch(stdout, /git add \.evidoc \.github/);

  const config = JSON.parse(await readFile(join(root, ".evidoc", "config.json"), "utf8"));
  assert.deepEqual(config.docRoots, ["README.md"]);
  assert.equal(config.reviewTtlDays, 90);
  assert.equal(config.maxFileBytes, 500000);
  assert.match(await readFile(join(root, ".evidoc", ".gitignore"), "utf8"), /^history\.jsonl$/m);

  const workflow = await readFile(join(root, ".github", "workflows", "evidoc.yml"), "utf8");
  assert.match(workflow, /handong66\/Evidoc\/packages\/github-action@main\n/);
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
});

test("init includes the detected repository branch in the generated GitHub workflow", async () => {
  const root = await fixture();
  await write(root, "README.md", "# Example\n");
  await gitInitBranch(root, "trunk");

  const exitCode = await runCli(["init", "--yes"], {
    cwd: root,
    stdout: () => {},
    stderr: () => {}
  });

  assert.equal(exitCode, 0);
  const workflow = await readFile(join(root, ".github", "workflows", "evidoc.yml"), "utf8");
  assert.match(workflow, /branches:\n      - trunk\n/);
});

test("init --local-git creates a local Git gate without a GitHub workflow", async () => {
  const root = await fixture();
  await gitInitBranch(root, "main");
  await write(root, "README.md", "# Example\n");

  let stdout = "";
  const exitCode = await runCli(["init", "--yes", "--local-git"], {
    cwd: root,
    stdout: (chunk: string) => {
      stdout += chunk;
    },
    stderr: () => {}
  });

  assert.equal(exitCode, 0);
  assert.equal(existsSync(join(root, ".evidoc", "config.json")), true);
  assert.equal(existsSync(join(root, ".evidoc", ".gitignore")), true);
  assert.equal(existsSync(join(root, ".githooks", "pre-commit")), true);
  assert.equal(existsSync(join(root, ".githooks", "pre-push")), true);
  assert.equal(existsSync(join(root, ".github", "workflows", "evidoc.yml")), false);
  assert.match(stdout, /Local Git Gate: created/);
  assert.match(stdout, /git config core\.hooksPath \.githooks/);
  assert.match(stdout, /evidoc guard --event pre-commit/);
  assert.match(stdout, /GitHub Action: skipped/);

  const preCommit = await readFile(join(root, ".githooks", "pre-commit"), "utf8");
  assert.match(preCommit, /guard --event pre-commit/);
  const prePush = await readFile(join(root, ".githooks", "pre-push"), "utf8");
  assert.match(prePush, /guard --event pre-push/);
});

test("init --local-git --install-hooks configures repo-local hooksPath", async () => {
  const root = await fixture();
  await gitInitBranch(root, "main");
  await write(root, "README.md", "# Example\n");

  const exitCode = await runCli(["init", "--yes", "--local-git", "--install-hooks"], {
    cwd: root,
    stdout: () => {},
    stderr: () => {}
  });

  assert.equal(exitCode, 0);
  const { stdout } = await execFileAsync("git", ["config", "--get", "core.hooksPath"], { cwd: root });
  assert.equal(stdout.trim(), ".githooks");
});

test("init --with scaffolds agent, hook, badge, and context-pack assets", async () => {
  const root = await fixture();
  await write(root, "README.md", "# Example\n");

  let stdout = "";
  const exitCode = await runCli(["init", "--yes", "--no-action", "--with", "agents,hooks,badge,llms"], {
    cwd: root,
    stdout: (chunk: string) => {
      stdout += chunk;
    },
    stderr: () => {}
  });

  assert.equal(exitCode, 0);
  assert.equal(existsSync(join(root, "AGENTS.md")), true);
  assert.equal(existsSync(join(root, "CLAUDE.md")), true);
  assert.equal(existsSync(join(root, ".cursor", "rules", "evidoc.md")), true);
  assert.equal(existsSync(join(root, ".github", "copilot-instructions.md")), true);
  assert.equal(existsSync(join(root, ".githooks", "pre-commit")), true);
  assert.equal(existsSync(join(root, ".githooks", "pre-push")), true);
  assert.equal(existsSync(join(root, ".evidoc", "badge.md")), true);
  assert.equal(existsSync(join(root, ".evidoc", "skills", "evidoc", "SKILL.md")), true);
  assert.equal(existsSync(join(root, "llms.txt")), true);
  assert.equal(existsSync(join(root, ".evidoc", "context-pack.md")), true);
  assert.match(stdout, /scaffold agents: created AGENTS\.md/);
  const gitAddLine = stdout.split(/\r?\n/).find((line) => line.startsWith("  git add "));
  assert.ok(gitAddLine);
  const gitAddPaths = new Set(gitAddLine.trim().split(/\s+/).slice(2));
  for (const path of [
    ".evidoc/config.json",
    ".evidoc/.gitignore",
    "AGENTS.md",
    "CLAUDE.md",
    ".cursor/rules/evidoc.md",
    ".github/copilot-instructions.md",
    ".githooks/pre-commit",
    ".githooks/pre-push",
    ".evidoc/badge.md",
    ".evidoc/skills/evidoc/SKILL.md",
    "llms.txt",
    ".evidoc/context-pack.md"
  ]) {
    assert.equal(gitAddPaths.has(path), true);
  }
  assert.match(await readFile(join(root, ".githooks", "pre-commit"), "utf8"), /guard --event pre-commit/);
  assert.match(await readFile(join(root, ".githooks", "pre-push"), "utf8"), /guard --event pre-push/);
  const agents = await readFile(join(root, "AGENTS.md"), "utf8");
  assert.match(agents, /Evidoc Agent Runtime Contract/);
  assert.match(agents, /evidoc guard --event manual --scope staged --json/);
  assert.match(agents, /fingerprint/);
  const skill = await readFile(join(root, ".evidoc", "skills", "evidoc", "SKILL.md"), "utf8");
  assert.match(skill, /name: evidoc/);
  assert.match(skill, /evidoc\.get_drift_status/);
  assert.match(skill, /dedupe by runtime\.findings\[\]\.fingerprint/);
});

test("help exposes init scaffold flags in the usage line", async () => {
  let stdout = "";
  const exitCode = await runCli(["--help"], {
    cwd: await fixture(),
    stdout: (chunk: string) => {
      stdout += chunk;
    },
    stderr: () => {}
  });

  assert.equal(exitCode, 0);
  assert.match(
    stdout,
    /evidoc init --yes \[--root path\] \[--force\] \[--no-action\] \[--local-git\] \[--install-hooks\] \[--with features\]/
  );
  assert.match(stdout, /hook events default to --fail-on=review_needed/);
});

test("init next commands quote repository roots with shell-special characters", async () => {
  const parent = await fixture();
  const root = join(parent, "repo with spaces");
  await write(root, "README.md", "# Example\n");

  let stdout = "";
  const exitCode = await runCli(["init", "--yes", "--no-action", "--root", root], {
    cwd: parent,
    stdout: (chunk: string) => {
      stdout += chunk;
    },
    stderr: () => {}
  });

  assert.equal(exitCode, 0);
  assert.ok(stdout.includes(`npx evidoc check --root ${shellArg(root)} --fail-on=review_needed`));
  assert.ok(stdout.includes(`npm run evidoc -- check --root ${shellArg(root)} --fail-on=review_needed`));
});

test("init includes agent instruction files when they exist", async () => {
  const root = await fixture();
  await write(root, "README.md", "# Example\n");
  await write(root, "AGENTS.md", "packageManager: npm\n");
  await write(root, "CLAUDE.md", "packageManager: npm\n");

  await runCli(["init", "--yes", "--no-action"], {
    cwd: root,
    stdout: () => {},
    stderr: () => {}
  });

  const config = JSON.parse(await readFile(join(root, ".evidoc", "config.json"), "utf8"));
  assert.deepEqual(config.docRoots, ["README.md", "AGENTS.md", "CLAUDE.md"]);
});

test("init is idempotent by default and force can replace generated files", async () => {
  const root = await fixture();
  await write(root, ".evidoc/config.json", JSON.stringify({ docRoots: ["docs"] }));

  let stdout = "";
  const exitCode = await runCli(["init", "--yes"], {
    cwd: root,
    stdout: (chunk: string) => {
      stdout += chunk;
    },
    stderr: () => {}
  });

  assert.equal(exitCode, 0);
  assert.match(stdout, /kept existing/);
  assert.deepEqual(JSON.parse(await readFile(join(root, ".evidoc", "config.json"), "utf8")).docRoots, [
    "docs"
  ]);

  await runCli(["init", "--yes", "--force", "--no-action"], {
    cwd: root,
    stdout: () => {},
    stderr: () => {}
  });
  assert.deepEqual(JSON.parse(await readFile(join(root, ".evidoc", "config.json"), "utf8")).docRoots, []);
});

test("doctor reports missing and ready onboarding state", async () => {
  const root = await fixture();

  let stdout = "";
  const missingExitCode = await runCli(["doctor"], {
    cwd: root,
    stdout: (chunk: string) => {
      stdout += chunk;
    },
    stderr: () => {}
  });

  assert.equal(missingExitCode, 1);
  assert.match(stdout, /not initialized/i);
  assert.match(stdout, /npx evidoc init --yes/);
  assert.match(stdout, /Source checkout fallback/);
  assert.ok(stdout.includes(`npx evidoc init --yes --root ${shellArg(root)}`));
  assert.ok(stdout.includes(`npm run evidoc -- init --yes --root ${shellArg(root)}`));

  await runCli(["init", "--yes"], {
    cwd: root,
    stdout: () => {},
    stderr: () => {}
  });

  stdout = "";
  const readyExitCode = await runCli(["doctor"], {
    cwd: root,
    stdout: (chunk: string) => {
      stdout += chunk;
    },
    stderr: () => {}
  });

  assert.equal(readyExitCode, 0);
  assert.match(stdout, /ready/i);
  assert.match(stdout, /config/i);
  assert.match(stdout, /GitHub Action/i);
  assert.doesNotMatch(stdout, /Local Git Gate issues:/);
  assert.doesNotMatch(stdout, /Warnings:/);
  assert.ok(stdout.includes(`npx evidoc check --root ${shellArg(root)} --fail-on=review_needed`));
  assert.ok(stdout.includes(`npm run evidoc -- check --root ${shellArg(root)} --fail-on=review_needed`));
});

test("doctor reports detected agent surfaces and default MCP entrypoint", async () => {
  const root = await fixture();
  await write(root, "README.md", "# Example\n");
  await write(root, "AGENTS.md", "Use Evidoc before documentation edits.\n");
  await write(root, "CLAUDE.md", "Use Evidoc before documentation edits.\n");

  await runCli(["init", "--yes"], {
    cwd: root,
    stdout: () => {},
    stderr: () => {}
  });

  let stdout = "";
  const exitCode = await runCli(["doctor"], {
    cwd: root,
    stdout: (chunk: string) => {
      stdout += chunk;
    },
    stderr: () => {}
  });

  assert.equal(exitCode, 0);
  assert.match(stdout, /Agent surfaces: AGENTS\.md, CLAUDE\.md/);
  assert.match(stdout, /MCP default: evidoc\.agent_scan/);
  assert.match(stdout, /MCP status: evidoc\.get_drift_status/);
});

test("doctor accepts an existing custom workflow that already runs Evidoc", async () => {
  const root = await fixture();
  await write(root, "README.md", "# Example\n");
  await write(root, ".evidoc/config.json", JSON.stringify({ docRoots: ["README.md"] }));
  await write(
    root,
    ".github/workflows/docs.yml",
    [
      "name: Docs",
      "on: pull_request",
      "jobs:",
      "  evidoc:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - uses: actions/checkout@v4",
      "      - uses: handong66/Evidoc/packages/github-action@main",
      "        with:",
      "          pr-comment: 'true'",
      ""
    ].join("\n")
  );

  let stdout = "";
  const exitCode = await runCli(["doctor"], {
    cwd: root,
    stdout: (chunk: string) => {
      stdout += chunk;
    },
    stderr: () => {}
  });

  assert.equal(exitCode, 0);
  assert.match(stdout, /ready/i);
  assert.match(stdout, /docs\.yml/);
  assert.doesNotMatch(stdout, /Warnings:/);
});

test("doctor accepts legacy DriftGuard packaged workflows after repository rename", async () => {
  const root = await fixture();
  await write(root, "README.md", "# Example\n");
  await write(root, ".evidoc/config.json", JSON.stringify({ docRoots: ["README.md"] }));
  await write(
    root,
    ".github/workflows/driftguard.yml",
    [
      "name: Legacy docs gate",
      "on: pull_request",
      "jobs:",
      "  evidoc:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - uses: actions/checkout@v4",
      "      - uses: handong66/DriftGuard/packages/github-action@main",
      "        with:",
      "          pr-comment: 'true'",
      ""
    ].join("\n")
  );

  let stdout = "";
  const exitCode = await runCli(["doctor"], {
    cwd: root,
    stdout: (chunk: string) => {
      stdout += chunk;
    },
    stderr: () => {}
  });

  assert.equal(exitCode, 0);
  assert.match(stdout, /ready/i);
  assert.match(stdout, /driftguard\.yml/);
  assert.doesNotMatch(stdout, /not initialized/i);
});

test("doctor accepts a source-checkout CI self-scan workflow", async () => {
  const root = await fixture();
  await write(root, "README.md", "# Example\n");
  await write(root, ".evidoc/config.json", JSON.stringify({ docRoots: ["README.md"] }));
  await write(
    root,
    ".github/workflows/ci.yml",
    [
      "name: CI",
      "on:",
      "  pull_request:",
      "  push:",
      "    branches:",
      "      - main",
      "jobs:",
      "  test:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - uses: actions/checkout@v4",
      "      - uses: actions/setup-node@v4",
      "        with:",
      '          node-version: "22"',
      "      - run: npm ci",
      "      - run: npm test",
      "      - run: npm run evidoc -- --fail-on=review_needed",
      ""
    ].join("\n")
  );

  let stdout = "";
  const exitCode = await runCli(["doctor"], {
    cwd: root,
    stdout: (chunk: string) => {
      stdout += chunk;
    },
    stderr: () => {}
  });

  assert.equal(exitCode, 0);
  assert.match(stdout, /ready/i);
  assert.match(stdout, /ci\.yml/);
  assert.doesNotMatch(stdout, /PR comments are disabled/);
  assert.doesNotMatch(stdout, /Local Git Gate issues:/);
});

test("doctor accepts a workflow delegated to a local composite action that runs Evidoc", async () => {
  const root = await fixture();
  await write(root, "README.md", "# Example\n");
  await write(root, ".evidoc/config.json", JSON.stringify({ docRoots: ["README.md"] }));
  await write(
    root,
    ".github/workflows/ci.yml",
    [
      "name: CI",
      "on:",
      "  pull_request:",
      "  push:",
      "    branches:",
      "      - main",
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

  let stdout = "";
  const exitCode = await runCli(["doctor"], {
    cwd: root,
    stdout: (chunk: string) => {
      stdout += chunk;
    },
    stderr: () => {}
  });

  assert.equal(exitCode, 0);
  assert.match(stdout, /ready/i);
  assert.match(stdout, /ci\.yml/);
  assert.doesNotMatch(stdout, /PR comments are disabled/);
  assert.doesNotMatch(stdout, /Local Git Gate issues:/);
});

test("doctor warns for source-checkout advisory fail-on policy", async () => {
  const root = await fixture();
  await write(root, "README.md", "# Example\n");
  await write(root, ".evidoc/config.json", JSON.stringify({ docRoots: ["README.md"] }));
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
      "      - uses: actions/setup-node@v4",
      "        with:",
      '          node-version: "22"',
      "      - run: npm ci",
      "      - run: npm test",
      '      - run: npm run evidoc -- --fail-on="broken"',
      ""
    ].join("\n")
  );

  let stdout = "";
  const exitCode = await runCli(["doctor"], {
    cwd: root,
    stdout: (chunk: string) => {
      stdout += chunk;
    },
    stderr: () => {}
  });

  assert.equal(exitCode, 0);
  assert.match(stdout, /ready/i);
  assert.match(stdout, /fail-on: broken is advisory/);
  assert.doesNotMatch(stdout, /PR comments are disabled/);
});

test("doctor warns when an Evidoc workflow can duplicate pull request checks", async () => {
  const root = await fixture();
  await write(root, "README.md", "# Example\n");
  await write(root, ".evidoc/config.json", JSON.stringify({ docRoots: ["README.md"] }));
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
      ""
    ].join("\n")
  );

  let stdout = "";
  const exitCode = await runCli(["doctor"], {
    cwd: root,
    stdout: (chunk: string) => {
      stdout += chunk;
    },
    stderr: () => {}
  });

  assert.equal(exitCode, 0);
  assert.match(stdout, /ready/i);
  assert.match(stdout, /Warnings:/);
  assert.match(stdout, /duplicate push and pull-request checks/);
  assert.match(stdout, /push\.branches/);
});

test("doctor warns for list-style pull request and push triggers", async () => {
  const root = await fixture();
  await write(root, "README.md", "# Example\n");
  await write(root, ".evidoc/config.json", JSON.stringify({ docRoots: ["README.md"] }));
  await write(
    root,
    ".github/workflows/evidoc.yml",
    [
      "name: Evidoc",
      "on:",
      "  - pull_request",
      "  - push",
      "jobs:",
      "  evidoc:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - uses: actions/checkout@v4",
      "      - uses: handong66/Evidoc/packages/github-action@main",
      ""
    ].join("\n")
  );

  let stdout = "";
  const exitCode = await runCli(["doctor"], {
    cwd: root,
    stdout: (chunk: string) => {
      stdout += chunk;
    },
    stderr: () => {}
  });

  assert.equal(exitCode, 0);
  assert.match(stdout, /Warnings:/);
  assert.match(stdout, /duplicate push and pull-request checks/);
});

test("doctor sanitizes workflow warning filenames in text output", async () => {
  const root = await fixture();
  await write(root, "README.md", "# Example\n");
  await write(root, ".evidoc/config.json", JSON.stringify({ docRoots: ["README.md"] }));
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

  let stdout = "";
  const exitCode = await runCli(["doctor"], {
    cwd: root,
    stdout: (chunk: string) => {
      stdout += chunk;
    },
    stderr: () => {}
  });

  assert.equal(exitCode, 0);
  assert.doesNotMatch(stdout, /\[click\]\(evil\.example\)/);
  assert.match(stdout, /\\\[click\\\]\\\(evil\.example\\\)/);
});

test("doctor warns when push branches omit the detected repository branch", async () => {
  const root = await fixture();
  await write(root, "README.md", "# Example\n");
  await write(root, ".evidoc/config.json", JSON.stringify({ docRoots: ["README.md"] }));
  await gitInitBranch(root, "trunk");
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
      "      - master",
      "jobs:",
      "  evidoc:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - uses: actions/checkout@v4",
      "      - uses: handong66/Evidoc/packages/github-action@main",
      ""
    ].join("\n")
  );

  let stdout = "";
  const exitCode = await runCli(["doctor"], {
    cwd: root,
    stdout: (chunk: string) => {
      stdout += chunk;
    },
    stderr: () => {}
  });

  assert.equal(exitCode, 0);
  assert.match(stdout, /Warnings:/);
  assert.match(stdout, /default branch trunk/);
  assert.match(stdout, /push\.branches/);
});

test("doctor accepts inline push branches that include the detected repository branch", async () => {
  const root = await fixture();
  await write(root, "README.md", "# Example\n");
  await write(root, ".evidoc/config.json", JSON.stringify({ docRoots: ["README.md"] }));
  await gitInitBranch(root, "trunk");
  await write(
    root,
    ".github/workflows/evidoc.yml",
    [
      "name: Evidoc",
      "on:",
      "  pull_request:",
      "  push:",
      "    branches: [main, trunk]",
      "jobs:",
      "  evidoc:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - uses: actions/checkout@v4",
      "      - uses: handong66/Evidoc/packages/github-action@main",
      ""
    ].join("\n")
  );

  let stdout = "";
  const exitCode = await runCli(["doctor"], {
    cwd: root,
    stdout: (chunk: string) => {
      stdout += chunk;
    },
    stderr: () => {}
  });

  assert.equal(exitCode, 0);
  assert.doesNotMatch(stdout, /push\.branches does not include detected default branch trunk/);
});

test("doctor warns when PR comments are disabled in the Evidoc workflow", async () => {
  const root = await fixture();
  await write(root, "README.md", "# Example\n");
  await write(root, ".evidoc/config.json", JSON.stringify({ docRoots: ["README.md"] }));
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

  let stdout = "";
  const exitCode = await runCli(["doctor"], {
    cwd: root,
    stdout: (chunk: string) => {
      stdout += chunk;
    },
    stderr: () => {}
  });

  assert.equal(exitCode, 0);
  assert.match(stdout, /Warnings:/);
  assert.match(stdout, /PR comments are disabled/);
  assert.match(stdout, /pr-comment: "true"/);
});

test("doctor warns when security-events permission is kept while SARIF is disabled", async () => {
  const root = await fixture();
  await write(root, "README.md", "# Example\n");
  await write(root, ".evidoc/config.json", JSON.stringify({ docRoots: ["README.md"] }));
  await write(
    root,
    ".github/workflows/evidoc.yml",
    [
      "name: Evidoc",
      "on:",
      "  pull_request:",
      "permissions:",
      "  contents: read",
      "  actions: read",
      "  security-events: write",
      "  pull-requests: write",
      "jobs:",
      "  evidoc:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - uses: actions/checkout@v4",
      "      - uses: handong66/Evidoc/packages/github-action@main",
      "        with:",
      '          sarif: "false"',
      '          pr-comment: "true"',
      ""
    ].join("\n")
  );

  let stdout = "";
  const exitCode = await runCli(["doctor"], {
    cwd: root,
    stdout: (chunk: string) => {
      stdout += chunk;
    },
    stderr: () => {}
  });

  assert.equal(exitCode, 0);
  assert.match(stdout, /Warnings:/);
  assert.match(stdout, /security-events: write is only needed when sarif: "true"/);
});

test("doctor warns when Evidoc workflow only gates broken findings", async () => {
  const root = await fixture();
  await write(root, "README.md", "# Example\n");
  await write(root, ".evidoc/config.json", JSON.stringify({ docRoots: ["README.md"] }));
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
      "          fail-on: broken",
      '          pr-comment: "true"',
      ""
    ].join("\n")
  );

  let stdout = "";
  const exitCode = await runCli(["doctor"], {
    cwd: root,
    stdout: (chunk: string) => {
      stdout += chunk;
    },
    stderr: () => {}
  });

  assert.equal(exitCode, 0);
  assert.match(stdout, /Warnings:/);
  assert.match(stdout, /fail-on: broken is advisory/);
  assert.match(stdout, /fail-on: review_needed/);
});

test("doctor rejects invalid config and missing configured paths", async () => {
  const root = await fixture();
  await write(root, ".github/workflows/evidoc.yml", "steps:\n  - uses: handong66/Evidoc/packages/github-action@main\n");
  await write(root, ".evidoc/config.json", "{");

  let stdout = "";
  const invalidExitCode = await runCli(["doctor"], {
    cwd: root,
    stdout: (chunk: string) => {
      stdout += chunk;
    },
    stderr: () => {}
  });

  assert.equal(invalidExitCode, 1);
  assert.match(stdout, /invalid JSON/i);

  await write(root, ".evidoc/config.json", JSON.stringify({ docRoots: ["docs"], apiSpecPaths: ["openapi.json"] }));

  stdout = "";
  const missingExitCode = await runCli(["doctor"], {
    cwd: root,
    stdout: (chunk: string) => {
      stdout += chunk;
    },
    stderr: () => {}
  });

  assert.equal(missingExitCode, 1);
  assert.match(stdout, /missing configured docRoots: docs/i);
  assert.match(stdout, /missing configured apiSpecPaths: openapi\.json/i);
});
