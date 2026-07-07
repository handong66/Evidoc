import { test } from "node:test";
import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

const root = join(import.meta.dirname, "../../../..");

function yamlBlocks(text: string): string[] {
  return [...text.matchAll(/```yaml\n([\s\S]*?)\n```/g)].map((match) => match[1]);
}

test("declares an open-source license, changelog, and privacy policy", async () => {
  await access(join(root, "LICENSE"));
  await access(join(root, "PRIVACY.md"));
  const changelog = await readFile(join(root, "CHANGELOG.md"), "utf8");
  const readme = await readFile(join(root, "README.md"), "utf8");
  const privacy = await readFile(join(root, "PRIVACY.md"), "utf8");

  assert.match(changelog, /0\.1\.0/);
  assert.match(readme, /\[Privacy\]\(PRIVACY\.md\)/);
  assert.match(privacy, /Telemetry is disabled by default/);
  assert.match(privacy, /must not include repository content/);
});

test("declares publishable packages including npx evidoc", async () => {
  const rootPackage = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  const npxPackage = JSON.parse(await readFile(join(root, "packages", "evidoc", "package.json"), "utf8"));
  const cliPackage = JSON.parse(await readFile(join(root, "packages", "cli", "package.json"), "utf8"));

  assert.notEqual(rootPackage.private, true);
  assert.equal(npxPackage.name, "evidoc");
  assert.equal(npxPackage.bin.evidoc, "dist/src/index.js");
  assert.equal(cliPackage.bin, undefined);
  assert.ok(rootPackage.scripts["release:notes"]);
});

test("release pipeline smoke-tests the npx evidoc package before publishing", async () => {
  const rootPackage = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  const workflow = await readFile(join(root, ".github", "workflows", "release.yml"), "utf8");
  const smokeScript = await readFile(join(root, "scripts", "smoke-npx.mjs"), "utf8");
  const gitignore = await readFile(join(root, ".gitignore"), "utf8");

  assert.equal(rootPackage.scripts["release:smoke:npx"], "node scripts/smoke-npx.mjs");
  assert.match(workflow, /npm run release:smoke:npx/);
  assert.match(workflow, /npm pack "\.\/\$package" --pack-destination \.evidoc\/release/);
  assert.doesNotMatch(workflow, /npm pack "\$package"/);
  assert.match(workflow, /npm publish \.\/packages\/core --access public --provenance/);
  assert.doesNotMatch(workflow, /npm publish packages\//);
  assert.match(smokeScript, /"npm"/);
  assert.match(smokeScript, /"install"/);
  assert.match(smokeScript, /shouldPackFresh/);
  assert.match(smokeScript, /rm\(releaseDir/);
  assert.match(smokeScript, /"npx"/);
  assert.match(smokeScript, /"--no-install"/);
  assert.match(smokeScript, /evidoc-\[0-9\]/);
  assert.match(smokeScript, /evidoc/);
  assert.match(smokeScript, /"app"/);
  assert.match(smokeScript, /"--once"/);
  assert.match(smokeScript, /"--json"/);
  assert.match(smokeScript, /"--no-open"/);
  assert.match(smokeScript, /"doctor"/);
  assert.match(smokeScript, /"init"/);
  assert.match(smokeScript, /"--yes"/);
  assert.match(smokeScript, /"check"/);
  assert.match(smokeScript, /"--fail-on=review_needed"/);
  assert.match(smokeScript, /"diagnose"/);
  assert.match(smokeScript, /"fix"/);
  assert.match(smokeScript, /"--safe"/);
  assert.match(smokeScript, /"demo"/);
  assert.match(gitignore, /^\.evidoc\/release\/$/m);
  assert.match(gitignore, /^\.evidoc\/history\.jsonl$/m);
});

test("repository CI self-scan uses review-needed gating", async () => {
  const workflow = await readFile(join(root, ".github", "workflows", "ci.yml"), "utf8");

  assert.match(workflow, /npm run evidoc -- --fail-on=review_needed/);
  assert.doesNotMatch(workflow, /npm run evidoc -- --fail-on=broken/);
});

test("published workspace packages refuse local publish before build output exists", async () => {
  const packagePaths = (await readdir(join(root, "packages"), { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(root, "packages", entry.name, "package.json"))
    .sort();

  for (const packagePath of packagePaths) {
    const manifest = JSON.parse(await readFile(packagePath, "utf8"));
    assert.equal(manifest.scripts?.prepublishOnly, "node ../../scripts/ensure-built-package.mjs");
    assert.deepEqual(manifest.files, ["dist/src"], manifest.name);
  }
});

test("public product docs do not promise an installed application path", async () => {
  const docs = [
    "README.md",
    "docs/architecture/full-scope-architecture.md",
    "docs/onboarding.md",
    "docs/vision/pursuit-goal.zh-CN.md",
    "docs/development/release-process.md"
  ];
  const forbidden = [
    "GitHub" + " App",
    "github" + "-app",
    "evidoc" + "-github" + "-app",
    "no" + "-workflow",
    "check" + "_suite"
  ];

  for (const docPath of docs) {
    const text = await readFile(join(root, docPath), "utf8");
    for (const term of forbidden) {
      assert.doesNotMatch(text, new RegExp(term));
    }
  }
});

test("README GitHub Action examples keep PR comments visible by default", async () => {
  const readme = await readFile(join(root, "README.md"), "utf8");
  const actionStart = readme.indexOf("\n## GitHub Action\n");
  const actionEnd = readme.indexOf("\n## Product Principles", actionStart);
  const actionSection = readme.slice(actionStart, actionEnd);

  assert.match(actionSection, /pr-comment: "true"/);
  assert.match(actionSection, /fail-on: review_needed/);
  assert.doesNotMatch(actionSection, /fail-on: broken/);
  assert.match(actionSection, /permissions:\n  contents: read\n  actions: read\n  pull-requests: write/);
  assert.match(actionSection, /When enabling SARIF in this workflow, also add `security-events: write`/);
  assert.match(actionSection, /changed-only: \$\{\{ github\.event_name == 'pull_request' && 'true' \|\| 'false' \}\}/);
  assert.doesNotMatch(actionSection, /changed-only: "true"/);
  assert.match(actionSection, /since: origin\/\$\{\{ github\.event\.repository\.default_branch \}\}/);
  assert.match(
    actionSection,
    /pull_request:\n  push:\n    # If your default branch is not main or master, replace this list\.\n    branches:\n      - main\n      - master/
  );
  assert.match(actionSection, /If your default branch is not main or master, replace this list/);
  assert.doesNotMatch(actionSection, /pull_request:\n  push:\n\npermissions:/);
});

test("public docs put the current GitHub Action path before unpublished npx adoption", async () => {
  const readme = await readFile(join(root, "README.md"), "utf8");
  const onboarding = await readFile(join(root, "docs/onboarding.md"), "utf8");

  assert.ok(
    readme.indexOf("\n## GitHub Action Adoption\n") < readme.indexOf("\n## Zero-Setup Local Adoption\n"),
    "README should show the currently supported public GitHub Action path before the future npm/npx path"
  );
  assert.ok(
    onboarding.indexOf("\n## GitHub Action CI Setup\n") < onboarding.indexOf("\n## One-command Local Setup\n"),
    "onboarding should show the currently supported public GitHub Action path before the future npm/npx path"
  );
  assert.match(readme, /before the npm package is published/i);
  assert.match(onboarding, /before the npm package is published/i);
  assert.match(readme, /npm run evidoc -- check --root \/path\/to\/repository --fail-on=review_needed/);
  assert.match(onboarding, /npm run evidoc -- check --root \/path\/to\/repository --fail-on=review_needed/);
  assert.match(readme, /npm run evidoc -- fix --root \/path\/to\/repository --safe --write --json/);
  assert.match(onboarding, /npm run evidoc -- fix --root \/path\/to\/repository --safe --write --json/);
  assert.match(readme, /Node\.js 22 or later/);
  assert.match(onboarding, /Node\.js 22 or later/);
  assert.match(readme, /Generated workflows from `init` and the local app try to detect the repository branch from remote HEAD metadata or the current branch/);
  assert.match(onboarding, /Generated workflows from `init` and the local app try to detect the repository branch from remote HEAD metadata or the current branch/);
});

test("public action docs keep security-events permission opt-in for SARIF", async () => {
  for (const docPath of ["README.md", "docs/onboarding.md"]) {
    const text = await readFile(join(root, docPath), "utf8");
    const sarifFalseBlocks = yamlBlocks(text).filter((block) => /sarif:\s*"false"/.test(block));

    assert.ok(sarifFalseBlocks.length > 0, `${docPath} should include at least one sarif false workflow example`);
    for (const block of sarifFalseBlocks) {
      assert.doesNotMatch(block, /security-events:\s*write/);
    }
    assert.match(text, /Only add `security-events: write` when setting `sarif: "true"`/);
  }
});

test("public adoption docs keep high-traffic guidance readable in web diffs", async () => {
  for (const docPath of ["README.md", "docs/onboarding.md"]) {
    const lines = (await readFile(join(root, docPath), "utf8")).split(/\r?\n/);
    const longLine = lines.find((line) => line.length > 500);
    assert.equal(longLine, undefined, `${docPath} contains a line longer than 500 characters`);
  }
});

test("public docs say fork PRs disable both safe auto-fix and auto-commit", async () => {
  for (const docPath of ["README.md", "docs/onboarding.md"]) {
    const text = await readFile(join(root, docPath), "utf8");

    assert.doesNotMatch(text, /fork PR auto-commit is skipped/i);
    assert.match(text, /fork PR safe auto-fix and auto-commit/i);
  }
});

test("public onboarding docs describe non-interactive bare runs as one-shot app scans", async () => {
  for (const docPath of ["README.md", "docs/onboarding.md"]) {
    const text = await readFile(join(root, docPath), "utf8");

    assert.doesNotMatch(text, /falls back to (?:a )?terminal-only `check`/i);
    assert.match(text, /one-shot (?:local )?app scan/i);
  }
});

test("public docs describe agent evaluation, MCP default, and telemetry boundary", async () => {
  for (const docPath of ["README.md", "docs/onboarding.md"]) {
    const text = await readFile(join(root, docPath), "utf8");

    assert.match(text, /agent-eval --json/);
    assert.match(text, /evidoc\.agent_scan/);
    assert.match(text, /Telemetry is disabled by default|telemetry is disabled by default/i);
    assert.match(text, /does not call external agent providers|do not upload repository content/i);
  }

  const mcpClients = await readFile(join(root, "docs/development/mcp-clients.md"), "utf8");
  assert.match(mcpClients, /evidoc\.agent_scan/);
  assert.match(mcpClients, /coldStart\.status/);
  assert.match(mcpClients, /freshness\.status/);
  assert.match(mcpClients, /read-parity/);

  const architecture = await readFile(join(root, "docs/architecture/full-scope-architecture.md"), "utf8");
  assert.match(architecture, /agent-eval/);
  assert.match(architecture, /evidoc-agent-ab-v0/);
  assert.match(architecture, /evidoc\.agent_scan/);
});
