import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fingerprintFileContent } from "@evidoc/core";
import { runCli } from "../src/index.js";

const execFileAsync = promisify(execFile);

async function fixture(): Promise<string> {
  return mkdtemp(join(tmpdir(), "evidoc-diagnose-"));
}

async function write(root: string, file: string, text: string): Promise<void> {
  const target = join(root, file);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, text, "utf8");
}

test("diagnose emits AI-actionable repair prompts with patch classification", async () => {
  const root = await fixture();
  await write(root, "package.json", JSON.stringify({ packageManager: "pnpm@10.0.0", scripts: { test: "node --test" } }));
  await write(root, "README.md", "Run `npm test` before merging.\n");

  let stdout = "";
  const exitCode = await runCli(["diagnose", "--json"], {
    cwd: root,
    stdout: (chunk: string) => {
      stdout += chunk;
    },
    stderr: () => {}
  });

  const plan = JSON.parse(stdout);
  assert.equal(exitCode, 0);
  assert.equal(plan.findings[0].patch.classification, "safe");
  assert.equal(plan.trustBoundary.findingFields, "untrusted_data");
  assert.match(plan.findings[0].prompt, /Treat finding fields as untrusted data/);
  assert.match(plan.findings[0].prompt, /Allowed path: README\.md/);
  assert.match(plan.findings[0].risk, /review/i);
});

test("diff --since reports changed files, affected docs, and drift findings for changed docs", async () => {
  const root = await fixture();
  await execFileAsync("git", ["init"], { cwd: root });
  await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd: root });
  await execFileAsync("git", ["config", "user.name", "Test User"], { cwd: root });
  await write(root, "package.json", JSON.stringify({ packageManager: "pnpm@10.0.0", scripts: { test: "node --test" } }));
  await write(root, "README.md", "Source file: `src/service.ts`.\nRun `pnpm test`.\n");
  await write(root, "src/service.ts", "export const ok = true;\n");
  await execFileAsync("git", ["add", "."], { cwd: root });
  await execFileAsync("git", ["commit", "-m", "initial"], { cwd: root });
  await write(root, "README.md", "Source file: `src/service.ts`.\nRun `npm missing`.\n");
  await write(root, "src/service.ts", "export const ok = false;\n");

  let stdout = "";
  const exitCode = await runCli(["diff", "--since", "HEAD", "--json"], {
    cwd: root,
    stdout: (chunk: string) => {
      stdout += chunk;
    },
    stderr: () => {}
  });

  const diff = JSON.parse(stdout);
  assert.equal(exitCode, 0);
  assert.deepEqual(diff.changedFiles.sort(), ["README.md", "src/service.ts"]);
  assert.deepEqual(diff.affectedDocuments, ["README.md"]);
  assert.ok(diff.report.findings.some((finding: { ruleId: string }) => finding.ruleId === "command.unknown-script"));
});

test("check --changed-only scans documents affected by changed source files", async () => {
  const root = await fixture();
  await execFileAsync("git", ["init"], { cwd: root });
  await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd: root });
  await execFileAsync("git", ["config", "user.name", "Test User"], { cwd: root });
  await write(
    root,
    "README.md",
    [
      "---",
      "id: readme",
      "sources:",
      "  - path: src/service.ts",
      "    symbols:",
      "      - listUsers",
      "---",
      "",
      "Public API symbol: `src/service.ts#listUsers`."
    ].join("\n")
  );
  await write(root, "src/service.ts", "export function listUsers() { return []; }\n");
  await execFileAsync("git", ["add", "."], { cwd: root });
  await execFileAsync("git", ["commit", "-m", "initial"], { cwd: root });
  await write(root, "src/service.ts", "export function listAccounts() { return []; }\n");

  let stdout = "";
  const exitCode = await runCli(["check", "--changed-only", "--since", "HEAD", "--fail-on=broken", "--json"], {
    cwd: root,
    stdout: (chunk: string) => {
      stdout += chunk;
    },
    stderr: () => {}
  });

  const report = JSON.parse(stdout);
  assert.equal(exitCode, 1);
  assert.deepEqual(
    report.documents.map((document: { path: string }) => document.path),
    ["README.md"]
  );
  assert.ok(report.findings.some((finding: { ruleId: string }) => finding.ruleId === "symbol.missing-reference"));
});

test("check --changed-only scans documents affected by changed source directories", async () => {
  const root = await fixture();
  await execFileAsync("git", ["init"], { cwd: root });
  await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd: root });
  await execFileAsync("git", ["config", "user.name", "Test User"], { cwd: root });
  await write(root, "README.md", "Implementation directory: `src/`.\n");
  await write(root, "src/auth.ts", "export const version = 1;\n");
  await execFileAsync("git", ["add", "."], { cwd: root });
  await execFileAsync("git", ["commit", "-m", "initial"], { cwd: root });
  await write(root, "src/auth.ts", "export const version = 2;\n");

  let stdout = "";
  const exitCode = await runCli(["check", "--changed-only", "--since", "HEAD", "--json"], {
    cwd: root,
    stdout: (chunk: string) => {
      stdout += chunk;
    },
    stderr: () => {}
  });

  const report = JSON.parse(stdout);
  assert.equal(exitCode, 0);
  assert.deepEqual(
    report.documents.map((document: { path: string }) => document.path),
    ["README.md"]
  );
});

test("check --changed-only scans documents affected by changed package-manager evidence", async () => {
  const root = await fixture();
  await execFileAsync("git", ["init"], { cwd: root });
  await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd: root });
  await execFileAsync("git", ["config", "user.name", "Test User"], { cwd: root });
  await write(root, "package.json", JSON.stringify({ packageManager: "npm@10.0.0", scripts: { test: "node --test" } }));
  await write(root, "README.md", "Run `npm test` before merging.\n");
  await write(root, "AGENTS.md", "packageManager: npm\n\nAlways use `npm test`.\n");
  await execFileAsync("git", ["add", "."], { cwd: root });
  await execFileAsync("git", ["commit", "-m", "initial"], { cwd: root });
  await write(root, "package.json", JSON.stringify({ packageManager: "pnpm@10.0.0", scripts: { test: "node --test" } }));

  let stdout = "";
  const exitCode = await runCli(["check", "--changed-only", "--since", "HEAD", "--fail-on=review_needed", "--json"], {
    cwd: root,
    stdout: (chunk: string) => {
      stdout += chunk;
    },
    stderr: () => {}
  });

  const report = JSON.parse(stdout);
  assert.equal(exitCode, 1);
  assert.deepEqual(
    report.documents.map((document: { path: string }) => document.path).sort(),
    ["AGENTS.md", "README.md"]
  );
  assert.ok(
    report.findings.some((finding: { ruleId: string }) => finding.ruleId === "agent_instruction.package-manager-mismatch")
  );
  assert.ok(report.findings.some((finding: { ruleId: string }) => finding.ruleId === "command.package-manager-mismatch"));
});

test("check --changed-only scans documents affected by changed OpenAPI specs", async () => {
  const root = await fixture();
  await execFileAsync("git", ["init"], { cwd: root });
  await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd: root });
  await execFileAsync("git", ["config", "user.name", "Test User"], { cwd: root });
  await write(
    root,
    "openapi.json",
    JSON.stringify({
      openapi: "3.1.0",
      paths: {
        "/v1/users": {
          get: {}
        }
      }
    })
  );
  await write(root, "README.md", "Endpoint: `GET /v1/users`.\n");
  await execFileAsync("git", ["add", "."], { cwd: root });
  await execFileAsync("git", ["commit", "-m", "initial"], { cwd: root });
  await write(
    root,
    "openapi.json",
    JSON.stringify({
      openapi: "3.1.0",
      paths: {
        "/v1/accounts": {
          get: {}
        }
      }
    })
  );

  let stdout = "";
  const exitCode = await runCli(["check", "--changed-only", "--since", "HEAD", "--fail-on=broken", "--json"], {
    cwd: root,
    stdout: (chunk: string) => {
      stdout += chunk;
    },
    stderr: () => {}
  });

  const report = JSON.parse(stdout);
  assert.equal(exitCode, 1);
  assert.deepEqual(
    report.documents.map((document: { path: string }) => document.path),
    ["README.md"]
  );
  assert.ok(report.findings.some((finding: { ruleId: string }) => finding.ruleId === "api.missing-operation"));
});

test("action --changed-only scans the same affected documents as check", async () => {
  const root = await fixture();
  await execFileAsync("git", ["init"], { cwd: root });
  await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd: root });
  await execFileAsync("git", ["config", "user.name", "Test User"], { cwd: root });
  await write(root, "package.json", JSON.stringify({ packageManager: "npm@10.0.0", scripts: { test: "node --test" } }));
  await write(root, "README.md", "Run `npm test` before merging.\n");
  await execFileAsync("git", ["add", "."], { cwd: root });
  await execFileAsync("git", ["commit", "-m", "initial"], { cwd: root });
  await write(root, "package.json", JSON.stringify({ packageManager: "pnpm@10.0.0", scripts: { test: "node --test" } }));

  let checkStdout = "";
  const checkExitCode = await runCli(["check", "--changed-only", "--since", "HEAD", "--json"], {
    cwd: root,
    stdout: (chunk: string) => {
      checkStdout += chunk;
    },
    stderr: () => {}
  });
  let actionStdout = "";
  const actionResultPath = join(root, "action-result.json");
  const actionExitCode = await runCli(
    ["action", "--changed-only", "--since", "HEAD", "--fail-on=none", "--result", actionResultPath],
    {
    cwd: root,
    stdout: (chunk: string) => {
      actionStdout += chunk;
    },
    stderr: () => {}
    }
  );

  const checkReport = JSON.parse(checkStdout);
  const actionReport = JSON.parse(await readFile(actionResultPath, "utf8"));
  assert.equal(checkExitCode, 0);
  assert.equal(actionExitCode, 0, actionStdout);
  assert.deepEqual(
    actionReport.documents.map((document: { path: string }) => document.path),
    checkReport.documents.map((document: { path: string }) => document.path)
  );
  assert.deepEqual(
    actionReport.findings.map((finding: { ruleId: string }) => finding.ruleId),
    checkReport.findings.map((finding: { ruleId: string }) => finding.ruleId)
  );
  assert.equal(actionReport.runtime.schemaVersion, "evidoc.agent-runtime.v1");
  assert.equal(actionReport.runtime.event, "github_action");
  assert.equal(actionReport.runtime.scope, "worktree");
  assert.equal(actionReport.runtime.baseline, "HEAD");
});

test("action --changed-only preserves changed-source coverage findings", async () => {
  const root = await fixture();
  await execFileAsync("git", ["init"], { cwd: root });
  await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd: root });
  await execFileAsync("git", ["config", "user.name", "Test User"], { cwd: root });
  await write(root, ".evidoc/config.json", JSON.stringify({ requireDocsForChangedSources: true }));
  await write(root, "README.md", "# Example\n");
  await write(root, "src/service.ts", "export const service = 1;\n");
  await execFileAsync("git", ["add", "."], { cwd: root });
  await execFileAsync("git", ["commit", "-m", "initial"], { cwd: root });
  await write(root, "src/service.ts", "export const service = 2;\n");

  let stdout = "";
  const resultPath = join(root, "action-result.json");
  const exitCode = await runCli(
    ["action", "--changed-only", "--since", "HEAD", "--fail-on=review_needed", "--result", resultPath],
    {
      cwd: root,
      stdout: (chunk: string) => {
        stdout += chunk;
      },
      stderr: () => {}
    }
  );

  const report = JSON.parse(await readFile(resultPath, "utf8"));
  assert.equal(exitCode, 1, stdout);
  assert.deepEqual(
    report.findings.map((finding: { ruleId: string }) => finding.ruleId),
    ["coverage.changed-source-without-doc"]
  );
  assert.equal(report.runtime.status, "review_needed");
});

test("diff without --since includes staged changes by default", async () => {
  const root = await fixture();
  await execFileAsync("git", ["init"], { cwd: root });
  await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd: root });
  await execFileAsync("git", ["config", "user.name", "Test User"], { cwd: root });
  await write(root, "README.md", "# Initial\n");
  await execFileAsync("git", ["add", "."], { cwd: root });
  await execFileAsync("git", ["commit", "-m", "initial"], { cwd: root });
  await write(root, "README.md", "Code lives in `src/missing.ts`.\n");
  await execFileAsync("git", ["add", "README.md"], { cwd: root });

  let stdout = "";
  const exitCode = await runCli(["diff", "--json"], {
    cwd: root,
    stdout: (chunk: string) => {
      stdout += chunk;
    },
    stderr: () => {}
  });

  const diff = JSON.parse(stdout);
  assert.equal(exitCode, 0);
  assert.deepEqual(diff.changedFiles, ["README.md"]);
  assert.deepEqual(diff.affectedDocuments, ["README.md"]);
});

test("diff --since fails when the git ref cannot be resolved", async () => {
  const root = await fixture();
  await execFileAsync("git", ["init"], { cwd: root });
  await write(root, "README.md", "Code lives in `src/missing.ts`.\n");

  let stderr = "";
  const exitCode = await runCli(["diff", "--since", "refs/heads/does-not-exist", "--json"], {
    cwd: root,
    stdout: () => {},
    stderr: (chunk: string) => {
      stderr += chunk;
    }
  });

  assert.equal(exitCode, 1);
  assert.match(stderr, /Unable to read git changed files/);
  assert.match(stderr, /refs\/heads\/does-not-exist/);
});

test("diff --since merge-base:<branch> compares against the local merge base", async () => {
  const root = await fixture();
  await execFileAsync("git", ["init", "--initial-branch", "main"], { cwd: root }).catch(async () => {
    await execFileAsync("git", ["init"], { cwd: root });
    await execFileAsync("git", ["checkout", "-b", "main"], { cwd: root });
  });
  await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd: root });
  await execFileAsync("git", ["config", "user.name", "Test User"], { cwd: root });
  await write(root, "README.md", "# Example\n");
  await execFileAsync("git", ["add", "."], { cwd: root });
  await execFileAsync("git", ["commit", "-m", "initial"], { cwd: root });
  await execFileAsync("git", ["checkout", "-b", "feature"], { cwd: root });
  await write(root, "README.md", "Broken path `src/missing.ts`.\n");

  let stdout = "";
  const exitCode = await runCli(["diff", "--since", "merge-base:main", "--json", "--fail-on=broken"], {
    cwd: root,
    stdout: (chunk: string) => {
      stdout += chunk;
    },
    stderr: () => {}
  });

  const diff = JSON.parse(stdout);
  assert.equal(exitCode, 1);
  assert.equal(diff.since, "merge-base:main");
  assert.deepEqual(diff.changedFiles, ["README.md"]);
  assert.equal(diff.report.summary.broken, 1);
});

test("check --changed-only fails clearly outside a git repository", async () => {
  const root = await fixture();
  await write(root, "README.md", "Code lives in `src/missing.ts`.\n");

  let stderr = "";
  const exitCode = await runCli(["check", "--changed-only", "--json"], {
    cwd: root,
    stdout: () => {},
    stderr: (chunk: string) => {
      stderr += chunk;
    }
  });

  assert.equal(exitCode, 1);
  assert.match(stderr, /Unable to read git changed files/);
  assert.match(stderr, /requires a git repository/);
});

test("check --changed-only can require changed source files to have affected documentation", async () => {
  const root = await fixture();
  await execFileAsync("git", ["init"], { cwd: root });
  await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd: root });
  await execFileAsync("git", ["config", "user.name", "Test User"], { cwd: root });
  await write(root, ".evidoc/config.json", JSON.stringify({ requireDocsForChangedSources: true }));
  await write(root, "README.md", "# Example\n");
  await write(root, "src/service.ts", "export const version = 1;\n");
  await execFileAsync("git", ["add", "."], { cwd: root });
  await execFileAsync("git", ["commit", "-m", "initial"], { cwd: root });
  await write(root, "src/service.ts", "export const version = 2;\n");

  let stdout = "";
  const exitCode = await runCli(["check", "--changed-only", "--since", "HEAD", "--fail-on=review_needed", "--json"], {
    cwd: root,
    stdout: (chunk: string) => {
      stdout += chunk;
    },
    stderr: () => {}
  });

  const report = JSON.parse(stdout);
  assert.equal(exitCode, 1);
  assert.ok(
    report.findings.some((finding: { ruleId: string; message: string; docPath: string }) => {
      return (
        finding.ruleId === "coverage.changed-source-without-doc" &&
        finding.message.includes("src/service.ts") &&
        finding.docPath === "src/service.ts"
      );
    })
  );
});

test("check --changed-only accepts changed source files with affected documentation", async () => {
  const root = await fixture();
  await execFileAsync("git", ["init"], { cwd: root });
  await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd: root });
  await execFileAsync("git", ["config", "user.name", "Test User"], { cwd: root });
  await write(root, ".evidoc/config.json", JSON.stringify({ requireDocsForChangedSources: true }));
  await write(root, "README.md", "Source: `src/service.ts`.\n");
  await write(root, "src/service.ts", "export const version = 1;\n");
  await execFileAsync("git", ["add", "."], { cwd: root });
  await execFileAsync("git", ["commit", "-m", "initial"], { cwd: root });
  await write(root, "src/service.ts", "export const version = 2;\n");

  let stdout = "";
  const exitCode = await runCli(["check", "--changed-only", "--since", "HEAD", "--fail-on=review_needed", "--json"], {
    cwd: root,
    stdout: (chunk: string) => {
      stdout += chunk;
    },
    stderr: () => {}
  });

  const report = JSON.parse(stdout);
  assert.equal(exitCode, 0);
  assert.equal(
    report.findings.some((finding: { ruleId: string }) => finding.ruleId === "coverage.changed-source-without-doc"),
    false
  );
});

test("check --changed-only accepts changed source files when the documenting file is also changed", async () => {
  const root = await fixture();
  await execFileAsync("git", ["init"], { cwd: root });
  await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd: root });
  await execFileAsync("git", ["config", "user.name", "Test User"], { cwd: root });
  await write(root, ".evidoc/config.json", JSON.stringify({ requireDocsForChangedSources: true }));
  await write(root, "README.md", "# Example\n");
  await write(root, "src/service.ts", "export const version = 1;\n");
  await execFileAsync("git", ["add", "."], { cwd: root });
  await execFileAsync("git", ["commit", "-m", "initial"], { cwd: root });
  await write(root, "README.md", "Source: `src/service.ts`.\n");
  await write(root, "src/service.ts", "export const version = 2;\n");

  let stdout = "";
  const exitCode = await runCli(["check", "--changed-only", "--since", "HEAD", "--fail-on=review_needed", "--json"], {
    cwd: root,
    stdout: (chunk: string) => {
      stdout += chunk;
    },
    stderr: () => {}
  });

  const report = JSON.parse(stdout);
  assert.equal(exitCode, 0);
  assert.deepEqual(
    report.documents.map((document: { path: string }) => document.path),
    ["README.md"]
  );
  assert.equal(
    report.findings.some((finding: { ruleId: string }) => finding.ruleId === "coverage.changed-source-without-doc"),
    false
  );
});

test("check --changed-only does not require docs for test and tool config files", async () => {
  const root = await fixture();
  await execFileAsync("git", ["init"], { cwd: root });
  await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd: root });
  await execFileAsync("git", ["config", "user.name", "Test User"], { cwd: root });
  await write(root, ".evidoc/config.json", JSON.stringify({ requireDocsForChangedSources: true }));
  await write(root, "README.md", "# Example\n");
  await write(root, "src/service.test.ts", "test('v1', () => {});\n");
  await write(root, "vite.config.ts", "export default {};\n");
  await execFileAsync("git", ["add", "."], { cwd: root });
  await execFileAsync("git", ["commit", "-m", "initial"], { cwd: root });
  await write(root, "src/service.test.ts", "test('v2', () => {});\n");
  await write(root, "vite.config.ts", "export default { clearScreen: false };\n");

  let stdout = "";
  const exitCode = await runCli(["check", "--changed-only", "--since", "HEAD", "--fail-on=review_needed", "--json"], {
    cwd: root,
    stdout: (chunk: string) => {
      stdout += chunk;
    },
    stderr: () => {}
  });

  const report = JSON.parse(stdout);
  assert.equal(exitCode, 0);
  assert.equal(
    report.findings.some((finding: { ruleId: string }) => finding.ruleId === "coverage.changed-source-without-doc"),
    false
  );
});

test("guard pre-commit does not let unstaged documentation cover staged source changes", async () => {
  const root = await fixture();
  await execFileAsync("git", ["init"], { cwd: root });
  await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd: root });
  await execFileAsync("git", ["config", "user.name", "Test User"], { cwd: root });
  await write(root, ".evidoc/config.json", JSON.stringify({ requireDocsForChangedSources: true }));
  await write(root, "README.md", "# Example\n");
  await write(root, "src/service.ts", "export const version = 1;\n");
  await execFileAsync("git", ["add", "."], { cwd: root });
  await execFileAsync("git", ["commit", "-m", "initial"], { cwd: root });
  await write(root, "src/service.ts", "export const version = 2;\n");
  await execFileAsync("git", ["add", "src/service.ts"], { cwd: root });
  await write(root, "README.md", "Unstaged doc now mentions `src/service.ts`.\n");

  let stdout = "";
  const exitCode = await runCli(["guard", "--event", "pre-commit", "--json"], {
    cwd: root,
    stdout: (chunk: string) => {
      stdout += chunk;
    },
    stderr: () => {}
  });

  const result = JSON.parse(stdout);
  assert.equal(exitCode, 1);
  assert.equal(result.scope, "staged");
  assert.deepEqual(result.changedFiles, ["src/service.ts"]);
  assert.deepEqual(result.affectedDocuments, []);
  assert.ok(
    result.report.findings.some((finding: { ruleId: string; docPath: string }) => {
      return finding.ruleId === "coverage.changed-source-without-doc" && finding.docPath === "src/service.ts";
    })
  );
});

test("guard pre-commit scans staged files without unrelated unstaged document drift", async () => {
  const root = await fixture();
  await execFileAsync("git", ["init"], { cwd: root });
  await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd: root });
  await execFileAsync("git", ["config", "user.name", "Test User"], { cwd: root });
  await write(root, "README.md", "# Example\n");
  await write(root, "docs/guide.md", "Clean guide.\n");
  await write(root, "scripts/tool.ts", "export const version = 1;\n");
  await execFileAsync("git", ["add", "."], { cwd: root });
  await execFileAsync("git", ["commit", "-m", "initial"], { cwd: root });

  await write(root, "docs/guide.md", "Unstaged drift points to `src/missing.ts`.\n");
  await write(root, "scripts/tool.ts", "export const version = 2;\n");
  await execFileAsync("git", ["add", "scripts/tool.ts"], { cwd: root });

  let stdout = "";
  const exitCode = await runCli(["guard", "--event", "pre-commit", "--json"], {
    cwd: root,
    stdout: (chunk: string) => {
      stdout += chunk;
    },
    stderr: () => {}
  });

  const result = JSON.parse(stdout);
  assert.equal(exitCode, 0);
  assert.equal(result.event, "pre-commit");
  assert.equal(result.scope, "staged");
  assert.deepEqual(result.changedFiles, ["scripts/tool.ts"]);
  assert.equal(result.report.summary.findings, 0);
  assert.equal(result.reports.json, ".evidoc/reports/local-gate.json");
});

test("guard pre-push checks a merge baseline and writes local reports", async () => {
  const root = await fixture();
  await execFileAsync("git", ["init"], { cwd: root });
  await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd: root });
  await execFileAsync("git", ["config", "user.name", "Test User"], { cwd: root });
  await write(root, "README.md", "# Example\n");
  await execFileAsync("git", ["add", "."], { cwd: root });
  await execFileAsync("git", ["commit", "-m", "initial"], { cwd: root });
  await write(root, "README.md", "Broken path `src/missing.ts`.\n");

  let stdout = "";
  const exitCode = await runCli(["guard", "--event", "pre-push", "--since", "HEAD", "--fail-on=broken", "--json"], {
    cwd: root,
    stdout: (chunk: string) => {
      stdout += chunk;
    },
    stderr: () => {}
  });

  const result = JSON.parse(stdout);
  assert.equal(exitCode, 1);
  assert.equal(result.event, "pre-push");
  assert.equal(result.scope, "worktree");
  assert.deepEqual(result.changedFiles, ["README.md"]);
  assert.equal(result.report.summary.broken, 1);
  assert.equal(await readFile(join(root, ".evidoc", "reports", "local-gate.json"), "utf8"), stdout);
  const markdown = await readFile(join(root, ".evidoc", "reports", "local-gate.md"), "utf8");
  assert.match(markdown, /Evidoc local Git gate/);
  assert.match(markdown, /references missing path src\/missing\.ts/);
});

test("guard report includes an agent runtime contract for deduped agent replies", async () => {
  const root = await fixture();
  await execFileAsync("git", ["init"], { cwd: root });
  await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd: root });
  await execFileAsync("git", ["config", "user.name", "Test User"], { cwd: root });
  await write(root, "README.md", "# Example\n");
  await execFileAsync("git", ["add", "."], { cwd: root });
  await execFileAsync("git", ["commit", "-m", "initial"], { cwd: root });
  await write(root, "README.md", "Broken path `src/missing.ts`.\n");
  await execFileAsync("git", ["add", "README.md"], { cwd: root });

  let stdout = "";
  const exitCode = await runCli(["guard", "--event", "pre-commit", "--fail-on=broken", "--json"], {
    cwd: root,
    stdout: (chunk: string) => {
      stdout += chunk;
    },
    stderr: () => {}
  });

  const result = JSON.parse(stdout);
  assert.equal(exitCode, 1);
  assert.equal(result.runtime.schemaVersion, "evidoc.agent-runtime.v1");
  assert.equal(result.runtime.source, "evidoc");
  assert.equal(result.runtime.event, "pre-commit");
  assert.equal(result.runtime.mode, "blocking");
  assert.equal(result.runtime.scope, "staged");
  assert.equal(result.runtime.baseline, "HEAD");
  assert.match(result.runtime.baselineCommit, /^[a-f0-9]{40}$/);
  assert.equal(result.runtime.status, "failed");
  assert.match(result.runtime.fingerprint, /^dgr_[a-f0-9]{16}$/);
  assert.match(result.runtime.findings[0].fingerprint, /^dgf_[a-f0-9]{16}$/);
  assert.equal(result.runtime.dedupe.fingerprintCount, 1);
  assert.deepEqual(result.runtime.changedFiles, ["README.md"]);
  assert.match(result.runtime.changedFileFingerprints["README.md"], /^sha256:[a-f0-9]{64}$/);
  assert.deepEqual(result.runtime.affectedDocuments, ["README.md"]);

  const saved = JSON.parse(await readFile(join(root, ".evidoc", "reports", "local-gate.json"), "utf8"));
  assert.deepEqual(saved.runtime, result.runtime);
  const markdown = await readFile(join(root, ".evidoc", "reports", "local-gate.md"), "utf8");
  assert.match(markdown, /Agent Runtime Contract/);
  assert.match(markdown, /Mode: blocking/);
  assert.match(markdown, /Status: failed/);
  assert.match(markdown, new RegExp(result.runtime.findings[0].fingerprint));
});

test("guard fingerprints staged symlink blobs from the git index", async () => {
  if (process.platform === "win32") return;
  const root = await fixture();
  await execFileAsync("git", ["init"], { cwd: root });
  await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd: root });
  await execFileAsync("git", ["config", "user.name", "Test User"], { cwd: root });
  await write(root, "README.md", "# Example\n");
  await execFileAsync("git", ["add", "."], { cwd: root });
  await execFileAsync("git", ["commit", "-m", "initial"], { cwd: root });
  await mkdir(join(root, "docs"), { recursive: true });
  await symlink("target.md", join(root, "docs", "link.md"));
  await execFileAsync("git", ["add", "docs/link.md"], { cwd: root });

  let stdout = "";
  await runCli(["guard", "--event", "pre-commit", "--json"], {
    cwd: root,
    stdout: (chunk: string) => {
      stdout += chunk;
    },
    stderr: () => {}
  });

  const result = JSON.parse(stdout);
  assert.equal(result.runtime.changedFileFingerprints["docs/link.md"], fingerprintFileContent("target.md"));
});

test("doctor treats a configured local Git gate as ready without GitHub Actions", async () => {
  const root = await fixture();
  await execFileAsync("git", ["init"], { cwd: root });
  await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd: root });
  await execFileAsync("git", ["config", "user.name", "Test User"], { cwd: root });
  await write(root, "README.md", "# Example\n");
  await execFileAsync("git", ["add", "."], { cwd: root });
  await execFileAsync("git", ["commit", "-m", "initial"], { cwd: root });
  await runCli(["init", "--yes", "--local-git", "--install-hooks"], {
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
  assert.match(stdout, /status: ready/);
  assert.match(stdout, /Local Git Gate: ready/);
  assert.match(stdout, /GitHub Action: missing/);
});

test("verify --instructions reports only agent instruction drift", async () => {
  const root = await fixture();
  await write(root, ".evidoc/config.json", JSON.stringify({ docRoots: ["README.md"] }));
  await write(root, "AGENTS.md", "Always use `npm test`.\nProject policy lives in `docs/missing.md`.\n");
  await write(root, "CLAUDE.md", "Never use `npm test`.\n");
  await write(root, "README.md", "Legacy path `docs/also-missing.md`.\n");

  let stdout = "";
  const exitCode = await runCli(["verify", "--instructions", "--json", "--fail-on=broken"], {
    cwd: root,
    stdout: (chunk: string) => {
      stdout += chunk;
    },
    stderr: () => {}
  });

  const verification = JSON.parse(stdout);
  assert.equal(exitCode, 1);
  assert.equal(verification.summary.broken, 2);
  assert.deepEqual(
    verification.findings.map((finding: { ruleId: string }) => finding.ruleId).sort(),
    ["agent_instruction.contradiction", "agent_instruction.missing-path"]
  );
});
