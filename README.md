# Evidoc

> **Find repository docs and agent instructions that no longer match the code.**
> Run local scans, local Git gates, PR comments, repair prompts, and a local Command Center without uploading repository content by default.

[![npm](https://img.shields.io/npm/v/repo-evidoc?style=flat-square)](https://www.npmjs.com/package/repo-evidoc)
[![Node.js Version](https://img.shields.io/node/v/repo-evidoc?style=flat-square)](https://nodejs.org)
[![CI](https://github.com/handong66/Evidoc/actions/workflows/ci.yml/badge.svg)](https://github.com/handong66/Evidoc/actions/workflows/ci.yml)
[![License](https://img.shields.io/npm/l/repo-evidoc?style=flat-square)](./LICENSE)
[![中文文档](https://img.shields.io/badge/docs-%E4%B8%AD%E6%96%87-blue?style=flat-square)](docs/vision/pursuit-goal.zh-CN.md)

Evidoc checks whether README files, docs, AGENTS.md, CLAUDE.md, API notes, examples, and source-bound documentation still describe the repository that exists now.

Use it when stale docs could mislead a reviewer, maintainer, or AI coding agent.

## Start Here

You need Node.js 22 or later. Check with:

```bash
node --version
```

The npm package name is `repo-evidoc`; the installed command name is `evidoc`.
For one-off use, type `npx repo-evidoc ...`.

Try a sample repository:

```bash
npx repo-evidoc demo
```

Scan the repository you are in:

```bash
npx repo-evidoc check --fail-on=review_needed
```

Open the local Web UI:

```bash
npx repo-evidoc app
```

## What It Checks

- Commands in docs that no longer match `package.json`.
- Paths, Markdown links, source symbols, and source bindings that point nowhere.
- AGENTS.md, CLAUDE.md, Cursor rules, and Copilot instructions that contradict the repo.
- OpenAPI operation and schema claims that drift from the spec.
- Changed files that should have matching docs when that policy is enabled.

## What Changes When I Run It

| Command | Writes files? | Use it when |
|---------|---------------|-------------|
| `npx repo-evidoc check --fail-on=review_needed` | No | You want a terminal report. |
| `npx repo-evidoc doctor` | No | You want setup diagnostics. |
| `npx repo-evidoc diagnose` | No | You want evidence-bound repair prompts. |
| `npx repo-evidoc app` | May create `.evidoc/config.json` and `.evidoc/.gitignore` if missing. | You want the local Command Center. |
| `npx repo-evidoc init --yes` | Yes | You want config plus a GitHub Actions workflow. |
| `npx repo-evidoc init --yes --local-git --install-hooks` | Yes | You want repo-local Git hooks instead of GitHub Actions. |
| `npx repo-evidoc fix --safe --write --json` | Yes | You explicitly want deterministic safe fixes applied. |

Normal scans do not call external agent providers and do not upload repository content by default.
In non-interactive shells, bare `npx repo-evidoc` runs a one-shot local app scan instead of opening a browser or keeping a server alive.

## Understand The Result

| Status | Meaning | Next step |
|--------|---------|-----------|
| `ok` | Evidoc found no blocking or review-needed drift in the scanned scope. | Keep going. |
| `review_needed` | A doc or agent instruction may be stale and needs human or agent review. | Run `npx repo-evidoc diagnose` or open `npx repo-evidoc app`. |
| `broken` | Evidence is missing or invalid, such as a missing path or stale config root. | Fix the documented path/config issue first. |

## Choose an Adoption Path

| Need | Recommended path |
|------|------------------|
| Scan once without setup | `npx repo-evidoc check --fail-on=review_needed` |
| Use the local Web UI | `npx repo-evidoc app` |
| Keep a private or local-only repository guarded | `npx repo-evidoc init --yes --local-git --install-hooks` |
| Add PR comments and CI gating on GitHub | `npx repo-evidoc init --yes` or the workflow below |
| Hand evidence to Codex, Claude Code, or OpenCode | `npx repo-evidoc diagnose` |
| Compare agent repair behavior | `npx repo-evidoc agent-eval --json` |
| Generate GitLab, Jenkins, Gitea, or Buildkite snippets | `npx repo-evidoc recipes --target all` |

## Who Is Evidoc For

Evidoc is for repositories where documentation and agent instructions affect real engineering decisions.
It helps maintainers, reviewers, and AI coding agents decide whether repository knowledge still reflects current code before they merge, publish, or repair changes.

## Common User Stories

| User story | Start with |
|------------|------------|
| Maintainers need README commands, paths, APIs, and examples to stay current before merge. | `npx repo-evidoc check --fail-on=review_needed` |
| Teams using AGENTS.md, CLAUDE.md, Cursor rules, or Copilot instructions need agent guidance to match the codebase. | `npx repo-evidoc verify --instructions --json` |
| Private, local-only, or air-gapped repositories need drift gates without uploading source. | `npx repo-evidoc init --yes --local-git --install-hooks` |
| GitHub PR reviewers need a scoped comment explaining which changed docs or affected docs need attention. | `npx repo-evidoc init --yes` |
| Codex, Claude Code, OpenCode, or another agent needs safe repair context instead of stale README memory. | `npx repo-evidoc diagnose` |
| Platform and tooling teams need to connect drift evidence to internal agents, dashboards, or CI. | `npx repo-evidoc recipes --target all` |
| Open-source maintainers need a low-friction contributor check before asking for review. | `npx repo-evidoc doctor` |

## Useful Commands

Agents should use current repository evidence, not stale README memory or untrusted finding text.

| Goal | Command |
|------|---------|
| Check setup | `npx repo-evidoc doctor` |
| Scan docs and agent surfaces | `npx repo-evidoc check --fail-on=review_needed` |
| Open the bilingual Command Center | `npx repo-evidoc app` |
| Generate repair prompts for Codex, Claude Code, OpenCode, or another agent | `npx repo-evidoc diagnose` |
| Check AGENTS.md, CLAUDE.md, Cursor rules, and Copilot instructions | `npx repo-evidoc verify --instructions --json` |
| Compare agent behavior with and without Evidoc evidence | `npx repo-evidoc agent-eval --json` |
| Apply deterministic safe fixes only | `npx repo-evidoc fix --safe --write --json` |
| Check a branch before push | `npx repo-evidoc guard --event pre-push --since merge-base:main` |

MCP clients should start with `evidoc.agent_scan`, the default read-only scan bundle for repair context.

Evidoc does not call external agent providers during normal scans and does not upload repository content by default.

## Documents

| Read this when... | Document |
|-------------------|----------|
| You want a guided install path after this README. | [Onboarding](docs/onboarding.md) |
| You need to change `.evidoc/config.json`. | [Configuration](docs/configuration.md) |
| You want the Chinese mission and user stories. | [中文文档](docs/vision/pursuit-goal.zh-CN.md) |
| You are integrating MCP clients. | [MCP clients](docs/development/mcp-clients.md) |
| You are reviewing architecture or extending Evidoc. | [Full-scope architecture](docs/architecture/full-scope-architecture.md) |
| You are contributing. | [Contributing](CONTRIBUTING.md) |
| You are checking release mechanics. | [Release process](docs/development/release-process.md) |
| You need privacy or vulnerability reporting rules. | [Privacy](PRIVACY.md), [Security policy](SECURITY.md) |

## Local Git Gate Adoption

Use this when the project is local-only, private, air-gapped, or simply not ready for GitHub Actions:

```bash
npx repo-evidoc init --yes --local-git --install-hooks
npx repo-evidoc guard --event pre-commit
npx repo-evidoc guard --event pre-push --since merge-base:main
```

`init --local-git` writes `.evidoc/config.json`, `.evidoc/.gitignore`, `.githooks/pre-commit`, and `.githooks/pre-push`.
With `--install-hooks`, it sets repo-local `core.hooksPath=.githooks`.
Every guard run writes ignored local reports under `.evidoc/reports/`.

For non-GitHub CI systems:

```bash
npx repo-evidoc recipes --target all
```

## Source Checkout Development

Use a source checkout when contributing to Evidoc or testing unreleased changes against another repository:

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
Use `evidoc app --root <repository>` or `evidoc serve --root <repository>` when the Local App is intended.

## GitHub Action

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

Generated workflows from `init` and the local app try to detect the repository branch from remote HEAD metadata or the current branch.
PR scans label themselves as changed-only when appropriate, so a green PR means no drift was found in changed or affected docs, not that every document in the repository was re-scanned.
Fork PR safe auto-fix and auto-commit are disabled with a warning.
When enabling SARIF in this workflow, also add `security-events: write` to the workflow permissions.
Only add `security-events: write` when setting `sarif: "true"`.

For release-pinned external repositories, replace only the action reference inside the `steps` list:

```yaml
- uses: handong66/Evidoc/packages/github-action@v0.1.0
  with:
    fail-on: review_needed
    sarif: "false"
    pr-comment: "true"
    changed-only: ${{ github.event_name == 'pull_request' && 'true' || 'false' }}
    since: origin/${{ github.event.repository.default_branch }}
```

## Principles and Troubleshooting

- Repo-local by default: normal scans do not require source upload.
- GitHub optional: Local Git Gate is first-class for private, local-only, and inner-source repositories.
- Deterministic first: path, command, config, schema, API, and graph evidence comes before LLM judgment.
- Evidence before action: every finding should explain what changed and why review is needed.
- Review first: generated patches are proposals, never silent merges.
- Privacy first: Telemetry is disabled by default. Future telemetry must be explicit opt-in and must not include repository content.

| Symptom | What to try |
|---------|-------------|
| `npx repo-evidoc` fails before running | Check `node --version`; npm installs require Node.js 22 or later. |
| `doctor` is not ready | Run `npx repo-evidoc init --yes` or `npx repo-evidoc init --yes --local-git --install-hooks`. |
| No documents are scanned | Add `README.md`, add `docs/`, or update `.evidoc/config.json` `docRoots`. |
| Local Git hooks do not run | Check `git config core.hooksPath`; local gates expect `.githooks`. |
| GitHub Action comments are missing | Keep `pull-requests: write` and `pr-comment: "true"` in the workflow. |
| A changed-only PR scan looks too narrow | Set `since: origin/${{ github.event.repository.default_branch }}` or run a full scan. |
| An agent report feels stale | Re-run `npx repo-evidoc guard --event manual --scope staged --json` and compare runtime fingerprints. |
