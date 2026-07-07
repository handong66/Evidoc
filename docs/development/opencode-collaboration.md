# OpenCode Collaboration

OpenCode is used as a bounded second reviewer for Evidoc.

## Division of Labor

- Codex owns scope, workspace state, implementation decisions, verification, git, remote repository creation, and final judgment.
- OpenCode may review documents, challenge architecture gaps, inspect diffs, or implement a narrowly scoped task.
- OpenCode must not commit, push, delete files, clean the worktree, or publish anything.

## Default Review Packet

When asking OpenCode to review Evidoc, use a narrow packet:

```text
Goal: review Evidoc's current docs and implementation for contradictions with the full-product open-source target.
Scope: repository files only.
Constraints: no commits, no pushes, no destructive commands, no secret access, no Codex runtime paths.
Output: findings first, then risks, then concrete recommendations.
```

Codex verifies every OpenCode finding against the actual repository before applying it.
