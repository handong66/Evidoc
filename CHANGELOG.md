# Changelog

This project follows Semantic Versioning. Before 1.0.0, minor versions may include breaking changes and patch versions are reserved for compatible fixes.

## Unreleased

- Renamed the project from DriftGuard to Evidoc across the CLI, npm package names, `.evidoc` configuration directory, MCP tools, GitHub Action examples, Local App, and public documentation.
- Added compatibility detection for pre-rename `handong66/DriftGuard/packages/github-action@...` workflows so existing GitHub redirect users are still recognized by `doctor`, setup warnings, and Local App checks instead of getting duplicate Evidoc gates.
- Redesigned the local Web app as the bilingual Evidoc Command Center with a system folder picker, fleet health, repository cockpit, triage queue, repair console, and copyable agent prompts.
- Fixed `doctor` readiness detection so source-checkout GitHub Actions workflows that run Evidoc through npm, pnpm, Yarn, Bun, or direct CLI commands count as valid Evidoc gates, without emitting packaged-action PR comment warnings or comment-only advisory fail-on warnings.
- Hardened the release workflow so npm pack/publish steps use explicit local package paths and public package tarballs only include runtime `dist/src` output.
- Synchronized onboarding, architecture, and planning docs with the published `npx repo-evidoc` package path and current local GUI behavior.

## 0.1.0 - 2026-07-05

- Added the full Evidoc scanner surface for path, command, OpenAPI, symbol, frontmatter, review TTL, agent instruction, package claim, ADR, and source-test coverage drift.
- Added review-log suppression, SARIF output, GitHub annotations, PR comment bodies, patch proposal validation, dashboard rendering, graph data, multi-repository scans, and MCP tools.
- Added the publishable `repo-evidoc` package for `npx repo-evidoc` usage and release artifact automation.
