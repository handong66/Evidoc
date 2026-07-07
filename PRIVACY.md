# Privacy

Evidoc is repo-local by default.

Normal CLI, local app, GitHub Action, and MCP scans do not upload repository content to third-party model providers. Generated reports, MCP tool responses, and benchmark packs are produced from local repository files and stay in the caller's environment unless the caller explicitly shares them.

Telemetry is disabled by default. Evidoc does not currently ship runtime telemetry. Any future telemetry must be explicit opt-in, documented before use, and must not include repository content, secrets, local absolute paths, generated agent logs, dependency directories, or patch contents.

LLM-backed patch drafting, if configured by a caller, is opt-in and separate from normal detection. Deterministic evidence remains the source of authority, and generated patches must be reviewed before merging.

Report security concerns through [SECURITY.md](SECURITY.md).
