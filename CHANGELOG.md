# Changelog

This project follows Semantic Versioning. Before 1.0.0, minor versions may include breaking changes and patch versions are reserved for compatible fixes.

## Unreleased

## 0.3.0 - 2026-07-10

- Moved the public launcher to `evidoc` and every library package to the `@evidoc` npm organization, with synchronized manifests, workspace imports, generated commands, tests, and documentation.
- Renamed the MCP executable to `evidoc-mcp` and aligned CLI, MCP, Local App, reports, GitHub Action, and onboarding output with the same package identity.
- Added a repository-wide stale-identity contract plus release verification for the exact twelve-package `0.3.0` set.
- Made first publication resumable only when registry and locally verified tarballs have identical integrity, then documented the verified `v0.3.0` and floating Action `v0` release path.

## 0.2.1 - 2026-07-10

- Upgraded every bundled and generated GitHub Action dependency to an immutable Node 24 release, eliminating GitHub's Node 20 runtime deprecation warning for CI, releases, and the packaged Evidoc Action.

## 0.2.0 - 2026-07-10

- Fixed false-green gates for invalid fail policies/config files, changed-source coverage in the GitHub Action, nested Markdown links, and generated pre-push baselines.
- Hardened the Local App against DNS rebinding and cross-origin writes, added explicit deterministic safe-fix application with rescan, and exposed the shared Agent Runtime Contract in Local App and GitHub Action results.
- Consolidated configuration, fail policy, changed-impact, frontmatter, review-log, MCP tool, and safe-fix contracts into shared implementations instead of entrypoint-specific truth.
- Prepared synchronized 0.2.0 release artifacts with exact Action tags, version/tag verification, package README/LICENSE files, tarball identity checks, and fail-before-publish registry preflight.
- Renamed the project from DriftGuard to Evidoc across the CLI, npm package names, `.evidoc` configuration directory, MCP tools, GitHub Action examples, Local App, and public documentation.
- Added compatibility detection for pre-rename `handong66/DriftGuard/packages/github-action@...` workflows so existing GitHub redirect users are still recognized by `doctor`, setup warnings, and Local App checks instead of getting duplicate Evidoc gates.
- Redesigned the local Web app as the bilingual Evidoc Command Center with a system folder picker, fleet health, repository cockpit, triage queue, repair console, and copyable agent prompts.
- Fixed `doctor` readiness detection so source-checkout GitHub Actions workflows that run Evidoc through npm, pnpm, Yarn, Bun, or direct CLI commands count as valid Evidoc gates, without emitting packaged-action PR comment warnings or comment-only advisory fail-on warnings.
- Hardened the release workflow so npm pack/publish steps use explicit local package paths and public tarballs include runtime `dist/src` plus package README/LICENSE files, but not source tests or build metadata.
- Synchronized onboarding, architecture, and planning docs with the published `npx evidoc` package path and current local GUI behavior.

## 0.1.0 - 2026-07-05

- Added the full Evidoc scanner surface for path, command, OpenAPI, symbol, frontmatter, review TTL, agent instruction, package claim, ADR, and source-test coverage drift.
- Added review-log suppression, SARIF output, GitHub annotations, PR comment bodies, patch proposal validation, dashboard rendering, graph data, multi-repository scans, and MCP tools.
- Added the publishable `evidoc` package for `npx evidoc` usage and release artifact automation.
