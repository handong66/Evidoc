import { test } from "node:test";
import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

const root = join(import.meta.dirname, "../../../..");

function yamlBlocks(text: string): string[] {
  return [...text.matchAll(/```yaml\n([\s\S]*?)\n```/g)].map((match) => match[1]);
}

function markdownSection(text: string, heading: string): string {
  const sectionStart = new RegExp(`^## ${heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\n`, "m").exec(text);
  assert.ok(sectionStart, `missing README section: ${heading}`);
  const start = sectionStart.index;
  const next = /^## /m.exec(text.slice(start + sectionStart[0].length));
  return next === null ? text.slice(start) : text.slice(start, start + sectionStart[0].length + next.index);
}

test("declares an open-source license, changelog, and privacy policy", async () => {
  await access(join(root, "LICENSE"));
  await access(join(root, "PRIVACY.md"));
  await access(join(root, "SECURITY.md"));
  const changelog = await readFile(join(root, "CHANGELOG.md"), "utf8");
  const readme = await readFile(join(root, "README.md"), "utf8");
  const privacy = await readFile(join(root, "PRIVACY.md"), "utf8");
  const security = await readFile(join(root, "SECURITY.md"), "utf8");

  assert.match(changelog, /0\.1\.0/);
  assert.match(changelog, /Semantic Versioning/);
  assert.match(changelog, /npx repo-evidoc/);
  assert.doesNotMatch(changelog, /npx evidoc/);
  assert.match(readme, /\[Privacy\]\(PRIVACY\.md\)/);
  assert.match(readme, /\[Security policy\]\(SECURITY\.md\)/);
  assert.match(privacy, /Telemetry is disabled by default/);
  assert.match(privacy, /must not include repository content/);
  assert.match(security, /## Supported Versions/);
  assert.match(security, /\| 0\.1\.x \| Yes \|/);
  assert.match(security, /5 business days/);
  assert.match(security, /coordinated disclosure/i);
});

test("declares publishable packages including npx repo-evidoc", async () => {
  const rootPackage = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  const npxPackage = JSON.parse(await readFile(join(root, "packages", "evidoc", "package.json"), "utf8"));
  const cliPackage = JSON.parse(await readFile(join(root, "packages", "cli", "package.json"), "utf8"));

  assert.notEqual(rootPackage.private, true);
  assert.equal(npxPackage.name, "repo-evidoc");
  assert.equal(npxPackage.bin.evidoc, "dist/src/index.js");
  assert.equal(cliPackage.bin, undefined);
  assert.ok(rootPackage.scripts["release:notes"]);
});

test("release pipeline smoke-tests the npx repo-evidoc package before publishing", async () => {
  const rootPackage = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  const workflow = await readFile(join(root, ".github", "workflows", "release.yml"), "utf8");
  const smokeScript = await readFile(join(root, "scripts", "smoke-npx.mjs"), "utf8");
  const gitignore = await readFile(join(root, ".gitignore"), "utf8");

  assert.equal(rootPackage.scripts["release:smoke:npx"], "node scripts/smoke-npx.mjs");
  assert.match(workflow, /npm run release:smoke:npx/);
  assert.match(workflow, /id-token: write/);
  assert.match(workflow, /node-version: "24"/);
  assert.match(workflow, /cache: npm/);
  assert.match(workflow, /npm install -g npm@11\.18\.0/);
  assert.match(workflow, /npm pack "\.\/\$package" --pack-destination \.evidoc\/release/);
  assert.doesNotMatch(workflow, /npm pack "\$package"/);
  assert.match(workflow, /npm view "\$\{name\}@\$\{version\}" version/);
  assert.match(workflow, /npm publish "\.\/\$\{package_dir\}" --access public/);
  assert.doesNotMatch(workflow, /NODE_AUTH_TOKEN/);
  assert.doesNotMatch(workflow, /NPM_TOKEN/);
  assert.doesNotMatch(workflow, /--provenance/);
  assert.match(workflow, /publish_package packages\/core/);
  assert.match(workflow, /publish_package packages\/evidoc/);
  assert.doesNotMatch(workflow, /npm publish packages\//);
  assert.match(smokeScript, /"npm"/);
  assert.match(smokeScript, /"install"/);
  assert.match(smokeScript, /shouldPackFresh/);
  assert.match(smokeScript, /rm\(releaseDir/);
  assert.match(smokeScript, /"npx"/);
  assert.match(smokeScript, /"--no-install"/);
  assert.match(smokeScript, /repo-evidoc-\[0-9\]/);
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
  assert.match(actionSection, /handong66\/Evidoc\/packages\/github-action@v0\.1\.0/);
  assert.doesNotMatch(actionSection, /pull_request:\n  push:\n\npermissions:/);
});

test("public docs present npx adoption as the current npm path", async () => {
  const readme = await readFile(join(root, "README.md"), "utf8");
  const onboarding = await readFile(join(root, "docs/onboarding.md"), "utf8");

  for (const text of [readme, onboarding]) {
    assert.match(text, /npx repo-evidoc check --fail-on=review_needed/);
    assert.match(text, /npx repo-evidoc app/);
    assert.doesNotMatch(text, /before the npm package is published/i);
    assert.doesNotMatch(text, /before npm publication/i);
    assert.doesNotMatch(text, /future `npx` command/i);
    assert.doesNotMatch(text, /pre-publication/i);
    assert.doesNotMatch(text, /pre-npm/i);
  }
  assert.match(readme, /npm run evidoc -- check --root \/path\/to\/repository --fail-on=review_needed/);
  assert.match(onboarding, /npm run evidoc -- check --root \/path\/to\/repository --fail-on=review_needed/);
  assert.match(readme, /npm run evidoc -- fix --root \/path\/to\/repository --safe --write --json/);
  assert.match(onboarding, /npm run evidoc -- fix --root \/path\/to\/repository --safe --write --json/);
  assert.doesNotMatch(readme, /npx evidoc/);
  assert.match(readme, /Node\.js 22 or later/);
  assert.match(onboarding, /Node\.js 22 or later/);
  assert.match(markdownSection(readme, "Choose an Adoption Path"), /npx repo-evidoc diagnose/);
  assert.match(markdownSection(readme, "For Humans"), /npx repo-evidoc doctor/);
  assert.match(markdownSection(readme, "For Humans"), /npx repo-evidoc fix --safe --write --json/);
  assert.match(markdownSection(readme, "For AI Agents"), /npx repo-evidoc agent-eval --json/);
  assert.match(markdownSection(readme, "For AI Agents"), /evidoc\.agent_scan/);
  assert.doesNotMatch(markdownSection(readme, "Local Git Gate Adoption"), /guard --scope staged/);
  assert.match(markdownSection(readme, "Troubleshooting"), /guard --event manual --scope staged/);
  assert.match(onboarding, /guard --event manual --scope staged/);
  assert.match(readme, /Generated workflows from `init` and the local app try to detect the repository branch from remote HEAD metadata or the current branch/);
  assert.match(onboarding, /Generated workflows from `init` and the local app try to detect the repository branch from remote HEAD metadata or the current branch/);
});

test("public docs explain real user stories before promotion", async () => {
  const readme = await readFile(join(root, "README.md"), "utf8");
  const pursuitGoal = await readFile(join(root, "docs", "vision", "pursuit-goal.zh-CN.md"), "utf8");
  const stories = markdownSection(readme, "Common User Stories");

  assert.match(markdownSection(readme, "Who Is Evidoc For"), /repository knowledge still reflects current code/);
  assert.match(stories, /Maintainers need README commands, paths, APIs, and examples to stay current before merge/);
  assert.match(stories, /Teams using AGENTS\.md, CLAUDE\.md, Cursor rules, or Copilot instructions/);
  assert.match(stories, /Private, local-only, or air-gapped repositories/);
  assert.match(stories, /GitHub PR reviewers/);
  assert.match(stories, /Codex/);
  assert.match(stories, /Claude Code/);
  assert.match(stories, /OpenCode/);
  assert.match(stories, /Platform and tooling teams/);
  assert.match(stories, /Open-source maintainers/);
  assert.match(stories, /npx repo-evidoc verify --instructions --json/);
  assert.match(stories, /npx repo-evidoc diagnose/);
  assert.match(stories, /npx repo-evidoc doctor/);
  assert.match(pursuitGoal, /## 真实用户故事/);
  assert.match(pursuitGoal, /维护者担心 README/);
  assert.match(pursuitGoal, /Codex/);
  assert.match(pursuitGoal, /Claude Code/);
  assert.match(pursuitGoal, /OpenCode/);
  assert.match(pursuitGoal, /npx repo-evidoc check --fail-on=review_needed/);
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
