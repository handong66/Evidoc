import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { runCli } from "../src/index.js";

async function fixture(): Promise<string> {
  return mkdtemp(join(tmpdir(), "evidoc-cli-"));
}

async function write(root: string, file: string, text: string): Promise<void> {
  const target = join(root, file);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, text, "utf8");
}

test("prints JSON report when --json is passed", async () => {
  const root = await fixture();
  await write(root, "README.md", "Auth code lives in `src/auth/token.ts`.\n");

  let stdout = "";
  const exitCode = await runCli(["--json"], {
    cwd: root,
    stdout: (chunk: string) => {
      stdout += chunk;
    },
    stderr: () => {}
  });

  const parsed = JSON.parse(stdout);
  assert.equal(exitCode, 0);
  assert.equal(parsed.summary.findings, 1);
  assert.equal(parsed.findings[0].ruleId, "path.missing-reference");
});

test("check prints a compact text report by default", async () => {
  const root = await fixture();
  await write(
    root,
    "package.json",
    JSON.stringify({
      packageManager: "pnpm@10.0.0",
      scripts: { test: "vitest" }
    })
  );
  await write(root, "README.md", "Run `npm test` before opening a PR.\n");

  let stdout = "";
  const exitCode = await runCli(["check"], {
    cwd: root,
    stdout: (chunk: string) => {
      stdout += chunk;
    },
    stderr: () => {}
  });

  assert.equal(exitCode, 0);
  assert.match(stdout, /Evidoc report/);
  assert.match(stdout, /review_needed\s+README\.md:1/);
  assert.match(stdout, /package-manager/i);
});

test("can fail on broken findings when requested", async () => {
  const root = await fixture();
  await write(root, "README.md", "Auth code lives in `src/auth/token.ts`.\n");

  let stdout = "";
  const exitCode = await runCli(["--fail-on=broken"], {
    cwd: root,
    stdout: (chunk: string) => {
      stdout += chunk;
    },
    stderr: () => {}
  });

  assert.equal(exitCode, 1);
  assert.match(stdout, /broken\s+README\.md:1/);
});
