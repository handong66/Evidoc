# Evidoc Full-Scope Architecture

This is a maintainer and integrator reference, not the first document a new user should read. If you only want to run Evidoc, use the README or `docs/onboarding.md`.

In one minute: Evidoc has one core scanner, and every surface reuses that evidence instead of inventing its own drift status. The CLI, local Web UI, Local Git hooks, GitHub Action, MCP server, reports, graph, patch proposals, and review log all work from the same repository-local evidence model.

Evidoc is organized as a full product from the first commit. Individual releases may expose only part of the surface, but package boundaries should already match the final system.

## Product Surfaces

- `@handong66/evidoc-core`: repository scanning, document indexing, deterministic detectors, evidence model, Agent Runtime Contract creation, stable finding fingerprints, shared path-safety helpers, and report assembly.
- `@handong66/evidoc-cli`: local command line interface for `demo`, `app`, `serve`, `check`, `diagnose`, `diff`, `guard`, `recipes`, `fix`, `verify`, `agent-eval`, `index`, `explain`, `graph`, `dashboard`, `draft`, `validate`, `multi`, `mcp-tools`, and `action`.
- `@handong66/evidoc-reports`: text and Markdown formatting, with JSON emitted directly by product surfaces.
- `@handong66/evidoc-github-action`: Action wrapper that runs the CLI in advisory or gate mode.
- `@handong66/evidoc-mcp-server`: `evidoc.agent_scan` as the default read-only repair entrypoint, `evidoc.get_drift_status` as the status entrypoint, focused read tools after that, and review-log recording as the only write tool. Writes require explicit authorization and only target roots inside the MCP server working directory.
- `@handong66/evidoc-graph`: file, document, symbol, API, claim, command, and agent-instruction graph.
- `@handong66/evidoc-frontmatter`: optional source binding schema, validation, and backfill suggestions.
- `@handong66/evidoc-patcher`: deterministic safe patches, LLM draft patches, and patch validation.
- `@handong66/evidoc-dashboard`: static report renderer plus the bilingual local Command Center UI, including fleet health, repository cockpit, Local Git Gate state, staged and unstaged changed files, affected docs, latest gate result with gate baseline, baseline commit, runtime status, fingerprint, freshness, triage queue, repair console, and copyable agent prompts.
- `@handong66/evidoc-local-app`: local Web server, auto-init, Local Git Gate enablement, system folder picker bridge, multi-repository scan state, Git status, scan history, local gate report summaries, agent skill scaffolding, and GUI actions.
  Added roots must be existing real directories and are stored by canonical real path.
  File-opening and write-capable actions are limited to roots already added to the local app.
  Generated config, workflow, local hooks, history, reports, and scaffold files use repository-bound writable path checks.
  File-opening resolves real paths and rejects symlink escapes; POST endpoints reject cross-origin browser writes and oversized JSON bodies.
- `@handong66/evidoc-review-log`: append-only human review decisions and expiry checks.

## Data Flow

```text
Repository files
  -> snapshot loader
  -> document index
  -> config/API/symbol/command indexes
  -> detectors
  -> evidence packs
  -> Agent Runtime Contract
  -> agent scan / benchmark packs
  -> report formatters
  -> CLI / Local Git Gate / Local App / GitHub Action / MCP / patch review
```

## Detector Order

1. Path and link references.
2. Package manager and script command claims.
3. Agent instruction consistency, including package-manager conflicts, stale file pointers, and contradictory always/never rules.
4. Frontmatter source binding validation.
5. Changed-source documentation coverage when configured.
6. API spec and schema drift.
7. Symbol and claim drift.
8. Semantic drift and patch drafting.

This order is intentional: the system must exhaust deterministic evidence before asking an LLM to reason about ambiguous claims.

## Completion Standard

The project is not done when a CLI prints findings. The full product is done when Evidoc can:

1. scan a repository locally through CLI and the one-command bilingual local app;
2. produce structured evidence;
3. explain findings to humans and agents;
4. run in Local Git hooks and GitHub Actions;
5. expose MCP read tools;
6. model document-to-source bindings;
7. generate and validate reviewable patches;
8. preserve review decisions;
9. publish local benchmark packs for Codex, Claude Code, and OpenCode A/B repair checks;
10. provide generic local CLI recipes for GitLab CI, Jenkins, Gitea Actions, and Buildkite;
11. keep sensitive content local unless explicitly configured otherwise.

GitHub integration intentionally stops at GitHub Actions. Evidoc does not include, publish, or plan a separate installed GitHub application surface. GitHub is optional; Local Git Gate is the first-class path for local-only, private, and inner-source repositories.

## Implemented Detector Families

- Local path and Markdown link references.
- Package-manager mismatch and unknown package scripts, including `npx` mismatch detection without treating `npx` targets as package scripts.
- OpenAPI operation and request/response schema references, including one-sided `request:` or `response:` schema claims.
- Source symbol anchors such as `src/service.ts#listUsers`.
- Frontmatter source path bindings.
- Frontmatter `lastReviewed` plus `ttlDays` review windows.
- Changed source coverage through `requireDocsForChangedSources`, reported as `coverage.changed-source-without-doc`.
- Agent instruction consistency across AGENTS.md, CLAUDE.md, Cursor rules, and GitHub Copilot instructions. These files are mandatory agent control surfaces and are scanned when present even if ordinary documentation coverage is narrowed with `docRoots`.
- Evidoc health score, computed from broken and review-needed findings.
- Diff impact mode for changed files and affected documents, including staged pre-commit scans and `merge-base:<branch>` baselines.

## Agent Evaluation Contract

`agent-eval --json` emits the local `evidoc-agent-ab-v0` benchmark pack. It does not run external agents. The pack captures the current coverage baseline, the default MCP entrypoint, read-parity repair tasks, safe-fix criteria, and pass/fail criteria for real Codex, Claude Code, and OpenCode A/B runs.

The Agent Runtime Contract is the shared anti-conflict layer for Local Git reports, MCP results, local app summaries, and generated agent instructions.
It records `source=evidoc`, `event`, `mode`, `scope`, `baseline`, optional `baselineCommit`, `status`, `generatedAt`, `scannedAt`, `changedFileFingerprints`, an aggregate fingerprint, and per-finding fingerprints.
Hooks report `mode=blocking`; manual, MCP, and IDE-style surfaces are advisory unless they are summarizing a hook failure.
User-facing reminders reject stale local reports by changed-file set and content fingerprints, with timestamp fallback for older reports, then dedupe by `runtime.findings[].fingerprint`.
The aggregate runtime fingerprint is scoped to the runtime context: event, mode, scope, baseline, affected documents, changed files, changed-file fingerprints, and finding fingerprints. It excludes generated/scanned timestamps so repeated reads of the same evidence stay stable without collapsing different changed-file sets into one reminder context.

`evidoc.agent_scan` is the MCP repair default.
Its JSON bundle includes the Agent Runtime Contract, freshness, partial-scan status, affected documents, evidence categories, repair modes, patch classifications, next commands, and a privacy contract.
`evidoc.get_drift_status` is the lighter status entrypoint, while `evidoc.diagnose_drift` and `evidoc.suggest_doc_fix` expose compact repair and proposal views.
A bundle is fresh only for the repository content, config, and review log observed at `scannedAt`; agents must rerun Evidoc after edits.

LLM output is not treated as detector truth. The patcher can create a bounded LLM request and validate the returned patch against current findings, but deterministic evidence remains the source of authority.

## Path Safety Contract

Repository-relative paths are accepted only after shared core validation.
Paths containing `..`, absolute roots, drive separators, empty segments, NUL, LF, or CR are rejected.
Existing read and patch targets are checked with `realpath`, so a symlink inside the repository cannot make Evidoc read or write outside the repository.
New write targets, such as the MCP review log, must have a real existing ancestor inside the repository before directories are created.
The GitHub Action's safe auto-fix commit step applies the same repository-relative filter and realpath boundary check before passing paths to `git add`.
