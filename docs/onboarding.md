# Onboarding

This page is the guided setup reference. If you are brand new, start with the README first and come here only after you know which path you want: one scan, local Git gate, GitHub Action, or local Web UI.

Evidoc is designed for copy-paste adoption. A new repository should not need to learn the rule system before it can run a first scan.

The npm package is the default adoption path. Local Git mode is first-class for repositories that are not on GitHub, cannot upload to GitHub, or should keep the gate entirely inside the local checkout.

From any repository with Node.js 22 or later:

```bash
npx repo-evidoc check --fail-on=review_needed
npx repo-evidoc app
npx repo-evidoc init --yes --local-git --install-hooks
```

## If You Only Need One Path

| Situation | Command | What happens |
|-----------|---------|--------------|
| Try Evidoc safely | `npx repo-evidoc demo` | Opens a temporary sample repository with intentional drift. |
| Scan without setup writes | `npx repo-evidoc check --fail-on=review_needed` | Prints terminal findings and exits. |
| Use the local Web UI | `npx repo-evidoc app` | Auto-initializes local config if needed, scans, and opens the Command Center. |
| Keep everything local | `npx repo-evidoc init --yes --local-git --install-hooks` | Writes repo-local hooks and ignored local reports. |
| Add GitHub PR comments | `npx repo-evidoc init --yes` | Writes config and a GitHub Actions workflow. |

The package name is `repo-evidoc`; the executable command installed by the package is `evidoc`. For copy-paste npm usage, keep using `npx repo-evidoc ...`.

## What Gets Written

- `check`, `doctor`, `diagnose`, `verify`, and `recipes` are read-only scans or generators unless redirected by the shell. `agent-eval` is an experimental maintainer-only benchmark-pack generator; it does not run agents.
- `app` and bare `npx repo-evidoc` may create `.evidoc/config.json` and `.evidoc/.gitignore` so local scan history stays out of commits.
- `init --yes` writes `.evidoc/config.json`, `.evidoc/.gitignore`, and either a GitHub Actions workflow or local hooks.
- `fix --safe --write --json` writes only deterministic safe fixes and requires the explicit `--safe` flag.

A local agent or human can also run Evidoc against another repository from a source checkout when testing unreleased changes:

```bash
git clone https://github.com/handong66/Evidoc.git
cd Evidoc
npm install
npm run evidoc -- check --root /path/to/repository --fail-on=review_needed
npm run evidoc -- guard --root /path/to/repository --event pre-commit --fail-on=review_needed
npm run evidoc -- diagnose --root /path/to/repository
npm run evidoc -- fix --root /path/to/repository --safe --write --json
npm run evidoc -- app --root /path/to/repository
```

Single-repository commands use the first `--root` as the target repository.
That makes the source-checkout repair loop usable from Codex, Claude Code, OpenCode, or a terminal session without installing the current checkout into the target project.
A bare `evidoc --root <repository> --json` runs a scan; use `evidoc app --root <repository>` or `evidoc serve --root <repository>` when you want the Local App.
`init`, `doctor`, and Local Git setup also print the equivalent source-checkout fallback beside the npm `npx` command.

## Local Git Gate Setup

Use Local Git Gate when the repository is local-only, private, air-gapped, or simply should not depend on GitHub Actions:

```bash
npx repo-evidoc init --yes --local-git
git config core.hooksPath .githooks
npx repo-evidoc guard --event pre-commit --fail-on=review_needed
```

`init --local-git` creates:

- `.evidoc/config.json`: conservative scan defaults.
- `.evidoc/.gitignore`: keeps `.evidoc/history.jsonl` and `.evidoc/reports/` local.
- `.githooks/pre-commit`: runs `evidoc guard --event pre-commit --fail-on=review_needed`.
- `.githooks/pre-push`: runs `evidoc guard --event pre-push --since HEAD --fail-on=review_needed`.

It skips the GitHub workflow file. Hook activation is explicit: run repo-local `git config core.hooksPath .githooks`, or use:

```bash
npx repo-evidoc init --yes --local-git --install-hooks
```

`guard` is the stable local gate entrypoint:

```bash
npx repo-evidoc guard --event pre-commit
npx repo-evidoc guard --event pre-push --since main
npx repo-evidoc guard --event pre-push --since merge-base:main
npx repo-evidoc guard --event manual --scope staged
```

`pre-commit` defaults to staged files so unrelated unstaged edits do not block the current commit. `pre-push` and manual runs default to the worktree and accept either a normal Git ref or `merge-base:<branch>`. `pre-commit` and `pre-push` guard events default to `--fail-on=review_needed`, so generated hooks block without requiring users to remember a flag; pass `--fail-on=none` only for an advisory local run.

Each local gate run writes local-gate JSON and Markdown reports under `.evidoc/reports/`. These reports are ignored by default and can be passed to Codex, Claude Code, OpenCode, a teammate, or an internal CI job.

The JSON report carries the Evidoc Agent Runtime Contract: `source=evidoc`, `event`, `mode`, `scope`, `baseline`, optional `baselineCommit`, `status`, `generatedAt`, `scannedAt`, `changedFileFingerprints`, an aggregate `fingerprint`, and per-finding fingerprints.
Use `changedFiles` plus `runtime.changedFileFingerprints` to reject stale reports. Older reports without fingerprints fall back to `runtime.generatedAt` or `runtime.scannedAt`; use `runtime.findings[].fingerprint` to dedupe repeated agent reminders.
Hook events are `blocking`; manual, MCP, and IDE-style reads are advisory unless they are reporting a hook failure.
The aggregate `runtime.fingerprint` includes event, mode, scope, baseline, affected documents, changed files, changed-file fingerprints, and finding fingerprints. It intentionally ignores generated/scanned timestamps, so identical evidence in the same runtime context stays stable while a different changed-file set gets a different aggregate fingerprint.

For GitLab CI, Jenkins, Gitea Actions, or Buildkite, generate snippets that call the same CLI:

```bash
npx repo-evidoc recipes --target all
```

## GitHub Action CI Setup

A hosted GitHub repository can adopt Evidoc today by adding one workflow file:

```yaml
name: Evidoc

on:
  pull_request:
  push:
    # If your default branch is not main or master, replace this list.
    branches:
      - main
      - master

permissions:
  contents: read
  actions: read
  pull-requests: write

jobs:
  evidoc:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5 # v4
      - uses: handong66/Evidoc/packages/github-action@v0.2.0
        with:
          fail-on: review_needed
          sarif: "false"
          pr-comment: "true"
          changed-only: ${{ github.event_name == 'pull_request' && 'true' || 'false' }}
          since: origin/${{ github.event.repository.default_branch }}
```

The composite action builds Evidoc from its GitHub action checkout and scans the caller repository at `GITHUB_WORKSPACE`. It uses Node.js 22 inside the action checkout, so callers do not need npm publishing or a globally installed CLI.

The default workflow runs on pull requests and on pushes to common default branch names (`main` and `master`) so same-repository PR branches do not create duplicate push and pull-request checks. Adjust `push.branches` if the repository uses a different default branch name.
Generated workflows from `init` and the local app try to detect the repository branch from remote HEAD metadata or the current branch.
`doctor`, GitHub Action setup warnings, and the Local App recognize packaged `uses: handong66/Evidoc/packages/github-action@...` workflows, source-checkout CI steps such as `npm run evidoc -- --fail-on=review_needed`, and repository-local custom actions such as `uses: ./.github/actions/evidoc-check` when their local action definition file runs Evidoc. Equivalent pnpm, Yarn, Bun, and direct CLI script forms are recognized for repositories that use those runners.
Local custom action discovery stays inside the repository root and follows nested local action entrypoints with a bounded depth, so symlink escapes and path traversal do not turn into scanned setup evidence.
It warns when an existing packaged-action workflow omits the detected branch or disables PR comments.

Pull requests use changed-only scans for lower noise: changed Markdown files are scanned directly, and source, OpenAPI, package-manager, or lockfile changes also scan documents affected by that evidence.
If `changed-only: "true"` is set but `since` is omitted, the action uses `origin/<default-branch>` instead of diffing against `HEAD`, so hand-written workflows do not silently scan zero changed files.
PR summaries and comments explicitly label this as a changed-only PR scan, so a green PR means no drift was found in the changed or affected documents, not that every document in the repository was re-scanned.
If the changed-only baseline cannot be fetched in GitHub Actions, Evidoc warns, falls back to a full repository scan, and includes the baseline setup warning in the PR summary instead of failing before a report exists.
Default-branch pushes use full scans as a safety net.

PR comments include CI setup warnings, a next-step repair plan, safe auto-fix candidates, human/agent review items, a copy-paste prompt for Codex, Claude Code, or OpenCode, and the exact local commands to preview, apply, diagnose, and re-run Evidoc.
The repair commands explicitly use `--root <target-repository-root>`, and each command also shows a source-checkout fallback for local-source testing. Agents are told to replace that placeholder with the repository they are editing; in GitHub Actions that repository root is `$GITHUB_WORKSPACE`.

The PR agent prompt carries affected document files, evidence file categories, each finding status, repair mode, structured evidence, and verification command.

Prompt safety rules are explicit: safe-only PRs are labeled as safe fixes instead of review work, findings without structured evidence are marked review-only, non-deterministic evidence is marked as review with structured evidence, finding text and evidence are labeled as untrusted data, dependency directories and agent logs are never kept, and generated lockfiles or other repair artifacts are kept only when required to resolve reported findings.

Code-fence/newline prompt injection is neutralized, truncated comments warn that they are not complete repair evidence, and configured repository roots plus common local/CI absolute paths are redacted from PR comment fields.

Those local `npx` commands use the published npm package. When testing unreleased changes from an Evidoc source checkout, use the shown source-checkout commands instead.

Safe auto-fix currently covers review-needed documented commands and agent `packageManager` fields backed by package-manager evidence. Broken findings remain review work even when they include structured evidence.

Same-repository PR auto-commit requires `auto-fix: "true"`, `auto-commit: "true"`, and workflow `contents: write` plus `checks: write`.
When safe fixes cannot be committed back to the PR branch, the action previews them, reports the safe-fix preview count, leaves the original report in force, and adds an auto-fix preview warning with a root-safe local fix command instead of turning the PR green from temporary runner edits.
If auto-commit is enabled but the final push does not update the PR branch, Evidoc restores the submitted-PR report and adds an auto-commit warning with the temporary applied-fix count and a root-safe local fix command instead of showing the temporary post-fix workspace report.
Fork PR safe auto-fix and auto-commit are disabled with a warning.

The action stages files listed in Evidoc's fix report, rejects non-repository-relative paths before staging (`..`, absolute paths, drive separators, empty segments, NUL, LF, or CR), verifies each staged file's real path stays inside `GITHUB_WORKSPACE`, and creates a fresh Evidoc check on the auto-fix commit when checks permission is available.

SARIF upload is opt-in with `sarif: "true"` because many private repositories do not have GitHub Code Scanning enabled. Only add `security-events: write` when setting `sarif: "true"`.

## One-command Local Setup

This is the lowest-cognition path:

```bash
npx repo-evidoc
```

It:

- creates `.evidoc/config.json` if it is missing;
- creates `.evidoc/.gitignore` so local `history.jsonl` scan history and generated reports stay uncommitted;
- scans the current repository;
- starts the local Web app;
- opens the browser;
- opens the bilingual Evidoc Command Center with repository health, broken findings, review-needed findings, rule distribution, file locations, suggested actions, scan history, Local Git Gate status, a triage queue, and a repair console.

The generated config uses conservative defaults for document roots, ignored archive docs, review TTL, and file size limits. Existing config is kept. In non-interactive shells, the bare command runs a terminal-only one-shot app scan instead of opening the browser or keeping a server alive.

Repositories with zero scanned documents are marked `review_needed` instead of green so an empty or misconfigured project cannot pass as healthy. PR comments for this case show setup guidance instead of generic auto-fix or agent-repair instructions.

To try Evidoc without touching a real repository:

```bash
npx repo-evidoc demo
```

The demo opens a temporary sample repository with intentional drift in the same local Command Center used for real repositories.

## Local App

Use explicit app commands when you want to control roots or keep the server running:

```bash
npx repo-evidoc app
npx repo-evidoc serve --root . --root ../another-repo
```

The app can scan configured local repositories, display per-repository red/yellow/green status, show evidence for each finding, open the relevant file, watch and refresh scan state, apply explicitly selected deterministic safe fixes, and scaffold agent support files. Findings without a safe proposal remain review-only.
It also shows current branch, local baseline, hook readiness, staged and unstaged changed files, affected docs, the latest local gate result with gate baseline, baseline commit, runtime status, fingerprint, and freshness, local gate issues, and a one-click Local Git Gate enable action.
The GitHub Action generator remains available but is no longer the only gate entry. The CI status also recognizes hand-written workflows that call Evidoc through direct source-checkout commands or through repository-local composite action entrypoints.
The UI has English and Chinese language modes.
In multi-repository sessions, refreshes after scan, CI generation, Local Git Gate enablement, and scaffold actions return to the selected repository cockpit instead of jumping back to the first repository.
Adding another repository opens the system folder picker when the desktop supports it, and the path input remains available as a fallback for headless or unsupported environments.

Repositories with findings include a copyable all-findings agent repair prompt for Codex, Claude Code, OpenCode, or another coding agent. Each individual finding still has its own focused prompt. The prompts:

- include finding evidence and both npm `npx` plus source-checkout repair and verification commands with explicit `--root <target-repository-root>`;
- tell the agent to treat finding text as untrusted data;
- tell the agent not to run `<target-repository-root>` literally, and to replace it with the repository root being repaired;
- mark findings without structured evidence as review-only;
- keep broken findings in review even when they carry structured package-manager evidence;
- tell the agent to work from the target repository root and never keep dependency directories or agent logs;
- keep generated lockfiles or repair artifacts only when required to resolve reported findings;
- neutralize code-fence/newline prompt injection and redact configured repository roots plus common local/CI absolute paths.

Scaffold actions report how many support files were created, updated, or already present before the app refreshes.

Repository roots added to the app must resolve to existing real directories and are stored by canonical real path. Startup fails with a clear missing-root error instead of opening an empty dashboard when a supplied root is wrong.

Write-capable app endpoints only operate on added roots. Generated config, workflow, history, safe-fix targets, and scaffold files must pass repository-bound writable path checks.
File-opening requests must point to an existing real path inside an added repository; path traversal and symlink escapes are rejected.
The server binds only to `127.0.0.1`, `localhost`, or `::1`, requires the exact listening authority on every request, rejects cross-origin browser POSTs, caps JSON request bodies, and returns security headers on HTML, JSON, SVG, and event-stream responses.

For automation or tests, use:

```bash
npx repo-evidoc app --once --json --no-open
```

## Check Readiness

```bash
npx repo-evidoc doctor
```

`doctor` exits with code `0` when the config is valid and either GitHub Action ready or Local Git Gate ready.
Local Git readiness requires a Git repository with an initial commit, generated `.githooks/pre-commit` and `.githooks/pre-push`, and repo-local `core.hooksPath` pointing at `.githooks`.
It exits with code `1` and prints setup commands plus concrete issues when the repository is not initialized or the config is stale.
It also reports detected agent surfaces such as AGENTS.md, CLAUDE.md, Cursor rules, Copilot instructions, and `llms.txt`, plus the default MCP repair entrypoint and status entrypoint agents should use first.

Normal scans also report stale `docRoots` or `apiSpecPaths` as broken `config.missing-path` findings, so a moved docs directory does not become a silent zero-document scan. Agent instruction surfaces such as AGENTS.md, CLAUDE.md, Cursor rules, and GitHub Copilot instructions are always scanned when present, even if `docRoots` is narrowed to README.md or docs/.

Existing configured doc roots that contain no Markdown or MDX produce a `coverage.no-documents-scanned` review-needed finding. Trailing slashes are normalized, so `docs` and `docs/` behave the same.

When testing from an Evidoc source checkout, use the printed `npm run evidoc -- doctor --root <repository>` or `npm run evidoc -- init --yes --root <repository>` source-checkout fallback. For local Git mode, use the printed `npm run evidoc -- init --yes --local-git --install-hooks --root <repository>` fallback.
For older or hand-written GitHub Actions workflows, `doctor` also prints non-blocking warnings when an Evidoc workflow listens to both `pull_request` and unfiltered `push`, when `push.branches` omits the detected repository branch, when packaged-action `pr-comment: "true"` is missing, or when the workflow gates only `fail-on: broken`.
Source-checkout self-scan steps such as `npm run evidoc -- --fail-on=review_needed` count as an Evidoc workflow without requiring packaged-action PR-comment inputs; equivalent pnpm, Yarn, Bun, and direct CLI script forms are recognized for repositories that use those runners.
If a workflow delegates to `uses: ./.github/actions/<name>`, `doctor` resolves that local action's definition file inside the repository root and recognizes nested local action entrypoints that eventually run Evidoc.

## First Scan

```bash
npx repo-evidoc check --fail-on=review_needed
```

Generated CI uses `--fail-on=review_needed` so evidence-backed documentation and agent-instruction drift cannot merge silently. Use `--fail-on=broken` only for an advisory rollout that should not block review-needed drift.

## Repair Loop

```bash
npx repo-evidoc diagnose
npx repo-evidoc guard --event pre-commit --fail-on=review_needed
npx repo-evidoc guard --event pre-push --since merge-base:main --fail-on=review_needed
npx repo-evidoc verify --instructions --json
npx repo-evidoc recipes --target all
npx repo-evidoc draft --json > /tmp/evidoc-proposals.json
npx repo-evidoc validate --proposal /tmp/evidoc-proposals.json --json
npx repo-evidoc fix --safe --write --json
```

`diagnose` emits evidence-bound prompts and classifies patch proposals as `safe`, `review`, or `blocked`. In local Git workflows, the agent loop is `evidoc guard --event pre-commit`, `evidoc diagnose`, `evidoc fix --safe --write`, and `git diff`; it should not tell users to push and wait for a GitHub workflow unless the repository actually uses GitHub Actions. Safe fixes are deterministic only, and `fix --write` is rejected unless `--safe` is present.

The current safe writer covers review-needed documented commands and agent `packageManager` fields backed by package-manager evidence. Broken, review, and blocked findings stay human-reviewed. `fix --safe --write --json` includes a `postFixSummary` so the remaining findings are visible immediately after deterministic fixes.
`draft --json` emits the full proposal array, and `validate --proposal` accepts the full generated file directly, so the repair plan can be checked without manually extracting a single proposal.
`verify --instructions` is the focused agent-guidance check for AGENTS.md, CLAUDE.md, Cursor rules, and GitHub Copilot instructions. It still sees those files when they were added after `init` and are not listed in `docRoots`.
The experimental maintainer command `agent-eval --json` emits only a local benchmark specification for manual Codex, Claude Code, or OpenCode A/B runs. It does not execute an A/B run, score an agent, call an external provider, or upload repository content.

For MCP-enabled agents, start repair work with `evidoc.agent_scan`.
It is the default read-only MCP entrypoint and returns one fresh scan bundle with the Agent Runtime Contract, `freshness`, `partial`, affected documents, evidence categories, patch classifications, next commands, and the privacy contract.
Before answering only whether docs drifted, use `evidoc.get_drift_status` when it is listed.
Before proposing repairs, use `evidoc.diagnose_drift` when it is listed.
Use `evidoc.suggest_doc_fix` for evidence-bound proposal data when available.
These tools share the same core scan and finding fingerprints. Their aggregate runtime fingerprints can differ when event, mode, scope, baseline, or changed-file context differs.

## Pull Request Diff Loop

```bash
npx repo-evidoc diff --since origin/main --json
npx repo-evidoc check --changed-only --since origin/main --fail-on=review_needed
npx repo-evidoc guard --event pre-push --since merge-base:main --fail-on=review_needed
```

Diff mode reports changed files, affected documents, undocumented changed files, and findings in affected documents.
`diff`, `check --changed-only`, and `guard` require a git working tree.
If `--since` is omitted, `diff` and `check --changed-only` use `HEAD`, so staged and unstaged tracked changes are included.
`guard --event pre-commit` uses staged files by default.
Changed-only scans include changed Markdown files plus documents affected by changed source paths, OpenAPI specs, package manager declarations, lockfiles, or source bindings.
If `requireDocsForChangedSources` is enabled, source files with no affected docs or source binding produce `coverage.changed-source-without-doc`.

For local Action smoke tests from a source checkout, use:

```bash
npm run evidoc -- action --root /path/to/repository --format=github --pr-comment-file <summary-output> --annotations-file <annotations-output>
```

`--summary` and `--annotations` are the canonical output flags. `--pr-comment-file` and `--annotations-file` are accepted aliases for copied CI-like commands, and `--format=github` is accepted as a compatibility flag.

## Terminal Setup

If you do not want the GUI, keep using the explicit CLI setup path:

```bash
npx repo-evidoc init --yes
npx repo-evidoc init --yes --local-git --install-hooks
```

This creates:

- `.evidoc/config.json`: conservative defaults for document roots, ignored archive docs, review TTL, and file size limits.
- `.evidoc/.gitignore`: ignores local `history.jsonl` scan history and generated reports while keeping stable Evidoc config reviewable.
- GitHub Actions workflow by default, or `.githooks/pre-commit` and `.githooks/pre-push` when `--local-git` is used.

The command is idempotent. Existing files are kept by default. Use `--no-action` to create `.evidoc/config.json` and `.evidoc/.gitignore` without any generated gate. Use `--local-git` when you want a local Git gate instead of a GitHub Actions workflow.

Optional scaffolders can be added with:

```bash
npx repo-evidoc init --yes --with agents,hooks,badge,llms
```

Available scaffolders are `agents`, `hooks`, `ci`, `badge`, and `llms`.
The `agents` scaffolder creates AGENTS.md, CLAUDE.md, Cursor rules, GitHub Copilot instructions, and the Evidoc skill template under the generated config directory.
The generated instructions tell agents when to run or read Evidoc, how to trust a same-scope local report only when `changedFiles` and content fingerprints still match, and how to dedupe replies by `runtime.findings[].fingerprint`.
The `hooks` scaffolder creates local pre-commit and pre-push hooks that prefer `./node_modules/.bin/evidoc`, then `npx --yes repo-evidoc`, then a global `evidoc`.

If no Evidoc runtime is available, the hooks print a warning and skip instead of blocking every local commit or push. Use `init --local-git` or `git config core.hooksPath .githooks` when those generated hooks should become the active local gate. The examples omit `ci` because `init` already creates the GitHub Action workflow by default; use `--no-action` plus `--with ci` only when you want CI generated through the scaffolder path.

## Generated Workflow

The generated workflow uses the full low-permission workflow shown in GitHub Action CI Setup. Its Evidoc step uses:

```yaml
- uses: handong66/Evidoc/packages/github-action@v0.2.0
  with:
    fail-on: review_needed
    sarif: "false"
    pr-comment: "true"
    changed-only: ${{ github.event_name == 'pull_request' && 'true' || 'false' }}
    since: origin/${{ github.event.repository.default_branch }}
```

Set `pr-comment: "false"` only if the repository prefers annotations and Actions logs without a sticky PR summary.
Set `sarif: "true"` only after GitHub Code Scanning is enabled for the repository.
When enabling SARIF in a generated workflow, also add `security-events: write` to the workflow permissions.

## Privacy Boundary

Evidoc is repo-local by default. Normal CLI, local app, GitHub Action, and MCP scans do not upload repository content to third-party model providers. Telemetry is disabled by default; any future telemetry must be explicit opt-in and must not include repository content.
