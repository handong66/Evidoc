# npm Namespace Hard-Cut Implementation Plan

<!-- evidoc: ignore-file -->

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish Evidoc `0.3.0` under the unscoped `evidoc` launcher and the `@evidoc` organization with no compatibility layer or stale repository identity.

**Architecture:** Workspace manifests define the package graph; contract tests enforce the allowed package set, aligned version, launcher/MCP bins, and absence of legacy identities. Release verification, tarball smoke tests, generated onboarding, and documentation consume the same identities and are validated before first publication in dependency order.

**Tech Stack:** Node.js 22+, npm workspaces/npm 11, TypeScript project references, Node test runner, GitHub Actions OIDC Trusted Publishing, npm registry, OpenCode bounded read-only review.

## Global Constraints

- Public version is exactly `0.3.0` for all twelve publishable packages and runtime version constants.
- Root workspace identity is `@evidoc/repo` and remains private.
- User package and executable are `evidoc`; documented one-shot command is `npx evidoc`.
- MCP package is `@evidoc/mcp-server`; executable is `evidoc-mcp`.
- No aliases, forwarding packages, compatibility bins, or dual dependency names.
- GitHub ownership and repository URLs remain `handong66/Evidoc`.
- Historical npm artifacts remain published until all replacement packages are verified; then they are deprecated, not unpublished.
- OpenCode is read-only and may not edit, commit, push, publish, alter settings, or read secrets/private Codex paths.

---

### Task 1: Add the package identity contract

**Files:**
- Modify: `packages/core/test/open-source-surface.test.ts`
- Test: `packages/core/test/open-source-surface.test.ts`

**Interfaces:**
- Consumes: workspace manifests under `packages/*/package.json` and root `package.json`.
- Produces: an executable contract for the exact package map, `0.3.0` alignment, launcher/MCP bins, private root, and stale-identity rejection.

- [ ] **Step 1: Write failing identity assertions**

Add the exact map and root/bin assertions:

```ts
const expectedPackageNames = new Map([
  ["cli", "@evidoc/cli"],
  ["core", "@evidoc/core"],
  ["dashboard", "@evidoc/dashboard"],
  ["evidoc", "evidoc"],
  ["frontmatter", "@evidoc/frontmatter"],
  ["github-action", "@evidoc/github-action"],
  ["graph", "@evidoc/graph"],
  ["local-app", "@evidoc/local-app"],
  ["mcp-server", "@evidoc/mcp-server"],
  ["patcher", "@evidoc/patcher"],
  ["reports", "@evidoc/reports"],
  ["review-log", "@evidoc/review-log"]
]);

assert.equal(rootManifest.name, "@evidoc/repo");
assert.equal(rootManifest.private, true);
assert.equal(wrapper?.bin?.evidoc, "dist/src/index.js");
assert.equal(mcp?.bin?.["evidoc-mcp"], "dist/src/index.js");
```

Construct forbidden historical strings from fragments inside the test, then recursively scan tracked product/config/docs surfaces while ignoring `.git`, `node_modules`, `dist`, and `.evidoc`.

- [ ] **Step 2: Run the contract and confirm the old tree fails**

Run: `npm run build && node --test packages/core/dist/test/open-source-surface.test.js`

Expected: FAIL on the root/package identities and stale-identity scan.

- [ ] **Step 3: Commit the red contract**

```bash
git add packages/core/test/open-source-surface.test.ts
git commit -m "test: define Evidoc npm identity contract"
```

### Task 2: Rename the workspace graph and align version 0.3.0

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `tsconfig.base.json`
- Modify: `packages/cli/package.json`
- Modify: `packages/core/package.json`
- Modify: `packages/dashboard/package.json`
- Modify: `packages/evidoc/package.json`
- Modify: `packages/frontmatter/package.json`
- Modify: `packages/github-action/package.json`
- Modify: `packages/graph/package.json`
- Modify: `packages/local-app/package.json`
- Modify: `packages/mcp-server/package.json`
- Modify: `packages/patcher/package.json`
- Modify: `packages/reports/package.json`
- Modify: `packages/review-log/package.json`
- Modify: `packages/core/src/version.ts`
- Modify: `packages/cli/src/index.ts`
- Modify: `packages/dashboard/src/index.ts`
- Modify: `packages/evidoc/src/index.ts`
- Modify: `packages/frontmatter/src/index.ts`
- Modify: `packages/github-action/src/index.ts`
- Modify: `packages/graph/src/index.ts`
- Modify: `packages/local-app/src/index.ts`
- Modify: `packages/mcp-server/src/index.ts`
- Modify: `packages/patcher/src/index.ts`
- Modify: `packages/reports/src/index.ts`
- Modify: `packages/review-log/src/index.ts`

**Interfaces:**
- Consumes: the Task 1 expected package map.
- Produces: a buildable workspace graph whose internal dependencies use exact `0.3.0` pins and new npm identities.

- [ ] **Step 1: Update manifest identities, bins, and versions**

Set root metadata to:

```json
{
  "name": "@evidoc/repo",
  "version": "0.3.0",
  "private": true
}
```

Set every workspace manifest to its Task 1 name and `0.3.0`. Replace every internal dependency with its `@evidoc/*` name and exact `0.3.0`. Keep the launcher bin as `evidoc`; rename the MCP bin to `evidoc-mcp`.

- [ ] **Step 2: Update TypeScript path aliases and source imports**

Replace workspace aliases in `tsconfig.base.json` with `@evidoc/*` keys. Update all source imports/exports without changing public TypeScript symbols or runtime behavior.

- [ ] **Step 3: Update the runtime version**

```ts
export const EVIDOC_VERSION = "0.3.0";
```

- [ ] **Step 4: Regenerate only the npm lockfile metadata**

Run: `npm install --package-lock-only --ignore-scripts`

Expected: exit 0; `package-lock.json` workspace entries and links use only the new identities and `0.3.0`.

- [ ] **Step 5: Build and run the identity contract**

Run: `npm run build && node --test packages/core/dist/test/open-source-surface.test.js`

Expected: package-map and bin assertions pass; remaining stale-identity failures point only to user-facing/release surfaces handled by later tasks.

- [ ] **Step 6: Commit the workspace graph**

```bash
git add package.json package-lock.json tsconfig.base.json packages
git commit -m "refactor: move packages to the Evidoc namespace"
```

### Task 3: Update generated product surfaces and behavioral tests

**Files:**
- Modify: `packages/cli/src/index.ts`
- Modify: `packages/core/src/workflow-warnings.ts`
- Modify: `packages/dashboard/src/index.ts`
- Modify: `packages/local-app/src/index.ts`
- Modify: `packages/evidoc/src/index.ts`
- Modify: `packages/mcp-server/src/index.ts`
- Modify: `packages/cli/test/diagnose-diff.test.ts`
- Modify: `packages/cli/test/onboarding.test.ts`
- Modify: `packages/core/test/open-source-surface.test.ts`
- Modify: `packages/core/test/product-surfaces.test.ts`
- Modify: `packages/core/test/scan.test.ts`
- Modify: `packages/core/test/workflow-warnings.test.ts`
- Modify: `packages/dashboard/test/dashboard.test.ts`
- Modify: `packages/dashboard/test/interactive.test.ts`
- Modify: `packages/dashboard/test/local-app-render.test.ts`
- Modify: `packages/dashboard/test/render.test.ts`
- Modify: `packages/local-app/test/local-app.test.ts`

**Interfaces:**
- Consumes: new manifests and runtime version from Task 2.
- Produces: generated workflow, diagnostics, repair prompts, Local App copy, and MCP setup instructions that all emit the new package/command names.

- [ ] **Step 1: Change test expectations first**

Update fixtures and assertions so generated shell commands use `npx evidoc`, imports use `@evidoc/*`, and MCP examples use `@evidoc/mcp-server` plus `evidoc-mcp`. Preserve GitHub Action source references as `handong66/Evidoc/packages/github-action@v0.3.0`.

- [ ] **Step 2: Run focused tests and confirm failures**

Run: `npm run build && node --test packages/{cli,core,dashboard,local-app,mcp-server}/dist/test/*.test.js`

Expected: FAIL at old generated product strings before source changes.

- [ ] **Step 3: Update generators and runtime copy**

Replace the package/command literals in the named source files. Prefer shared constants when the same identity is emitted in multiple branches; do not change analyzer status logic or write permissions.

- [ ] **Step 4: Run focused tests**

Run: `npm run build && node --test packages/{cli,core,dashboard,local-app,mcp-server}/dist/test/*.test.js`

Expected: PASS.

- [ ] **Step 5: Commit product-surface changes**

```bash
git add packages/cli packages/core packages/dashboard packages/local-app packages/evidoc packages/mcp-server
git commit -m "feat: expose the Evidoc package identity"
```

### Task 4: Make release verification and tarball smoke tests authoritative

**Files:**
- Modify: `scripts/verify-release-version.mjs`
- Modify: `scripts/smoke-npx.mjs`
- Modify: `scripts/release-notes.mjs` if release output embeds an identity
- Modify: `.github/workflows/release.yml`
- Modify: `packages/core/test/release-version.test.ts`
- Modify: `packages/core/test/open-source-surface.test.ts`

**Interfaces:**
- Consumes: package manifests and `0.3.0` runtime version.
- Produces: deterministic package-set verification, dependency-ordered publishing, launcher discovery, and resumable registry-state checks.

- [ ] **Step 1: Write failing release-contract assertions**

Assert that release verification accepts exactly the Task 1 map, tag `v0.3.0`, and no private root publication. Assert that smoke tests identify `evidoc-0.3.0.tgz`, execute `npx --no-install evidoc`, require twelve tarballs, and check `evidoc-mcp` metadata.

- [ ] **Step 2: Run release tests and confirm failure**

Run: `npm run build && node --test packages/core/dist/test/release-version.test.js packages/core/dist/test/open-source-surface.test.js`

Expected: FAIL on the previous verifier/smoke identities.

- [ ] **Step 3: Update verifier and smoke implementation**

Keep an explicit directory-to-package map as the reviewed public allowlist, but make version and internal dependency checks manifest-derived. Update tarball detection and all command executions to `evidoc`; preserve temporary-directory installation of all twelve tarballs.

- [ ] **Step 4: Harden partial-release handling**

In `.github/workflows/release.yml`, preserve dependency order and immutable artifact publication. For each tarball, compute `sha512-$(openssl dgst -sha512 -binary "$tarball" | openssl base64 -A)`. If the target version is `E404`, publish that exact tarball. If it exists, read `dist.integrity` and skip only when it equals the local tarball integrity; otherwise fail before publishing the next package. Do not add token secrets or publish source directories.

- [ ] **Step 5: Run release verification and local tarball smoke**

```bash
npm run release:verify -- --tag v0.3.0
npm run release:smoke:npx
```

Expected: `Release version verified: 0.3.0 across 12 packages for v0.3.0.` and an `npx evidoc smoke passed` summary.

- [ ] **Step 6: Commit release machinery**

```bash
git add scripts .github/workflows/release.yml packages/core/test
git commit -m "release: verify Evidoc 0.3.0 artifacts"
```

### Task 5: Synchronize documentation, examples, changelog, and package READMEs

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `SECURITY.md` if its supported-version table requires `0.3.x`
- Modify: `docs/architecture/full-scope-architecture.md`
- Modify: `docs/configuration.md`
- Modify: `docs/development/mcp-clients.md`
- Modify: `docs/development/release-process.md`
- Modify: `docs/onboarding.md`
- Modify: `docs/vision/pursuit-goal.zh-CN.md`
- Modify: `packages/cli/README.md`
- Modify: `packages/core/README.md`
- Modify: `packages/dashboard/README.md`
- Modify: `packages/evidoc/README.md`
- Modify: `packages/frontmatter/README.md`
- Modify: `packages/github-action/README.md`
- Modify: `packages/graph/README.md`
- Modify: `packages/local-app/README.md`
- Modify: `packages/mcp-server/README.md`
- Modify: `packages/patcher/README.md`
- Modify: `packages/reports/README.md`
- Modify: `packages/review-log/README.md`
- Modify: documentation contract tests under `packages/core/test`

**Interfaces:**
- Consumes: new command, package map, release tag, and MCP bin.
- Produces: one public installation story and release runbook consistent with runtime behavior.

- [ ] **Step 1: Update documentation tests**

Require first-screen onboarding to use `npx evidoc check --fail-on=review_needed`, badges to target `evidoc`, MCP setup to use `@evidoc/mcp-server`, and release instructions to use `v0.3.0` plus the floating Action tag `v0` only after verification.

- [ ] **Step 2: Run documentation contracts and confirm failure**

Run: `npm run build && node --test packages/core/dist/test/open-source-surface.test.js packages/core/dist/test/product-surfaces.test.js`

Expected: FAIL until every public surface is migrated.

- [ ] **Step 3: Rewrite public documentation and package READMEs**

Keep product claims unchanged; change only package, command, version, release, and installation identities. Add a `0.3.0` changelog section describing the intentional pre-user hard cut and new npm organization.

- [ ] **Step 4: Run documentation and stale-identity gates**

```bash
npm run build
node --test packages/core/dist/test/open-source-surface.test.js packages/core/dist/test/product-surfaces.test.js
legacy_scope="@handong66"/"evidoc-"
legacy_launcher="repo"-"evidoc"
rg -n "$legacy_scope|$legacy_launcher" --hidden --glob '!.git/**' --glob '!node_modules/**' --glob '!dist/**' --glob '!.evidoc/**'
```

Expected: tests PASS; `rg` exits 1 with no matches.

- [ ] **Step 5: Commit documentation**

```bash
git add README.md CHANGELOG.md SECURITY.md docs packages/*/README.md packages/core/test
git commit -m "docs: publish the Evidoc npm identity"
```

### Task 6: Full local validation and bounded OpenCode review

**Files:**
- Review: all changes since `v0.2.1`
- Modify: only files required by verified review findings

**Interfaces:**
- Consumes: completed local migration.
- Produces: a release candidate with Codex-verified OpenCode findings and a green acceptance ledger.

- [ ] **Step 1: Run the full local gate**

```bash
npm ci
npm test
npm run release:verify -- --tag v0.3.0
npm run release:smoke:npx
npm run evidoc -- --fail-on=review_needed
git diff --check
```

Expected: all commands exit 0.

- [ ] **Step 2: Inspect packed artifacts**

Pack all twelve workspaces into `.evidoc/release`, list tarball package manifests, confirm no internal/private files, and verify exact internal dependency names/versions.

- [ ] **Step 3: Ask OpenCode for one bounded read-only review**

Goal: find missed npm identities, split-brain version/package logic, broken launcher/MCP paths, and unsafe release assumptions.

Acceptance: findings-first output with exact files/lines; `outputSummary.resultComplete === true`.

Scope: current diff, manifests, `tsconfig.base.json`, `scripts/`, `.github/workflows/release.yml`, public docs, and identity tests.

Forbidden: edits, commits, push, publish, settings changes, secrets, Codex-private paths, subagents.

- [ ] **Step 4: Verify every OpenCode finding locally**

Record claim, current file/runtime evidence, verdict, action, and regression test. Reject phantom or historical-only findings explicitly.

- [ ] **Step 5: Patch accepted findings and rerun affected plus full gates**

Expected: all Task 6 Step 1 commands remain green and the stale scan remains empty.

- [ ] **Step 6: Commit the release candidate**

```bash
git add -A
git commit -m "release: prepare Evidoc 0.3.0 namespace"
```

### Task 7: Bootstrap npm packages and publish v0.3.0

**Files/External state:**
- npm packages: `evidoc` and eleven `@evidoc/*` packages
- npm Trusted Publisher settings for each new package
- GitHub tag/release: `v0.3.0`
- GitHub Action floating tag: `v0`
- Historical package deprecation metadata

**Interfaces:**
- Consumes: exact verified commit and twelve tarballs from Task 6.
- Produces: publicly installable npm packages, GitHub Release, green CI, deprecation pointers, and Action major alias.

- [ ] **Step 1: Push the verified release commit and wait for main CI**

Confirm a clean worktree and push `main` to `origin`. Wait for the exact commit's CI run and require success with no annotations before publishing.

- [ ] **Step 2: Verify npm publication preconditions**

Confirm all target names at version `0.3.0` return registry `E404`, npm owner is `handong66`, organization is `evidoc`, and 2FA is enabled. Refresh CLI authentication without printing tokens.

- [ ] **Step 3: Bootstrap new package records in dependency order**

Publish the exact locally verified tarballs with public access. After each publish, read back name, version, dependencies, dist integrity, repository, engines, files, and executable metadata. Never repack between verification and publication.

- [ ] **Step 4: Configure Trusted Publishing for all twelve packages**

Bind each package to GitHub repository `handong66/Evidoc` and workflow `release.yml`; require the supported Node/npm versions already configured in the workflow.

- [ ] **Step 5: Create and push the release tag**

```bash
git tag -a v0.3.0 -m "Evidoc 0.3.0"
git push origin v0.3.0
```

Expected: Release Artifacts verifies that the already-published tarballs have identical integrity, skips only exact matches, and creates the GitHub Release with no annotations.

- [ ] **Step 6: Verify public installs and GitHub artifacts**

Run in clean temporary directories:

```bash
npx --yes evidoc@0.3.0 --version
npx --yes evidoc@0.3.0 doctor
npx --yes @evidoc/mcp-server@0.3.0 --help
```

Compare npm tarballs with GitHub Release assets byte-for-byte and verify all twelve registry package records.

- [ ] **Step 7: Deprecate historical packages**

Apply clear migration messages only after Step 5 passes. Do not unpublish any package.

- [ ] **Step 8: Move the Action major tag**

```bash
git tag -f v0 v0.3.0
git push origin -f v0
```

Verify `v0`, `v0.3.0`, `origin/main`, and the GitHub Release all resolve to the intended release commit.

- [ ] **Step 9: Final closeout**

Run registry readback, `gh run list`, `gh release view v0.3.0`, public `npx` smoke, and final `git status --short --branch`. Expected: all green; worktree clean and synchronized with `origin/main`.
