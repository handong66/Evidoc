#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const EXPECTED_PACKAGE_COUNT = 12;
const releaseVersion = JSON.parse(await readFile(join(repoRoot, "package.json"), "utf8")).version;
const releaseDir = resolve(repoRoot, process.argv[2] ?? ".evidoc/release");
const shouldPackFresh = process.argv[2] === undefined;

if (shouldPackFresh) {
  await rm(releaseDir, { recursive: true, force: true });
}
await mkdir(releaseDir, { recursive: true });
await ensureTarballs(releaseDir);

const tarballs = (await readdir(releaseDir))
  .filter((entry) => entry.endsWith(".tgz"))
  .map((entry) => join(releaseDir, entry))
  .sort(packageOrder);

for (const tarball of tarballs) {
  await assertTarballMetadata(tarball);
}

const hasEvidocPackage = tarballs.some((tarball) => isWrapperTarball(basename(tarball)));
if (tarballs.length !== EXPECTED_PACKAGE_COUNT) {
  throw new Error(`Expected ${EXPECTED_PACKAGE_COUNT} package tarballs, found ${tarballs.length} in ${releaseDir}.`);
}
if (!hasEvidocPackage) {
  throw new Error(`No @evidoc/evidoc package tarball found in ${releaseDir}.`);
}

const fixture = await mkdtemp(join(tmpdir(), "evidoc-npx-smoke-"));
try {
  await writeFile(
    join(fixture, "package.json"),
    `${JSON.stringify(
      {
        name: "evidoc-npx-smoke",
        version: "1.0.0",
        private: true,
        type: "module",
        packageManager: "pnpm@9.15.4",
        scripts: {
          test: "node --test"
        }
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  await mkdir(join(fixture, "src"), { recursive: true });
  await writeFile(join(fixture, "src", "service.js"), "export function listAccounts() { return []; }\n", "utf8");
  await writeFile(
    join(fixture, "README.md"),
    [
      "---",
      "id: npx-smoke",
      "sources:",
      "  - path: src/service.js",
      "    symbols:",
      "      - listUsers",
      "lastReviewed: 2026-07-06",
      "ttlDays: 365",
      "---",
      "",
      "# npx smoke",
      "",
      "Run `npm test` before opening a PR.",
      "",
      "Public symbol: `src/service.js#listUsers`.",
      ""
    ].join("\n"),
    "utf8"
  );

  const install = await run("npm", ["install", "--no-audit", "--no-fund", ...tarballs], {
    cwd: fixture
  });
  if (install.exitCode !== 0) {
    throw new Error(`tarball install failed with exit ${install.exitCode}\n${install.stderr}\n${install.stdout}`);
  }

  const result = await run(
    "npx",
    ["--no-install", "evidoc", "app", "--once", "--json", "--no-open"],
    { cwd: fixture }
  );
  if (result.exitCode !== 0) {
    throw new Error(`npx smoke failed with exit ${result.exitCode}\n${result.stderr}\n${result.stdout}`);
  }
  if (!result.stdout.trim()) {
    throw new Error(`npx smoke produced no output.\n${result.stderr}`);
  }

  const version = await runEvidoc(fixture, ["--version"]);
  assertExit(version, 0, "--version");
  if (version.stdout.trim() !== releaseVersion) {
    throw new Error(`Expected evidoc --version to print ${releaseVersion}, got ${JSON.stringify(version.stdout)}.`);
  }

  const mcp = await run(
    "npx",
    ["--no-install", "evidoc-mcp"],
    {
      cwd: fixture,
      input: [
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-11-25",
            capabilities: {},
            clientInfo: { name: "evidoc-release-smoke", version: "1.0.0" }
          }
        }),
        JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
        ""
      ].join("\n")
    }
  );
  assertExit(mcp, 0, "evidoc-mcp initialize and tools/list");
  assertIncludes(mcp.stdout, '"id":1', "evidoc-mcp initialize response");
  assertIncludes(mcp.stdout, '"id":2', "evidoc-mcp tools/list response");
  assertIncludes(mcp.stdout, "evidoc.agent_scan", "evidoc-mcp default tool list");

  const state = JSON.parse(result.stdout);
  const repository = state.repositories?.[0];
  if (repository?.health !== "broken") {
    throw new Error(`Expected drift smoke repository health broken, got ${repository?.health ?? "missing"}.`);
  }
  if (!repository.report?.summary?.findings) {
    throw new Error(`Expected drift smoke repository to report findings.\n${result.stdout}`);
  }

  const config = await readFile(join(fixture, ".evidoc", "config.json"), "utf8");
  const parsedConfig = JSON.parse(config);
  if (!Array.isArray(parsedConfig.docRoots) || !parsedConfig.docRoots.includes("README.md")) {
    throw new Error("npx smoke did not auto-initialize README.md as a doc root.");
  }

  const cleanFixture = await mkdtemp(join(tmpdir(), "evidoc-npx-onboarding-"));
  try {
    await writeFile(join(cleanFixture, "README.md"), "# clean onboarding\n", "utf8");
    const cleanInstall = await run("npm", ["install", "--no-audit", "--no-fund", ...tarballs], {
      cwd: cleanFixture
    });
    if (cleanInstall.exitCode !== 0) {
      throw new Error(
        `clean fixture tarball install failed with exit ${cleanInstall.exitCode}\n${cleanInstall.stderr}\n${cleanInstall.stdout}`
      );
    }

    const missingDoctor = await runEvidoc(cleanFixture, ["doctor"]);
    assertExit(missingDoctor, 1, "doctor before init");
    assertIncludes(missingDoctor.stdout, "status: not initialized", "doctor before init status");

    const init = await runEvidoc(cleanFixture, ["init", "--yes"]);
    assertExit(init, 0, "init --yes");
    assertIncludes(init.stdout, "Evidoc initialized", "init output");

    const readyDoctor = await runEvidoc(cleanFixture, ["doctor"]);
    assertExit(readyDoctor, 0, "doctor after init");
    assertIncludes(readyDoctor.stdout, "status: ready", "doctor after init status");
    assertNotIncludes(
      readyDoctor.stdout,
      "duplicate push and pull-request checks",
      "generated workflow should not warn about duplicate PR checks"
    );
  } finally {
    await rm(cleanFixture, { recursive: true, force: true });
  }

  const failingCheck = await runEvidoc(fixture, ["check", "--fail-on=review_needed"]);
  assertExit(failingCheck, 1, "check --fail-on=review_needed");
  assertIncludes(failingCheck.stdout, "findings", "check output");

  const diagnosis = await runEvidoc(fixture, ["diagnose"]);
  assertExit(diagnosis, 0, "diagnose");
  assertIncludes(diagnosis.stdout, "safe", "diagnose safe output");
  assertIncludes(diagnosis.stdout, "review", "diagnose review output");

  const fixPreview = await runEvidoc(fixture, ["fix", "--safe", "--json"]);
  assertExit(fixPreview, 0, "fix preview");
  const preview = JSON.parse(fixPreview.stdout);
  if (!Array.isArray(preview.proposals) || preview.proposals.length < 1) {
    throw new Error(`Expected at least one safe fix proposal.\n${fixPreview.stdout}`);
  }

  const fixWrite = await runEvidoc(fixture, ["fix", "--safe", "--write", "--json"]);
  assertExit(fixWrite, 0, "fix --safe --write");
  const writeResult = JSON.parse(fixWrite.stdout);
  if (!Array.isArray(writeResult.applied) || writeResult.applied.length < 1) {
    throw new Error(`Expected safe fix write to apply at least one proposal.\n${fixWrite.stdout}`);
  }
  if (writeResult.postFixSummary?.reviewNeeded !== 0) {
    throw new Error(`Expected safe fix write to clear review-needed command drift.\n${fixWrite.stdout}`);
  }

  const remainingBroken = await runEvidoc(fixture, ["check", "--fail-on=broken"]);
  assertExit(remainingBroken, 1, "check remaining broken drift");
  assertIncludes(remainingBroken.stdout, "symbol.missing-reference", "remaining broken symbol drift");

  const demo = await runEvidoc(fixture, ["demo", "--once", "--json", "--no-open"]);
  assertExit(demo, 0, "demo --once");
  const demoState = JSON.parse(demo.stdout);
  if (!demoState.repositories?.[0]?.report?.summary?.findings) {
    throw new Error(`Expected demo smoke to include sample findings.\n${demo.stdout}`);
  }

  process.stdout.write(`npx @evidoc/evidoc smoke passed using ${tarballs.length} package tarball(s) across app, doctor, init, check, diagnose, fix, demo, and MCP.\n`);
} finally {
  await rm(fixture, { recursive: true, force: true });
}

async function ensureTarballs(targetDir) {
  const existing = (await readdir(targetDir)).filter((entry) => entry.endsWith(".tgz"));
  if (existing.length > 0) return;

  const packages = (await readdir(join(repoRoot, "packages"), { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(repoRoot, "packages", entry.name))
    .sort();

  for (const packageDir of packages) {
    const result = await run("npm", ["pack", packageDir, "--pack-destination", targetDir], {
      cwd: repoRoot
    });
    if (result.exitCode !== 0) {
      throw new Error(`npm pack failed for ${packageDir}\n${result.stderr}\n${result.stdout}`);
    }
  }
}

function packageOrder(left, right) {
  const leftBase = basename(left);
  const rightBase = basename(right);
  if (isWrapperTarball(leftBase)) return 1;
  if (isWrapperTarball(rightBase)) return -1;
  return leftBase.localeCompare(rightBase);
}

function isWrapperTarball(name) {
  return /^evidoc-evidoc-[0-9]/.test(name);
}

function runEvidoc(cwd, args) {
  return run("npx", ["--no-install", "evidoc", ...args], { cwd });
}

function assertExit(result, expected, label) {
  if (result.exitCode !== expected) {
    throw new Error(`${label} exited ${result.exitCode}, expected ${expected}\n${result.stderr}\n${result.stdout}`);
  }
}

function assertIncludes(value, needle, label) {
  if (!value.includes(needle)) {
    throw new Error(`${label} did not include ${needle}\n${value}`);
  }
}

function assertNotIncludes(value, needle, label) {
  if (value.includes(needle)) {
    throw new Error(`${label} unexpectedly included ${needle}\n${value}`);
  }
}

async function assertTarballMetadata(tarball) {
  const listing = await run("tar", ["-tzf", tarball], { cwd: repoRoot });
  if (listing.exitCode !== 0) {
    throw new Error(`Cannot inspect ${tarball}\n${listing.stderr}`);
  }
  for (const required of ["package/package.json", "package/README.md", "package/LICENSE"]) {
    if (!listing.stdout.split(/\r?\n/).includes(required)) {
      throw new Error(`${basename(tarball)} is missing ${required}.`);
    }
  }

  const manifestResult = await run("tar", ["-xOf", tarball, "package/package.json"], { cwd: repoRoot });
  if (manifestResult.exitCode !== 0) {
    throw new Error(`Cannot read package manifest from ${tarball}\n${manifestResult.stderr}`);
  }
  const manifest = JSON.parse(manifestResult.stdout);
  if (manifest.name === "@evidoc/evidoc" && manifest.bin?.evidoc !== "dist/src/index.js") {
    throw new Error(`${basename(tarball)} does not expose the evidoc executable.`);
  }
  if (manifest.name === "@evidoc/mcp-server" && manifest.bin?.["evidoc-mcp"] !== "dist/src/index.js") {
    throw new Error(`${basename(tarball)} does not expose the evidoc-mcp executable.`);
  }
}

function run(command, args, options) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: {
        ...process.env,
        npm_config_audit: "false",
        npm_config_fund: "false"
      },
      stdio: ["pipe", "pipe", "pipe"]
    });
    child.stdin.end(options.input ?? "");
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
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
