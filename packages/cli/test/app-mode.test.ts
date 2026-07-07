import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { runCli } from "../src/index.js";

async function fixture(): Promise<string> {
  return mkdtemp(join(tmpdir(), "evidoc-cli-app-"));
}

async function write(root: string, file: string, text: string): Promise<void> {
  const target = join(root, file);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, text, "utf8");
}

test("app command can auto-initialize and print one-shot GUI state", async () => {
  const root = await fixture();
  await write(root, "README.md", "# Example\n");

  let stdout = "";
  const exitCode = await runCli(["app", "--once", "--json", "--no-open"], {
    cwd: root,
    stdout: (chunk: string) => {
      stdout += chunk;
    },
    stderr: () => {}
  });

  const state = JSON.parse(stdout);
  assert.equal(exitCode, 0);
  assert.equal(state.repositories[0].health, "ok");
  assert.equal(existsSync(join(root, ".evidoc", "config.json")), true);
});

test("serve command supports multi-repository one-shot state", async () => {
  const first = await fixture();
  const second = await fixture();
  await write(first, "README.md", "# Clean\n");
  await write(second, "README.md", "Code lives in `src/missing.ts`.\n");

  let stdout = "";
  const exitCode = await runCli(["serve", "--once", "--json", "--no-open", "--root", first, "--root", second], {
    cwd: first,
    stdout: (chunk: string) => {
      stdout += chunk;
    },
    stderr: () => {}
  });

  const state = JSON.parse(stdout);
  assert.equal(exitCode, 0);
  assert.equal(state.summary.repositoriesScanned, 2);
  assert.equal(state.summary.brokenRepositories, 1);
});

test("bare one-click mode can be forced for programmatic use", async () => {
  const root = await fixture();
  await write(root, "README.md", "# Example\n");

  let stdout = "";
  const exitCode = await runCli(["--once", "--json", "--no-open"], {
    cwd: root,
    forceApp: true,
    stdout: (chunk: string) => {
      stdout += chunk;
    },
    stderr: () => {}
  });

  const state = JSON.parse(stdout);
  assert.equal(exitCode, 0);
  assert.equal(state.repositories[0].name, root.split("/").at(-1));
});

test("bare non-interactive one-click mode auto-initializes and exits after one scan", async () => {
  const root = await fixture();
  await write(root, "README.md", "# Example\n");

  let stdout = "";
  const exitCode = await runCli([], {
    cwd: root,
    stdout: (chunk: string) => {
      stdout += chunk;
    },
    stderr: () => {}
  });

  assert.equal(exitCode, 0);
  assert.match(stdout, /Evidoc Local App state/);
  assert.equal(existsSync(join(root, ".evidoc", "config.json")), true);
});

test("bare app flags run one-shot app mode without requiring an explicit app command", async () => {
  const root = await fixture();
  await write(root, "README.md", "# Example\n");

  let stdout = "";
  const exitCode = await runCli(["--once", "--json", "--no-open"], {
    cwd: root,
    stdout: (chunk: string) => {
      stdout += chunk;
    },
    stderr: () => {}
  });

  const state = JSON.parse(stdout);
  assert.equal(exitCode, 0);
  assert.equal(state.repositories[0].name, root.split("/").at(-1));
  assert.equal(existsSync(join(root, ".evidoc", "config.json")), true);
});

test("bare --root without app-only flags scans the target repository", async () => {
  const source = await fixture();
  const target = await fixture();
  await write(source, "README.md", "# Source\n");
  await write(target, "README.md", "Code lives in `src/missing.ts`.\n");

  let stdout = "";
  const exitCode = await runCli(["--root", target, "--json"], {
    cwd: source,
    stdout: (chunk: string) => {
      stdout += chunk;
    },
    stderr: () => {}
  });

  const report = JSON.parse(stdout);
  assert.equal(exitCode, 0);
  assert.equal(report.root, target);
  assert.equal(report.summary.findings, 1);
  assert.equal(report.findings[0].ruleId, "path.missing-reference");
});

test("bare inline --root without app-only flags scans the target repository", async () => {
  const source = await fixture();
  const target = await fixture();
  await write(source, "README.md", "# Source\n");
  await write(target, "README.md", "Code lives in `src/missing.ts`.\n");

  let stdout = "";
  const exitCode = await runCli([`--root=${target}`, "--json"], {
    cwd: source,
    stdout: (chunk: string) => {
      stdout += chunk;
    },
    stderr: () => {}
  });

  const report = JSON.parse(stdout);
  assert.equal(exitCode, 0);
  assert.equal(report.root, target);
  assert.equal(report.summary.findings, 1);
  assert.equal(report.findings[0].ruleId, "path.missing-reference");
});

test("demo command returns a built-in GUI state without touching the current repository", async () => {
  const root = await fixture();
  await write(root, "README.md", "# User repo\n");

  let stdout = "";
  const exitCode = await runCli(["demo", "--once", "--json", "--no-open"], {
    cwd: root,
    stdout: (chunk: string) => {
      stdout += chunk;
    },
    stderr: () => {}
  });

  const state = JSON.parse(stdout);
  assert.equal(exitCode, 0);
  assert.equal(state.repositories[0].name, "evidoc-demo");
  assert.ok(state.summary.findings > 0);
  assert.equal(existsSync(join(root, ".evidoc", "config.json")), false);
});
