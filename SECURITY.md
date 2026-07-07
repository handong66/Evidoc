# Security Policy

Evidoc scans repository content and can expose evidence to local tools. The default design keeps scans local and avoids automatic source upload.

## Reporting

For now, report security issues privately through GitHub private vulnerability reporting if it is enabled on the repository, or open a minimal issue that asks for a private disclosure channel without posting exploit details.

## Security Boundaries

- The CLI and MCP read tools are read-only by default.
- MCP write tools require explicit `allowWrites`.
- Patch generation returns reviewable diffs; it does not silently apply them.
- LLM patch requests are bounded evidence packs and should not be sent to providers unless the operator explicitly configures that workflow.
- Review logs are append-only JSONL records intended for auditability.
