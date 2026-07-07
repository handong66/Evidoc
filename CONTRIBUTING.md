# Contributing to Evidoc

Evidoc is open-source-first and repo-local by default. Contributions should improve deterministic drift detection, evidence quality, agent safety, or review ergonomics.

## Development

```bash
npm install
npm test
npm run evidoc -- --json
```

Keep changes scoped to the package surface they affect. Add or update Node test-runner tests for behavior changes.

## Review Standard

- Every finding must point to evidence.
- Generated patches must remain proposals that require review.
- New write behavior must be opt-in.
- Do not add default network upload of repository content.
- Do not weaken AGENTS.md, CLAUDE.md, frontmatter, or review-log checks to make a scan pass.

## Pull Requests

Include:

- what changed;
- which package surfaces changed;
- what evidence or detector behavior was added;
- verification commands.

Run `npm test` before opening a PR.
