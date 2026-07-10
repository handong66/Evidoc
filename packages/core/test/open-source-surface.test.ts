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
  assert.match(changelog, /npx repo-evidoc/);
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

  assert.equal(packages.length, 12);
  for (const { directory, manifest } of packages) {
    assert.equal(manifest.version, rootManifest.version, manifest.name);
    assert.equal(manifest.scripts?.prepublishOnly, "node ../../scripts/ensure-built-package.mjs", manifest.name);
    assert.deepEqual(manifest.files, ["dist/src", "README.md", "LICENSE"], manifest.name);
    await access(join(root, "packages", directory, "README.md"));
    await access(join(root, "packages", directory, "LICENSE"));
    for (const [name, version] of Object.entries(manifest.dependencies ?? {})) {
      if (workspaceNames.has(name)) assert.equal(version, rootManifest.version, `${manifest.name} -> ${name}`);
    }
  }

  const wrapper = packages.find(({ manifest }) => manifest.name === "repo-evidoc")?.manifest;
  assert.equal(wrapper?.bin?.evidoc, "dist/src/index.js");
  assert.equal(wrapper?.engines?.node, ">=22");
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
  assert.match(workflow, /Refusing partial release/);
  assert.match(workflow, /Unable to verify registry state/);
  assert.match(workflow, /packages\/core/);
  assert.match(workflow, /packages\/evidoc/);
  assert.match(workflow, /tarball="\.evidoc\/release\/\$\{tarball_name\}"/);
  assert.match(workflow, /npm publish "\$tarball" --access public/);
  assert.doesNotMatch(workflow, /npm publish "\.\/\$\{package_dir\}"/);
  assert.ok(
    workflow.indexOf("- name: Publish packages to npm") < workflow.indexOf("- name: Attach artifacts to GitHub Release"),
    "npm publishing must succeed before the GitHub Release is created"
  );
  assert.doesNotMatch(workflow, /NODE_AUTH_TOKEN|NPM_TOKEN|Skipping .*already published/);
  assert.doesNotMatch(workflow, /github\.event\.inputs\.publish/);
  assert.match(workflow, /- name: Publish packages to npm\n\s+if: startsWith\(github\.ref, 'refs\/tags\/'\)/);
  assert.match(smoke, /package\/README\.md/);
  assert.match(smoke, /package\/LICENSE/);
  assert.match(smoke, /EXPECTED_PACKAGE_COUNT = 12/);
  assert.match(smoke, /"npx"/);
  assert.match(smoke, /"--no-install"/);
  assert.match(smoke, /"fix"/);
  const verifier = await readFile(join(root, "scripts/verify-release-version.mjs"), "utf8");
  assert.match(verifier, /Public package directories changed/);
  assert.match(verifier, /\["evidoc", "repo-evidoc"\]/);

  for (const source of [workflow, action]) {
    for (const match of source.matchAll(/^\s*uses:\s*([^\s#]+)/gm)) {
      assert.match(match[1], /@[a-f0-9]{40}$/, `mutable action dependency: ${match[1]}`);
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
  assert.match(firstScreen, /npx repo-evidoc check --fail-on=review_needed/);
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
