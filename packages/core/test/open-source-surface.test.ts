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
  assert.match(readme, /\[!\[中文文档\]\(https:\/\/img\.shields\.io\/badge\/docs-%E4%B8%AD%E6%96%87-blue\?style=flat-square\)\]\(docs\/vision\/pursuit-goal\.zh-CN\.md\)/);
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
  assert.equal(npxPackage.engines.node, ">=22");
  assert.equal(cliPackage.engines.node, ">=22");
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
  const actionEnd = readme.indexOf("\n## How Evidoc Works", actionStart);
  const actionSection = readme.slice(actionStart, actionEnd);

  assert.match(actionSection, /name: Evidoc/);
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
  assert.match(markdownSection(readme, "Who Uses Evidoc"), /npx repo-evidoc diagnose|evidoc\.agent_scan/);
  assert.match(markdownSection(readme, "Start Here"), /npx repo-evidoc doctor/);
  assert.match(markdownSection(readme, "Start Here"), /npx repo-evidoc fix --safe --write --json/);
  assert.match(markdownSection(readme, "Start Here"), /npx repo-evidoc agent-eval --json/);
  assert.match(markdownSection(readme, "Start Here"), /evidoc\.agent_scan/);
  assert.doesNotMatch(readme, /^## For Humans$/m);
  assert.doesNotMatch(readme, /^## For AI Agents$/m);
  assert.doesNotMatch(markdownSection(readme, "Local Git Gate Adoption"), /guard --scope staged/);
  assert.match(markdownSection(readme, "Troubleshooting"), /guard --event manual --scope staged/);
  assert.match(onboarding, /guard --event manual --scope staged/);
  assert.match(readme, /Generated workflows from `init` and the local app try to detect the repository branch from remote HEAD metadata or the current branch/);
  assert.match(onboarding, /Generated workflows from `init` and the local app try to detect the repository branch from remote HEAD metadata or the current branch/);
});

test("public README keeps the beginner path low-cognition", async () => {
  const readme = await readFile(join(root, "README.md"), "utf8");
  const lines = readme.trimEnd().split(/\r?\n/);
  const firstScreen = lines.slice(0, 80).join("\n");
  const h2Count = readme.match(/^## /gm)?.length ?? 0;
  const documentsLine = lines.findIndex((line) => line === "## Documents") + 1;
  const agentSectionLine = lines.findIndex((line) => line === "## Use Evidoc With Your Agent") + 1;
  const startLine = lines.findIndex((line) => line === "## Start Here") + 1;
  const storiesLine = lines.findIndex((line) => line === "## Who Uses Evidoc") + 1;
  const surfacesLine = lines.findIndex((line) => line === "## Product Surfaces") + 1;

  assert.ok(lines.length <= 280, `README has ${lines.length} lines`);
  assert.ok(h2Count <= 13, `README has ${h2Count} h2 sections`);
  assert.ok(agentSectionLine > 0 && agentSectionLine < startLine, `Agent section starts at line ${agentSectionLine}`);
  assert.ok(startLine > 0 && startLine < storiesLine, `Start Here starts at line ${startLine}`);
  assert.ok(storiesLine > 0 && storiesLine < surfacesLine, `Who Uses starts at line ${storiesLine}`);
  assert.match(firstScreen, /## Start Here/);
  assert.match(firstScreen, /## Use Evidoc With Your Agent/);
  assert.match(firstScreen, /The npm package name is `repo-evidoc`; the installed command name is `evidoc`/);
  assert.match(firstScreen, /## Who Uses Evidoc/);
  assert.match(firstScreen, /Codex, Claude Code, OpenCode, Cursor/);
  assert.match(firstScreen, /npx -p @handong66\/evidoc-mcp-server repo-evidoc-mcp/);
  assert.match(firstScreen, /npx repo-evidoc init --yes --with agents,hooks,badge,llms/);
  assert.match(firstScreen, /\[MCP clients\]\(docs\/development\/mcp-clients\.md\)/);
  assert.match(firstScreen, /Use Evidoc to check whether README, docs, and agent instructions drifted/);
  assert.match(firstScreen, /Call `evidoc\.agent_scan`, then explain which docs are unsafe to trust/);
  assert.match(firstScreen, /Run `npx repo-evidoc diagnose` and repair only evidence-backed findings/);
  assert.doesNotMatch(firstScreen, /Agent Runtime Contract|runtime\.fingerprint|patch classifications/);
  assert.ok(documentsLine > 0 && documentsLine <= 150, `Documents section starts at line ${documentsLine}`);
  assert.match(markdownSection(readme, "Documents"), /Read this when/);
});

test("public docs explain real user stories before promotion", async () => {
  const readme = await readFile(join(root, "README.md"), "utf8");
  const pursuitGoal = await readFile(join(root, "docs", "vision", "pursuit-goal.zh-CN.md"), "utf8");
  const stories = markdownSection(readme, "Who Uses Evidoc");
  const productSurfaces = markdownSection(readme, "Product Surfaces");

  assert.match(readme, /same repo-local evidence before they trust or repair stale context/);
  assert.match(readme, /After setup, you can keep working in your coding agent/);
  assert.match(stories, /AI coding teams want Codex, Claude Code, OpenCode, Cursor, or internal agents/);
  assert.match(stories, /generated agent instructions, CLI fallback commands, and repair prompts/);
  assert.match(stories, /Maintainers want README commands, paths, APIs, and examples to stay current before merge/);
  assert.match(stories, /Teams using AGENTS\.md, CLAUDE\.md, Cursor rules, or Copilot instructions/);
  assert.match(stories, /Private, local-only, or air-gapped repositories/);
  assert.match(stories, /Reviewers want PR comments/);
  assert.match(stories, /Local Web UI \/ Command Center/);
  assert.match(stories, /Codex/);
  assert.match(stories, /Claude Code/);
  assert.match(stories, /OpenCode/);
  assert.match(stories, /Cursor/);
  assert.match(stories, /Platform teams want drift evidence/);
  assert.match(stories, /Architecture and API maintainers/);
  assert.match(stories, /Teams that need audit trails/);
  assert.match(stories, /Review log and runtime fingerprints/);
  assert.match(stories, /Open-source maintainers/);
  assert.match(stories, /npx repo-evidoc verify --instructions --json/);
  assert.match(stories, /npx repo-evidoc diagnose/);
  assert.match(stories, /npx repo-evidoc doctor/);
  assert.match(stories, /evidoc\.agent_scan/);
  assert.match(productSurfaces, /GitHub Action/);
  assert.match(productSurfaces, /MCP server/);
  assert.match(productSurfaces, /@handong66\/evidoc-mcp-server/);
  assert.match(productSurfaces, /repo-evidoc-mcp/);
  assert.match(productSurfaces, /evidoc\.get_drift_status/);
  assert.match(productSurfaces, /evidoc\.record_review/);
  assert.match(productSurfaces, /Reports and graph/);
  assert.match(productSurfaces, /Repair workflow/);
  assert.match(markdownSection(readme, "Documents"), /Chinese feature guide, user stories, and product surfaces/);
  assert.match(pursuitGoal, /^# Evidoc 中文指南：功能、用户故事和使用场景/m);
  assert.doesNotMatch(pursuitGoal, /^# Evidoc 追求目标/m);
  assert.doesNotMatch(pursuitGoal, /^# Evidoc 用户故事/m);
  assert.doesNotMatch(pursuitGoal, /## Evidoc 不是什么/);
  assert.doesNotMatch(pursuitGoal, /不只是命令行/);
  assert.match(pursuitGoal, /## 我想直接和 agent 对话，怎么接入？/);
  assert.match(pursuitGoal, /npx -p @handong66\/evidoc-mcp-server repo-evidoc-mcp/);
  assert.match(pursuitGoal, /npx repo-evidoc init --yes --with agents,hooks,badge,llms/);
  assert.match(pursuitGoal, /\[MCP clients\]\(https:\/\/github\.com\/handong66\/Evidoc\/blob\/main\/docs\/development\/mcp-clients\.md\)/);
  assert.match(pursuitGoal, /先用 Evidoc 检查这个仓库的 README、docs 和 AGENTS\.md 是否漂移/);
  assert.match(pursuitGoal, /调用 `evidoc\.agent_scan` 后告诉我哪些文档不可信/);
  assert.match(pursuitGoal, /基于 `npx repo-evidoc diagnose` 的证据修复文档，不要凭旧 README 猜/);
  assert.match(pursuitGoal, /## Evidoc 能做什么/);
  assert.match(pursuitGoal, /## 真实用户故事/);
  assert.match(pursuitGoal, /README 里的命令、路径、API 或示例可能已经过期/);
  assert.match(pursuitGoal, /## 写入由你选择/);
  assert.match(pursuitGoal, /本地 Web UI \/ Command Center/);
  assert.match(pursuitGoal, /GitHub Action/);
  assert.match(pursuitGoal, /MCP tools/);
  assert.match(pursuitGoal, /Codex/);
  assert.match(pursuitGoal, /Claude Code/);
  assert.match(pursuitGoal, /OpenCode/);
  assert.match(pursuitGoal, /Cursor/);
  assert.match(pursuitGoal, /npx repo-evidoc check --fail-on=review_needed/);
  assert.match(pursuitGoal, /npx repo-evidoc verify --instructions --json/);
  assert.match(pursuitGoal, /npx repo-evidoc recipes --target all/);
  assert.match(pursuitGoal, /npx repo-evidoc agent-eval --json/);
  assert.match(pursuitGoal, /npx repo-evidoc draft --json/);
  assert.match(pursuitGoal, /npx repo-evidoc validate --proposal <proposal-file> --json/);
  assert.match(pursuitGoal, /evidoc\.agent_scan/);
  assert.match(pursuitGoal, /evidoc\.get_drift_status/);
  assert.match(pursuitGoal, /JSON reports/);
  assert.match(pursuitGoal, /Graph 和 evidence/);
  assert.match(pursuitGoal, /Review log 和 runtime fingerprint/);
  assert.match(pursuitGoal, /safe fixes/);
  assert.match(pursuitGoal, /Finding 必须绑定具体 evidence/);
  assert.match(pursuitGoal, /MCP 写入工具需要显式授权/);
  assert.match(pursuitGoal, /source binding、frontmatter 和 review log/);
  assert.match(pursuitGoal, /外部 patch provider 是显式 opt-in/);
});

test("public action docs keep security-events permission opt-in for SARIF", async () => {
  for (const docPath of ["README.md", "docs/onboarding.md"]) {
    const text = await readFile(join(root, docPath), "utf8");
    const sarifFalseBlocks = yamlBlocks(text).filter((block) => /sarif:\s*"false"/.test(block));
    const fullWorkflowBlocks = yamlBlocks(text).filter(
      (block) => /jobs:\n[\s\S]*handong66\/Evidoc\/packages\/github-action/.test(block)
    );

    assert.ok(sarifFalseBlocks.length > 0, `${docPath} should include at least one sarif false workflow example`);
    assert.ok(fullWorkflowBlocks.length > 0, `${docPath} should include a full workflow example`);
    for (const block of fullWorkflowBlocks) {
      assert.match(block, /^name:\s*Evidoc$/m, `${docPath} full workflow should name the Actions run`);
    }
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
    assert.match(text, /keep repository content local by default|does not call external agent providers|do not upload repository content/i);
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
