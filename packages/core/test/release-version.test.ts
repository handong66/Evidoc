import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";

const verifier = resolve(process.cwd(), "scripts/verify-release-version.mjs");

test("release verifier accepts the synchronized package and runtime version", () => {
  const result = spawnSync(process.execPath, [verifier, "--tag", "v0.2.0"], {
    cwd: process.cwd(),
    encoding: "utf8"
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /0\.2\.0 across 12 packages for v0\.2\.0/);
});

test("release verifier rejects a tag that does not match package manifests", () => {
  const result = spawnSync(process.execPath, [verifier, "--tag", "v0.1.0"], {
    cwd: process.cwd(),
    encoding: "utf8"
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /does not match package version v0\.2\.0/);
});

test("release notes are selected from the current package version rather than Unreleased", () => {
  const script = resolve(process.cwd(), "scripts/release-notes.mjs");
  const result = spawnSync(process.execPath, [script], {
    cwd: process.cwd(),
    encoding: "utf8"
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^# Evidoc 0\.2\.0 - 2026-07-10/m);
  assert.doesNotMatch(result.stdout, /Evidoc Unreleased/);
});
