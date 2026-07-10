import { test } from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";

const requiredPackages = [
  ["core", "@handong66/evidoc-core"],
  ["cli", "@handong66/evidoc-cli"],
  ["reports", "@handong66/evidoc-reports"],
  ["github-action", "@handong66/evidoc-github-action"],
  ["mcp-server", "@handong66/evidoc-mcp-server"],
  ["graph", "@handong66/evidoc-graph"],
  ["frontmatter", "@handong66/evidoc-frontmatter"],
  ["patcher", "@handong66/evidoc-patcher"],
  ["dashboard", "@handong66/evidoc-dashboard"],
  ["local-app", "@handong66/evidoc-local-app"],
  ["review-log", "@handong66/evidoc-review-log"]
] as const;

test("declares every full-product package surface", async () => {
  const root = join(import.meta.dirname, "../../../..");

  for (const [directory, packageName] of requiredPackages) {
    const packageJsonPath = join(root, "packages", directory, "package.json");
    const entrypointPath = join(root, "packages", directory, "src", "index.ts");
    const manifest = JSON.parse(await readFile(packageJsonPath, "utf8")) as { name: string };

    assert.equal(manifest.name, packageName);
    await access(entrypointPath);
  }
});

test("excludes installed application from the product surface", async () => {
  const root = join(import.meta.dirname, "../../../..");
  const tsconfig = await readFile(join(root, "tsconfig.json"), "utf8");
  const tsconfigBase = await readFile(join(root, "tsconfig.base.json"), "utf8");
  const removedPackageDir = "github" + "-app";
  const removedPackageNamePattern = new RegExp("evidoc" + "-github" + "-app");

  await assert.rejects(() => access(join(root, "packages", removedPackageDir, "package.json")));
  assert.doesNotMatch(tsconfig, new RegExp(removedPackageDir));
  assert.doesNotMatch(tsconfigBase, new RegExp(removedPackageDir));
  assert.doesNotMatch(tsconfigBase, removedPackageNamePattern);
});

test("runtime packages with command-line bins restrict published files", async () => {
  const root = join(import.meta.dirname, "../../../..");
  for (const directory of ["evidoc", "mcp-server"]) {
    const packageJsonPath = join(root, "packages", directory, "package.json");
    const manifest = JSON.parse(await readFile(packageJsonPath, "utf8")) as { files?: string[] };

    assert.deepEqual(manifest.files, ["dist/src", "README.md", "LICENSE"]);
    await access(join(root, "packages", directory, "README.md"));
    await access(join(root, "packages", directory, "LICENSE"));
  }
});
