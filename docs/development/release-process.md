# Release Process

Evidoc publishes npm package tarballs and publishes registry packages through npm Trusted Publishing. GitHub Actions receives a short-lived OIDC credential for the configured workflow instead of using a long-lived npm token.

## Preconditions

```bash
npm ci
npm test
npm run release:verify -- --tag v0.3.1
npm run release:smoke:npx
npm run evidoc -- --fail-on=review_needed
npm whoami
```

When `npm run release:smoke:npx` is run locally without an explicit release directory, the script clears its default release directory and re-packs every workspace package before installing the tarballs into a temporary repository. This prevents stale package artifacts from passing as a current-source smoke test. Each package also has a `prepublishOnly` guard that refuses local publish when its package build output or bin entry is missing.
Direct local npm publishing still requires a logged-in maintainer account; `npm whoami` fails on machines that can run dry-runs but cannot publish. GitHub Actions publishing requires a trusted publisher entry on every public package with repository `handong66/Evidoc`, workflow path `.github/workflows/release.yml`, and allowed action `npm publish`.

Eleven component package records were bootstrapped at `0.3.0`. The unscoped launcher was rejected by npm's name-similarity policy, so `@evidoc/evidoc@0.3.1` must be bootstrapped from the exact locally verified tarball with the authenticated `handong66` maintainer account, then configured for Trusted Publishing. Do not repack between smoke verification and this bootstrap publish. After all twelve scoped records and trusted publishers exist, the `v0.3.1` workflow verifies or publishes the same locally rebuilt artifacts before creating the GitHub Release.

Configure or audit the trusted publisher entries with npm CLI 11.15.0 or newer:

```bash
for package in \
  evidoc \
  @evidoc/cli \
  @evidoc/core \
  @evidoc/dashboard \
  @evidoc/frontmatter \
  @evidoc/github-action \
  @evidoc/graph \
  @evidoc/local-app \
  @evidoc/mcp-server \
  @evidoc/patcher \
  @evidoc/reports \
  @evidoc/review-log
do
  npx npm@11.18.0 trust github "$package" --repo handong66/Evidoc --file "$(basename .github/workflows/release.yml)" --allow-publish --yes
  npx npm@11.18.0 trust list "$package"
done
```

After trusted publishing is configured and a publish workflow has succeeded, remove any legacy GitHub npm token secret:

```bash
gh secret delete NPM_TOKEN --repo handong66/Evidoc
```

Before adding a new public npm package or changing package ownership, verify that every intended package name is either still unpublished or already owned by the maintainer account:

```bash
npm view evidoc name version --json
npm view @evidoc/cli name version --json
npm view @evidoc/core name version --json
npm view @evidoc/dashboard name version --json
npm view @evidoc/frontmatter name version --json
npm view @evidoc/github-action name version --json
npm view @evidoc/graph name version --json
npm view @evidoc/local-app name version --json
npm view @evidoc/mcp-server name version --json
npm view @evidoc/patcher name version --json
npm view @evidoc/reports name version --json
npm view @evidoc/review-log name version --json
```

Use explicit local paths for package dry-runs and publish commands. Bare `packages/core`-style arguments can be interpreted by npm as GitHub package shorthand instead of a local directory.

```bash
for package in packages/*; do
  npm pack "./$package" --dry-run --json
done

npm publish ./packages/core --dry-run --access public
```

All public package manifests whitelist `dist/src`, `README.md`, and `LICENSE` through `files`, so release tarballs contain runtime output and the minimum package identity/legal files, but not source tests or TypeScript build metadata. The npx smoke test inspects every tarball for those files before installation.
Release verification also checks the exact 12 public package directories and names before the wildcard pack step, so adding a workspace package cannot silently add a new public artifact.

## Release Artifact Workflow

The `Release Artifacts` GitHub Actions workflow runs on `v*` tags and manual dispatch. Manual runs build and smoke-test artifacts only; npm publishing and GitHub Release creation require an exact version tag. It:

1. installs with `npm ci`;
2. verifies that the root, all workspace manifests, exact internal dependency pins, runtime version, and tag use one version;
3. builds and tests all workspace packages;
4. creates one npm tarball per package with explicit local `npm pack "./$package"` paths;
5. runs `npm run release:smoke:npx -- .evidoc/release`, which checks tarball identity files, installs the local tarballs into temporary repositories, verifies the published `npx @evidoc/evidoc` path across `app --once --json --no-open`, `doctor`, `init --yes`, `check --fail-on=review_needed`, `diagnose`, `fix --safe --json`, `fix --safe --write --json`, and `demo --once --json --no-open`, and starts `evidoc-mcp` for real JSON-RPC `initialize` plus `tools/list` requests;
6. uploads tarballs as workflow artifacts;
7. preflights every intended npm name/version, accepts an existing version only when its registry integrity exactly matches the verified local tarball, fails on any mismatch or registry error, and publishes only missing packages in dependency order;
8. attaches tarballs to a GitHub Release only after tag-triggered npm publishing succeeds, so a failed registry release does not create a green-looking GitHub Release first.

## Versioning

Until the project has external users, package versions can stay synchronized. A release tag should use:

```bash
git tag v0.3.1
git push origin v0.3.1
```

The generated onboarding workflow references the exact matching tag, `handong66/Evidoc/packages/github-action@v0.3.1`. Do not merge or advertise that generated workflow until the tag exists in the public repository.

After the first public release, maintainers can document a pinned release path and move the floating major tag after the exact release tag is pushed:

```bash
git tag -f v0 v0.3.1
git push origin -f v0
```

Do not enable npm publishing until package ownership, package names, trusted publisher entries, and `npm publish ./packages/<name> --dry-run --access public` have been deliberately reviewed.
