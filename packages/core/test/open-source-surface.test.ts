import { test } from "node:test";
import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

const root = join(import.meta.dirname, "../../../..");

async function workspaceManifests(): Promise<Array<{ directory: string; manifest: Record<string, any> }>> {
  const entries = await readdir(join(root, "packages"), { withFileTypes: true });
  const manifests = [];
  for (const entry of entries.filter((item) => item.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    manifests.push({
      directory: entry.name,
      manifest: JSON.parse(await readFile(join(root, "packages", entry.name, "package.json"), "utf8"))
    });
  }
  return manifests;
}

async function repositoryTextFiles(directory = root): Promise<string[]> {
  const ignoredDirectories = new Set([
    ".evidoc",
    ".git",
    ".opencode-plugin-codex",
    ".worktrees",
    "dist",
    "node_modules"
  ]);
  const textExtensions = new Set([".json", ".md", ".mjs", ".ts", ".yaml", ".yml"]);
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) files.push(...(await repositoryTextFiles(path)));
      continue;
    }
    const extension = entry.name.slice(entry.name.lastIndexOf("."));
    if (textExtensions.has(extension)) files.push(path);
  }
  return files;
}

function markdownSection(text: string, heading: string): string {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const startMatch = new RegExp(`^## ${escaped}\\n`, "m").exec(text);
  assert.ok(startMatch, `missing README section: ${heading}`);
  const start = startMatch.index;
  const remainder = text.slice(start + startMatch[0].length);
  const next = /^## /m.exec(remainder);
  return next ? text.slice(start, start + startMatch[0].length + next.index) : text.slice(start);
}

test("declares current open-source, privacy, and security policy", async () => {
  const rootManifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  for (const path of ["LICENSE", "PRIVACY.md", "SECURITY.md", "CONTRIBUTING.md", "CODE_OF_CONDUCT.md"]) {
    await access(join(root, path));
  }

  const changelog = await readFile(join(root, "CHANGELOG.md"), "utf8");
  const privacy = await readFile(join(root, "PRIVACY.md"), "utf8");
  const security = await readFile(join(root, "SECURITY.md"), "utf8");
  const minor = rootManifest.version.split(".").slice(0, 2).join(".");

  assert.match(changelog, /Semantic Versioning/);
  assert.match(changelog, /npx evidoc/);
  assert.match(privacy, /Telemetry is disabled by default/);
  assert.match(privacy, /must not include repository content/);
  assert.match(security, new RegExp(`\\| ${minor.replace(".", "\\.")}\\.x \\| Yes \\|`));
  assert.match(security, /loopback hosts/);
  assert.match(security, /untrusted data/);
  assert.match(security, /5 business days/);
});

test("keeps all published package manifests synchronized and identifiable", async () => {
  const rootManifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  const packages = await workspaceManifests();
  const workspaceNames = new Set(packages.map(({ manifest }) => manifest.name));
  const expectedPackageNames = new Map([
    ["cli", "@evidoc/cli"],
    ["core", "@evidoc/core"],
    ["dashboard", "@evidoc/dashboard"],
    ["evidoc", "evidoc"],
    ["frontmatter", "@evidoc/frontmatter"],
    ["github-action", "@evidoc/github-action"],
    ["graph", "@evidoc/graph"],
    ["local-app", "@evidoc/local-app"],
    ["mcp-server", "@evidoc/mcp-server"],
    ["patcher", "@evidoc/patcher"],
    ["reports", "@evidoc/reports"],
    ["review-log", "@evidoc/review-log"]
  ]);

  assert.equal(packages.length, 12);
  assert.equal(rootManifest.name, "@evidoc/repo");
  assert.equal(rootManifest.private, true);
  for (const { directory, manifest } of packages) {
    assert.equal(manifest.name, expectedPackageNames.get(directory), directory);
    assert.equal(manifest.version, rootManifest.version, manifest.name);
    assert.equal(manifest.scripts?.prepublishOnly, "node ../../scripts/ensure-built-package.mjs", manifest.name);
    assert.deepEqual(manifest.files, ["dist/src", "README.md", "LICENSE"], manifest.name);
    await access(join(root, "packages", directory, "README.md"));
    await access(join(root, "packages", directory, "LICENSE"));
    for (const [name, version] of Object.entries(manifest.dependencies ?? {})) {
      if (workspaceNames.has(name)) assert.equal(version, rootManifest.version, `${manifest.name} -> ${name}`);
    }
  }

  const wrapper = packages.find(({ manifest }) => manifest.name === "evidoc")?.manifest;
  const mcp = packages.find(({ manifest }) => manifest.name === "@evidoc/mcp-server")?.manifest;
  assert.equal(wrapper?.bin?.evidoc, "dist/src/index.js");
  assert.equal(wrapper?.engines?.node, ">=22");
  assert.equal(mcp?.bin?.["evidoc-mcp"], "dist/src/index.js");
});

test("contains no stale npm scope, launcher package, or MCP executable identity", async () => {
  const legacyScope = ["@handong66", "evidoc-"].join("/");
  const legacyLauncher = ["repo", "evidoc"].join("-");
  const staleReferences: string[] = [];

  for (const path of await repositoryTextFiles()) {
    const text = await readFile(path, "utf8");
    if (text.includes(legacyScope) || text.includes(legacyLauncher)) {
      staleReferences.push(path.slice(root.length + 1));
    }
  }

  assert.deepEqual(staleReferences, []);
});

test("release pipeline verifies versions, package identity, and registry state before publishing", async () => {
  const rootManifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  const workflow = await readFile(join(root, ".github/workflows/release.yml"), "utf8");
  const action = await readFile(join(root, "packages/github-action/action.yml"), "utf8");
  const smoke = await readFile(join(root, "scripts/smoke-npx.mjs"), "utf8");

  assert.equal(rootManifest.scripts["release:verify"], "node scripts/verify-release-version.mjs");
  assert.equal(rootManifest.scripts["release:smoke:npx"], "node scripts/smoke-npx.mjs");
  assert.match(workflow, /npm run release:verify/);
  assert.match(workflow, /npm run release:smoke:npx/);
  assert.match(workflow, /id-token: write/);
  assert.match(workflow, /npm install -g npm@11\.18\.0/);
  assert.match(workflow, /Unable to verify registry state/);
  assert.match(workflow, /Published package integrity mismatch/);
  assert.match(workflow, /Verified existing package artifact/);
  assert.match(workflow, /dist\.integrity/);
  assert.match(workflow, /openssl dgst -sha512 -binary/);
  assert.match(workflow, /packages\/core/);
  assert.match(workflow, /packages\/evidoc/);
  const packageOrderBlock = workflow.match(/package_dirs=\(\n([\s\S]*?)\n\s+\)/)?.[1];
  assert.ok(packageOrderBlock, "release workflow is missing package_dirs");
  const publishDirectories = [...packageOrderBlock.matchAll(/packages\/([a-z-]+)/g)].map((match) => match[1]);
  const manifests = await workspaceManifests();
  const directoryByPackageName = new Map(manifests.map(({ directory, manifest }) => [manifest.name, directory]));
  assert.deepEqual([...publishDirectories].sort(), manifests.map(({ directory }) => directory).sort());
  for (const { directory, manifest } of manifests) {
    for (const dependency of Object.keys(manifest.dependencies ?? {})) {
      const dependencyDirectory = directoryByPackageName.get(dependency);
      if (!dependencyDirectory) continue;
      assert.ok(
        publishDirectories.indexOf(dependencyDirectory) < publishDirectories.indexOf(directory),
        `${dependencyDirectory} must publish before ${directory}`
      );
    }
  }
  assert.match(workflow, /tarball="\.evidoc\/release\/\$\{tarball_name\}"/);
  assert.match(workflow, /npm publish "\$tarball" --access public/);
  assert.doesNotMatch(workflow, /npm publish "\.\/\$\{package_dir\}"/);
  assert.ok(
    workflow.indexOf("- name: Publish packages to npm") < workflow.indexOf("- name: Attach artifacts to GitHub Release"),
    "npm publishing must succeed before the GitHub Release is created"
  );
  assert.doesNotMatch(workflow, /NODE_AUTH_TOKEN|NPM_TOKEN/);
  assert.doesNotMatch(workflow, /github\.event\.inputs\.publish/);
  assert.match(workflow, /- name: Publish packages to npm\n\s+if: startsWith\(github\.ref, 'refs\/tags\/'\)/);
  assert.match(smoke, /package\/README\.md/);
  assert.match(smoke, /package\/LICENSE/);
  assert.match(smoke, /EXPECTED_PACKAGE_COUNT = 12/);
  assert.match(smoke, /"npx"/);
  assert.match(smoke, /"--no-install"/);
  assert.match(smoke, /"evidoc"/);
  assert.match(smoke, /evidoc-mcp/);
  assert.match(smoke, /"fix"/);
  const verifier = await readFile(join(root, "scripts/verify-release-version.mjs"), "utf8");
  assert.match(verifier, /Public package directories changed/);
  assert.match(verifier, /\["core", "@evidoc\/core"\]/);
  assert.match(verifier, /\["evidoc", "evidoc"\]/);

  for (const source of [workflow, action]) {
    for (const match of source.matchAll(/^\s*uses:\s*([^\s#]+)/gm)) {
      assert.match(match[1], /@[a-f0-9]{40}$/, `mutable action dependency: ${match[1]}`);
    }
  }
});

test("workflow dependencies use immutable Node 24 action releases", async () => {
  const sources = await Promise.all([
    readFile(join(root, ".github/workflows/ci.yml"), "utf8"),
    readFile(join(root, ".github/workflows/release.yml"), "utf8"),
    readFile(join(root, "packages/github-action/action.yml"), "utf8"),
    readFile(join(root, "packages/cli/src/index.ts"), "utf8"),
    readFile(join(root, "packages/local-app/src/index.ts"), "utf8")
  ]);
  const expectedPins = new Map([
    ["actions/checkout", "9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0"],
    ["actions/setup-node", "48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e"],
    ["actions/upload-artifact", "043fb46d1a93c77aae656e7c1c64a875d1fc6a0a"],
    ["softprops/action-gh-release", "718ea10b132b3b2eba29c1007bb80653f286566b"],
    ["actions/github-script", "3a2844b7e9c422d3c10d287c895573f7108da1b3"],
    ["github/codeql-action/upload-sarif", "99df26d4f13ea111d4ec1a7dddef6063f76b97e9"]
  ]);
  const combined = sources.join("\n");

  for (const [actionName, sha] of expectedPins) {
    const references = [...combined.matchAll(new RegExp(`${actionName.replaceAll("/", "\\/")}@([a-f0-9]{40})`, "g"))];
    assert.ok(references.length > 0, `missing pinned action dependency: ${actionName}`);
    for (const reference of references) {
      assert.equal(reference[1], sha, `stale action dependency: ${actionName}@${reference[1]}`);
    }
  }
});

test("repository CI self-scan uses review-needed gating", async () => {
  const workflow = await readFile(join(root, ".github/workflows/ci.yml"), "utf8");
  assert.match(workflow, /npm run evidoc -- --fail-on=review_needed/);
  assert.doesNotMatch(workflow, /npm run evidoc -- --fail-on=broken/);
});

test("README leads with one read-only check and a focused product definition", async () => {
  const readme = await readFile(join(root, "README.md"), "utf8");
  const firstScreen = readme.split(/\r?\n/).slice(0, 80).join("\n");

  assert.match(firstScreen, /repo-local evidence gate for stale documentation and coding-agent instructions/);
  assert.match(firstScreen, /## One-Minute Check/);
  assert.match(firstScreen, /npx evidoc check --fail-on=review_needed/);
  assert.match(firstScreen, /This first check is read-only/);
  assert.match(firstScreen, /deterministic analyzer is the engine/);
  assert.match(firstScreen, /Agent Runtime Contract/);
  assert.match(firstScreen, /“Agent-first” describes how coding agents consume that same evidence/);
  assert.match(markdownSection(readme, "Who It Is For"), /maintainers/);
  assert.match(markdownSection(readme, "Product Surfaces"), /loopback-only/);
  assert.match(markdownSection(readme, "Product Surfaces"), /experimental `agent-eval --json`/);
  assert.ok(readme.split(/\r?\n/).length <= 260);
});

test("public Action examples are pinned and retain actionable PR feedback", async () => {
  const rootManifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  for (const path of ["README.md", "docs/onboarding.md"]) {
    const text = await readFile(join(root, path), "utf8");
    assert.match(text, new RegExp(`handong66/Evidoc/packages/github-action@v${rootManifest.version.replaceAll(".", "\\.")}`));
    assert.doesNotMatch(text, /handong66\/Evidoc\/packages\/github-action@main/);
    assert.match(text, /pr-comment: "true"/);
    assert.match(text, /fail-on: review_needed/);
    assert.match(text, /changed-only: \$\{\{ github\.event_name == 'pull_request'/);
    assert.match(text, /since: origin\/\$\{\{ github\.event\.repository\.default_branch \}\}/);
    assert.match(text, /Only add `security-events: write` when setting `sarif: "true"`/);
  }
});

test("public claims distinguish implemented behavior from experimental surfaces", async () => {
  const readme = await readFile(join(root, "README.md"), "utf8");
  const onboarding = await readFile(join(root, "docs/onboarding.md"), "utf8");
  const architecture = await readFile(join(root, "docs/architecture/full-scope-architecture.md"), "utf8");

  assert.match(readme, /No repository content is uploaded by default/);
  assert.match(readme, /experimental `agent-eval --json` command emits a benchmark specification but does not run agents/i);
  assert.match(onboarding, /does not execute an A\/B run, score an agent, call an external provider, or upload repository content/);
  assert.match(onboarding, /binds only to `127\.0\.0\.1`, `localhost`, or `::1`/);
  assert.match(onboarding, /apply explicitly selected deterministic safe fixes/);
  assert.match(onboarding, /aggregate runtime fingerprints can differ/);
  assert.match(architecture, /Experimental Agent Evaluation Pack/);
  assert.match(architecture, /does not run, compare, or score external agents/);
  assert.match(architecture, /GitHub Action results/);
  assert.doesNotMatch(readme, /GitHub App|github-app|evidoc-github-app/);
});

test("high-traffic public guidance stays reviewable in web diffs", async () => {
  for (const path of ["README.md", "docs/onboarding.md"]) {
    const lines = (await readFile(join(root, path), "utf8")).split(/\r?\n/);
    const longLine = lines.find((line) => line.length > 500);
    assert.equal(longLine, undefined, `${path} contains a line longer than 500 characters`);
  }
});
