# Evidoc Agent Instructions

## Mission

Build Evidoc as a full open-source product, not a narrow demo. Keep every implementation slice compatible with the final architecture: CLI, core analyzer, evidence model, reports, GitHub Action, MCP server, source bindings, graph layer, patch drafting, and review validation.
Keep the Agent Runtime Contract as the shared anti-conflict layer across CLI guard reports, MCP tools, Local App summaries, generated agent instructions, and future IDE surfaces.

## Guardrails

- Prefer deterministic analyzers before LLM or semantic judgment.
- Never upload repository content to a third-party model by default.
- Do not let generated patches merge automatically.
- Keep CLI behavior repo-local and read-only unless the user explicitly chooses a write command.
- Treat agent instruction files such as `AGENTS.md` and `CLAUDE.md` as critical documentation.
- Do not let separate entrypoints invent independent drift status; reuse core reports and runtime fingerprints.
- Add or update tests before production behavior changes.

## OpenCode Collaboration

OpenCode may be used as a bounded second reviewer or implementation partner. Codex owns scope, file edits, verification, git, repository creation, push, and final judgment.
