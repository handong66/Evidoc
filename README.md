# Evidoc

> **Keep repository docs and coding-agent instructions aligned with the code humans and agents use now.**
> Give reviewers, CI, the local Command Center, and agents like Codex, Claude Code, OpenCode, Cursor, or internal tools the same repo-local evidence before they trust or repair stale context.

[![npm](https://img.shields.io/npm/v/evidoc?style=flat-square)](https://www.npmjs.com/package/evidoc)
[![Node.js Version](https://img.shields.io/node/v/evidoc?style=flat-square)](https://nodejs.org)
[![CI](https://github.com/handong66/Evidoc/actions/workflows/ci.yml/badge.svg)](https://github.com/handong66/Evidoc/actions/workflows/ci.yml)
[![License](https://img.shields.io/npm/l/evidoc?style=flat-square)](./LICENSE)
[![中文文档](https://img.shields.io/badge/docs-%E4%B8%AD%E6%96%87-blue?style=flat-square)](docs/vision/pursuit-goal.zh-CN.md)

Evidoc is a repo-local evidence gate for stale documentation and coding-agent instructions. It checks claims about paths, commands, source symbols, APIs, configuration, and review freshness against the repository that exists now. No repository content is uploaded by default.

The deterministic analyzer is the engine. The Agent Runtime Contract carries report identity and freshness metadata across CLI guards, GitHub Actions, the Local App, and MCP. “Agent-first” describes how coding agents consume that same evidence; it is not a separate analyzer or status system.

## One-Minute Check

You need Node.js 22 or later. From any repository, run:

```bash
npx evidoc check --fail-on=review_needed
```

This first check is read-only. If it finds drift, inspect evidence with `npx evidoc diagnose`, apply only deterministic fixes with `npx evidoc fix --safe --write --json`, or open the loopback-only Local App with `npx evidoc app`.

## Start Here

You need Node.js 22 or later. Check with:

```bash
node --version
```

The npm package and installed command are both named `evidoc`.
For one-off use, type `npx evidoc ...`.

Choose one adoption path after the read-only check:

| I want to... | Start with |
|--------------|------------|
| Give a coding agent current repo evidence | Configure the MCP server or run `npx evidoc init --yes --with agents` |
| See findings, history, gates, and fixes in a browser | `npx evidoc app` |
| Add a local or PR gate | `npx evidoc init --yes --local-git --install-hooks` or `npx evidoc init --yes` |

Try a safe sample first with `npx evidoc demo`.

Common commands:

| Goal | Command |
|------|---------|
| Check setup | `npx evidoc doctor` |
| Scan docs and agent surfaces | `npx evidoc check --fail-on=review_needed` |
| Open the bilingual Command Center | `npx evidoc app` |
| Generate repair prompts for Codex, Claude Code, OpenCode, or another agent | `npx evidoc diagnose` |
| Check AGENTS.md, CLAUDE.md, Cursor rules, and Copilot instructions | `npx evidoc verify --instructions --json` |
| Use MCP from an agent | `evidoc.agent_scan`, then `evidoc.get_drift_status`, `evidoc.diagnose_drift`, or `evidoc.suggest_doc_fix` |
| Export graph/report data | `npx evidoc graph --json`, `npx evidoc index --json`, or `npx evidoc dashboard --out evidoc.html` |
| Apply deterministic safe fixes only | `npx evidoc fix --safe --write --json` |
| Check a branch before push | `npx evidoc guard --event pre-push --since merge-base:main` |
| Generate GitLab, Jenkins, Gitea, or Buildkite snippets | `npx evidoc recipes --target all` |

## Who It Is For

Evidoc is for maintainers who rely on repository docs during review, teams whose coding agents read AGENTS.md or similar instructions, and platform teams that need the same drift evidence in local gates and pull requests. It is most useful when a stale command, path, API claim, or agent rule can cause incorrect engineering work.

## Product Surfaces

| Surface | What it supports |
|---------|------------------|
| CLI | `check`, `diff`, `doctor`, `verify`, `diagnose`, `fix`, `guard`, `graph`, `dashboard`, `multi`, `recipes`, and action-compatible runs. An experimental `agent-eval --json` command emits a benchmark specification but does not run agents. |
| Local Web UI | A bilingual, loopback-only Command Center with repository health, finding evidence, scan history, deterministic safe-fix actions, Local Git Gate controls, and pinned GitHub Action generation. |
| GitHub Action | PR comments, annotations, optional SARIF, changed-only scans, fail policies, safe auto-fix controls, and release-pinned usage. |
| Local Git Gate | Repo-local pre-commit, pre-push, and manual gates with ignored local reports under `.evidoc/reports/`. |
| MCP server | `@evidoc/mcp-server` exposes `evidoc-mcp`, read-only tools (`evidoc.agent_scan`, `evidoc.get_drift_status`, `evidoc.diagnose_drift`, `evidoc.suggest_doc_fix`), and the explicit-write `evidoc.record_review` review-log tool. |
| Reports and graph | JSON reports, runtime fingerprints, document/source/API/rule graph data, static dashboards, and machine-readable repository indexes. |
| Repair workflow | Evidence-bound repair prompts, deterministic safe fixes, patch drafts, patch validation, and review-log decisions. |

## Detection Surface

Evidoc monitors the repository knowledge that people and agents trust:

- Commands in docs and agent instructions that should match `package.json`.
- Paths, Markdown links, source symbols, frontmatter source bindings, and review windows.
- AGENTS.md, CLAUDE.md, Cursor rules, and Copilot instructions.
- OpenAPI operation and request/response schema claims.
- Changed files, affected docs, package-manager evidence, and source-to-doc coverage policy.

## Read-Only by Default, Explicit Writes When You Choose

| Command | Writes files? | Use it when |
|---------|---------------|-------------|
| `npx evidoc check --fail-on=review_needed` | No | You want a terminal report. |
| `npx evidoc doctor` | No | You want setup diagnostics. |
| `npx evidoc diagnose` | No | You want evidence-bound repair prompts. |
| `npx evidoc app` | May create `.evidoc/config.json` and `.evidoc/.gitignore` if missing. | You want the local Command Center. |
| `npx evidoc init --yes` | Yes | You want config plus a GitHub Actions workflow. |
| `npx evidoc init --yes --local-git --install-hooks` | Yes | You want repo-local Git hooks instead of GitHub Actions. |
| `npx evidoc fix --safe --write --json` | Yes | You want deterministic safe fixes applied. |

Normal scans run repo-local evidence checks and keep repository content local by default.
MCP write access is limited to `evidoc.record_review` and requires explicit server authorization.
In non-interactive shells, bare `npx evidoc` runs a one-shot local app scan instead of opening a browser or keeping a server alive.

## Understand The Result

| Status | Meaning | Next step |
|--------|---------|-----------|
| `ok` | Evidoc found no blocking or review-needed drift in the scanned scope. | Keep going. |
| `review_needed` | A doc or agent instruction may be stale and needs human or agent review. | Run `npx evidoc diagnose` or open `npx evidoc app`. |
| `broken` | Evidence is missing or invalid, such as a missing path or stale config root. | Fix the documented path/config issue first. |

## Documents

| Read this when... | Document |
|-------------------|----------|
| You want a guided install path after this README. | [Onboarding](docs/onboarding.md) |
| You need to change `.evidoc/config.json`. | [Configuration](docs/configuration.md) |
| You want the Chinese feature guide, user stories, and product surfaces. | [中文文档](docs/vision/pursuit-goal.zh-CN.md) |
| You are integrating MCP clients. | [MCP clients](docs/development/mcp-clients.md) |
| You are reviewing architecture or extending Evidoc. | [Full-scope architecture](docs/architecture/full-scope-architecture.md) |
| You are contributing. | [Contributing](CONTRIBUTING.md) |
| You are checking release mechanics. | [Release process](docs/development/release-process.md) |
| You need privacy or vulnerability reporting rules. | [Privacy](PRIVACY.md), [Security policy](SECURITY.md) |

## Local Git Gate Adoption

Use this when the project is local-only, private, air-gapped, or simply not ready for GitHub Actions:

```bash
npx evidoc init --yes --local-git --install-hooks
npx evidoc guard --event pre-commit
npx evidoc guard --event pre-push --since merge-base:main
```

`init --local-git` writes `.evidoc/config.json`, `.evidoc/.gitignore`, `.githooks/pre-commit`, and `.githooks/pre-push`.
With `--install-hooks`, it sets repo-local `core.hooksPath=.githooks`.
Every guard run writes ignored local reports under `.evidoc/reports/`.

For non-GitHub CI systems:

```bash
npx evidoc recipes --target all
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
      - uses: actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0 # v7
      - uses: handong66/Evidoc/packages/github-action@v0.3.0
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

The generated workflow is pinned to the matching release tag. To upgrade, change only the action reference inside the `steps` list:

```yaml
- uses: handong66/Evidoc/packages/github-action@v0.3.0
  with:
    fail-on: review_needed
    sarif: "false"
    pr-comment: "true"
    changed-only: ${{ github.event_name == 'pull_request' && 'true' || 'false' }}
    since: origin/${{ github.event.repository.default_branch }}
```

## How Evidoc Works

- Repo-local evidence powers every surface: CLI, Local Git Gate, Local App, GitHub Action, MCP tools, reports, graph data, and repair prompts.
- Local Git Gate is first-class for private, local-only, air-gapped, and inner-source repositories.
- Deterministic checks connect paths, commands, configs, schemas, APIs, source symbols, and graph evidence before semantic analysis.
- Every finding cites specific evidence: the document fragment or instruction claim, related code/config/API evidence, rule trigger, and why review is needed.
- Generated patches are reviewable proposals with safe-fix classification and validation.
- Telemetry is disabled by default. Future telemetry must be explicit opt-in and must keep repository content out of payloads.

## Troubleshooting

| Symptom | What to try |
|---------|-------------|
| `npx evidoc` fails before running | Check `node --version`; npm installs require Node.js 22 or later. |
| `doctor` is not ready | Run `npx evidoc init --yes` or `npx evidoc init --yes --local-git --install-hooks`. |
| No documents are scanned | Add `README.md`, add `docs/`, or update `.evidoc/config.json` `docRoots`. |
| Local Git hooks do not run | Check `git config core.hooksPath`; local gates expect `.githooks`. |
| GitHub Action comments are missing | Keep `pull-requests: write` and `pr-comment: "true"` in the workflow. |
| A changed-only PR scan looks too narrow | Set `since: origin/${{ github.event.repository.default_branch }}` or run a full scan. |
| An agent report feels stale | Re-run `npx evidoc guard --event manual --scope staged --json` and compare runtime fingerprints. |
