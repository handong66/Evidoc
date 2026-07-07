import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { runGithubAction } from "../src/index.js";

async function fixture(): Promise<string> {
  return mkdtemp(join(tmpdir(), "evidoc-action-product-"));
}

async function write(root: string, file: string, text: string): Promise<void> {
  const target = join(root, file);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, text, "utf8");
}

test("returns annotations, SARIF, and PR comment output for GitHub integration", async () => {
  const root = await fixture();
  await write(root, "README.md", "Code lives in `src/missing.ts`.\n");

  const result = await runGithubAction({ cwd: root, failOn: "broken" });

  assert.equal(result.exitCode, 1);
  assert.match(result.annotations, /::error file=README\.md,line=1::/);
  assert.match(result.prComment, /Evidoc Report/);
  assert.equal(JSON.parse(result.sarif).version, "2.1.0");
});

test("labels changed-only action summaries and comments as scoped PR scans", async () => {
  const root = await fixture();
  await write(root, "README.md", "Code lives in `src/app.ts`.\n");
  await write(root, "src/app.ts", "export const ok = true;\n");

  const result = await runGithubAction({ cwd: root, failOn: "broken", changedFiles: ["README.md"] });
  const fullScanResult = await runGithubAction({ cwd: root, failOn: "broken" });

  assert.equal(result.exitCode, 0);
  assert.match(result.markdownSummary, /Changed-only PR scan/);
  assert.match(result.markdownSummary, /not a full-repository scan/);
  assert.match(result.prComment, /Changed-only PR scan/);
  assert.match(result.prComment, /No drift findings in this changed-only scan scope/);
  assert.doesNotMatch(fullScanResult.prComment, /Changed-only PR scan/);
});

test("composite action does not turn PRs green with uncommitted auto-fixes", async () => {
  const action = await readFile(join(process.cwd(), "packages/github-action/action.yml"), "utf8");
  const previewStep = action.match(/- name: Preview safe fixes when changes will not be committed[\s\S]*?(?=\n    - name: )/)?.[0] ?? "";
  const applyStep = action.match(/- name: Apply safe fixes[\s\S]*?(?=\n    - name: )/)?.[0] ?? "";

  assert.match(action, /Preview safe fixes when changes will not be committed/);
  assert.match(previewStep, /fix --safe --json > \.evidoc\/reports\/fix\.json/);
  assert.doesNotMatch(previewStep, /dist\/src\/index\.js" fix --safe --write --json > \.evidoc\/reports\/fix\.json/);
  assert.match(applyStep, /fix --safe --write --json > \.evidoc\/reports\/fix\.json/);
  assert.match(
    action,
    /- name: Apply safe fixes\n\s+if: \$\{\{ always\(\) && inputs\.auto-fix == 'true' && inputs\.auto-commit == 'true' && github\.event_name == 'pull_request' && github\.event\.pull_request\.head\.repo\.full_name == github\.repository \}\}/
  );
  assert.match(
    action,
    /- name: Refresh report after safe fixes\n\s+id: refresh\n\s+if: \$\{\{ always\(\) && inputs\.auto-fix == 'true' && inputs\.auto-commit == 'true' && github\.event_name == 'pull_request' && github\.event\.pull_request\.head\.repo\.full_name == github\.repository \}\}/
  );
  assert.match(action, /The report below still reflects the PR as submitted/);
  assert.doesNotMatch(action, /No safe fixes were written in this run/);
  assert.match(action, /No safe fixes were committed to the pull request branch in this run/);
  assert.match(action, /preview_count=/);
  assert.match(previewStep, /\[ "\$rc" = "0" \] && \[ "\$preview_count" = "0" \] && exit 0/);
  assert.match(action, /Evidoc previewed \$preview_count safe fix candidate/);
  assert.match(previewStep, /::warning::Evidoc safe auto-fix preview found \$preview_count safe fix candidate/);
  assert.match(action, /npx evidoc fix --safe --write --json --root <target-repository-root>/);
});

test("composite action restores submitted report when auto-commit cannot push applied fixes", async () => {
  const action = await readFile(join(process.cwd(), "packages/github-action/action.yml"), "utf8");
  const backupStep =
    action.match(/- name: Back up submitted PR report before auto-commit[\s\S]*?(?=\n    - name: )/)?.[0] ?? "";
  const commitStep = action.match(/- name: Commit safe fixes[\s\S]*?(?=\n    - name: )/)?.[0] ?? "";
  const restoreStep =
    action.match(/- name: Restore submitted PR report when auto-commit did not update branch[\s\S]*?(?=\n    - name: )/)?.[0] ??
    "";

  assert.match(backupStep, /cp \.evidoc\/reports\/summary\.md \.evidoc\/reports\/submitted-summary\.md/);
  assert.match(backupStep, /cp \.evidoc\/reports\/result\.json \.evidoc\/reports\/submitted-result\.json/);
  assert.match(commitStep, /git push origin "HEAD:\$\{EVIDOC_HEAD_REF\}"/);
  assert.match(commitStep, /echo "EVIDOC_AUTOFIX_SHA=\$autofix_sha" >> "\$GITHUB_ENV"/);
  assert.match(restoreStep, /\[ -n "\$\{EVIDOC_AUTOFIX_SHA:-\}" \] && exit 0/);
  assert.match(restoreStep, /applied_count=/);
  assert.match(restoreStep, /mv \.evidoc\/reports\/submitted-summary\.md \.evidoc\/reports\/summary\.md/);
  assert.match(restoreStep, /mv \.evidoc\/reports\/submitted-result\.json \.evidoc\/reports\/result\.json/);
  assert.match(restoreStep, /Auto-commit did not update the PR branch/);
  assert.match(restoreStep, /Evidoc applied \$applied_count safe fix candidate/);
  assert.match(restoreStep, /The report below reflects the PR as submitted/);
  assert.match(restoreStep, /npx evidoc fix --safe --write --json --root <target-repository-root>/);
  assert.ok(
    action.indexOf("- name: Back up submitted PR report before auto-commit") <
      action.indexOf("- name: Refresh report after safe fixes")
  );
  assert.ok(
    action.indexOf("- name: Restore submitted PR report when auto-commit did not update branch") <
      action.indexOf("- name: Publish Evidoc outputs")
  );
  assert.ok(
    action.indexOf("- name: Publish Evidoc outputs") <
      action.indexOf("- name: Comment on pull request")
  );
});

test("composite action defaults changed-only scans to the repository default branch when since is omitted", async () => {
  const action = await readFile(join(process.cwd(), "packages/github-action/action.yml"), "utf8");
  const prepareStep = action.match(/- name: Prepare changed-only baseline[\s\S]*?(?=\n    - name: )/)?.[0] ?? "";
  const runStep = action.match(/- name: Run Evidoc[\s\S]*?(?=\n    - name: )/)?.[0] ?? "";
  const refreshStep = action.match(/- name: Refresh report after safe fixes[\s\S]*?(?=\n    - name: )/)?.[0] ?? "";

  assert.match(prepareStep, /if: \$\{\{ inputs\.changed-only == 'true' \}\}/);
  assert.doesNotMatch(prepareStep, /inputs\.since != ''/);
  assert.match(prepareStep, /requested_since="\$INPUT_SINCE"/);
  assert.match(prepareStep, /if \[ -z "\$requested_since" \]; then\n\s+requested_since="origin\/\$\{default_branch\}"/);
  assert.match(prepareStep, /echo "EVIDOC_EFFECTIVE_SINCE=\$requested_since" >> "\$GITHUB_ENV"/);
  assert.match(runStep, /effective_since="\$\{EVIDOC_EFFECTIVE_SINCE:-\$INPUT_SINCE\}"/);
  assert.match(runStep, /args\+=\(--since "\$effective_since"\)/);
  assert.doesNotMatch(runStep, /args\+=\(--since "\$INPUT_SINCE"\)/);
  assert.match(refreshStep, /effective_since="\$\{EVIDOC_EFFECTIVE_SINCE:-\$INPUT_SINCE\}"/);
  assert.match(refreshStep, /args\+=\(--since "\$effective_since"\)/);
});

test("composite action bootstraps from the GitHub action checkout without npm publishing", async () => {
  const action = await readFile(join(process.cwd(), "packages/github-action/action.yml"), "utf8");

  assert.doesNotMatch(action, /\n  version:/);
  assert.doesNotMatch(action, /npm install -g/);
  assert.doesNotMatch(action, /evidoc@\$\{\{ inputs\.version \}\}/);
  assert.match(action, /fail-on:[\s\S]*?default: review_needed/);
  assert.match(action, /value: \$\{\{ steps\.publish\.outputs\.health-score \}\}/);
  assert.match(action, /Publish Evidoc outputs/);
  assert.match(action, /id: publish/);
  assert.doesNotMatch(action, /steps\.refresh\.outputs\.health-score \|\| steps\.run\.outputs\.health-score/);
  assert.match(action, /sarif:[\s\S]*?default: "false"/);
  assert.match(action, /GITHUB_ACTION_PATH/);
  assert.match(action, /GITHUB_WORKSPACE/);
  assert.match(action, /npm ci/);
  assert.match(action, /changed-only:/);
  assert.match(action, /Prepare changed-only baseline/);
  assert.match(action, /refs\/heads\/\$\{branch\}:refs\/remotes\/origin\/\$\{branch\}/);
  assert.match(action, /auto-fix:/);
  assert.match(action, /health-score:/);
  assert.match(action, /--result \.evidoc\/reports\/result\.json/);
  assert.match(action, /node "\$EVIDOC_ACTION_ROOT\/packages\/evidoc\/dist\/src\/index\.js" "\$\{args\[@\]\}"/);
  assert.match(action, /Check out pull request head for auto-commit/);
  assert.match(action, /EVIDOC_HEAD_REF: \$\{\{ github\.event\.pull_request\.head\.ref \}\}/);
  assert.match(action, /EVIDOC_HEAD_SHA: \$\{\{ github\.event\.pull_request\.head\.sha \}\}/);
  assert.match(action, /git checkout -B evidoc-auto-fix "\$EVIDOC_HEAD_SHA"/);
  assert.match(action, /git push origin "HEAD:\$\{EVIDOC_HEAD_REF\}"/);
  assert.doesNotMatch(action, /git push origin "HEAD:\$\{\{ github\.event\.pull_request\.head\.ref \}\}"/);
  assert.match(action, /Refresh report after safe fixes/);
  assert.match(action, /id: refresh/);
  assert.match(action, /EVIDOC_AUTOFIX_SHA/);
  assert.match(action, /Create auto-fix head check/);
  assert.match(action, /github\.rest\.checks\.create/);
  assert.match(action, /Evidoc failed before a summary report was produced/);
  assert.match(action, /Check this workflow run's logs for the failing setup or runtime step/);
  assert.match(action, /npm run evidoc --/);
  assert.match(action, /npm run evidoc -- check --changed-only --since "\$suggested_since" --fail-on=review_needed --root <target-repository-root>/);
  assert.match(action, /npm run evidoc -- check --fail-on=review_needed --json --root <target-repository-root>/);
  assert.match(action, /Evidoc changed-only baseline is unavailable/);
  assert.match(action, /Edit the Evidoc workflow step/);
  assert.match(action, /use origin\/<branch> or refs\/heads\/<branch> when the ref must be fetched in Actions/);
  assert.match(action, /suggested_since="origin\/\$\{default_branch\}"/);
  assert.doesNotMatch(action, /suggested_since="\$INPUT_SINCE"/);
  assert.doesNotMatch(action, /suggested_since="origin\/\$\{branch\}"\n\s+if ! git fetch/);
  assert.match(
    action,
    /if git fetch --no-tags --depth=1 origin "\+refs\/heads\/\$\{branch\}:refs\/remotes\/origin\/\$\{branch\}"; then\n\s+requested_since="origin\/\$\{branch\}"\n\s+suggested_since="\$requested_since"/
  );
  assert.match(action, /For the default branch, use \\`since: \$suggested_since\\`/);
  assert.match(action, /changed-only: "false"/);
  assert.match(action, /--since "\$suggested_since"/);
  assert.doesNotMatch(action, /npx evidoc check --changed-only --since "\$INPUT_SINCE"/);
  assert.match(action, /EVIDOC_CHANGED_ONLY=false/);
  assert.match(action, /EVIDOC_BASELINE_WARNING=true/);
  assert.match(action, /tail -n \+2 \.evidoc\/reports\/summary\.md/);
  assert.match(action, /falling back to a full repository scan/);
  assert.match(action, /EVIDOC_BASELINE_WARNING/);
  assert.doesNotMatch(action, /EVIDOC_BASELINE_WARNING<<EOF/);
  assert.doesNotMatch(action, /::error::Evidoc changed-only baseline/);
  assert.match(action, /<!-- evidoc-pr-comment -->/);
  assert.doesNotMatch(action, /git add -A/);
  assert.match(action, /git add -- "\$path"/);
  assert.match(action, /normalizeSafeReportPath/);
  assert.match(action, /normalized\.includes\('\\n'\)/);
  assert.match(action, /normalized\.includes\('\\r'\)/);
  assert.match(action, /normalized\.startsWith\('\/'\)/);
  assert.match(action, /normalized\.includes\(':'\)/);
  assert.match(action, /part === '\.\.'/);
  assert.match(action, /fs\.realpathSync\(absolute\)/);
  assert.match(action, /fs\.statSync\(real\)\.isFile\(\)/);
  assert.match(action, /isPathInsideRoot\(workspace, real\)/);
  assert.match(action, /hashFiles\('\.evidoc\/reports\/evidoc\.sarif'\) != ''/);
  assert.match(action, /continue-on-error: true/);
  assert.match(action, /wait-for-processing: false/);
  assert.match(action, /Fork pull request safe auto-fix and auto-commit are disabled/);
});
