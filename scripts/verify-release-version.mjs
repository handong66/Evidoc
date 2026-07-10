#!/usr/bin/env node
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const expectedPackages = new Map([
  ["cli", "@handong66/evidoc-cli"],
  ["core", "@handong66/evidoc-core"],
  ["dashboard", "@handong66/evidoc-dashboard"],
  ["evidoc", "repo-evidoc"],
  ["frontmatter", "@handong66/evidoc-frontmatter"],
  ["github-action", "@handong66/evidoc-github-action"],
  ["graph", "@handong66/evidoc-graph"],
  ["local-app", "@handong66/evidoc-local-app"],
  ["mcp-server", "@handong66/evidoc-mcp-server"],
  ["patcher", "@handong66/evidoc-patcher"],
  ["reports", "@handong66/evidoc-reports"],
  ["review-log", "@handong66/evidoc-review-log"]
]);
const args = parseArgs(process.argv.slice(2));
const root = resolve(args.root ?? scriptRoot);
const rootManifest = await readJson(join(root, "package.json"));
const packageRoot = join(root, "packages");
const packageDirs = (await readdir(packageRoot, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();
const expectedDirectories = [...expectedPackages.keys()].sort();
if (JSON.stringify(packageDirs) !== JSON.stringify(expectedDirectories)) {
  fail(
    `Public package directories changed. Expected ${expectedDirectories.join(", ")}; found ${packageDirs.join(", ")}.`
  );
}

const manifests = [];
for (const directory of packageDirs) {
  const path = join(packageRoot, directory, "package.json");
  const manifest = await readJson(path);
  if (manifest.name !== expectedPackages.get(directory)) {
    fail(`${relativePath(root, path)} is named ${manifest.name ?? "missing"}; expected ${expectedPackages.get(directory)}.`);
  }
  manifests.push({ path, manifest });
}

const version = rootManifest.version;
if (!isSemver(version)) {
  fail(`Root package version must be a semantic version, got ${JSON.stringify(version)}.`);
}

for (const { path, manifest } of manifests) {
  if (manifest.version !== version) {
    fail(`${relativePath(root, path)} has version ${manifest.version ?? "missing"}; expected ${version}.`);
  }
}

const workspaceNames = new Set(manifests.map(({ manifest }) => manifest.name));
for (const { path, manifest } of manifests) {
  for (const dependencyField of ["dependencies", "optionalDependencies", "peerDependencies"]) {
    for (const [name, requested] of Object.entries(manifest[dependencyField] ?? {})) {
      if (workspaceNames.has(name) && requested !== version) {
        fail(
          `${relativePath(root, path)} pins internal dependency ${name} to ${requested}; expected exact ${version}.`
        );
      }
    }
  }
}

const versionSource = await readFile(join(root, "packages/core/src/version.ts"), "utf8");
const runtimeVersion = versionSource.match(/EVIDOC_VERSION\s*=\s*["']([^"']+)["']/)?.[1];
if (runtimeVersion !== version) {
  fail(`packages/core/src/version.ts exposes ${runtimeVersion ?? "no version"}; expected ${version}.`);
}

const changelog = await readFile(join(root, "CHANGELOG.md"), "utf8");
if (!new RegExp(`^## ${escapeRegExp(version)}(?: - .+)?$`, "m").test(changelog)) {
  fail(`CHANGELOG.md has no release heading for ${version}.`);
}

const tag = args.tag ?? (process.env.GITHUB_REF_TYPE === "tag" ? process.env.GITHUB_REF_NAME : undefined);
if (tag !== undefined && tag !== `v${version}`) {
  fail(`Release tag ${tag} does not match package version v${version}.`);
}

process.stdout.write(`Release version verified: ${version} across ${manifests.length} packages${tag ? ` for ${tag}` : ""}.\n`);

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--root" || value === "--tag") {
      const next = values[index + 1];
      if (!next) fail(`${value} requires a value.`);
      parsed[value.slice(2)] = next;
      index += 1;
      continue;
    }
    fail(`Unknown option: ${value}`);
  }
  return parsed;
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    fail(`Cannot read valid JSON from ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function relativePath(rootPath, path) {
  return path.startsWith(`${rootPath}/`) ? path.slice(rootPath.length + 1) : path;
}

function isSemver(value) {
  return typeof value === "string" && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
