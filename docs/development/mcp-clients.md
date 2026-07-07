# MCP Clients

Evidoc ships an MCP server through `@handong66/evidoc-mcp-server`.

```bash
npx -p @handong66/evidoc-mcp-server repo-evidoc-mcp
```

The server exposes `evidoc.agent_scan` as the default read-only repair entrypoint, `evidoc.get_drift_status` as the status entrypoint, and `evidoc.diagnose_drift` / `evidoc.suggest_doc_fix` for focused repair context.
It also includes read tools for repository contracts, document search, drift checks, evidence packs, patch drafting, and patch validation.
`evidoc.record_review` is the write tool and requires explicit server configuration; no MCP tool applies file patches by default.

Agents should call `evidoc.get_drift_status` before answering whether docs drifted when that tool is listed, and `evidoc.agent_scan` before repairing drift. Both use the same core scanner and Agent Runtime Contract. `evidoc.agent_scan` runs a fresh repo-local scan and returns one JSON bundle with:

- `runtime.source`, `runtime.event`, `runtime.mode`, `runtime.scope`, `runtime.status`, and runtime fingerprints for deduped agent replies;
- `coldStart.status`, `freshness.status`, `partial`, `scannedAt`, and when the bundle becomes stale;
- affected document files and evidence categories for read-parity repair;
- each finding's structured evidence, suggested action, repair mode, and patch classification;
- safe-fix preview, diagnose, and verification commands;
- a privacy contract stating that repository content upload and telemetry are disabled by default.

Use `evidoc.diagnose_drift` when the agent needs a compact list of findings with runtime fingerprints and repair modes, and `evidoc.suggest_doc_fix` when it needs evidence-bound patch proposal data without writing files. The older narrower tools remain useful after the default bundle points to a focused follow-up, for example explaining one finding, searching docs for a literal term, or validating a proposed patch.

All `root` arguments are confined to the MCP server working directory and must point at a repository root, such as a git checkout or a directory with `.evidoc/config.json`.
Start the server with the repository or workspace parent as `cwd`; Evidoc rejects roots outside that boundary even when `--allow-writes` is enabled.
If a tool call omits `root`, Evidoc only scans the startup `cwd` when it looks like a repository.
Otherwise the tool returns an explicit-root error instead of silently scanning the wrong directory.
Set `EVIDOC_ROOT=/path/to/repository` when an MCP client cannot set `cwd`; an invalid `EVIDOC_ROOT` fails startup instead of silently falling back.
Review-log writes are append-only and pass the same realpath/symlink boundary check used by the scanner and patcher.

## Claude Desktop

```json
{
  "mcpServers": {
    "evidoc": {
      "command": "npx",
      "args": ["-p", "@handong66/evidoc-mcp-server", "repo-evidoc-mcp"],
      "cwd": "/path/to/repository",
      "env": {
        "EVIDOC_ROOT": "/path/to/repository"
      }
    }
  }
}
```

## Codex

Use a local MCP server entry that runs `npx -p @handong66/evidoc-mcp-server repo-evidoc-mcp` with the target repository or workspace parent as `cwd`. Keep write tools disabled unless the thread explicitly needs to append a review-log decision.

## Cursor

Register a custom MCP server with command `npx`, arguments `-p`, `@handong66/evidoc-mcp-server`, and `repo-evidoc-mcp`, with the workspace root as the working directory.

## OpenCode

Run Evidoc through the CLI when OpenCode needs deterministic evidence:

```bash
npx repo-evidoc check --json
npx repo-evidoc agent-eval --json
npx repo-evidoc graph --json
npx repo-evidoc draft --json
```

Use the MCP server when the OpenCode environment supports MCP tool registration. Codex remains responsible for verifying any OpenCode recommendation against repository files and test output.
