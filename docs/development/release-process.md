# Release Process

Evidoc publishes npm package tarballs and can publish registry packages when maintainers provide `NPM_TOKEN` and set the manual `publish` input, or when a tag run has a configured token.

## Preconditions

```bash
npm install
npm test
npm run release:smoke:npx
npm run evidoc -- --fail-on=review_needed
npm whoami
```

When `npm run release:smoke:npx` is run locally without an explicit release directory, the script clears its default release directory and re-packs every workspace package before installing the tarballs into a temporary repository. This prevents stale package artifacts from passing as a current-source smoke test. Each package also has a `prepublishOnly` guard that refuses local publish when its package build output or bin entry is missing.
Direct local npm publishing also requires a logged-in maintainer account; `npm whoami` fails on machines that can run dry-runs but cannot publish. GitHub Actions publishing requires the `NPM_TOKEN` secret.

Before the first public npm release, verify that every intended package name is either still unpublished or already owned by the maintainer account:

```bash
npm view repo-evidoc name version --json
npm view @handong66/evidoc-cli name version --json
npm view @handong66/evidoc-core name version --json
npm view @handong66/evidoc-dashboard name version --json
npm view @handong66/evidoc-frontmatter name version --json
npm view @handong66/evidoc-github-action name version --json
npm view @handong66/evidoc-graph name version --json
npm view @handong66/evidoc-local-app name version --json
npm view @handong66/evidoc-mcp-server name version --json
npm view @handong66/evidoc-patcher name version --json
npm view @handong66/evidoc-reports name version --json
npm view @handong66/evidoc-review-log name version --json
```

Use explicit local paths for package dry-runs and publish commands. Bare `packages/core`-style arguments can be interpreted by npm as GitHub package shorthand instead of a local directory.

```bash
for package in packages/*; do
  npm pack "./$package" --dry-run --json
done

npm publish ./packages/core --dry-run --access public
```

All public package manifests whitelist `dist/src` through `files`, so release tarballs contain runtime build output instead of source files, tests, or TypeScript build metadata.

## Release Artifact Workflow

The `Release Artifacts` GitHub Actions workflow runs on `v*` tags and manual dispatch. It:

1. installs with `npm ci`;
2. builds and tests all workspace packages;
3. creates one npm tarball per package with explicit local `npm pack "./$package"` paths;
4. runs `npm run release:smoke:npx -- .evidoc/release`, which installs the local tarballs into temporary repositories and verifies the published `npx repo-evidoc` path across `app --once --json --no-open`, `doctor`, `init --yes`, `check --fail-on=review_needed`, `diagnose`, `fix --safe --json`, `fix --safe --write --json`, and `demo --once --json --no-open`;
5. uploads tarballs as workflow artifacts;
6. attaches tarballs to a GitHub Release when the run is tag-triggered;
7. optionally publishes all public workspace packages: `repo-evidoc`, `@handong66/evidoc-cli`, `@handong66/evidoc-core`, `@handong66/evidoc-dashboard`, `@handong66/evidoc-frontmatter`, `@handong66/evidoc-github-action`, `@handong66/evidoc-graph`, `@handong66/evidoc-local-app`, `@handong66/evidoc-mcp-server`, `@handong66/evidoc-patcher`, `@handong66/evidoc-reports`, and `@handong66/evidoc-review-log`.

## Versioning

Until the project has external users, package versions can stay synchronized. A release tag should use:

```bash
git tag v0.1.0
git push origin v0.1.0
```

The generated onboarding workflow references `handong66/Evidoc/packages/github-action@main` so a public repository can still adopt the CI path without a release tag.

After the first public release, maintainers can document a pinned release path and move the floating major tag after the exact release tag is pushed:

```bash
git tag -f v0 v0.1.0
git push origin -f v0
```

Do not enable npm publishing until package ownership, package names, secret handling, and `npm publish ./packages/<name> --dry-run --access public` have been deliberately reviewed.
