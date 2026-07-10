# Security Policy

Evidoc scans repository content and can expose evidence to local tools. The default design keeps scans local and avoids automatic source upload.

For normal users, the important rule is simple: ordinary CLI scans, the local Web UI, GitHub Action scans, and MCP read tools do not upload repository content to third-party model providers by default. Write paths require explicit commands such as `init`, Local Git hook setup, review-log writes, or `fix --safe --write`.

## Supported Versions

Security fixes are provided for the latest published minor line.

| Version | Supported |
|---------|-----------|
| 0.3.x | Yes |
| 0.2.x and earlier | No |
| Earlier pre-release or unpublished builds | No |

## Reporting

Report security issues privately through GitHub private vulnerability reporting on this repository.
If that private channel is unavailable, open a minimal public issue asking for a private disclosure channel and do not include exploit details, private repository content, tokens, logs, or proof-of-concept payloads.

We aim to acknowledge valid security reports within 5 business days.
After acknowledgment, we will coordinate reproduction, fix scope, release timing, and advisory text with the reporter when practical.

## Disclosure

Please use coordinated disclosure.
Do not publicly post exploit details before a fix, mitigation, or advisory is available.
We may close reports that depend on social engineering, denial-of-service volume, compromised third-party accounts, or access to repositories the reporter is not authorized to access.

## Security Boundaries

- The CLI and MCP read tools are read-only by default.
- MCP write tools require explicit `allowWrites`.
- The Local App binds only to loopback hosts, requires the exact listening authority on every request, rejects cross-origin writes, and limits write endpoints to known repository roots.
- Patch generation returns reviewable diffs. Deterministic safe fixes require an explicit CLI write flag or Local App action; other proposals are not applied.
- LLM patch requests are bounded evidence packs and should not be sent to providers unless the operator explicitly configures that workflow.
- Finding messages, evidence, document text, and review notes are untrusted data. Generated agent prompts and MCP repair payloads tell consumers not to execute instructions embedded in those fields.
- Review logs are append-only JSONL records intended for auditability.
