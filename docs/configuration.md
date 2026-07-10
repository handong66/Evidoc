# Evidoc Configuration

Most users do not need to edit this file before a first scan. Read this page when `doctor` says config is stale, when no documents are scanned, or when you want to narrow/expand what Evidoc checks.

Evidoc reads `.evidoc/config.json` from the repository root. The file is optional; defaults are intentionally conservative and scan Markdown control surfaces in the repository.
If the file exists but is malformed, unreadable, or contains an invalid field type, scans and `doctor` fail closed with a configuration error instead of silently replacing it with defaults.

`npx evidoc` and `npx evidoc init --yes` also maintain `.evidoc/.gitignore` with `history.jsonl` and `reports/` so local Command Center scan history and Local Git Gate reports stay out of commits. Commit the config and `.evidoc/.gitignore`; leave generated history and reports local.

## Beginner Defaults

If you are unsure, keep the generated config and run:

```bash
npx evidoc doctor
npx evidoc check --fail-on=review_needed
```

Only change `docRoots` when Evidoc is scanning too much or missing the docs you care about. Keep AGENTS.md, CLAUDE.md, Cursor rules, and Copilot instructions in scope when coding agents rely on them.

```json
{
  "docRoots": ["docs", "README.md", "AGENTS.md", "CLAUDE.md"],
  "ignorePatterns": ["docs/archive/**"],
  "severityOverrides": {
    "path.missing-reference": "medium"
  },
  "apiSpecPaths": ["openapi.json"],
  "ownerMapping": {
    "docs/api/**": "@api-maintainers"
  },
  "reviewTtlDays": 90,
  "requireTestsForSources": true,
  "requireDocsForChangedSources": false,
  "maxFileBytes": 500000
}
```

## Fields

- `docRoots`: ordinary document files or directories to scan. Trailing slashes are normalized, so `docs` and `docs/` are equivalent. When omitted or set to an empty array, Evidoc scans all Markdown and MDX files outside ignored build/system directories. Agent instruction control surfaces such as AGENTS.md, CLAUDE.md, Cursor rules, and GitHub Copilot instructions are scanned when present even if `docRoots` is narrowed to README.md or docs/.
- `ignorePatterns`: repository-relative glob patterns to exclude from document scanning.
- `severityOverrides`: rule-id to severity map. Valid severities are `low`, `medium`, and `high`.
- `apiSpecPaths`: explicit OpenAPI/Swagger JSON files to use for API operation and schema drift.
- `ownerMapping`: repository-relative pattern to owner mapping for review routing.
- `reviewTtlDays`: default review window for documents that do not declare a frontmatter TTL.
- `requireTestsForSources`: require tests for files named in frontmatter source bindings.
- `requireDocsForChangedSources`: when true, changed source files in `diff`, `check --changed-only`, and `guard` runs must map to changed documentation, affected documentation, or a source binding. Uncovered source changes produce `coverage.changed-source-without-doc`.
- `maxFileBytes`: skip oversized documents during scans while recording the skip count.

If a configured `docRoots` entry exists but contains no Markdown or MDX documents, normal scans surface a `coverage.no-documents-scanned` review-needed finding with setup guidance. Missing configured roots are reported separately as broken `config.missing-path` findings.

## Local Reports

`evidoc guard` writes local-gate JSON and Markdown reports under `.evidoc/reports/`. These files are generated runtime state, not committed configuration. The JSON report includes:

- changed files, affected documents, and undocumented changed files for the selected Git scope;
- the normal Evidoc report and summary;
- `runtime`, the Agent Runtime Contract with `source`, `event`, `mode`, `scope`, `baseline`, optional `baselineCommit`, `status`, `generatedAt`, `scannedAt`, `changedFileFingerprints`, aggregate `fingerprint`, and per-finding fingerprints.

Agents, local apps, hooks, and internal CI should read this report only when `changedFiles` and `runtime.changedFileFingerprints` match the same scope. Older reports without fingerprints must fall back to `runtime.generatedAt` or `runtime.scannedAt` being fresh for those files, and repeated user-facing reminders should dedupe by `runtime.findings[].fingerprint`.
The aggregate `runtime.fingerprint` is stable across timestamp-only refreshes but changes when event, mode, scope, baseline, affected documents, changed files, changed-file fingerprints, or finding fingerprints change.

## Review Log

Evidoc reads `.evidoc/review-log.jsonl`. Active accepted, false-positive, or fixed decisions suppress matching findings until `expiresAt`. Expired entries are surfaced as `review_log.override-expired` findings.

```jsonl
{"findingId":"README.md:1:path.missing-reference:src/old.ts","decision":"false_positive","reviewer":"maintainer","reviewedAt":"2026-07-05T00:00:00.000Z","expiresAt":"2026-10-03T00:00:00.000Z"}
```
