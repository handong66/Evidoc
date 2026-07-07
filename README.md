# Evidoc

> **Keep repository docs and agent instructions aligned with code before humans or AI agents trust stale context.**
> Run repo-local drift scans, local Git gates, PR comments, repair prompts, and a local command center without uploading repository content by default.

[![npm](https://img.shields.io/npm/v/repo-evidoc?style=flat-square)](https://www.npmjs.com/package/repo-evidoc)
[![Node.js Version](https://img.shields.io/node/v/repo-evidoc?style=flat-square)](https://nodejs.org)
[![CI](https://github.com/handong66/Evidoc/actions/workflows/ci.yml/badge.svg)](https://github.com/handong66/Evidoc/actions/workflows/ci.yml)
[![License](https://img.shields.io/npm/l/repo-evidoc?style=flat-square)](./LICENSE)

Evidoc is an open-source-first, repo-local documentation drift control plane for agent-first development.
It treats README, AGENTS.md, CLAUDE.md, architecture notes, API docs, examples, and source-bound documentation as engineering control surfaces.

Evidoc gives you one surface for three kinds of drift control:

- **Run local scans and a local Web UI** to find stale README claims, agent instructions, commands, paths, schemas, source bindings, and review windows.
- **Gate changes in Local Git or GitHub Actions** with deterministic evidence before LLM or semantic judgment.
- **Give AI agents repair evidence** through PR comments, `diagnose`, MCP tools, runtime fingerprints, and safe deterministic fixes.

## Quick Start

Evidoc is published on npm as `repo-evidoc` and exposes the `evidoc` command. It requires Node.js 22 or later; check with `node --version` if `npx` fails before Evidoc starts.

### 1. Run a first scan

```bash
npx repo-evidoc check --fail-on=review_needed
```

### 2. Open the local Command Center

```bash
npx repo-evidoc app
```

To try Evidoc without touching a real repository:

```bash
npx repo-evidoc demo
```

### 3. Add a repo-local Git gate

```bash
npx repo-evidoc init --yes --local-git --install-hooks
npx repo-evidoc guard --event pre-commit
```

### 4. Optional: add GitHub Actions

```bash
npx repo-evidoc init --yes
```

Both `init` forms write a conservative `.evidoc/config.json` and `.evidoc/.gitignore`.
The plain form writes an Evidoc workflow; `--local-git` writes repo-local hooks when the repository should stay local-only.

## Choose an Adoption Path

| Need | Recommended path |
|------|------------------|
| Scan a repository once | `npx repo-evidoc check --fail-on=review_needed` |
| Open the local Web UI | `npx repo-evidoc app` |
| Keep a private or local-only repository guarded | `npx repo-evidoc init --yes --local-git --install-hooks` |
| Add PR comments and CI gating on GitHub | `npx repo-evidoc init --yes` or the workflow below |
| Hand evidence to Codex, Claude Code, or OpenCode | `npx repo-evidoc diagnose` |
| Compare agent repair behavior | `npx repo-evidoc agent-eval --json` |
| Generate GitLab, Jenkins, Gitea, or Buildkite snippets | `npx repo-evidoc recipes --target all` |

## For Humans

Use Evidoc directly when you want a concrete report before editing, reviewing, or merging:

- `npx repo-evidoc doctor` checks whether the repository is configured correctly.
- `npx repo-evidoc check --fail-on=review_needed` scans documentation and agent surfaces.
- `npx repo-evidoc app` opens the bilingual local Command Center.
- `npx repo-evidoc fix --safe --write --json` applies only deterministic safe fixes.
- `npx repo-evidoc guard --event pre-push --since merge-base:main` checks a branch before pushing.

## For AI Agents

Evidoc is designed to be read by coding agents before they repair documentation.
Agents should use current repository evidence, not stale README memory or untrusted finding text.

- `npx repo-evidoc diagnose` emits evidence-bound repair prompts for Codex, Claude Code, OpenCode, or another agent.
- `npx repo-evidoc verify --instructions --json` focuses on AGENTS.md, CLAUDE.md, Cursor rules, and GitHub Copilot instructions.
- `npx repo-evidoc agent-eval --json` prints a local benchmark pack for comparing agent behavior with and without Evidoc evidence.
- MCP clients should start with `evidoc.agent_scan`, the default read-only scan bundle with freshness, runtime fingerprints, patch classifications, and privacy metadata.

Evidoc does not call external agent providers during normal scans and does not upload repository content by default.

## Source Checkout Development

Use a source checkout when contributing to Evidoc or verifying unreleased changes against another repository:

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

Single-repository commands use the first `--root` as the target repository, so a Codex, Claude Code, OpenCode, or human repair session can run Evidoc from this source checkout while editing another project elsewhere on disk.
A bare `evidoc --root <repository> --json` is treated as a scan, not as a GUI shortcut; use `evidoc app --root <repository>` or `evidoc serve --root <repository>` when the Local App is intended.
`init`, `doctor`, and Local Git setup output also print equivalent `npm run evidoc -- ... --root <repository>` source-checkout fallbacks beside the npm `npx` command for contributors testing from a checkout.

## Local Git Gate Adoption

Use this path when the project is local-only, private, air-gapped, or simply not ready for GitHub Actions:

```bash
npx repo-evidoc init --yes --local-git
git config core.hooksPath .githooks
npx repo-evidoc guard --event pre-commit --fail-on=review_needed
```

`init --local-git` writes `.evidoc/config.json`, keeps `.evidoc/history.jsonl` and `.evidoc/reports/` ignored through `.evidoc/.gitignore`, and generates `.githooks/pre-commit` plus `.githooks/pre-push`. It intentionally skips the GitHub workflow file. Hook activation is explicit: either run the repo-local `git config core.hooksPath .githooks` command yourself or pass `--install-hooks`:

```bash
npx repo-evidoc init --yes --local-git --install-hooks
```

`guard` is the local gate command so users and hooks do not need to remember the lower-level changed-only flags:

```bash
npx repo-evidoc guard --event pre-commit
npx repo-evidoc guard --event pre-push --since main
npx repo-evidoc guard --event pre-push --since merge-base:main
npx repo-evidoc guard --event manual --scope staged
```

`pre-commit` defaults to staged files, so unrelated unstaged worktree edits do not block the commit being made.
`pre-push` and manual runs default to the worktree and accept normal Git refs or `merge-base:<branch>` for branch-before-merge checks.
`pre-commit` and `pre-push` guard events default to `--fail-on=review_needed`, so generated hooks block without extra flags; pass `--fail-on=none` only for an advisory local run.
Every guard run writes local-gate JSON and Markdown reports under `.evidoc/reports/`; those files are ignored by default and can be handed to an agent, teammate, or internal CI without needing a PR comment.

The JSON report includes an Evidoc Agent Runtime Contract with `source`, `event`, `mode`, `scope`, `baseline`, optional `baselineCommit`, `status`, `generatedAt`, `scannedAt`, `changedFileFingerprints`, `fingerprint`, and per-finding fingerprints.
Hooks use `mode=blocking`; manual, MCP, and IDE-style reads stay advisory unless a hook failed.
Agents should use `changedFiles` plus `runtime.changedFileFingerprints` to reject stale reports.
Older reports without content fingerprints should fall back to `runtime.generatedAt` or `runtime.scannedAt`; repeated reminders should dedupe with `runtime.findings[].fingerprint` instead of rewording the same drift every turn.
The aggregate `runtime.fingerprint` includes event, mode, scope, baseline, affected documents, changed files, changed-file fingerprints, and finding fingerprints, while still ignoring generated/scanned timestamps.

`doctor` is ready when the config is valid and either a GitHub Action workflow exists or the Local Git Gate is ready. Local Git readiness checks that the target is a Git repository, has an initial commit, has generated pre-commit and pre-push hooks, and has repo-local `core.hooksPath` pointing at `.githooks`.

For GitLab CI, Jenkins, Gitea Actions, or Buildkite, generate platform snippets that all call the same local CLI instead of platform-specific detectors:

```bash
npx repo-evidoc recipes --target all
```

## GitHub Action Adoption

A hosted GitHub project can adopt Evidoc today by adding one workflow file:

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
      - uses: actions/checkout@v4
      - uses: handong66/Evidoc/packages/github-action@main
        with:
          fail-on: review_needed
          sarif: "false"
          pr-comment: "true"
          changed-only: ${{ github.event_name == 'pull_request' && 'true' || 'false' }}
          since: origin/${{ github.event.repository.default_branch }}
```

The action builds Evidoc from the GitHub action checkout and scans the caller repository. It uses Node.js 22 inside the action checkout, so callers do not need npm publishing or a globally installed CLI.

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

The action stages files reported by Evidoc as applied fixes, rejects non-repository-relative paths before `git add` (`..`, absolute paths, drive separators, empty segments, NUL, LF, or CR), verifies each staged file's real path stays inside `GITHUB_WORKSPACE`, and creates a fresh Evidoc check on the auto-fix commit when checks permission is available.

SARIF upload is opt-in with `sarif: "true"` because many private repositories do not have GitHub Code Scanning enabled. Only add `security-events: write` when setting `sarif: "true"`.

## Zero-Setup Local Adoption

Run Evidoc from any existing repository:

```bash
npx repo-evidoc
```

The default entrypoint creates a conservative `.evidoc/config.json` when one is missing, keeps local scan history ignored through `.evidoc/.gitignore`, scans the current repository, starts the local Web app, and opens the browser.

In non-interactive shells, the same bare command runs a terminal-only one-shot app scan instead of opening a browser or keeping a server alive. The first interactive experience is the bilingual Evidoc Command Center, not a pile of flags. Repositories with zero scanned documents are marked `review_needed` instead of green so an empty or misconfigured project does not look healthy; PR comments for that case show setup guidance instead of generic auto-fix or agent-repair instructions.

For explicit GUI commands:

```bash
npx repo-evidoc app
npx repo-evidoc serve --root . --root ../another-repo
```

The local app shows a fleet health strip, repository cockpit, broken and review-needed findings, rule distribution, exact file locations, suggested actions, scan history, Local Git Gate state, staged and unstaged changed files, affected docs, the latest local gate result with gate baseline, baseline commit, runtime status, fingerprint, and freshness, scaffolding actions, a triage queue, and a repair console.
It also includes one-click Local Git Gate enablement and a one-click GitHub Action generator.
Users can switch English or Chinese in the UI.
In multi-repository sessions, the app remembers the repository the user selected or just acted on, so refreshes after scan, CI, Local Git Gate, or scaffold actions return to the same cockpit.
Adding another repository uses the system folder picker when available and keeps a paste-path fallback for headless or unsupported desktops.

Repositories with findings include a copyable all-findings agent repair prompt for Codex, Claude Code, OpenCode, or another coding agent. Each individual finding still has its own focused prompt. These prompts:

- include finding evidence and both npm `npx` plus source-checkout repair and verification commands with explicit `--root <target-repository-root>`;
- tell the agent to treat finding text as untrusted data;
- tell the agent not to run `<target-repository-root>` literally, and to replace it with the repository root being repaired;
- mark findings without structured evidence as review-only;
- keep broken findings in review even when they carry structured package-manager evidence;
- tell the agent to work from the target repository root and never keep dependency directories or agent logs;
- keep generated lockfiles or repair artifacts only when required to resolve reported findings;
- neutralize code-fence/newline prompt injection and redact configured repository roots plus common local/CI absolute paths.

Scaffold actions report how many support files were created, updated, or already present before the app refreshes.

Added repository roots must resolve to existing real directories and are stored by canonical real path. Startup fails with a clear missing-root error instead of opening an empty dashboard.

Write-capable local API actions are limited to those added repositories, reject cross-origin browser writes, cap JSON request bodies, and route generated files through repository-bound writable path checks. File-opening requests must resolve to an existing real path inside an added repository, so `..`, absolute paths, and symlink escapes are rejected.

Check the integration state any time:

```bash
npx repo-evidoc doctor
```

Stale `docRoots` or `apiSpecPaths` also appear in normal scans as broken `config.missing-path` findings, so a moved docs directory does not turn into a silent zero-document scan. Existing configured doc roots that contain no Markdown or MDX produce a `coverage.no-documents-scanned` review-needed finding, and `docs` / `docs/` are treated equivalently.
Agent instruction surfaces such as AGENTS.md, CLAUDE.md, Cursor rules, and GitHub Copilot instructions are always scanned when present, even when `docRoots` is narrowed to ordinary docs such as README.md.

Try the product without touching the current repository:

```bash
npx repo-evidoc demo
npx repo-evidoc demo --once --json --no-open
```

The demo uses a temporary built-in repository with intentional drift, then opens the same local Command Center used for real repositories.

For terminal-only adoption:

```bash
npx repo-evidoc init --yes
npx repo-evidoc init --yes --local-git --install-hooks
npx repo-evidoc check --fail-on=review_needed
```

`init` writes a minimal `.evidoc/config.json` and a `.evidoc/.gitignore` that keeps local `history.jsonl` and generated reports out of commits. By default it also writes an Evidoc GitHub Actions workflow. `--local-git` writes repo-local hooks instead of a workflow, and `--install-hooks` sets repo-local `core.hooksPath=.githooks`. It does not overwrite existing files unless `--force` is passed. Use `--no-action` when the repository should stay CLI-only with no generated gate.
Generated gates use `--fail-on=review_needed` so evidence-backed documentation and agent-instruction drift cannot merge silently. Use `--fail-on=broken` only for an advisory rollout that should not block review-needed drift.
`doctor` exits green when the config is valid and either GitHub Action ready or Local Git Gate ready.
For GitHub workflows it accepts packaged-action adoption, source-checkout self-scan steps such as `npm run evidoc -- --fail-on=review_needed`, and repository-local custom actions whose local action definition file runs Evidoc. Equivalent pnpm, Yarn, Bun, and direct CLI script forms are recognized for repositories that use those runners.
It stays non-blocking for working but noisy workflows: it warns when an existing Evidoc workflow listens to both `pull_request` and unfiltered `push`, when `push.branches` omits the detected repository branch, when packaged-action `pr-comment: "true"` is missing, or when the workflow gates only `fail-on: broken`.

Optional scaffolding can be enabled in one command:

```bash
npx repo-evidoc init --yes --with agents,hooks,badge,llms
```

This creates agent instruction files, an installable Evidoc skill template under the generated config directory, local pre-commit and pre-push hook files, a badge snippet, `llms.txt`, and an Evidoc context pack.
The generated AGENTS.md, CLAUDE.md, Cursor, Copilot, and skill files instruct agents to run or read Evidoc before final replies about code, docs, reviews, or commits, prefer a fresh same-scope local gate report only when `changedFiles` and content fingerprints still match, and dedupe replies by runtime fingerprints.
The hooks prefer `./node_modules/.bin/evidoc`, then `npx --yes repo-evidoc`, then a global `evidoc`.
If no runtime is available, they print a skip warning instead of blocking every local commit or push.
Use `init --local-git` or `git config core.hooksPath .githooks` when those generated hooks should become the active local gate.

For repair workflows:

```bash
npx repo-evidoc diagnose
npx repo-evidoc diff --since origin/main --json
npx repo-evidoc guard --event pre-commit --fail-on=review_needed
npx repo-evidoc guard --event pre-push --since merge-base:main --fail-on=review_needed
npx repo-evidoc verify --instructions --json
npx repo-evidoc agent-eval --json
npx repo-evidoc recipes --target all
npx repo-evidoc draft --json > /tmp/evidoc-proposals.json
npx repo-evidoc validate --proposal /tmp/evidoc-proposals.json --json
npx repo-evidoc fix --safe --write --json
```

`diagnose` turns findings into evidence-bound prompts for Codex, Claude, OpenCode, or another agent. Patch proposals are classified as `safe`, `review`, or `blocked`.

Only `safe` proposals are eligible for automatic writes, and `fix --write` is rejected unless `--safe` is present. Safe writes are intentionally narrow and currently cover review-needed documented commands and agent `packageManager` fields backed by package-manager evidence.

Broken, API, symbol, architecture, and semantic findings stay in review. `fix --safe --write --json` includes a `postFixSummary` so users can immediately see remaining broken or review-needed findings after deterministic fixes.
`draft --json` emits the full proposal array, and `validate --proposal` accepts that full file directly, so users can validate the generated patch plan without manually extracting one proposal at a time.
`verify --instructions` narrows the findings to AGENTS.md, CLAUDE.md, Cursor rules, and GitHub Copilot instructions so teams can catch contradictory or stale agent guidance before it reaches CI. These agent-facing control files are scanned even when `.evidoc/config.json` limits `docRoots` to README.md or docs/.
`diff`, `check --changed-only`, and `guard` require a git working tree.
`diff` and `check --changed-only` use `HEAD` as the default git baseline when `--since` is omitted, so staged and unstaged tracked changes are included.
`guard --event pre-commit` defaults to staged files.
Changed-only scans include changed Markdown files plus documents affected by changed source paths, OpenAPI specs, package manager declarations, lockfiles, or source bindings.
If `requireDocsForChangedSources` is enabled, changed source files with no affected docs or source binding produce `coverage.changed-source-without-doc`.

`agent-eval --json` prints a local benchmark pack for comparing Codex, Claude Code, and OpenCode with and without Evidoc evidence first. It records the current coverage baseline, the default MCP tool, read-parity tasks, safe-fix criteria, and pass/fail criteria for real agent A/B runs. It redacts the local repository root and does not call external agent providers or upload repository content.

For MCP clients, `evidoc.agent_scan` is the default read-only repair entrypoint.
It runs a fresh repo-local scan and returns one JSON bundle with the Agent Runtime Contract, `freshness`, `partial`, read-parity fields, affected documents, evidence categories, patch classifications, next commands, and the privacy contract.
Use `evidoc.get_drift_status` before answering whether docs drifted, `evidoc.diagnose_drift` before proposing repairs, and `evidoc.suggest_doc_fix` for evidence-bound proposal data when those tools are listed by the MCP client.
The older read tools remain available for focused follow-up.

## Development Commands

| Command | Purpose |
|---------|---------|
| `npm install` | Install workspace dependencies |
| `npm test` | Build and run the full test suite |
| `npm run release:smoke:npx` | Pack local tarballs and smoke-test `npx repo-evidoc` |
| `npm run evidoc -- --json` | Run a source-checkout scan as JSON |

## CLI

| Command | Purpose |
|---------|---------|
| `npm run evidoc -- app --once --json --no-open` | One-shot local app state |
| `npm run evidoc -- demo --once --json --no-open` | Built-in sample repository |
| `npm run evidoc -- serve --root . --json --once --no-open` | Multi-root app server smoke |
| `npm run evidoc -- check --json` | Full drift scan |
| `npm run evidoc -- diagnose --json` | Agent repair prompts |
| `npm run evidoc -- diff --since HEAD --json` | Changed-file evidence |
| `npm run evidoc -- guard --event pre-commit --json` | Local staged gate |
| `npm run evidoc -- guard --event pre-push --since merge-base:main --json` | Branch-before-push gate |
| `npm run evidoc -- verify --instructions --json` | Agent instruction check |
| `npm run evidoc -- agent-eval --json` | Agent A/B benchmark pack |
| `npm run evidoc -- recipes --target all` | CI recipe snippets |
| `npm run evidoc -- fix --safe --write --json` | Deterministic safe fixes |
| `npm run evidoc -- index --json` | Repository index |
| `npm run evidoc -- explain 0 --json` | Finding detail |
| `npm run evidoc -- graph --json` | Evidence graph |
| `npm run evidoc -- dashboard --out .evidoc/reports/dashboard.html` | Static dashboard |
| `npm run evidoc -- draft --json` | Patch proposals |
| `npm run evidoc -- validate --proposal <proposal-json> --json` | Proposal validation |
| `npm run evidoc -- multi --root . --json` | Multi-repository aggregate |
| `npm run evidoc -- mcp-tools` | MCP tool list |
| `npm run evidoc -- action --format=github --pr-comment-file <summary-output> --annotations-file <annotations-output>` | Local action smoke |
| `npm run evidoc -- init --yes --no-action` | CLI-only config |
| `npm run evidoc -- init --yes --local-git --install-hooks` | Local Git Gate setup |
| `npm run evidoc -- doctor` | Readiness check |

For local GitHub Action smoke tests, `--summary` / `--annotations` are the canonical output flags. `--pr-comment-file` and `--annotations-file` are accepted aliases, and `--format=github` is accepted for copied CI-like commands.

## Troubleshooting

| Symptom | What to try |
|---------|-------------|
| `npx repo-evidoc` fails before running | Check `node --version`; npm installs require Node.js 22 or later |
| `doctor` is not ready | Run `npx repo-evidoc init --yes` or `npx repo-evidoc init --yes --local-git --install-hooks` |
| No documents are scanned | Add `README.md`, add `docs/`, or update `.evidoc/config.json` `docRoots` |
| Local Git hooks do not run | Check `git config core.hooksPath`; local gates expect `.githooks` |
| GitHub Action comments are missing | Keep `pull-requests: write` and `pr-comment: "true"` in the workflow |
| A changed-only PR scan looks too narrow | Set `since: origin/${{ github.event.repository.default_branch }}` or run a full scan |
| An agent report feels stale | Re-run `npx repo-evidoc guard --event manual --scope staged --json` and compare runtime fingerprints |

## GitHub Action

```yaml
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
      - uses: actions/checkout@v4
      - uses: handong66/Evidoc/packages/github-action@main
        with:
          fail-on: review_needed
          sarif: "false"
          pr-comment: "true"
          changed-only: ${{ github.event_name == 'pull_request' && 'true' || 'false' }}
          since: origin/${{ github.event.repository.default_branch }}
```

For release-pinned external repositories, keep the full workflow trigger, permissions, and job above.
Inside the `steps` list, replace only the action reference with an exact release tag:

```yaml
- uses: handong66/Evidoc/packages/github-action@v0.1.0
  with:
    fail-on: review_needed
    sarif: "false"
    pr-comment: "true"
    changed-only: ${{ github.event_name == 'pull_request' && 'true' || 'false' }}
    since: origin/${{ github.event.repository.default_branch }}
```

When enabling SARIF in this workflow, also add `security-events: write` to the workflow permissions.

## Product Principles

- Repo-local by default: no source upload is required for normal detection.
- GitHub optional: Local Git Gate is a first-class gate for private, local-only, and inner-source repositories.
- Deterministic first: path, command, config, schema, API, and graph evidence comes before LLM judgment.
- Evidence before action: every finding must explain what changed, what document claim is affected, and why review is needed.
- Review first: generated patches are proposals, never silent merges.
- Agent-first: AGENTS.md, CLAUDE.md, MCP tools, and agent session workflows are first-class surfaces.
- Privacy first: telemetry is disabled by default. Future telemetry must be explicit opt-in and must not upload repository content.

## Documents

- [Pursuit goal](docs/vision/pursuit-goal.zh-CN.md)
- [Full-scope architecture](docs/architecture/full-scope-architecture.md)
- [Onboarding](docs/onboarding.md)
- [Configuration](docs/configuration.md)
- [MCP clients](docs/development/mcp-clients.md)
- [OpenCode collaboration](docs/development/opencode-collaboration.md)
- [Release process](docs/development/release-process.md)
- [Privacy](PRIVACY.md)
- [Contributing](CONTRIBUTING.md)
- [Security policy](SECURITY.md)
