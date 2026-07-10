# npm Namespace Hard-Cut Design

Date: 2026-07-10
Status: Approved for planning
Owner: Codex

## Goal

Move Evidoc to one public npm identity with no compatibility layer. The user-facing launcher becomes `evidoc`; every publishable workspace library moves under the `@evidoc` organization; repository code, generated configuration, documentation, tests, release automation, and packed artifacts must agree on those identities.

## Decisions

- Publish the user-facing package as `evidoc` at version `0.3.0`.
- Keep the installed CLI command as `evidoc`; the documented one-shot path is `npx evidoc`.
- Publish the MCP executable as `evidoc-mcp`.
- Publish all workspace packages at the same `0.3.0` version.
- Do not ship aliases, forwarding packages, compatibility bins, or dual dependency names.
- Do not unpublish historical npm artifacts. After all replacements are verified, mark the historical packages deprecated with a concise pointer to the corresponding new package.
- Keep the GitHub repository owner and repository URLs unchanged. This migration changes npm identities, not GitHub ownership.

## Package Identity Map

| Workspace | New identity |
| --- | --- |
| repository root | `@evidoc/repo` (private) |
| `packages/evidoc` | `evidoc` |
| `packages/cli` | `@evidoc/cli` |
| `packages/core` | `@evidoc/core` |
| `packages/dashboard` | `@evidoc/dashboard` |
| `packages/frontmatter` | `@evidoc/frontmatter` |
| `packages/github-action` | `@evidoc/github-action` |
| `packages/graph` | `@evidoc/graph` |
| `packages/local-app` | `@evidoc/local-app` |
| `packages/mcp-server` | `@evidoc/mcp-server` |
| `packages/patcher` | `@evidoc/patcher` |
| `packages/reports` | `@evidoc/reports` |
| `packages/review-log` | `@evidoc/review-log` |

## Change Surface

The migration covers all package manifests and workspace dependency edges; TypeScript imports and exports; package-lock workspace links; CLI and MCP executable references; generated onboarding and GitHub Action snippets; Local App copy; tests and fixtures; release allowlists, version checks, tarball naming, smoke tests, release notes, badges, and public documentation.

The GitHub Action remains sourced from the current GitHub repository path. Its generated examples pin the exact `v0.3.0` release tag. After the release passes npm and GitHub verification, the floating Action tag `v0` moves to the same commit as `v0.3.0`.

## Single-Truth Rules

- Workspace manifests are the source of package names and versions.
- Release verification derives the expected package set from the workspaces and rejects missing, extra, private, or version-divergent publishable packages.
- Tarball smoke tests discover the launcher from its manifest and assert the `evidoc` bin instead of encoding an independent legacy identity.
- Generated onboarding, Local App guidance, MCP examples, and documentation use constants or manifest-derived values where practical; duplicated literals receive contract tests.
- Current repository files must contain no stale legacy npm scope, launcher package, or MCP bin identity.

## Release Sequence

1. Land and verify the repository migration at `0.3.0` without publishing.
2. Pack all twelve public packages from the verified commit and run tarball-level installation and command smoke tests in temporary directories.
3. Bootstrap the new npm package records using the authenticated owner account, publishing in dependency order.
4. Configure Trusted Publishing independently for every new package and bind it to the repository release workflow.
5. Re-run or resume the `v0.3.0` release only after the package records and trusted publishers are consistent. The workflow must refuse partial or mismatched releases.
6. Verify registry metadata, tarball contents, executable behavior, GitHub Release assets, checksums, and release CI.
7. Deprecate historical package identities only after every replacement is publicly installable.
8. Move the GitHub Action `v0` tag to the verified `v0.3.0` commit.

## Failure Handling

- Before publishing, any stale-name scan, test, build, pack, or smoke failure blocks the release.
- During first publication, publish in dependency order and record each successful package. Never republish an existing version.
- If publication stops midway, keep published packages immutable, fix only the failed release configuration, and resume after registry-state reconciliation.
- Do not deprecate historical packages or move the Action major tag until all twelve replacements pass public install checks.
- Do not expose npm tokens in logs or repository files. Prefer Trusted Publishing for steady-state releases.

## Verification Gates

The implementation is complete only when all of the following pass from a clean checkout or isolated temporary directory:

- A repository-wide stale-identity scan returns no matches. The shell check will concatenate the sensitive legacy fragments so this specification itself does not preserve a stale literal.
- `npm ci`
- `npm test`
- `npm run build`
- `npm run release:verify -- --tag v0.3.0`
- Package all workspaces into `.evidoc/release` and verify the expected twelve tarballs.
- `npm run release:smoke:npx -- .evidoc/release`
- Install the packed launcher in a temporary directory and run `npx --no-install evidoc --version`, `doctor`, `check`, `diagnose`, `demo`, and one-shot Local App scans.
- Run Evidoc's own repository check with the release gate required by the project.
- `git diff --check`
- OpenCode performs a bounded read-only review of the final diff for missed identities, split-brain release logic, and broken npm install paths. Codex verifies every accepted finding and reruns the affected gates.
- Final `git status --short --branch` is clean after commit and publication.

## Acceptance Criteria

- `npm view evidoc@0.3.0` and every `@evidoc/*@0.3.0` package return the expected repository metadata and dependency names.
- `npx evidoc@0.3.0 --version` reports `0.3.0` in a clean temporary directory.
- `npx @evidoc/mcp-server@0.3.0` exposes only the new MCP executable identity and starts successfully under its documented contract.
- The public README, onboarding, generated workflow, CLI, MCP, Local App, package metadata, release verifier, and tarball smoke tests all name the same product and package set.
- GitHub Actions for the release commit are green, the GitHub Release contains exactly the verified tarballs, and floating Action tag `v0` resolves to the exact `v0.3.0` commit.
- Historical packages are deprecated only after all replacement checks pass; no compatibility code remains in the repository.

## OpenCode Boundary

OpenCode is a read-only second reviewer for the completed diff. It may inspect the repository diff and named release files, but it may not edit, commit, push, publish, modify npm/GitHub settings, read secrets, or access Codex-private paths. Codex owns implementation, verification, release, and final judgment.
